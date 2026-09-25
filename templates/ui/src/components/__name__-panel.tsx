// Seed file: generated once by `yarn new:ui`, then yours to edit. The drift
// check ignores it. Replace the ledger readout and the circuit TODO list with
// the example's own UI; keep <DeploymentCard> as step 1.
import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DeploymentCard } from "@/components/deployment-card";
import { useContractState } from "@/hooks/use-contract-state";
import { useDeployment } from "@/hooks/use-deployment";
import { __PANEL_API_IMPORTS__ } from "@/midnight/__name__-api";

/** Exported ledger fields, from contract-info.json. */
const LEDGER_FIELDS = __LEDGER_FIELDS__ as const;

/** Provable circuits and their argument names, from contract-info.json. */
const CIRCUITS: { name: string; args: string[] }[] = __CIRCUIT_LIST__;

export function __Name__Panel() {
  const deployment = useDeployment({
__DEPLOYMENT_OPS__
  });
  const { providers, address, error } = deployment;

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
                    <div key={field} className="contents">
                      <dt className="font-mono text-muted-foreground">{field}</dt>
                      <dd className="break-all font-mono">{formatValue(state[field])}</dd>
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
                TODO: one form per circuit. Call the wrapper from @/midnight/__name__-api inside
                {" "}<code>deployment.run(&quot;&lt;label&gt;&quot;, ...)</code> so busy/error state is shared.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="list-disc pl-5 font-mono text-sm">
                {CIRCUITS.map((c) => (
                  <li key={c.name}>
                    {c.name}({c.args.join(", ")})
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

/** Best-effort display of a decoded ledger value. Replace with real rendering. */
function formatValue(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) {
    return Array.from(value, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const size = (value as { size?: unknown }).size;
  if (typeof size === "function") return `${String(size.call(value))} entries`;
  try {
    return JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
  } catch {
    return "(complex value)";
  }
}
