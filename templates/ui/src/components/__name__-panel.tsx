// Seed file: generated once by `yarn new:ui`, then yours to edit. The drift
// check ignores it. Replace the ledger readout and the generic circuit forms
// with the example's own UI; keep <DeploymentCard> as step 1.
// @if ledger
import { useMemo } from "react";
// @endif
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CircuitForm } from "@/components/circuit-form";
import { DeploymentCard } from "@/components/deployment-card";
// @if tokens
import { WalletBalancesCard } from "@/components/wallet-balances-card";
// @endif
// @if ledger
import { useContractState } from "@/hooks/use-contract-state";
// @endif
import { useDeployment } from "@/hooks/use-deployment";
import type { ArgSpec } from "@/lib/circuit-args";
// @if ledger
import { formatLedgerValue, type LedgerField } from "@/lib/ledger-format";
// @endif
import {__PANEL_API_IMPORTS__} from "@/midnight/__name__-api";

// @if ledger
/** Exported ledger fields and how they're stored, from contract-info.json. */
const LEDGER_FIELDS: LedgerField[] = __LEDGER_FIELDS__;
// @endif

/**
 * Provable circuits and their argument types, from contract-info.json. `args`
 * is null when an argument has no generic form (see lib/circuit-args.ts);
 * `todo` names it.
 */
type CircuitSpec = { name: string; args: ArgSpec[] } | { name: string; args: null; todo: string };
const CIRCUITS: CircuitSpec[] = __CIRCUIT_LIST__;

/**
 * Submits a circuit through its wrapper in @/midnight/__name__-api and
 * resolves to the circuit's return value, which <CircuitForm> shows.
 */
const CALLS: Record<string, (contract: __Name__Contract, args: unknown[]) => Promise<unknown>> = __CIRCUIT_CALLS__;

export function __Name__Panel() {
  const deployment = useDeployment({
__DEPLOYMENT_OPS__
  });
  const { providers, contract, address, busy, error, run } = deployment;
  // @if ledger

  const ledgerObservable = useMemo(
    () => (providers && address ? ledger$(providers, address) : null),
    [providers, address],
  );
  const { state, error: stateError } = useContractState(ledgerObservable);
  // @endif

  return (
    <div className="flex flex-col gap-6">
      <DeploymentCard deployment={deployment} />

      {providers && address && (
        <>
          {/* @if ledger */}
          <Card>
            <CardHeader>
              <CardTitle>2. Ledger</CardTitle>
              <CardDescription>Public ledger fields, streamed live from the indexer.</CardDescription>
            </CardHeader>
            <CardContent>
              {state === null ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  {LEDGER_FIELDS.map((field) => (
                    <div key={field.name} className="contents">
                      <dt className="font-mono text-muted-foreground">{field.name}</dt>
                      <dd className="break-all font-mono">
                        {formatLedgerValue(field, state[field.name as keyof typeof state])}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {stateError && <p className="text-xs text-destructive">{stateError.message}</p>}
            </CardContent>
          </Card>
          {/* @endif */}
          {/* @if tokens */}

          {/* busy flips when a call starts and ends, so it doubles as a refresh key. */}
          <WalletBalancesCard title="__BALANCES_STEP__. Your wallet" refreshKey={busy} />
          {/* @endif */}

          <Card>
            <CardHeader>
              <CardTitle>__CIRCUITS_STEP__. Circuits</CardTitle>
              <CardDescription>
                One generic form per circuit. Each call runs the circuit locally, proves it, then
                asks the wallet to balance and submit it. What a circuit returns is shown under
                its form.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {CIRCUITS.map((c) =>
                c.args ? (
                  <CircuitForm
                    key={c.name}
                    name={c.name}
                    args={c.args}
                    busy={busy === c.name}
                    disabled={busy !== null || !contract}
                    onSubmit={async (values) => {
                      let result: unknown;
                      const ok = await run(c.name, async () => {
                        const call = CALLS[c.name];
                        if (contract && call) result = await call(contract, values);
                      });
                      return ok ? { ok: true, result } : { ok: false };
                    }}
                  />
                ) : (
                  <p key={c.name} className="text-sm text-muted-foreground">
                    <code>{c.name}</code>: TODO, no generic form because {c.todo}. Build one here and
                    call its wrapper from @/midnight/__name__-api.
                  </p>
                ),
              )}
            </CardContent>
          </Card>
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
