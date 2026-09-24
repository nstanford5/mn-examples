// The secret a test wallet is built from.
//
// This lives in the shared package (rather than in any one example's
// wallet.ts) because both the fast-sync assembler and the .env resolver need
// it. Each example re-exports it from its own src/wallet.ts so existing
// imports keep working.

export type WalletSecret =
  | { kind: 'seed'; value: string }
  | { kind: 'mnemonic'; value: string };
