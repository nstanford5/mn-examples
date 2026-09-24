// @vitest-environment node
//
// Runs the real compiled hello-world contract in memory (no network, no
// proofs) to produce actual on-chain state values, then checks that message$
// decodes them the way the UI displays them.
import { describe, expect, it } from "vitest";
import { firstValueFrom, of, toArray } from "rxjs";
import {
  createCircuitContext,
  createConstructorContext,
  dummyContractAddress,
} from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import { Contract } from "../midnight/contract";
import { message$ } from "../midnight/hello-world-api";
import type { HelloWorldProviders } from "../midnight/providers";

const COIN_PK = "00".repeat(32);

describe("message$", () => {
  it("decodes the on-chain message before and after storeMessage", async () => {
    const contract = new Contract({});
    const { currentContractState } = contract.initialState(createConstructorContext({}, COIN_PK));

    const ctx = createCircuitContext(dummyContractAddress(), COIN_PK, currentContractState, {});
    const { context } = contract.impureCircuits.storeMessage(ctx, "Hello World!");

    // Minimal stand-in for the indexer: emit the two states in order.
    const providers = {
      publicDataProvider: {
        contractStateObservable: () =>
          of({ data: currentContractState.data }, { data: context.currentQueryContext.state }),
      },
    } as unknown as HelloWorldProviders;

    const seen = await firstValueFrom(message$(providers, "addr").pipe(toArray()));
    expect(seen).toEqual(["", "Hello World!"]);
  });
});
