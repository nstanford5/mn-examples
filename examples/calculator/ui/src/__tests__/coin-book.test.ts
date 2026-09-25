import { beforeEach, describe, expect, it } from "vitest";
import { bookedCoins, clearCoins, describeCoin, findCoins, recordCoins, removeCoin } from "../lib/coin-book";

const coin = (n: number) => ({
  nonce: new Uint8Array(32).fill(n),
  color: new Uint8Array(32).fill(0xee),
  value: BigInt(n),
});

beforeEach(() => clearCoins());

describe("findCoins", () => {
  it("finds a bare ShieldedCoinInfo (mintShieldedToken's result)", () => {
    expect(findCoins(coin(1))).toEqual([{ coin: coin(1), path: [] }]);
  });

  it("finds sent and change in a ShieldedSendResult, skipping an empty Maybe", () => {
    const some = { change: { is_some: true, value: coin(2) }, sent: coin(3) };
    expect(findCoins(some).map((f) => f.path)).toEqual([["change"], ["sent"]]);
    // is_some false holds a zeroed placeholder, not a coin.
    const none = { change: { is_some: false, value: coin(0) }, sent: coin(3) };
    expect(findCoins(none).map((f) => f.path)).toEqual([["sent"]]);
  });

  it("ignores lookalikes: wrong lengths, extra fields, non-bigint values", () => {
    expect(findCoins({ ...coin(1), mt_index: 0n })).toEqual([]);
    expect(findCoins({ nonce: new Uint8Array(31), color: new Uint8Array(32), value: 1n })).toEqual([]);
    expect(findCoins({ nonce: new Uint8Array(32), color: new Uint8Array(32), value: 1 })).toEqual([]);
    expect(findCoins(new Uint8Array(32))).toEqual([]);
    expect(findCoins([])).toEqual([]);
  });
});

describe("the book", () => {
  it("records each coin once, labelled with where it came from, and removes by id", () => {
    expect(recordCoins("mintAndSend", { change: { is_some: true, value: coin(2) }, sent: coin(3) })).toBe(2);
    expect(recordCoins("again", coin(3))).toBe(0);
    expect(bookedCoins().map((c) => [c.id.slice(0, 4), c.source])).toEqual([
      ["0202", "mintAndSend → change"],
      ["0303", "mintAndSend → sent"],
    ]);
    removeCoin("03".repeat(32));
    expect(bookedCoins()).toHaveLength(1);
    expect(describeCoin(coin(2))).toBe("2 of eeeeeeeeeeee…");
  });
});
