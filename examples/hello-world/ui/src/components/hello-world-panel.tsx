import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DeploymentCard } from "@/components/deployment-card";
import { useContractState } from "@/hooks/use-contract-state";
import { useDeployment } from "@/hooks/use-deployment";
import {
  deployHelloWorld,
  joinHelloWorld,
  message$,
  storeMessage,
} from "@/midnight/hello-world-api";

/**
 * The whole hello-world flow: deploy or join (the generic DeploymentCard),
 * then watch `message` and call storeMessage.
 */
export function HelloWorldPanel() {
  const deployment = useDeployment({ deploy: deployHelloWorld, join: joinHelloWorld });
  const { providers, contract, address, busy, error, run } = deployment;
  const [draft, setDraft] = useState("Hello World!");

  const messageObservable = useMemo(
    () => (providers && address ? message$(providers, address) : null),
    [providers, address],
  );
  const { state: onChainMessage, error: stateError } = useContractState(messageObservable);

  const onStore = () =>
    run("storing", async () => {
      if (!contract) return;
      await storeMessage(contract, draft);
    });

  return (
    <div className="flex flex-col gap-6">
      <DeploymentCard deployment={deployment} />

      {providers && address && (
        <Card>
          <CardHeader>
            <CardTitle>2. Message</CardTitle>
            <CardDescription>
              The public <code>message</code> ledger field, streamed live from the indexer.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-lg" data-testid="on-chain-message">
              {onChainMessage === null ? (
                <span className="text-muted-foreground">Loading...</span>
              ) : onChainMessage === "" ? (
                <span className="text-muted-foreground italic">(empty — nothing stored yet)</span>
              ) : (
                onChainMessage
              )}
            </p>
            {stateError && <p className="text-xs text-destructive">{stateError.message}</p>}

            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void onStore();
              }}
            >
              <Input
                aria-label="New message"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <Button type="submit" disabled={busy !== null || !contract}>
                {busy === "storing" && <Loader2 className="animate-spin" />}
                storeMessage
              </Button>
            </form>
            {busy === "storing" && (
              <p className="text-xs text-muted-foreground">
                Running the circuit, proving, then waiting for wallet approval and finalization.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
