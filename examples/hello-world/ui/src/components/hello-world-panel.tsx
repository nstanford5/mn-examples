import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useContractState } from "@/hooks/use-contract-state";
import { errorMessage } from "@/lib/errors";
import { storage } from "@/lib/storage";
import {
  deployHelloWorld,
  joinHelloWorld,
  message$,
  storeMessage,
  type HelloWorldContract,
} from "@/midnight/hello-world-api";
import { useMidnightProviders } from "@/providers/midnight-providers";
import { useWallet } from "@/hooks/use-wallet";
import { useDustBalance } from "@/hooks/use-dust-balance";

const ADDRESS_KEY_PREFIX = "hello-world-ui:contract-address:";

type Busy = null | "deploying" | "joining" | "storing";

/**
 * The whole hello-world flow: deploy or join, watch `message`, call
 * storeMessage. The contract address is remembered per network so a reload
 * re-joins automatically.
 */
export function HelloWorldPanel() {
  const { networkId } = useWallet();
  const { providers, error: providersError } = useMidnightProviders();
  const addressKey = `${ADDRESS_KEY_PREFIX}${networkId ?? "unknown"}`;

  const [contract, setContract] = useState<HelloWorldContract | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [joinInput, setJoinInput] = useState("");
  const [draft, setDraft] = useState("Hello World!");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const dust = useDustBalance();

  // Contract handles are bound to one providers bundle. When the providers
  // change (new wallet connection or proving mode), re-join the remembered
  // address with the new bundle.
  useEffect(() => {
    setContract(null);
    if (!providers) return;
    const saved = storage.get(addressKey);
    if (!saved) {
      setAddress(null);
      return;
    }
    let cancelled = false;
    setBusy("joining");
    joinHelloWorld(providers, saved)
      .then((c) => {
        if (cancelled) return;
        setContract(c);
        setAddress(saved);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        storage.remove(addressKey);
        setAddress(null);
        setError(errorMessage(err, `Could not re-join ${saved}`));
      })
      .finally(() => !cancelled && setBusy(null));
    return () => {
      cancelled = true;
    };
  }, [providers, addressKey]);

  const messageObservable = useMemo(
    () => (providers && address ? message$(providers, address) : null),
    [providers, address],
  );
  const { state: onChainMessage, error: stateError } = useContractState(messageObservable);

  async function run(kind: Exclude<Busy, null>, fn: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (err: unknown) {
      setError(errorMessage(err, `Failed while ${kind}`));
    } finally {
      setBusy(null);
    }
  }

  const onDeploy = () =>
    run("deploying", async () => {
      if (!providers) return;
      const { contract: c, address: a } = await deployHelloWorld(providers);
      storage.set(addressKey, a);
      setContract(c);
      setAddress(a);
    });

  const onJoin = () =>
    run("joining", async () => {
      if (!providers) return;
      const a = joinInput.trim();
      const c = await joinHelloWorld(providers, a);
      storage.set(addressKey, a);
      setContract(c);
      setAddress(a);
      setJoinInput("");
    });

  const onStore = () =>
    run("storing", async () => {
      if (!contract) return;
      await storeMessage(contract, draft);
    });

  const onForget = () => {
    storage.remove(addressKey);
    setContract(null);
    setAddress(null);
  };

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
    <div className="flex flex-col gap-6">
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
              <Button variant="ghost" size="sm" onClick={onForget} disabled={busy !== null}>
                Forget
              </Button>
            </div>
          ) : (
            <>
              <Button onClick={onDeploy} disabled={busy !== null} className="self-start">
                {busy === "deploying" && <Loader2 className="animate-spin" />}
                Deploy new contract
              </Button>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void onJoin();
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

      {address && (
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

/**
 * Shown while the wallet has 0 DUST. On the local devnet, point
 * `yarn fund:wallet` at this wallet's DUST address: a sponsor wallet registers
 * NIGHT with this address as the DUST receiver, so no wallet UI step is needed.
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
