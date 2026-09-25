import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMidnightProviders } from "@/providers/midnight-providers";

/**
 * Chooses where ZK proofs are generated (see ProvingMode in
 * src/midnight/providers.ts). Changing it rebuilds the providers. A deployed
 * or joined contract handle is tied to the old providers, so the contract
 * panel re-joins by address afterwards.
 */
export function ProvingSettings() {
  const { proving, setProving } = useMidnightProviders();
  const [url, setUrl] = useState(proving.proofServerUrl);
  const reachable = useProofServerReachable(proving.mode === "local" ? proving.proofServerUrl : null);

  return (
    <div className="flex flex-col gap-3 text-sm">
      <fieldset className="flex flex-wrap items-center gap-4">
        <legend className="sr-only">Proving mode</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="proving"
            checked={proving.mode === "wallet"}
            onChange={() => setProving({ ...proving, mode: "wallet" })}
          />
          Wallet proves (default)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="proving"
            checked={proving.mode === "local"}
            onChange={() => setProving({ ...proving, mode: "local" })}
          />
          Local proof server
        </label>
      </fieldset>

      {proving.mode === "local" && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setProving({ ...proving, proofServerUrl: url.trim() });
          }}
        >
          <Input
            aria-label="Proof server URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="max-w-72 font-mono"
          />
          <Button type="submit" variant="outline" size="sm" disabled={url.trim() === proving.proofServerUrl}>
            Apply
          </Button>
          {reachable !== null && (
            <Badge variant={reachable ? "secondary" : "destructive"}>
              {reachable ? "Reachable" : "Unreachable"}
            </Badge>
          )}
        </form>
      )}
    </div>
  );
}

/** Rough reachability probe; `no-cors` only tells us the host answered. */
function useProofServerReachable(url: string | null): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    if (!url) {
      setOk(null);
      return;
    }
    let cancelled = false;
    fetch(url, { mode: "no-cors" })
      .then(() => !cancelled && setOk(true))
      .catch(() => !cancelled && setOk(false));
    return () => {
      cancelled = true;
    };
  }, [url]);
  return ok;
}
