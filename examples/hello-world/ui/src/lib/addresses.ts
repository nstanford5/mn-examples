// Wallet addresses as Compact values.
//
// A circuit that takes the stdlib `UserAddress` struct gets `{ bytes }` in
// TypeScript (contract/index.d.ts): the 32 raw bytes of the user's unshielded
// address. The DApp Connector's `getUnshieldedAddress()` returns that address
// in Bech32m (`mn_addr_<network>1...`), so it has to be decoded first. The
// Node harness does the same with the wallet SDK's `UnshieldedAddress.data`.
//
// A circuit that takes the stdlib `ZswapCoinPublicKey` struct (a shielded
// recipient) also gets `{ bytes }`: the wallet's 32-byte Zswap coin public key.
// `getShieldedAddresses()` returns it in Bech32m (`mn_shield-cpk_<network>1...`);
// the Node harness encodes the wallet SDK's hex key with `encodeCoinPublicKey`.
//
// Template-owned: edit templates/ui/src/lib/addresses.ts, then
// `yarn new:ui --sync-all`.
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import {
  MidnightBech32m,
  ShieldedCoinPublicKey,
  UnshieldedAddress,
} from "@midnight-ntwrk/wallet-sdk-address-format";

/** The TypeScript shape of Compact's `UserAddress` struct. */
export interface UserAddressValue {
  bytes: Uint8Array;
}

/**
 * Decode a Bech32m unshielded address into a `UserAddress`. Throws when the
 * string isn't an unshielded address for `networkId` (e.g. a shielded
 * address, or one for another network).
 */
export function userAddressFromBech32(bech32: string, networkId: string): UserAddressValue {
  const decoded = UnshieldedAddress.codec.decode(networkId, MidnightBech32m.parse(bech32));
  return { bytes: new Uint8Array(decoded.data) };
}

/** The connected wallet's own unshielded address, as a `UserAddress`. */
export async function walletUserAddress(api: ConnectedAPI, networkId: string): Promise<UserAddressValue> {
  const { unshieldedAddress } = await api.getUnshieldedAddress();
  return userAddressFromBech32(unshieldedAddress, networkId);
}

/** The TypeScript shape of Compact's `ZswapCoinPublicKey` struct. */
export interface CoinPublicKeyValue {
  bytes: Uint8Array;
}

/**
 * Decode a Bech32m shielded coin public key into a `ZswapCoinPublicKey`.
 * Throws when the string isn't a coin public key for `networkId` (e.g. an
 * unshielded address, or one for another network).
 */
export function coinPublicKeyFromBech32(bech32: string, networkId: string): CoinPublicKeyValue {
  const decoded = ShieldedCoinPublicKey.codec.decode(networkId, MidnightBech32m.parse(bech32));
  return { bytes: new Uint8Array(decoded.data) };
}

/** The connected wallet's own Zswap coin public key, as a `ZswapCoinPublicKey`. */
export async function walletCoinPublicKey(api: ConnectedAPI, networkId: string): Promise<CoinPublicKeyValue> {
  const { shieldedCoinPublicKey } = await api.getShieldedAddresses();
  return coinPublicKeyFromBech32(shieldedCoinPublicKey, networkId);
}
