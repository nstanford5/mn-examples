// This file is part of example-shielded-chips.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.


// Privacy-assumption verification for the shielded-chips DApp.
//
// This is NOT a re-run of the functional e2e test. It runs one focused
// bet→reveal→claim round and then MECHANICALLY checks the privacy claims the
// README and the two contracts make, by capturing the ephemeral secrets that
// should never leak (the escrowed bet-coin nonce, the payout-coin nonce, the
// player's Zswap wallet key) and asserting they are absent from the on-chain
// public ledger state of BOTH contracts.
//
// Claims under test (from README "Privacy model" + roulette.compact header):
//   P1  No player coin nonce is ever in public state — INBOUND: the escrowed
//       bet coin's nonce does not appear in roulette public state.
//   P2  OUTBOUND: the payout coin's nonce (derived from the escrow coin via
//       mergeCoin's first argument) does not appear in public state, and is not
//       equal to the public house match-coin nonce it was merged with.
//   P3  The player's wallet identity (Zswap coin public key) never hits chain.
//   P4  betCommits stores a *commitment*, not the coin: the stored value equals
//       persistentCommit and is not any field of the escrowed coin.
//   P5  Behavior IS public: the pseudonym is a public map key, and the bet
//       color / bet value / paid outcome are readable.
//   P6  The winning number is private until reveal — only a hash is on chain,
//       and it is not the number.
//   P7  Recipient-private mint: the coin Alice minted to Bob leaves no nonce in
//       the chips contract's public state.
//   P8  Issuer-unlinkability residual: a self-transfer re-nonces Bob's chip, so
//       the coin he bets is not the coin the issuer minted him.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  deployContract,
  submitCallTx,
  type DeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import {
  type ContractAddress,
  encodeCoinPublicKey,
  encodeRawTokenType,
} from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { rawTokenType } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import pino from 'pino';

import { getConfig } from '../config.js';
import { MidnightWalletProvider, syncWallet } from '../wallet.js';
import { buildProviders, type ShieldedChipsProviders } from '../providers.js';
import {
  CompiledRouletteContract,
  CompiledChipsContract,
  RouletteContract,
  ChipsContract,
  rouletteLedger,
  chipsLedger,
  BetState,
  Color,
  type RouletteLedger,
  type ChipsLedger,
  rouletteZkConfigPath,
  chipsZkConfigPath,
} from '../../contract/index.js';
import {
  createRoulettePrivateState,
  rememberEscrow,
  type QualifiedCoin,
  type RoulettePrivateState,
} from '../../contract/witnesses.js';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { resolveWallet, waitForNightThenDust } from '@midnight-ntwrk/example-fast-sync';
import { WebSocket } from 'ws';

// Required for GraphQL subscriptions in Node.js
// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
const isRemote = network !== 'local';
const syncTimeoutMs = Number(
  process.env['MIDNIGHT_SYNC_TIMEOUT_MS'] ?? (isRemote ? 60 * 60_000 : 10 * 60_000),
);

/**
 * Build, start, sync, and (on a remote network) fund-gate one wallet.
 *
 * Locally, ALICE/BOB/CHARLIE are the genesis-funded seeds 01/02/03. Remotely
 * they are the shared wallets in the repo-root .env.<network>, fast-syncing
 * from the reference bundle when a birthday is recorded. See FAST-SYNC.md.
 */
async function buildWallet(
  role: 'ALICE' | 'BOB' | 'CHARLIE',
  env: EnvironmentConfiguration,
  faucet: string,
): Promise<MidnightWalletProvider> {
  const setup = resolveWallet(network, role);
  const w = await MidnightWalletProvider.build(logger, env, setup.secret, {
    fastSync: setup.fastSync,
  });
  await w.start();
  await syncWallet(logger, w.wallet, syncTimeoutMs);
  if (isRemote) {
    // Synced is not funded: a wallet with no DUST fails its first submit.
    await waitForNightThenDust(logger, w.wallet, w.unshieldedKeystore, env, faucet, {
      label: setup.role,
    });
  }
  return w;
}

const hex = (u: Uint8Array): string => Buffer.from(u).toString('hex');

type Labeled = { label: string; bytes: Uint8Array };

// Every Uint8Array that lives in the roulette contract's PUBLIC ledger state.
// If a value is not in here, it is not on chain (for this contract).
function collectRouletteBytes(l: RouletteLedger): Labeled[] {
  const out: Labeled[] = [];
  out.push({ label: 'theHouse', bytes: l.theHouse });
  out.push({ label: 'chipColor', bytes: l.chipColor });
  out.push({ label: 'winningNumHash', bytes: l.winningNumHash });
  for (const [k, v] of l.bets) out.push({ label: `bets.key`, bytes: k }), void v;
  for (const [k, v] of l.betCommits) {
    out.push({ label: 'betCommits.key(pseudonym)', bytes: k });
    out.push({ label: 'betCommits.value(commitment)', bytes: v });
  }
  for (const [k] of l.betValues) out.push({ label: 'betValues.key(pseudonym)', bytes: k });
  for (const k of l.paidWinners) out.push({ label: 'paidWinners.elem(pseudonym)', bytes: k });
  for (const [k, coin] of l.houseCoins) {
    out.push({ label: 'houseCoins.key', bytes: k });
    out.push({ label: 'houseCoins.coin.nonce', bytes: coin.nonce });
    out.push({ label: 'houseCoins.coin.color', bytes: coin.color });
  }
  return out;
}

function collectChipsBytes(l: ChipsLedger): Labeled[] {
  const out: Labeled[] = [];
  out.push({ label: '_domain', bytes: l._domain });
  out.push({ label: 'theHouse', bytes: l.theHouse });
  for (const [k, coin] of l._treasury) {
    out.push({ label: '_treasury.key', bytes: k });
    out.push({ label: '_treasury.coin.nonce', bytes: coin.nonce });
    out.push({ label: '_treasury.coin.color', bytes: coin.color });
  }
  return out;
}

function findLeak(pool: Labeled[], target: Uint8Array): string | null {
  const t = hex(target);
  for (const { label, bytes } of pool) if (hex(bytes) === t) return label;
  return null;
}

type ShieldedCoinArg = { nonce: Uint8Array; color: Uint8Array; value: bigint };

describe(`Privacy assumptions of shielded-chips (mechanical, on-chain) (${network})`, () => {
  let aliceWallet: MidnightWalletProvider;
  let bobWallet: MidnightWalletProvider;

  let aliceChipsProv: ShieldedChipsProviders;
  let bobChipsProv: ShieldedChipsProviders;
  let aliceRouletteProv: ShieldedChipsProviders;
  let bobRouletteProv: ShieldedChipsProviders;

  let chipsAddress: ContractAddress;
  let rouletteAddress: ContractAddress;
  let chipColorBytes: Uint8Array;
  let chipColorHex: string;

  // Captured secrets that MUST NOT leak into public state.
  let bobMintedNonce: Uint8Array; // nonce of the coin the issuer minted to Bob
  let bobBetNonce: Uint8Array; // nonce of the (re-nonced) coin Bob escrowed
  let bobPayoutNonce: Uint8Array; // nonce of the coin Bob was paid
  let bobCoinPk: Uint8Array; // Bob's Zswap wallet key
  let bobPseudonym: Uint8Array; // Bob's public dapp pseudonym (behavior-public)
  let publicMatchNonce: Uint8Array; // the house match coin nonce (public)

  const config = getConfig();

  const ALICE_CHIPS = 'PrivAliceChips';
  const ALICE_ROULETTE = 'PrivAliceRoulette';
  const BOB_CHIPS = 'PrivBobChips';
  const BOB_ROULETTE = 'PrivBobRoulette';

  const BET = 100n;
  const WINNING = 1n; // RED → Bob (RED) wins

  const CHIP_NAME = 'Roulette Chips';
  const CHIP_SYMBOL = 'CHIP';
  const CHIP_DECIMALS = 0n;
  const CHIP_DOMAIN = (() => {
    const d = new Uint8Array(32);
    d.set(new Uint8Array(Buffer.from('roulette:chip:', 'utf8')));
    return d;
  })();

  const aliceSk = new Uint8Array(randomBytes(32));
  const bobSk = new Uint8Array(randomBytes(32));
  const bobSalt = new Uint8Array(randomBytes(32));

  const mintNonce = (): Uint8Array => new Uint8Array(randomBytes(32));

  async function queryRoulette(): Promise<RouletteLedger> {
    const s = await aliceRouletteProv.publicDataProvider.queryContractState(rouletteAddress);
    expect(s).not.toBeNull();
    return rouletteLedger(s!.data);
  }
  async function queryChips(): Promise<ChipsLedger> {
    const s = await aliceChipsProv.publicDataProvider.queryContractState(chipsAddress);
    expect(s).not.toBeNull();
    return chipsLedger(s!.data);
  }

  async function takeChipCoin(w: MidnightWalletProvider): Promise<ShieldedCoinArg> {
    const st = await w.wallet.waitForSyncedState();
    const chip = st.shielded.availableCoins.find((c) => c.coin.type === chipColorHex);
    if (!chip) throw new Error(`No chip coin in wallet; saw ${st.shielded.availableCoins.map((c) => c.coin.type).join(',')}`);
    return {
      nonce: Uint8Array.from(Buffer.from(chip.coin.nonce, 'hex')),
      color: chipColorBytes,
      value: chip.coin.value,
    };
  }
  async function chipBalance(w: MidnightWalletProvider): Promise<bigint> {
    const st = await w.wallet.waitForSyncedState();
    return st.shielded.balances[chipColorHex] ?? 0n;
  }

  async function escrowMtIndex(blockHeight: number): Promise<bigint> {
    const query = `{ block(offset:{height:${blockHeight}}) { transactions {
        ... on RegularTransaction { zswapStartIndex }
        contractActions { address ... on ContractCall { entryPoint } } } } }`;
    const res = await fetch(config.indexer, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const body = (await res.json()) as {
      data: { block: { transactions: { zswapStartIndex?: number; contractActions: { address: string; entryPoint?: string }[] }[] } | null };
    };
    const txs = body.data.block?.transactions ?? [];
    const match = txs.find((t) => t.contractActions?.some((a) => a.address === rouletteAddress && a.entryPoint === 'betColor'));
    if (match?.zswapStartIndex === undefined) throw new Error(`No betColor tx in block ${blockHeight}`);
    return BigInt(match.zswapStartIndex);
  }

  beforeAll(async () => {
    setNetworkId(config.networkId);
    const env: EnvironmentConfiguration = {
      walletNetworkId: config.networkId,
      networkId: config.networkId,
      indexer: config.indexer,
      indexerWS: config.indexerWS,
      node: config.node,
      nodeWS: config.nodeWS,
      faucet: config.faucet,
      proofServer: config.proofServer,
    };
    aliceWallet = await buildWallet('ALICE', env, config.faucet);
    bobWallet = await buildWallet('BOB', env, config.faucet);

    aliceChipsProv = buildProviders(aliceWallet, chipsZkConfigPath, config, 'p-chips-alice');
    bobChipsProv = buildProviders(bobWallet, chipsZkConfigPath, config, 'p-chips-bob');
    aliceRouletteProv = buildProviders(aliceWallet, rouletteZkConfigPath, config, 'p-roul-alice');
    bobRouletteProv = buildProviders(bobWallet, rouletteZkConfigPath, config, 'p-roul-bob');

    bobCoinPk = encodeCoinPublicKey(bobWallet.getCoinPublicKey());
    logger.info('Privacy harness providers ready');
  });

  afterAll(async () => {
    if (aliceWallet) await aliceWallet.stop();
    if (bobWallet) await bobWallet.stop();
  });

  it('sets up: deploy chips, mint to Alice+Bob, deploy roulette, house deposit', async () => {
    // chips
    const deployedChips: DeployedContract<ChipsContract> = await deployContract<ChipsContract>(aliceChipsProv, {
      compiledContract: CompiledChipsContract,
      privateStateId: ALICE_CHIPS,
      initialPrivateState: createRoulettePrivateState(aliceSk),
      args: [CHIP_NAME, CHIP_SYMBOL, CHIP_DECIMALS, CHIP_DOMAIN],
    });
    chipsAddress = deployedChips.deployTxData.public.contractAddress;
    chipColorHex = rawTokenType(CHIP_DOMAIN, chipsAddress);
    chipColorBytes = encodeRawTokenType(chipColorHex);

    bobChipsProv.privateStateProvider.setContractAddress(chipsAddress);
    await bobChipsProv.privateStateProvider.set(BOB_CHIPS, createRoulettePrivateState(bobSk));

    const aliceCoinPk = aliceWallet.getCoinPublicKey();
    const bobCoinPkHex = bobWallet.getCoinPublicKey();
    const encMap = new Map<string, string>([
      [aliceCoinPk, aliceWallet.getEncryptionPublicKey()],
      [bobCoinPkHex, bobWallet.getEncryptionPublicKey()],
    ]);
    const mintTo = async (recipient: { bytes: Uint8Array }) => {
      await submitCallTx<ChipsContract, 'mint'>(aliceChipsProv, {
        compiledContract: CompiledChipsContract,
        contractAddress: chipsAddress,
        privateStateId: ALICE_CHIPS,
        circuitId: 'mint',
        args: [recipient, BET, mintNonce()],
        additionalCoinEncPublicKeyMappings: encMap,
      });
    };
    await mintTo({ bytes: encodeCoinPublicKey(aliceCoinPk) }); // match coin
    await mintTo({ bytes: bobCoinPk }); // Bob's chip

    await syncWallet(logger, aliceWallet.wallet, 600_000);
    await syncWallet(logger, bobWallet.wallet, 600_000);
    // Capture the exact coin the issuer minted to Bob (P7/P8).
    bobMintedNonce = (await takeChipCoin(bobWallet)).nonce;
    logger.info(`Bob minted-coin nonce: ${hex(bobMintedNonce)}`);

    // roulette
    const deployedRoul: DeployedContract<RouletteContract> = await deployContract<RouletteContract>(aliceRouletteProv, {
      compiledContract: CompiledRouletteContract,
      privateStateId: ALICE_ROULETTE,
      initialPrivateState: createRoulettePrivateState(aliceSk),
      args: [WINNING, chipColorBytes],
    });
    rouletteAddress = deployedRoul.deployTxData.public.contractAddress;

    // house deposit one match coin
    const match = await takeChipCoin(aliceWallet);
    await submitCallTx<RouletteContract, 'houseDeposit'>(aliceRouletteProv, {
      compiledContract: CompiledRouletteContract,
      contractAddress: rouletteAddress,
      privateStateId: ALICE_ROULETTE,
      circuitId: 'houseDeposit',
      args: [match],
    });
    const rl = await queryRoulette();
    expect(rl.houseCoins.size()).toEqual(1n);
    publicMatchNonce = [...rl.houseCoins][0]![1].nonce;
    expect(rl.betState).toEqual(BetState.OPEN);
  }, 1_800_000);

  it('P6: before reveal, the winning number is only a hash on chain (not the number)', async () => {
    const rl = await queryRoulette();
    expect(rl.betState).toEqual(BetState.OPEN);
    // The number 1 as Bytes<32> would be 31 zero bytes + 0x01. The stored hash
    // must not equal that, and winningColor must still be the default (GREEN=0).
    const numberAsBytes = new Uint8Array(32); // 0x00..00; getColor(1) not yet applied
    expect(hex(rl.winningNumHash)).not.toEqual(hex(numberAsBytes));
    const oneAsBytes = new Uint8Array(32);
    oneAsBytes[31] = 1;
    expect(hex(rl.winningNumHash)).not.toEqual(hex(oneAsBytes));
    expect(rl.winningNumHash.length).toEqual(32);
    expect(rl.winningColor).toEqual(Color.GREEN); // default, unrevealed
  });

  it('P8: Bob re-nonces his chip so the coin he bets is not the coin he was minted', async () => {
    await bobWallet.splitShieldedCoin(chipColorHex, BET);
    await syncWallet(logger, bobWallet.wallet, 600_000);
    const after = await takeChipCoin(bobWallet);
    expect(hex(after.nonce)).not.toEqual(hex(bobMintedNonce));
    expect(after.value).toEqual(BET);
  }, 1_800_000);

  it('Bob bets RED; the escrowed coin nonce is captured as a secret', async () => {
    const bobPS = createRoulettePrivateState(bobSk, bobSalt);
    bobRouletteProv.privateStateProvider.setContractAddress(rouletteAddress);
    await bobRouletteProv.privateStateProvider.set(BOB_ROULETTE, bobPS);

    const chip = await takeChipCoin(bobWallet);
    bobBetNonce = chip.nonce; // SECRET: escrowed coin nonce
    logger.info(`Bob bet-coin nonce (secret): ${hex(bobBetNonce)}`);

    const tx = await submitCallTx<RouletteContract, 'betColor'>(bobRouletteProv, {
      compiledContract: CompiledRouletteContract,
      contractAddress: rouletteAddress,
      privateStateId: BOB_ROULETTE,
      circuitId: 'betColor',
      args: [chip, Color.RED],
    });

    // persist escrow so claim can reopen it
    const mtIndex = await escrowMtIndex(tx.public.blockHeight);
    const escrowed: QualifiedCoin = { nonce: chip.nonce, color: chip.color, value: chip.value, mt_index: mtIndex };
    await bobRouletteProv.privateStateProvider.set(BOB_ROULETTE, rememberEscrow(bobPS, escrowed));

    const rl = await queryRoulette();
    expect(rl.betCommits.size()).toEqual(1n);
    bobPseudonym = [...rl.betCommits][0]![0]; // pseudonym = map key (public)
    logger.info(`Bob pseudonym (public): ${hex(bobPseudonym)}`);
  }, 1_800_000);

  it('P4: betCommits stores a commitment, not the escrowed coin', async () => {
    const rl = await queryRoulette();
    const commitment = rl.betCommits.lookup(bobPseudonym);
    expect(commitment.length).toEqual(32);
    // The commitment is not any raw field of the coin it hides.
    expect(hex(commitment)).not.toEqual(hex(bobBetNonce));
    expect(hex(commitment)).not.toEqual(hex(chipColorBytes));
    // And there is deliberately no coin stored under the player's key anywhere.
  });

  it('P5: behavior is public — pseudonym, bet color and bet value are readable', async () => {
    const rl = await queryRoulette();
    expect(rl.bets.member(bobPseudonym)).toBe(true);
    expect(rl.bets.lookup(bobPseudonym)).toEqual(Color.RED); // what he bet
    expect(rl.betValues.lookup(bobPseudonym)).toEqual(BET); // how much
  });

  it('Alice reveals; Bob claims his 2x', async () => {
    await submitCallTx<RouletteContract, 'revealWinningNumber'>(aliceRouletteProv, {
      compiledContract: CompiledRouletteContract,
      contractAddress: rouletteAddress,
      privateStateId: ALICE_ROULETTE,
      circuitId: 'revealWinningNumber',
      args: [WINNING],
    });
    let rl = await queryRoulette();
    expect(rl.betState).toEqual(BetState.CLOSED);
    expect(rl.winningColor).toEqual(Color.RED);

    const matchKey = [...rl.houseCoins].find(([, c]) => c.value === BET)![0];
    await submitCallTx<RouletteContract, 'claimWinnings'>(bobRouletteProv, {
      compiledContract: CompiledRouletteContract,
      contractAddress: rouletteAddress,
      privateStateId: BOB_ROULETTE,
      circuitId: 'claimWinnings',
      args: [matchKey],
    });

    await syncWallet(logger, bobWallet.wallet, 600_000);
    expect(await chipBalance(bobWallet)).toEqual(2n * BET);
    // Capture the nonce of the coin Bob was actually paid (P2, outbound).
    bobPayoutNonce = (await takeChipCoin(bobWallet)).nonce;
    logger.info(`Bob payout-coin nonce (secret): ${hex(bobPayoutNonce)}`);

    rl = await queryRoulette();
    expect(rl.paidWinners.member(bobPseudonym)).toBe(true); // P5: outcome public
  }, 1_800_000);

  // ---- The core assertions: nothing that identifies Bob is on chain --------

  it('P1 (inbound): the escrowed bet-coin nonce is absent from all public state', async () => {
    const roul = collectRouletteBytes(await queryRoulette());
    const chips = collectChipsBytes(await queryChips());
    const leakR = findLeak(roul, bobBetNonce);
    const leakC = findLeak(chips, bobBetNonce);
    expect(leakR, `bet nonce leaked into roulette.${leakR}`).toBeNull();
    expect(leakC, `bet nonce leaked into chips.${leakC}`).toBeNull();
  });

  it('P2 (outbound): the payout-coin nonce is absent from public state and is not the public match nonce', async () => {
    const roul = collectRouletteBytes(await queryRoulette());
    const chips = collectChipsBytes(await queryChips());
    expect(findLeak(roul, bobPayoutNonce), 'payout nonce leaked into roulette').toBeNull();
    expect(findLeak(chips, bobPayoutNonce), 'payout nonce leaked into chips').toBeNull();
    // mergeCoin derives the merged nonce from its FIRST input (Bob's secret
    // escrow coin), so the payout nonce is NOT the public house match nonce.
    expect(hex(bobPayoutNonce)).not.toEqual(hex(publicMatchNonce));
  });

  it('P3: Bob\'s wallet coin public key never appears in public state', async () => {
    const roul = collectRouletteBytes(await queryRoulette());
    const chips = collectChipsBytes(await queryChips());
    expect(findLeak(roul, bobCoinPk), 'wallet key leaked into roulette').toBeNull();
    expect(findLeak(chips, bobCoinPk), 'wallet key leaked into chips').toBeNull();
  });

  it('P7: recipient-private mint left no nonce for Bob\'s minted coin in chips public state', async () => {
    const chips = collectChipsBytes(await queryChips());
    expect(findLeak(chips, bobMintedNonce), 'minted-coin nonce leaked into chips').toBeNull();
  });

  it('summary: identity-private, behavior-public holds end to end', async () => {
    const rl = await queryRoulette();
    // Identity-private: pseudonym present, but it is a hash — not Bob's wallet key.
    expect(hex(bobPseudonym)).not.toEqual(hex(bobCoinPk));
    expect(rl.paidWinners.member(bobPseudonym)).toBe(true);
    logger.info('All privacy assumptions verified against live public state.');
  });
});
