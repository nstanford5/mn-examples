// @vitest-environment node
//
// Runs the real compiled calculator contract, divMod witness included, in
// memory (no network, no proofs) to produce actual ledger states. It checks
// that result$ decodes them the way the UI shows them, and that the panel's
// `evaluate` pre-check agrees with what the circuits accept and store.
import { describe, expect, expectTypeOf, it } from "vitest";
import { firstValueFrom, from, toArray } from "rxjs";
import type { FinalizedCallTxData } from "@midnight-ntwrk/midnight-js-contracts";
import {
  createCircuitContext,
  createConstructorContext,
  dummyContractAddress,
  type ChargedState,
} from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import { Contract, createInitialPrivateState, ledger } from "../midnight/contract";
import {
  add,
  divide,
  evaluate,
  multiply,
  OPERATIONS,
  parseOperand,
  result$,
  square,
  subtract,
  UINT16_MAX,
  type Operation,
} from "../midnight/calculator-api";
import type { CalculatorProviders } from "../midnight/providers";
import { witnesses } from "../../../contract/witnesses.js";

const COIN_PK = "00".repeat(32);

const contract = new Contract(witnesses);
const { currentContractState: initialState } = contract.initialState(
  createConstructorContext(createInitialPrivateState(), COIN_PK),
);

/**
 * Run one circuit against a ledger state and return the next one; throws if the
 * circuit rejects. The state is what the indexer serves as a contract state's
 * `data`, i.e. what ledger() and result$ decode.
 */
function call(state: ChargedState, op: Operation, a: bigint, b: bigint): ChargedState {
  const ctx = createCircuitContext(dummyContractAddress(), COIN_PK, state, createInitialPrivateState());
  const args = OPERATIONS[op].arity === 1 ? [a] : [a, b];
  const circuit = contract.impureCircuits[op] as (
    c: typeof ctx,
    ...xs: bigint[]
  ) => { context: typeof ctx };
  return circuit(ctx, ...args).context.currentQueryContext.state;
}

describe("calculator contract (in memory)", () => {
  it("replays the Node test's sequence, and result$ decodes each state", async () => {
    expect(ledger(initialState.data).result).toBe(0n);

    // Same operations and expectations as src/test/calculator.test.ts.
    const steps: [Operation, bigint, bigint, bigint][] = [
      ["add", 2n, 3n, 5n],
      ["subtract", 10n, 4n, 6n],
      ["multiply", 6n, 7n, 42n],
      ["square", 9n, 0n, 81n],
      ["divide", 20n, 6n, 3n], // divMod returns [3, 2]; the circuit checks 3*6+2 == 20
    ];
    const datas = [initialState.data];
    for (const [op, a, b, expected] of steps) {
      const next = call(datas[datas.length - 1]!, op, a, b);
      expect(ledger(next).result, `${op}(${a}, ${b})`).toBe(expected);
      expect(evaluate(op, a, b)).toEqual({ ok: true, value: expected });
      datas.push(next);
    }

    // Minimal stand-in for the indexer: emit the states in order.
    const providers = {
      publicDataProvider: {
        contractStateObservable: () => from(datas.map((data) => ({ data }))),
      },
    } as unknown as CalculatorProviders;
    const seen = await firstValueFrom(result$(providers, "addr").pipe(toArray()));
    expect(seen).toEqual([0n, 5n, 6n, 42n, 81n, 3n]);
  });

  it("evaluate() agrees with the real circuits on edge cases", () => {
    const values = [0n, 1n, 2n, 3n, 255n, 256n, 1000n, UINT16_MAX - 1n, UINT16_MAX];
    let accepted = 0;
    let rejected = 0;
    for (const op of Object.keys(OPERATIONS) as Operation[]) {
      for (const a of values) {
        for (const b of values) {
          const predicted = evaluate(op, a, b);
          const label = `${op}(${a}, ${b})`;
          if (predicted.ok) {
            expect(ledger(call(initialState.data, op, a, b)).result, label).toBe(predicted.value);
            accepted++;
          } else {
            expect(() => call(initialState.data, op, a, b), label).toThrow();
            rejected++;
          }
        }
      }
    }
    // Both branches must actually be exercised for the comparison to mean anything.
    expect(accepted).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0);
  });

  it("parseOperand accepts only whole non-negative numbers", () => {
    expect(parseOperand(" 42 ")).toBe(42n);
    expect(parseOperand("0")).toBe(0n);
    for (const bad of ["", "-1", "1.5", "1e3", "abc", "0x10"]) expect(parseOperand(bad)).toBeNull();
  });
});


// Checked by `tsc -b` (the typecheck script); expectTypeOf does nothing at
// runtime. Each wrapper must hit the callTx overload that proves, submits and
// waits for finalization, and take exactly the circuit's arguments (counted
// from contract-info.json) after the contract handle.
describe("calculator circuit wrappers (types)", () => {
  it("submit through callTx with exactly the circuit's arguments", () => {
    expectTypeOf<Awaited<ReturnType<typeof add>>>().toEqualTypeOf<FinalizedCallTxData<Contract, "add">>();
    expectTypeOf<Awaited<ReturnType<typeof subtract>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "subtract">
    >();
    expectTypeOf<Awaited<ReturnType<typeof multiply>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "multiply">
    >();
    expectTypeOf<Awaited<ReturnType<typeof square>>>().toEqualTypeOf<FinalizedCallTxData<Contract, "square">>();
    expectTypeOf<Awaited<ReturnType<typeof divide>>>().toEqualTypeOf<FinalizedCallTxData<Contract, "divide">>();
    expectTypeOf<Parameters<typeof add>["length"]>().toEqualTypeOf<3>();
    expectTypeOf<Parameters<typeof subtract>["length"]>().toEqualTypeOf<3>();
    expectTypeOf<Parameters<typeof multiply>["length"]>().toEqualTypeOf<3>();
    expectTypeOf<Parameters<typeof square>["length"]>().toEqualTypeOf<2>();
    expectTypeOf<Parameters<typeof divide>["length"]>().toEqualTypeOf<3>();
  });
});
