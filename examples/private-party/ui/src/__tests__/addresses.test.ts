// @vitest-environment node
//
// Node, not jsdom: @scure/base (under the address codec) checks
// `instanceof Uint8Array`, and jsdom's Uint8Array is a different realm's.
// The browser build has a single realm, so this only matters in tests.
import { describe, expect, it } from "vitest";
import { MidnightBech32m, ShieldedCoinPublicKey, UnshieldedAddress } from "@midnight-ntwrk/wallet-sdk-address-format";
import { encodeCoinPublicKey } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import {
  coinPublicKeyFromBech32,
  userAddressFromBech32,
  walletCoinPublicKey,
  walletUserAddress,
} from "../lib/addresses";

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

const cpk = (networkId: string) =>
  ShieldedCoinPublicKey.codec.encode(networkId, new ShieldedCoinPublicKey(Buffer.from(RAW))).asString();

describe("coinPublicKeyFromBech32", () => {
  it("decodes a shielded coin public key to the ZswapCoinPublicKey bytes", () => {
    const key = cpk("undeployed");
    expect(key.startsWith("mn_shield-cpk_undeployed1")).toBe(true);
    expect(coinPublicKeyFromBech32(key, "undeployed")).toEqual({ bytes: RAW });
  });

  it("gives the same bytes as the Node harness's encodeCoinPublicKey(hex)", () => {
    const hex = Buffer.from(RAW).toString("hex");
    expect(coinPublicKeyFromBech32(cpk("undeployed"), "undeployed").bytes).toEqual(
      new Uint8Array(encodeCoinPublicKey(hex)),
    );
  });

  it("rejects an unshielded address or another network's key", () => {
    expect(() => coinPublicKeyFromBech32(bech32("undeployed"), "undeployed")).toThrow();
    expect(() => coinPublicKeyFromBech32(cpk("preprod"), "undeployed")).toThrow();
  });

  it("reads the connected wallet's own key", async () => {
    const api = { getShieldedAddresses: async () => ({ shieldedCoinPublicKey: cpk("preview") }) };
    await expect(walletCoinPublicKey(api as unknown as ConnectedAPI, "preview")).resolves.toEqual({ bytes: RAW });
  });
});
