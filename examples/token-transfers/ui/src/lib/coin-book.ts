// Shielded coins seen in circuit results, for circuits that take one back.
//
// A circuit that takes a stdlib `ShieldedCoinInfo` ({ nonce, color, value })
// needs a coin that already exists: the Zswap commitment of exactly those
// three values. Nobody can type one in, and the DApp Connector doesn't list a
// wallet's coins. But circuits that mint or send shielded coins *return* them
// (`mintShieldedToken`'s ShieldedCoinInfo, `sendShielded`'s ShieldedSendResult
// with `sent` and `change`). So <CircuitForm> records every ShieldedCoinInfo
// found in a result here, and a `shieldedCoin` argument picks one from the list.
//
// What the book can't know is who holds each coin: `sent` went to the
// recipient, `change` and a mint to self stayed with the contract. Each entry
// is labelled with where it came from ("mintAndSendShielded → sent") so the
// user can tell. A coin is dropped once a circuit spends or receives it.
//
// Session-only (module state, not storage): a reload forgets the list, and the
// coins themselves are unaffected.
//
// Template-owned: edit templates/ui/src/lib/coin-book.ts, then
// `yarn new:ui --sync-all`.
import { useSyncExternalStore } from "react";
import { formatScalar } from "@/lib/ledger-format";

/** The TypeScript shape of Compact's `ShieldedCoinInfo` struct. */
export interface ShieldedCoinValue {
  nonce: Uint8Array;
  color: Uint8Array;
  value: bigint;
}

export interface BookedCoin {
  /** The coin's nonce as hex: unique per coin, and the form field's text. */
  id: string;
  coin: ShieldedCoinValue;
  /** Where it came from, e.g. "mintAndSendShielded → sent". */
  source: string;
}

let coins: BookedCoin[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const isBytes32 = (v: unknown): v is Uint8Array => v instanceof Uint8Array && v.length === 32;

/** Exactly a ShieldedCoinInfo: nonce and color are 32 bytes, value a bigint. */
export function isShieldedCoin(v: unknown): v is ShieldedCoinValue {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    Object.keys(o).length === 3 && isBytes32(o["nonce"]) && isBytes32(o["color"]) && typeof o["value"] === "bigint"
  );
}

/**
 * Every ShieldedCoinInfo inside `result`, with its path. A `Maybe` with
 * `is_some: false` holds a zero placeholder, not a coin, so it's skipped.
 */
export function findCoins(result: unknown, path: string[] = []): { coin: ShieldedCoinValue; path: string[] }[] {
  if (isShieldedCoin(result)) return [{ coin: result, path }];
  if (typeof result !== "object" || result === null || result instanceof Uint8Array) return [];
  const o = result as Record<string, unknown>;
  if (o["is_some"] === false) return [];
  return Object.entries(o).flatMap(([k, v]) =>
    // Maybe's own `value` field doesn't need its name in the label.
    findCoins(v, "is_some" in o && k === "value" ? path : [...path, k]),
  );
}

/** Add the coins found in `circuit`'s result. Returns how many were new. */
export function recordCoins(circuit: string, result: unknown): number {
  const found = findCoins(result).filter(({ coin }) => !coins.some((c) => c.id === formatScalar(coin.nonce)));
  if (found.length === 0) return 0;
  coins = [
    ...coins,
    ...found.map(({ coin, path }) => ({
      id: formatScalar(coin.nonce),
      coin,
      source: [circuit, ...path].join(" → "),
    })),
  ];
  emit();
  return found.length;
}

/** Drop a coin once it's been spent or handed back. */
export function removeCoin(id: string): void {
  const next = coins.filter((c) => c.id !== id);
  if (next.length !== coins.length) {
    coins = next;
    emit();
  }
}

/** Forget every coin, e.g. when the panel switches to another contract. */
export function clearCoins(): void {
  if (coins.length) {
    coins = [];
    emit();
  }
}

export function bookedCoins(): BookedCoin[] {
  return coins;
}

export function subscribeCoins(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The booked coins, re-rendering when the list changes. */
export function useCoinBook(): BookedCoin[] {
  return useSyncExternalStore(subscribeCoins, bookedCoins, bookedCoins);
}

/** "300 of 49b10faae5bb…", for a picker or a message. */
export function describeCoin(coin: ShieldedCoinValue): string {
  return `${coin.value} of ${formatScalar(coin.color).slice(0, 12)}…`;
}
