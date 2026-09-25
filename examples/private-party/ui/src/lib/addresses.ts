// Wallet addresses as Compact values.
//
// A circuit that takes the stdlib `UserAddress` struct gets `{ bytes }` in
// TypeScript (contract/index.d.ts): the 32 raw bytes of the user's unshielded
// address. The DApp Connector's `getUnshieldedAddress()` returns that address
// in Bech32m (`mn_addr_<network>1...`), so it has to be decoded first. The
// Node harness does the same with the wallet SDK's `UnshieldedAddress.data`.
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import { MidnightBech32m, UnshieldedAddress } from "@midnight-ntwrk/wallet-sdk-address-format";

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
