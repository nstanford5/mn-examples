// Resolve which wallet a suite should run as, on any network.
//
// Every example used to carry its own copy of this logic, and they disagreed:
// some accepted only a bare MIDNIGHT_<NET>_SEED, others a per-role
// MIDNIGHT_<NET>_<ROLE>_{SEED,MNEMONIC}, and the role names themselves differ
// between suites (ORGANIZER/BIDDER_ONE/BIDDER_TWO vs ALICE/BOB/CHARLIE). This
// is the one place that knows all of it.
//
// There are four canonical remote wallets. A suite asks for the role it thinks
// in, and the alias table maps it onto one of the four, so a single set of
// funded wallets in the repo-root .env.<network> serves all eight examples.

import { fileURLToPath } from 'node:url';
import type { WalletSecret } from './types.js';
import type { FastSyncOptions } from './fast-wallet.js';

/** The four wallets a remote run is funded with. */
export type CanonicalRole = 'ALICE' | 'BOB' | 'CHARLIE' | 'DAVE';

/**
 * Role names as the individual suites spell them, mapped onto the four funded
 * wallets. A suite keeps its own vocabulary; the .env file only ever names the
 * canonical four.
 */
const ALIASES: Record<string, CanonicalRole> = {
  ALICE: 'ALICE',
  BOB: 'BOB',
  CHARLIE: 'CHARLIE',
  DAVE: 'DAVE',
  ORGANIZER: 'ALICE',
  BIDDER_ONE: 'BOB',
  BIDDER_TWO: 'CHARLIE',
};

/** The shipped reference bundles, at the repo root. */
export const REFERENCE_ROOT = fileURLToPath(new URL('../../../preseed', import.meta.url));

/** Genesis-funded seeds on the local `undeployed` devnet. */
export const LOCAL_SEEDS: Record<CanonicalRole, string> = {
  ALICE: '0000000000000000000000000000000000000000000000000000000000000001',
  BOB: '0000000000000000000000000000000000000000000000000000000000000002',
  CHARLIE: '0000000000000000000000000000000000000000000000000000000000000003',
  // Deliberately NOT a genesis seed: Dave starts with nothing on a local
  // devnet, and the sponsorship suite funds him from Alice.
  DAVE: '000000000000000000000000000000000000000000000000000000000000000d',
};

export interface ResolvedWallet {
  secret: WalletSecret;
  /** Present only when the wallet's birthday is known and fast-sync is safe. */
  fastSync?: FastSyncOptions;
  /** The canonical wallet this resolved to. */
  role: CanonicalRole;
}

function normalizeRole(role: string | undefined): CanonicalRole {
  if (role === undefined) return 'ALICE';
  const canonical = ALIASES[role.toUpperCase()];
  if (!canonical) {
    throw new Error(
      `Unknown wallet role '${role}'. Known roles: ${Object.keys(ALIASES).join(', ')}.`,
    );
  }
  return canonical;
}

function readSecret(prefix: string): WalletSecret | null {
  const mnemonicEnv = `${prefix}_MNEMONIC`;
  const seedEnv = `${prefix}_SEED`;
  const mnemonic = process.env[mnemonicEnv]?.trim().replace(/\s+/g, ' ');
  const seedHex = process.env[seedEnv]?.trim();

  if (mnemonic && seedHex) {
    throw new Error(`Set only one of ${mnemonicEnv} or ${seedEnv} (both are defined).`);
  }
  if (mnemonic) return { kind: 'mnemonic', value: mnemonic };
  if (seedHex) {
    if (!/^[0-9a-fA-F]+$/.test(seedHex) || seedHex.length % 2 !== 0) {
      throw new Error(`${seedEnv} must be a hex string of even length (no 0x prefix).`);
    }
    return { kind: 'seed', value: seedHex };
  }
  return null;
}

function readBirthday(prefix: string): number | undefined {
  const raw = process.env[`${prefix}_BIRTHDAY`]?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${prefix}_BIRTHDAY must be a positive integer, got '${raw}'.`);
  }
  return n;
}

/**
 * Pick the wallet for `role` on `net`.
 *
 * Lookup order, for a role that aliases to canonical role C on network N:
 *   1. MIDNIGHT_<N>_<ROLE>_{SEED,MNEMONIC}  — the suite's own spelling, wins
 *   2. MIDNIGHT_<N>_<C>_{SEED,MNEMONIC}     — the canonical wallet
 *   3. MIDNIGHT_<N>_{SEED,MNEMONIC}         — the un-roled form, Alice only
 *
 * The birthday is always read from the SAME prefix as the seed, so a birthday
 * can never be paired with a different wallet's seed by accident — the one way
 * this could go wrong on its own.
 *
 * Fast-sync is enabled only when that `_BIRTHDAY` is set. That is the
 * whole safety story: `isSeedable()` refuses to seed a wallet that could have
 * been active before the reference was cut, and a seed with no recorded
 * birthday is exactly such a wallet. Never hand-write a _BIRTHDAY line — only
 * `yarn wallets:new`, which reads the chain tip at the moment it mints the
 * seed, is entitled to.
 */
export function resolveWallet(net: string, role?: string): ResolvedWallet {
  const canonical = normalizeRole(role);

  if (net === 'local') {
    return { secret: { kind: 'seed', value: LOCAL_SEEDS[canonical] }, role: canonical };
  }

  const upper = net.toUpperCase();
  const candidates: string[] = [];
  if (role) candidates.push(`MIDNIGHT_${upper}_${role.toUpperCase()}`);
  candidates.push(`MIDNIGHT_${upper}_${canonical}`);
  if (canonical === 'ALICE') candidates.push(`MIDNIGHT_${upper}`);

  for (const prefix of candidates) {
    const secret = readSecret(prefix);
    if (!secret) continue;
    const birthday = readBirthday(prefix);
    return {
      secret,
      role: canonical,
      ...(birthday === undefined ? {} : { fastSync: { referenceRoot: REFERENCE_ROOT, birthday } }),
    };
  }

  throw new Error(
    `No wallet for role '${canonical}' on network '${net}'. Set ` +
      `MIDNIGHT_${upper}_${canonical}_SEED (plus MIDNIGHT_${upper}_${canonical}_BIRTHDAY ` +
      `to enable fast-sync) in the repo-root .env.${net}. ` +
      `Run \`yarn wallets:new\` to generate and \`yarn preseed:cut\` first — see FAST-SYNC.md.`,
  );
}
