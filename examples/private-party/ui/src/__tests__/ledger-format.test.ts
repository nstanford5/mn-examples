import { describe, expect, it } from "vitest";
import { formatLedgerValue, formatScalar } from "../lib/ledger-format";

/** Shaped like a decoded Set/List from the compiler-generated ledger(). */
const iterable = <T,>(items: T[]) => ({
  size: () => BigInt(items.length),
  [Symbol.iterator]: () => items[Symbol.iterator](),
});

describe("formatLedgerValue", () => {
  it("names enum cells and prints counters and bytes", () => {
    const turn = { name: "turn", storage: "Cell", enumValues: ["A_SHOOT", "B_SHOOT"] };
    expect(formatLedgerValue(turn, 1)).toBe("B_SHOOT");
    expect(formatLedgerValue(turn, 7)).toBe("7");
    expect(formatLedgerValue({ name: "n", storage: "Counter" }, 3n)).toBe("3");
    expect(formatLedgerValue({ name: "pk", storage: "Cell" }, new Uint8Array([0, 171]))).toBe("00ab");
  });

  it("lists Set/List elements with a count, capped", () => {
    const hits = { name: "hits", storage: "Set" };
    expect(formatLedgerValue(hits, iterable([]))).toBe("empty");
    expect(formatLedgerValue(hits, iterable([1n, 2n]))).toBe("2: 1, 2");
    const many = iterable(Array.from({ length: 10 }, (_, i) => BigInt(i)));
    expect(formatLedgerValue(hits, many)).toBe("10: 0, 1, 2, 3, 4, 5, 6, 7, …");
  });

  it("shows Map entries as key → value", () => {
    const m = { name: "m", storage: "Map" };
    expect(formatLedgerValue(m, iterable([[new Uint8Array([1]), 5n]]))).toBe("1: 01 → 5");
  });
});

describe("formatScalar", () => {
  it("stringifies structs with bigints and bytes", () => {
    expect(formatScalar({ a: 1n, b: new Uint8Array([255]) })).toBe('{"a":"1","b":"ff"}');
  });
});
