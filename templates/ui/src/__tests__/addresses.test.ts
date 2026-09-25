// @vitest-environment node
//
// Node, not jsdom: @scure/base (under the address codec) checks
// `instanceof Uint8Array`, and jsdom's Uint8Array is a different realm's.
// The browser build has a single realm, so this only matters in tests.
import { describe, expect, it } from "vitest";
import { MidnightBech32m, UnshieldedAddress } from "@midnight-ntwrk/wallet-sdk-address-format";
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import { userAddressFromBech32, walletUserAddress } from "../lib/addresses";

const RAW = Uint8Array.from({ length: 32 }, (_, i) => i);
const bech32 = (networkId: string) =>
  MidnightBech32m.encode(networkId, new UnshieldedAddress(Buffer.from(RAW))).asString();

describe("userAddressFromBech32", () => {
  it("decodes an unshielded address to the UserAddress bytes", () => {
    const addr = bech32("undeployed");
    expect(addr.startsWith("mn_addr_undeployed1")).toBe(true);
    expect(userAddressFromBech32(addr, "undeployed")).toEqual({ bytes: RAW });
  });

  it("rejects an address for another network", () => {
    expect(() => userAddressFromBech32(bech32("preprod"), "undeployed")).toThrow();
  });

  it("reads the connected wallet's own address", async () => {
    const api = { getUnshieldedAddress: async () => ({ unshieldedAddress: bech32("preview") }) };
    await expect(walletUserAddress(api as unknown as ConnectedAPI, "preview")).resolves.toEqual({ bytes: RAW });
  });
});
