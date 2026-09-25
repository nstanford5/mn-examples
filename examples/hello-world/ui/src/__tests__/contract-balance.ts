// Contract balances for in-memory circuit tests.
//
// A contract that moves unshielded tokens checks its own balance
// (`unshieldedBalance`, `unshieldedBalanceGte`, ...). In an in-memory run that
// balance comes from the call context, and `createCircuitContext` starts it
// empty. A `receiveUnshielded` in one in-memory call doesn't credit the
// next one either. On chain, the ledger tracks it. So a circuit test that
// reaches a balance check must say what the chain would hold at that point,
// e.g. `entryFee * checkedIn` after that many paid check-ins.
//
// Template-owned: edit templates/ui/src/__tests__/contract-balance.ts, then
// `yarn new:ui --sync-all`. A module, not a test: vitest only runs *.test.ts.
import type { CircuitContext } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import { nativeToken } from "@midnight-ntwrk/midnight-js-protocol/ledger";

type UnshieldedToken = ReturnType<typeof nativeToken>;

/**
 * Set the contract's unshielded balance of `token` (NIGHT by default) in
 * `ctx` to `amount`, in the token's smallest unit. Returns `ctx`.
 */
export function withUnshieldedBalance<PS>(
  ctx: CircuitContext<PS>,
  amount: bigint,
  token: UnshieldedToken = nativeToken(),
): CircuitContext<PS> {
  const q = ctx.currentQueryContext;
  q.block = { ...q.block, balance: new Map([[token, amount]]) };
  return ctx;
}
