// Shared test-wallet harness for running the examples against a remote
// Midnight network (preview / preprod). See FAST-SYNC.md at the repo root.

export type { WalletSecret } from './types.js';
export {
  getConfig,
  LOCAL_CONFIG,
  PREPROD_CONFIG,
  PREVIEW_CONFIG,
  type NetworkConfig,
} from './config.js';
export {
  assembleWallet,
  getChainTipHeight,
  type AssembledWallet,
  type FastSyncOptions,
  type SerializableSubWallet,
} from './fast-wallet.js';
export {
  isSeedable,
  preSeedNewWallet,
  type NewWalletKeys,
  type SeededSnapshots,
} from './preseed.js';
export { loadReferenceBundle, type EmptyRefStates } from './reference-bundle.js';
export {
  LOCAL_SEEDS,
  REFERENCE_ROOT,
  resolveWallet,
  type CanonicalRole,
  type ResolvedWallet,
} from './resolve.js';
export {
  FUND_TIMEOUT_MS,
  waitForDust,
  waitForNightThenDust,
  type FundingGateOptions,
} from './funding.js';
export { getOrCreateTestWallet, type PersistedWallet } from './test-wallet.js';
