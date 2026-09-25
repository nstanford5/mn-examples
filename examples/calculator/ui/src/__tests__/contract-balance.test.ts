// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  createCircuitContext,
  dummyContractAddress,
  StateValue,
} from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import { nativeToken } from "@midnight-ntwrk/midnight-js-protocol/ledger";
import { withUnshieldedBalance } from "./contract-balance";

describe("withUnshieldedBalance", () => {
  it("sets the contract's NIGHT balance on the call context", () => {
    const ctx = createCircuitContext(dummyContractAddress(), "00".repeat(32), StateValue.newNull(), {});
    expect(ctx.currentQueryContext.block.balance.size).toBe(0);
    withUnshieldedBalance(ctx, 42n);
    expect([...ctx.currentQueryContext.block.balance]).toEqual([[nativeToken(), 42n]]);
  });
});
