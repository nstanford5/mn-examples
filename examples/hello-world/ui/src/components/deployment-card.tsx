import { useEffect, useState, type ReactNode } from "react";
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
 * its own circuit and ledger cards below it once `deployment.contract` is set.
 *
 * `deployForm` replaces the plain "Deploy" button when deploying needs input
 * (constructor args, private-state inputs). It must call
 * `deployment.deploy(input)` itself. Without it, the button calls `deploy()`
 * with no input, which is only right when the ops' input type is `void`.
 */
export function DeploymentCard<T, I = void>({
  deployment,
  deployForm,
}: {
  deployment: Deployment<T, I>;
  deployForm?: ReactNode;
}) {
  const { providers, providersError, networkId, address, contract, busy, error } = deployment;
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
            Deploy a new hello-world contract, or join one someone else deployed.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {address ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Address</span>
              <code className="break-all rounded bg-muted px-2 py-1">{address}</code>
              {!contract && busy === null && error && (
                <Button variant="outline" size="sm" onClick={() => void deployment.rejoin()}>
                  Retry join
                </Button>
              )}
              {busy === "joining" && <Loader2 className="size-4 animate-spin" />}
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
              {deployForm ?? (
                <Button
                  onClick={() => void deployment.deploy(undefined as I)}
                  disabled={busy !== null}
                  className="self-start"
                >
                  {busy === "deploying" && <Loader2 className="animate-spin" />}
                  Deploy new contract
                </Button>
              )}
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
 * The unshielded address is passed too, so the wallet also gets NIGHT to spend
 * (a contract may charge it, e.g. private-party's checkIn). The script is a
 * root script (packages/fast-sync/scripts/fund-wallet.ts) and works for any UI.
 */
function NoDustWarning({ cap, networkId }: { cap: bigint; networkId: string | null }) {
  const { connectedApi } = useWallet();
  const [dustAddress, setDustAddress] = useState<string | null>(null);
  const [nightAddress, setNightAddress] = useState<string | null>(null);
  useEffect(() => {
    connectedApi
      ?.getDustAddress()
      .then((a) => setDustAddress(a.dustAddress))
      .catch(() => setDustAddress(null));
    connectedApi
      ?.getUnshieldedAddress()
      .then((a) => setNightAddress(a.unshieldedAddress))
      .catch(() => setNightAddress(null));
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
            On the local devnet, run this anywhere in the repo to have DUST generated for this
            wallet{nightAddress && " and 1,000 NIGHT sent to it"}:
          </p>
          <code className="break-all rounded bg-muted px-2 py-1 text-xs">
            yarn fund:wallet {dustAddress}
            {nightAddress && ` ${nightAddress}`}
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
