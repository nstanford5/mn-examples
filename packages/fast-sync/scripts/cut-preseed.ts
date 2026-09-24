// Re-cut the pre-seed reference bundle for a network.
//
// A reference bundle is one throwaway EMPTY wallet synced to chain tip, with
// its three sub-wallet states serialized and gzipped. New wallets restore from
// it (with their own keys swapped in by preseed.ts) instead of walking the
// chain from genesis.
//
// The bundle only ever goes stale, never wrong — a wallet syncs forward from
// it — but staleness costs roughly half a second of catch-up per hour of age,
// paid on every wallet build. Re-cut when that gets annoying.
//
// TWO RULES:
//
//  1. The cutting wallet MUST be empty and MUST never be funded. The bundle is
//     shipped in the repo precisely because it holds public chain state and a
//     public key that gets replaced. A funded wallet's own coins would end up
//     in it.
//
//  2. Re-cutting INVALIDATES fast-sync for wallets minted before the new cut.
//     isSeedable() refuses to seed a wallet whose birthday predates the
//     reference, because doing so would start it past its own funding
//     transaction and hide those funds. So a re-cut means re-running
//     `yarn wallets:new` and re-funding at the faucet. Cut first, mint second.

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import * as Rx from 'rxjs';
import type { FacadeState } from '@midnight-ntwrk/wallet-sdk';
import pino from 'pino';
import {
  assembleWallet,
  getChainTipHeight,
  getConfig,
  loadReferenceBundle,
  REFERENCE_ROOT,
} from '../src/index.js';

const PARTS = ['shielded', 'unshielded', 'dust'] as const;
const STREAMS: Record<string, string> = {
  shielded: 'zswapLedgerEvents',
  dust: 'dustLedgerEvents',
};

const network = process.env['MIDNIGHT_NETWORK'] ?? 'preprod';
// Bootstrapping the cutter from the existing bundle is much faster, but it
// replays the whole gap between that bundle's cursor and tip through the
// dedup/restore path. Past a certain staleness that path is where things break
// (a WASM replay error in DustLocalState, or the indexer dropping the long
// subscription). --from-genesis takes the slow, boring road instead: no
// restore, no dedup, just a normal sync. Use it when a bootstrapped cut fails.
const fromGenesis = process.argv.includes('--from-genesis');
const config = getConfig(network);
const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

if (network === 'local') {
  throw new Error('A local devnet syncs from genesis in seconds; it needs no reference bundle.');
}

setNetworkId(config.networkId);

const envConfig: EnvironmentConfiguration = {
  walletNetworkId: config.networkId,
  networkId: config.networkId,
  indexer: config.indexer,
  indexerWS: config.indexerWS,
  node: config.node,
  nodeWS: config.nodeWS,
  faucet: config.faucet,
  proofServer: config.proofServer,
};

function isComplete(progress: unknown): boolean {
  const c = progress as { isStrictlyComplete?: () => boolean } | null;
  return typeof c?.isStrictlyComplete === 'function' && c.isStrictlyComplete();
}

/** "<complete> (applied/target)" — the applied index is the stall detector. */
function fmt(progress: unknown): string {
  const done = isComplete(progress);
  const p = progress as {
    appliedIndex?: bigint; highestRelevantWalletIndex?: bigint;
    appliedId?: bigint; highestTransactionId?: bigint;
  } | null;
  const applied = p?.appliedIndex ?? p?.appliedId;
  const target = p?.highestRelevantWalletIndex ?? p?.highestTransactionId;
  return applied === undefined || target === undefined
    ? `${done}`
    : `${done} (${applied}/${target})`;
}

// A throwaway seed, generated here and never written down: the wallet exists
// only long enough to reach tip and be serialized. It must stay empty.
const seed = randomBytes(32).toString('hex');
const tipAtStart = await getChainTipHeight(config.indexer);
if (tipAtStart === undefined) {
  throw new Error(`Could not read the ${network} chain tip from ${config.indexer}.`);
}

const existing = fromGenesis ? null : loadReferenceBundle(REFERENCE_ROOT, config.networkId);
logger.info(
  fromGenesis
    ? `--from-genesis: syncing the cutter from genesis to tip ${tipAtStart}. Slow (~78 min on preprod) but it avoids the restore/dedup replay path entirely.`
    : existing
      ? `Bootstrapping the cutter from the current reference (height ${existing.height}); tip is ${tipAtStart}.`
      : `No existing ${config.networkId} reference — the cutter syncs from genesis, which is slow.`,
);

const assembled = await assembleWallet(
  logger,
  envConfig,
  { kind: 'seed', value: seed },
  fromGenesis
    ? undefined
    : {
        referenceRoot: REFERENCE_ROOT,
        // The wallet was created just now, so the current tip is its true birthday.
        birthday: tipAtStart,
      },
);

const syncTimeoutMs = Number(
  process.env['MIDNIGHT_SYNC_TIMEOUT_MS'] ?? (fromGenesis ? 180 * 60_000 : 90 * 60_000),
);
await assembled.facade.start(assembled.zswapSecretKeys, assembled.dustSecretKey);

try {
  logger.info('Syncing the cutter to chain tip...');
  let emissions = 0;
  await Rx.firstValueFrom(
    assembled.facade.state().pipe(
      Rx.tap((s: FacadeState) => {
        emissions++;
        if (emissions % 10 === 1) {
          logger.info(
            `sync [${emissions}]: shielded=${fmt(s.shielded.state.progress)}, ` +
              `unshielded=${fmt(s.unshielded.progress)}, dust=${fmt(s.dust.state.progress)}`,
          );
        }
      }),
      Rx.filter(
        (s: FacadeState) =>
          isComplete(s.shielded.state.progress) &&
          isComplete(s.unshielded.progress) &&
          isComplete(s.dust.state.progress),
      ),
      Rx.take(1),
      Rx.timeout({
        each: syncTimeoutMs,
        with: () => Rx.throwError(() => new Error(`Cutter sync timed out after ${syncTimeoutMs}ms`)),
      }),
    ),
  );
  logger.info(`Cutter synced after ${emissions} emissions. Serializing...`);

  // The height the bundle claims, and the one place in this script where an
  // off-by-one in the wrong DIRECTION is a safety bug rather than a slowdown.
  //
  // Call T the height the serialized state's cursors actually cover. The guard
  // admits any wallet whose birthday B >= the claimed height H. A wallet is
  // safe to seed only when B >= T, because anything that happened to it in
  // [B, T) sits before the restored cursor and would never be scanned.
  //
  //   H >= T  ->  B >= H >= T. Safe. Over-claiming only turns wallets away.
  //   H <  T  ->  admits B in [H, T). UNSAFE: silently hides those funds.
  //
  // So read the tip AFTER the sync: the chain only moves forward, so a tip
  // observed once the wallet is at T is necessarily >= T. `tipAtStart` was read
  // before the sync and is therefore < T — using it as a fallback would be the
  // exact inversion this comment exists to prevent. If the read fails, stop.
  const postSyncTip = await getChainTipHeight(config.indexer);
  if (postSyncTip === undefined) {
    throw new Error(
      'Synced, but could not read the chain tip to stamp the manifest. Refusing to guess: a ' +
        'height below what the state actually covers would let unsafe wallets be seeded. ' +
        'Nothing was written; re-run.',
    );
  }
  const height = postSyncTip;

  const states: Record<string, string> = {
    shielded: await assembled.subWallets.shielded.serializeState(),
    unshielded: await assembled.subWallets.unshielded.serializeState(),
    dust: await assembled.subWallets.dust.serializeState(),
  };

  // Stage into a scratch root and only swap into place once the result has
  // been validated. Writing straight over the live bundle would mean a failed
  // cut destroys the working one.
  const stagingRoot = join(REFERENCE_ROOT, `.staging-${config.networkId}`);
  const dir = join(stagingRoot, config.networkId);
  rmSync(stagingRoot, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const parts: Record<string, { bytes: number; gzipBytes: number }> = {};
  const witnesses: Record<string, { stream: string; id: number; digest: string }> = {};
  for (const part of PARTS) {
    const raw = states[part]!;
    const gz = gzipSync(Buffer.from(raw, 'utf8'), { level: 9 });
    writeFileSync(join(dir, `${part}.dat.gz`), gz);
    parts[part] = { bytes: Buffer.byteLength(raw, 'utf8'), gzipBytes: gz.length };

    const stream = STREAMS[part];
    if (stream) {
      const offset = Number((JSON.parse(raw) as { offset?: string | number }).offset ?? 0);
      witnesses[part] = {
        stream,
        id: offset,
        digest: createHash('sha256').update(raw).digest('hex').slice(0, 16),
      };
    }
  }

  writeFileSync(
    join(dir, 'manifest.json'),
    `${JSON.stringify({ network: config.networkId, height, parts, witnesses }, null, 2)}\n`,
  );

  // Validate the staged bundle before it replaces anything. loadReferenceBundle
  // fails closed — a bundle it rejects would silently degrade every future run
  // to a full genesis sync, which is the kind of thing nobody notices for weeks.
  // It also rejects a genesis-sentinel cursor, so this doubles as proof that the
  // cutter really reached tip rather than serializing an empty state.
  const verified = loadReferenceBundle(stagingRoot, config.networkId);
  if (!verified) {
    rmSync(stagingRoot, { recursive: true, force: true });
    throw new Error(
      'The freshly cut bundle does not load back, so it has been discarded and the existing ' +
        `${config.networkId} bundle is untouched. Re-run with LOG_LEVEL=debug to investigate.`,
    );
  }
  if (verified.height !== height) {
    rmSync(stagingRoot, { recursive: true, force: true });
    throw new Error(`Manifest height mismatch: wrote ${height}, read back ${verified.height}.`);
  }

  const live = join(REFERENCE_ROOT, config.networkId);
  rmSync(live, { recursive: true, force: true });
  renameSync(dir, live);
  rmSync(stagingRoot, { recursive: true, force: true });

  const total = PARTS.reduce((n, p) => n + parts[p]!.gzipBytes, 0);
  logger.info(
    `Wrote ${config.networkId} reference at height ${height} ` +
      `(${(total / 1e6).toFixed(1)} MB gzipped) to ${live}`,
  );
  logger.info(
    'Next: `yarn wallets:new` to mint wallets against this reference, then fund them. ' +
      'Any wallet minted BEFORE this cut can no longer fast-sync — see FAST-SYNC.md.',
  );
} finally {
  await assembled.facade.stop().catch((err: unknown) => logger.warn(`stop() failed: ${String(err)}`));
}
