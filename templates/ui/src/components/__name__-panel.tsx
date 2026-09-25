// Seed file: generated once by `yarn new:ui`, then yours to edit. The drift
// check ignores it. Replace the ledger readout and the generic circuit forms
// with the example's own UI; keep <DeploymentCard> as step 1.
import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CircuitForm } from "@/components/circuit-form";
import { DeploymentCard } from "@/components/deployment-card";
import { useContractState } from "@/hooks/use-contract-state";
import { useDeployment } from "@/hooks/use-deployment";
import type { ArgSpec } from "@/lib/circuit-args";
import { formatLedgerValue, type LedgerField } from "@/lib/ledger-format";
import {__PANEL_API_IMPORTS__} from "@/midnight/__name__-api";

/** Exported ledger fields and how they're stored, from contract-info.json. */
const LEDGER_FIELDS: LedgerField[] = __LEDGER_FIELDS__;

/**
 * Provable circuits and their argument types, from contract-info.json. `args`
 * is null when an argument has no generic form (see lib/circuit-args.ts);
 * `todo` names it.
 */
type CircuitSpec = { name: string; args: ArgSpec[] } | { name: string; args: null; todo: string };
const CIRCUITS: CircuitSpec[] = __CIRCUIT_LIST__;

/** Submits a circuit through its wrapper in @/midnight/__name__-api. */
const CALLS: Record<string, (contract: __Name__Contract, args: unknown[]) => Promise<unknown>> = __CIRCUIT_CALLS__;

export function __Name__Panel() {
  const deployment = useDeployment({
__DEPLOYMENT_OPS__
  });
  const { providers, contract, address, busy, error, run } = deployment;

  const ledgerObservable = useMemo(
    () => (providers && address ? ledger$(providers, address) : null),
    [providers, address],
  );
  const { state, error: stateError } = useContractState(ledgerObservable);

  return (
    <div className="flex flex-col gap-6">
      <DeploymentCard deployment={deployment} />

      {providers && address && (
        <>
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

          <Card>
            <CardHeader>
              <CardTitle>3. Circuits</CardTitle>
              <CardDescription>
                One generic form per circuit. Each call runs the circuit locally, proves it, then
                asks the wallet to balance and submit it.
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
                    onSubmit={(values) =>
                      void run(c.name, async () => {
                        const call = CALLS[c.name];
                        if (contract && call) await call(contract, values);
                      })
                    }
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
