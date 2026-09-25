import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Deployment } from "@/hooks/use-deployment";
import { useDustBalance } from "@/hooks/use-dust-balance";
import { useWallet } from "@/hooks/use-wallet";

/**
 * The generic "1. Contract" step: provider status, the no-DUST warning, and
 * deploy / join / forget. The example-specific panel renders this first and
 * its own circuit and ledger cards below it once `deployment.address` is set.
 */
export function DeploymentCard<T>({ deployment }: { deployment: Deployment<T> }) {
  const { providers, providersError, networkId, address, busy } = deployment;
  const [joinInput, setJoinInput] = useState("");
  const dust = useDustBalance();

  useEffect(() => {
    if (address) setJoinInput("");
  }, [address]);

  if (providersError) {
    return <p className="text-sm text-destructive">Provider setup failed: {providersError}</p>;
  }
  if (!providers) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Preparing Midnight providers...
      </p>
    );
  }

  return (
    <>
      {dust !== null && dust.balance === 0n && (
        <NoDustWarning cap={dust.cap} networkId={networkId} />
      )}
      <Card>
        <CardHeader>
          <CardTitle>1. Contract</CardTitle>
          <CardDescription>
            Deploy a new calculator contract, or join one someone else deployed.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {address ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Address</span>
              <code className="break-all rounded bg-muted px-2 py-1">{address}</code>
              <Button
                variant="ghost"
                size="sm"
                onClick={deployment.forget}
                disabled={busy !== null}
              >
                Forget
              </Button>
            </div>
          ) : (
            <>
              <Button
                onClick={() => void deployment.deploy()}
                disabled={busy !== null}
                className="self-start"
              >
                {busy === "deploying" && <Loader2 className="animate-spin" />}
                Deploy new contract
              </Button>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void deployment.join(joinInput);
                }}
              >
                <Input
                  aria-label="Contract address"
                  placeholder="Existing contract address"
                  value={joinInput}
                  onChange={(e) => setJoinInput(e.target.value)}
                  className="font-mono"
                />
                <Button type="submit" variant="outline" disabled={busy !== null || !joinInput.trim()}>
                  {busy === "joining" && <Loader2 className="animate-spin" />}
                  Join
                </Button>
              </form>
            </>
          )}
          {busy === "deploying" && (
            <p className="text-xs text-muted-foreground">
              Proving the deploy, then waiting for your wallet to approve and the tx to finalize.
              This can take a minute.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/**
 * Shown while the wallet has 0 DUST. On the local devnet, point
 * `yarn fund:wallet` at this wallet's DUST address: a sponsor wallet registers
 * NIGHT with this address as the DUST receiver, so no wallet UI step is needed.
 * The script lives in examples/hello-world and works for any example's UI.
 */
function NoDustWarning({ cap, networkId }: { cap: bigint; networkId: string | null }) {
  const { connectedApi } = useWallet();
  const [dustAddress, setDustAddress] = useState<string | null>(null);
  useEffect(() => {
    connectedApi
      ?.getDustAddress()
      .then((a) => setDustAddress(a.dustAddress))
      .catch(() => setDustAddress(null));
  }, [connectedApi]);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-destructive/40 p-3 text-sm" role="alert">
      <p className="text-destructive">
        This wallet has no DUST, so it can&apos;t pay transaction fees.
        {cap > 0n && " DUST is accruing from registered NIGHT; wait a few blocks."}
      </p>
      {cap === 0n && networkId === "undeployed" && dustAddress && (
        <>
          <p className="text-muted-foreground">
            On the local devnet, run this in <code>examples/hello-world</code> to have DUST generated
            for this wallet:
          </p>
          <code className="break-all rounded bg-muted px-2 py-1 text-xs">
            yarn fund:wallet {dustAddress}
          </code>
        </>
      )}
      {cap === 0n && networkId !== "undeployed" && (
        <p className="text-muted-foreground">
          Get tNIGHT from the faucet and have it generate DUST for this wallet.
        </p>
      )}
    </div>
  );
}
