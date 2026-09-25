// Contract operations the UI calls. Each one is the browser counterpart of a
// step in the Node test (examples/token-transfers/src/test/); the only difference is
// where `providers` came from.
//
// The contract has no ledger (`Ledger` is `{}`): everything it does is a token
// movement. So there is no `ledger$` here. The panel shows the wallet's own
// balances instead (the template's <WalletBalancesCard>), and the helpers at
// the bottom build the values the Node test hard-codes or reads from the
// wallet SDK: the custom token's color, a fresh mint nonce, the wallet's Zswap
// coin key. NIGHT's color and STAR formatting are in the template's
// lib/tokens.ts.
//
// Seed file: generated once by `yarn new:ui` from contract-info.json, then
// yours to edit. The drift check ignores it.
import {
  deployContract,
  findDeployedContract,
  type FoundContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import {
  encodeCoinPublicKey,
  rawTokenType,
  type ContractAddress,
} from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import {
  CompiledTokenTransfersContract,
  createInitialPrivateState,
  PRIVATE_STATE_ID,
  type Contract,
} from "./contract";
import type { TokenTransfersProviders } from "./providers";

export type TokenTransfersContract = FoundContract<Contract>;

/**
 * Deploy a fresh token-transfers contract. The wallet is asked to balance and sign
 * the deploy tx.
 */
export async function deployTokenTransfers(
  providers: TokenTransfersProviders,
): Promise<{ contract: TokenTransfersContract; address: ContractAddress }> {
  const deployed = await deployContract(providers, {
    compiledContract: CompiledTokenTransfersContract,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: createInitialPrivateState(),
  });
  return {
    contract: deployed,
    address: deployed.deployTxData.public.contractAddress,
  };
}

/**
 * Attach to an existing deployment by address. findDeployedContract fetches
 * the on-chain state and checks that its verifier keys match the ones we serve
 * (a wrong address or a different contract fails here, before any tx).
 *
 * Private state: findDeployedContract *overwrites* whatever is stored under
 * PRIVATE_STATE_ID whenever it is given an `initialPrivateState`. So reuse the
 * stored state when there is one (a reload, or the deployer re-joining with a
 * persistent store) and only fall back to a fresh initial state otherwise.
 */
export async function joinTokenTransfers(
  providers: TokenTransfersProviders,
  address: ContractAddress,
): Promise<TokenTransfersContract> {
  providers.privateStateProvider.setContractAddress(address);
  const stored = await providers.privateStateProvider.get(PRIVATE_STATE_ID);
  if (stored !== null) {
    return findDeployedContract(providers, {
      compiledContract: CompiledTokenTransfersContract,
      contractAddress: address,
      privateStateId: PRIVATE_STATE_ID,
    });
  }
  return findDeployedContract(providers, {
    compiledContract: CompiledTokenTransfersContract,
    contractAddress: address,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: createInitialPrivateState(),
  });
}

// One wrapper per provable circuit. midnight-js runs the circuit locally,
// proves it (wallet or proof server), then gets the wallet to balance and
// submit it. Each resolves once the tx is final on chain.

/**
 * A circuit's arguments without its leading CircuitContext, i.e. what
 * `contract.callTx.<circuit>(...)` takes. Not `Parameters<callTx[c]>`: callTx
 * members are overloaded, and `Parameters` picks the last overload, whose
 * first parameter is a TransactionContext.
 */
export type CircuitArgs<K extends keyof Contract["provableCircuits"]> =
  Parameters<Contract["provableCircuits"][K]> extends [unknown, ...infer A] ? A : never;

/** Circuit `mintAndReceive(amount)`. */
export async function mintAndReceive(
  contract: TokenTransfersContract,
  ...args: CircuitArgs<"mintAndReceive">
) {
  return contract.callTx.mintAndReceive(...args);
}

/** Circuit `sendToUser(amount, user_addr)`. */
export async function sendToUser(
  contract: TokenTransfersContract,
  ...args: CircuitArgs<"sendToUser">
) {
  return contract.callTx.sendToUser(...args);
}

/** Circuit `receiveTokens(amount)`. */
export async function receiveTokens(
  contract: TokenTransfersContract,
  ...args: CircuitArgs<"receiveTokens">
) {
  return contract.callTx.receiveTokens(...args);
}

/** Circuit `receiveNightTokens(amount)`. */
export async function receiveNightTokens(
  contract: TokenTransfersContract,
  ...args: CircuitArgs<"receiveNightTokens">
) {
  return contract.callTx.receiveNightTokens(...args);
}

/** Circuit `sendNightTokensToUser(amount, user_addr)`. */
export async function sendNightTokensToUser(
  contract: TokenTransfersContract,
  ...args: CircuitArgs<"sendNightTokensToUser">
) {
  return contract.callTx.sendNightTokensToUser(...args);
}

/** Circuit `receiveShieldedTokens(coin)`. */
export async function receiveShieldedTokens(
  contract: TokenTransfersContract,
  ...args: CircuitArgs<"receiveShieldedTokens">
) {
  return contract.callTx.receiveShieldedTokens(...args);
}

/**
 * Circuit `sendShieldedToUser(input, publicKey, value)`. The panel doesn't
 * call it: `input` is a QualifiedShieldedCoinInfo, a coin the contract already
 * holds plus its index in the Zswap commitment tree, and neither the Node test
 * nor this UI tracks the contract's coins. mintAndSendShielded covers
 * sendShielded for a freshly minted coin. Kept for the type checks.
 */
export async function sendShieldedToUser(
  contract: TokenTransfersContract,
  ...args: CircuitArgs<"sendShieldedToUser">
) {
  return contract.callTx.sendShieldedToUser(...args);
}

/** Circuit `mintShieldedToSelf(domainSep, value, nonce)`. */
export async function mintShieldedToSelf(
  contract: TokenTransfersContract,
  ...args: CircuitArgs<"mintShieldedToSelf">
) {
  return contract.callTx.mintShieldedToSelf(...args);
}

/** Circuit `mintAndSendShielded(domainSep, mintValue, mintNonce, publicKey, sendValue)`. */
export async function mintAndSendShielded(
  contract: TokenTransfersContract,
  ...args: CircuitArgs<"mintAndSendShielded">
) {
  return contract.callTx.mintAndSendShielded(...args);
}

// --- values the circuits need, built the way the Node test builds them -----

/** `pad(32, s)` in Compact: UTF-8 bytes, zero-filled on the right to 32. */
export function pad32(text: string): Uint8Array {
  const utf8 = new TextEncoder().encode(text);
  if (utf8.length > 32) throw new Error(`"${text}" is ${utf8.length} bytes; at most 32 fit`);
  const out = new Uint8Array(32);
  out.set(utf8);
  return out;
}

/**
 * The domain separator of the custom unshielded token. mintAndReceive,
 * sendToUser and receiveTokens all use `pad(32, "simple:receive")`.
 */
export const CUSTOM_DOMAIN = pad32("simple:receive");

/**
 * The custom token's color at `address`, as hex (the form wallet balances are
 * keyed by). It is `tokenType(domain, kernel.self())` in the contract, so it's
 * known from the address alone: a user who joins sees their balance of it
 * without minting first. The circuits test checks it against mintAndReceive's
 * return value.
 */
export function customTokenColor(address: ContractAddress): string {
  return rawTokenType(CUSTOM_DOMAIN, address);
}

/**
 * A shielded mint's domain separator from a short label (the Node test uses
 * fixed bytes). Different labels are different shielded tokens.
 */
export function domainSepFromLabel(label: string): Uint8Array {
  if (label.trim() === "") throw new Error("Give the token a label");
  return pad32(label);
}

/**
 * A fresh mint nonce. The minted coin (and the `sent`/`change` coins
 * mintAndSendShielded derives from it) is a function of the nonce, so
 * reusing one would mint the same coin twice. Never take it from the user.
 */
export function randomNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * The connected wallet's Zswap coin public key, as the circuits'
 * `ZswapCoinPublicKey` struct. The providers already hold it as hex (they
 * decode the connector's Bech32m); the Node test does the same encode on the
 * wallet SDK's hex key.
 */
export function myCoinPublicKey(providers: TokenTransfersProviders): { bytes: Uint8Array } {
  return { bytes: encodeCoinPublicKey(providers.walletProvider.getCoinPublicKey()) };
}

/** The largest `Uint<64>`, the type of a mint value. */
export const UINT64_MAX = 2n ** 64n - 1n;

/**
 * Why mintAndSendShielded would reject these values, or null. The circuit
 * mints `mintValue` (a Uint<64>) and sends `sendValue` of it; sending more than
 * was minted fails its change computation ("result of subtraction would be
 * negative"). Checked against the real circuit in the circuits test.
 */
export function mintAndSendError(mintValue: bigint, sendValue: bigint): string | null {
  if (mintValue < 0n || mintValue > UINT64_MAX) return `mint value must be between 0 and ${UINT64_MAX}`;
  if (sendValue < 0n) return "send value must be 0 or more";
  if (sendValue > mintValue) return `can't send more than the ${mintValue} minted`;
  return null;
}
