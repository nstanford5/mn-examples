// @vitest-environment node
//
// Runs the real compiled token-transfers contract in memory (no network, no
// proofs) through the Node test's sequence (src/test/token-transfers.test.ts).
// The contract has no ledger, so each step asserts on what the circuit
// returns and on its Effects: the mints, inputs, outputs and coin claims the
// transaction must carry for the node to accept it. On chain, those are what
// move the wallet balances the panel shows.
//
// It also checks the panel's helpers against the circuits: customTokenColor
// against mintAndReceive's color, and the mintAndSendError pre-check against
// what mintAndSendShielded accepts.
//
// Seed file: generated once by `yarn new:ui`, then yours to edit. The drift
// check ignores it.
import { describe, expect, expectTypeOf, it } from "vitest";
import type { FinalizedCallTxData } from "@midnight-ntwrk/midnight-js-contracts";
import {
  createCircuitContext,
  createConstructorContext,
  dummyContractAddress,
  rawTokenType,
  type Effects,
} from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import { toHex } from "@midnight-ntwrk/midnight-js-utils";
import { Contract, createInitialPrivateState, ledger } from "../midnight/contract";
import {
  CUSTOM_DOMAIN,
  customTokenColor,
  domainSepFromLabel,
  mintAndReceive,
  mintAndSendError,
  mintAndSendShielded,
  mintShieldedToSelf,
  pad32,
  receiveNightTokens,
  receiveShieldedTokens,
  receiveTokens,
  sendNightTokensToUser,
  sendShieldedToUser,
  sendToUser,
  UINT64_MAX,
} from "../midnight/token-transfers-api";
import { findCoins } from "../lib/coin-book";
import { NIGHT_COLOR } from "../lib/tokens";

const COIN_PK = "00".repeat(32);
const contract = new Contract({});
const ADDRESS = dummyContractAddress();
const { currentContractState } = contract.initialState(
  createConstructorContext(createInitialPrivateState(), COIN_PK),
);
/** A fresh context per call: no ledger, so no state carries between calls. */
const ctx = () => createCircuitContext(ADDRESS, COIN_PK, currentContractState.data, createInitialPrivateState());
const c = contract.impureCircuits;

// Alice, the Node test's wallet: her unshielded address and Zswap coin key.
const ALICE = { bytes: new Uint8Array(32).fill(4) };
const ALICE_COIN_KEY = { bytes: new Uint8Array(32).fill(1) };

/**
 * An Effects map with its keys as JSON. TokenType and PublicAddress keys are
 * objects ({ tag, raw }, { tag, address }), so Map.get with a fresh object
 * never matches; compare entries instead.
 */
const entries = (m: Map<unknown, bigint>) => Object.fromEntries([...m].map(([k, v]) => [JSON.stringify(k), v]));
const unshielded = (raw: string) => ({ tag: "unshielded", raw });
const user = (bytes: Uint8Array) => ({ tag: "user", address: toHex(bytes) });
const contractAddr = { tag: "contract", address: ADDRESS };
const key = (...parts: unknown[]) => JSON.stringify(parts.length === 1 ? parts[0] : parts);

/** Nothing but the listed fields may be non-empty. */
function onlyEffects(effects: Effects, fields: (keyof Effects)[]) {
  for (const [name, value] of Object.entries(effects) as [keyof Effects, unknown][]) {
    const size = value instanceof Map ? value.size : (value as unknown[]).length;
    if (!fields.includes(name)) expect(size, name).toBe(0);
  }
}

describe("token-transfers contract (in memory)", () => {
  it("constructs, with no ledger fields", () => {
    expect(ledger(currentContractState.data)).toEqual({});
  });

  describe("custom unshielded token", () => {
    const color = customTokenColor(ADDRESS);

    it("mintAndReceive mints into the contract and returns the color customTokenColor derives", () => {
      const { result, context } = c.mintAndReceive(ctx(), 1_000n);
      expect(toHex(result)).toBe(color);
      const fx = context.currentQueryContext.effects;
      // Minted under the domain separator, then received by the contract itself.
      expect(entries(fx.unshieldedMints)).toEqual({ [key(toHex(CUSTOM_DOMAIN))]: 1_000n });
      expect(entries(fx.unshieldedInputs)).toEqual({ [key(unshielded(color))]: 1_000n });
      expect(entries(fx.claimedUnshieldedSpends)).toEqual({ [key(unshielded(color), contractAddr)]: 1_000n });
      onlyEffects(fx, ["unshieldedMints", "unshieldedInputs", "claimedUnshieldedSpends"]);
    });

    it("sendToUser authorizes an output of the custom token to the address", () => {
      const fx = c.sendToUser(ctx(), 400n, ALICE).context.currentQueryContext.effects;
      expect(entries(fx.unshieldedOutputs)).toEqual({ [key(unshielded(color))]: 400n });
      expect(entries(fx.claimedUnshieldedSpends)).toEqual({ [key(unshielded(color), user(ALICE.bytes))]: 400n });
      onlyEffects(fx, ["unshieldedOutputs", "claimedUnshieldedSpends"]);
    });

    it("receiveTokens expects the custom token as an input (the wallet supplies it)", () => {
      const fx = c.receiveTokens(ctx(), 400n).context.currentQueryContext.effects;
      expect(entries(fx.unshieldedInputs)).toEqual({ [key(unshielded(color))]: 400n });
      onlyEffects(fx, ["unshieldedInputs"]);
    });
  });

  describe("NIGHT", () => {
    it("receiveNightTokens expects NIGHT (color all zeros) as an input", () => {
      const fx = c.receiveNightTokens(ctx(), 5_000n).context.currentQueryContext.effects;
      expect(entries(fx.unshieldedInputs)).toEqual({ [key(unshielded(NIGHT_COLOR))]: 5_000n });
      onlyEffects(fx, ["unshieldedInputs"]);
    });

    it("sendNightTokensToUser authorizes a NIGHT output to the address", () => {
      const fx = c.sendNightTokensToUser(ctx(), 2_000n, ALICE).context.currentQueryContext.effects;
      expect(entries(fx.unshieldedOutputs)).toEqual({ [key(unshielded(NIGHT_COLOR))]: 2_000n });
      expect(entries(fx.claimedUnshieldedSpends)).toEqual({
        [key(unshielded(NIGHT_COLOR), user(ALICE.bytes))]: 2_000n,
      });
      onlyEffects(fx, ["unshieldedOutputs", "claimedUnshieldedSpends"]);
    });
  });

  describe("shielded", () => {
    const domainSep = domainSepFromLabel("demo:shielded");
    const nonce = new Uint8Array(32).fill(9);

    it("mintShieldedToSelf mints a coin to the contract and returns it", () => {
      const { result, context } = c.mintShieldedToSelf(ctx(), domainSep, 250n, nonce);
      expect(result.value).toBe(250n);
      expect(result.nonce).toEqual(nonce);
      // The same tokenType(domain, self) as the unshielded token.
      expect(toHex(result.color)).toBe(rawTokenType(domainSep, ADDRESS));
      const fx = context.currentQueryContext.effects;
      expect(entries(fx.shieldedMints)).toEqual({ [key(toHex(domainSep))]: 250n });
      // Minted to the contract: it is both the coin's receiver and, as the
      // minter, its spender into existence.
      expect(fx.claimedShieldedReceives).toHaveLength(1);
      expect(fx.claimedShieldedSpends).toEqual(fx.claimedShieldedReceives);
    });

    it("the coin follows from the nonce, so a reused nonce mints the same coin", () => {
      const a = c.mintAndSendShielded(ctx(), domainSep, 500n, nonce, ALICE_COIN_KEY, 300n).result;
      const b = c.mintAndSendShielded(ctx(), domainSep, 500n, nonce, ALICE_COIN_KEY, 300n).result;
      expect(b.sent.nonce).toEqual(a.sent.nonce);
    });

    it("mintAndSendShielded sends part of a fresh coin and keeps the change", () => {
      const { sent, change } = c.mintAndSendShielded(ctx(), domainSep, 500n, nonce, ALICE_COIN_KEY, 300n).result;
      expect(sent.value).toBe(300n);
      expect(change.is_some).toBe(true);
      expect(change.value.value).toBe(200n);
      expect(sent.color).toEqual(change.value.color);
    });

    it("mintAndSendError predicts exactly what mintAndSendShielded accepts", () => {
      const grid: [bigint, bigint][] = [];
      for (const m of [0n, 1n, 500n, UINT64_MAX]) for (const s of [0n, 1n, m - 1n, m, m + 1n]) if (s >= 0n) grid.push([m, s]);
      for (const [m, s] of grid) {
        let accepted = true;
        try {
          c.mintAndSendShielded(ctx(), domainSep, m, nonce, ALICE_COIN_KEY, s);
        } catch {
          accepted = false;
        }
        expect(mintAndSendError(m, s) === null, `mint ${m}, send ${s}`).toBe(accepted);
      }
    });

    it("the coin book finds the coins these circuits return, labelled for the picker", () => {
      // What receiveShieldedTokens' form offers: the panel books every result.
      expect(findCoins(c.mintShieldedToSelf(ctx(), domainSep, 250n, nonce).result).map((f) => f.path)).toEqual([[]]);
      const sendResult = c.mintAndSendShielded(ctx(), domainSep, 500n, nonce, ALICE_COIN_KEY, 300n).result;
      expect(findCoins(sendResult).map((f) => f.path)).toEqual([["change"], ["sent"]]);
      // Sending everything leaves no change: an empty Maybe, not a coin.
      const all = c.mintAndSendShielded(ctx(), domainSep, 500n, nonce, ALICE_COIN_KEY, 500n).result;
      expect(findCoins(all).map((f) => f.path)).toEqual([["sent"]]);
    });

    it("receiveShieldedTokens claims the coin Alice received", () => {
      const { sent } = c.mintAndSendShielded(ctx(), domainSep, 500n, nonce, ALICE_COIN_KEY, 300n).result;
      const [booked] = findCoins(sent);
      const fx = c.receiveShieldedTokens(ctx(), booked!.coin).context.currentQueryContext.effects;
      expect(fx.claimedShieldedReceives).toHaveLength(1);
      onlyEffects(fx, ["claimedShieldedReceives"]);
    });

    it("domainSepFromLabel pads like Compact's pad(32, ...) and rejects what can't fit", () => {
      expect(pad32("simple:receive")).toEqual(CUSTOM_DOMAIN);
      expect(() => domainSepFromLabel("")).toThrow();
      expect(() => domainSepFromLabel("x".repeat(33))).toThrow(/at most 32/);
      expect(domainSepFromLabel("x".repeat(32))).toHaveLength(32);
    });
  });
});

// Checked by `tsc -b` (the typecheck script); expectTypeOf does nothing at
// runtime. Each wrapper must hit the callTx overload that proves, submits and
// waits for finalization, and take exactly the circuit's arguments (counted
// from contract-info.json) after the contract handle.
describe("token-transfers circuit wrappers (types)", () => {
  it("submit through callTx with exactly the circuit's arguments", () => {
    expectTypeOf<Awaited<ReturnType<typeof mintAndReceive>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "mintAndReceive">
    >();
    expectTypeOf<Parameters<typeof mintAndReceive>["length"]>().toEqualTypeOf<2>();
    expectTypeOf<Awaited<ReturnType<typeof sendToUser>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "sendToUser">
    >();
    expectTypeOf<Parameters<typeof sendToUser>["length"]>().toEqualTypeOf<3>();
    expectTypeOf<Awaited<ReturnType<typeof receiveTokens>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "receiveTokens">
    >();
    expectTypeOf<Parameters<typeof receiveTokens>["length"]>().toEqualTypeOf<2>();
    expectTypeOf<Awaited<ReturnType<typeof receiveNightTokens>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "receiveNightTokens">
    >();
    expectTypeOf<Parameters<typeof receiveNightTokens>["length"]>().toEqualTypeOf<2>();
    expectTypeOf<Awaited<ReturnType<typeof sendNightTokensToUser>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "sendNightTokensToUser">
    >();
    expectTypeOf<Parameters<typeof sendNightTokensToUser>["length"]>().toEqualTypeOf<3>();
    expectTypeOf<Awaited<ReturnType<typeof receiveShieldedTokens>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "receiveShieldedTokens">
    >();
    expectTypeOf<Parameters<typeof receiveShieldedTokens>["length"]>().toEqualTypeOf<2>();
    expectTypeOf<Awaited<ReturnType<typeof sendShieldedToUser>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "sendShieldedToUser">
    >();
    expectTypeOf<Parameters<typeof sendShieldedToUser>["length"]>().toEqualTypeOf<4>();
    expectTypeOf<Awaited<ReturnType<typeof mintShieldedToSelf>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "mintShieldedToSelf">
    >();
    expectTypeOf<Parameters<typeof mintShieldedToSelf>["length"]>().toEqualTypeOf<4>();
    expectTypeOf<Awaited<ReturnType<typeof mintAndSendShielded>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "mintAndSendShielded">
    >();
    expectTypeOf<Parameters<typeof mintAndSendShielded>["length"]>().toEqualTypeOf<6>();
  });
});
