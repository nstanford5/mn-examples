import { useCallback, useEffect, useRef, useState } from "react";
import type { ContractAddress } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import { errorMessage } from "@/lib/errors";
import { storage } from "@/lib/storage";
import type { __Name__Providers } from "@/midnight/providers";
import { useMidnightProviders } from "@/providers/midnight-providers";
import { useWallet } from "@/hooks/use-wallet";

const ADDRESS_KEY_PREFIX = "__name__-ui:contract-address:";

export interface DeploymentOps<T> {
  deploy: (providers: __Name__Providers) => Promise<{ contract: T; address: ContractAddress }>;
  join: (providers: __Name__Providers, address: ContractAddress) => Promise<T>;
}

export interface Deployment<T> {
  providers: __Name__Providers | null;
  providersError: string | null;
  networkId: string | null;
  /** Handle for callTx; null until deployed/joined with the current providers. */
  contract: T | null;
  address: ContractAddress | null;
  /** Label of the operation in flight ("deploying", "joining", or a run() kind). */
  busy: string | null;
  error: string | null;
  deploy: () => Promise<void>;
  join: (address: string) => Promise<void>;
  forget: () => void;
  /** Run an async operation with the shared busy/error state. */
  run: (kind: string, fn: () => Promise<void>) => Promise<void>;
}

/**
 * Deploy / join / forget for one contract, shared by every generated UI.
 *
 * The address is remembered per network so a reload re-joins automatically.
 * Contract handles are bound to one providers bundle, so when the providers
 * change (new wallet connection or proving mode) the remembered address is
 * re-joined with the new bundle.
 */
export function useDeployment<T>(ops: DeploymentOps<T>): Deployment<T> {
  const { networkId } = useWallet();
  const { providers, error: providersError } = useMidnightProviders();
  const addressKey = `${ADDRESS_KEY_PREFIX}${networkId ?? "unknown"}`;

  // Callers usually pass fresh function references each render; keep the
  // latest in a ref so they don't retrigger the re-join effect.
  const opsRef = useRef(ops);
  opsRef.current = ops;

  const [contract, setContract] = useState<T | null>(null);
  const [address, setAddress] = useState<ContractAddress | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    opsRef.current
      .join(providers, saved)
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

  const run = useCallback(async (kind: string, fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (err: unknown) {
      setError(errorMessage(err, `Failed while ${kind}`));
    } finally {
      setBusy(null);
    }
  }, []);

  const deploy = () =>
    run("deploying", async () => {
      if (!providers) return;
      const { contract: c, address: a } = await opsRef.current.deploy(providers);
      storage.set(addressKey, a);
      setContract(c);
      setAddress(a);
    });

  const join = (input: string) =>
    run("joining", async () => {
      if (!providers) return;
      const a = input.trim();
      const c = await opsRef.current.join(providers, a);
      storage.set(addressKey, a);
      setContract(c);
      setAddress(a);
    });

  const forget = () => {
    storage.remove(addressKey);
    setContract(null);
    setAddress(null);
  };

  return {
    providers,
    providersError,
    networkId,
    contract,
    address,
    busy,
    error,
    deploy,
    join,
    forget,
    run,
  };
}
