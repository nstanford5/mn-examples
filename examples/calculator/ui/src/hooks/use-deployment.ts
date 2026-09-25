import { useCallback, useEffect, useRef, useState } from "react";
import type { ContractAddress } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import { errorMessage } from "@/lib/errors";
import { storage } from "@/lib/storage";
import type { CalculatorProviders } from "@/midnight/providers";
import { useMidnightProviders } from "@/providers/midnight-providers";
import { useWallet } from "@/hooks/use-wallet";

const ADDRESS_KEY_PREFIX = "calculator-ui:contract-address:";

/**
 * The example's deploy and join, from its seed api file.
 *
 * `I` is whatever deploying needs from the user (constructor args, inputs to
 * the initial private state). It defaults to `void`: the no-input case, where
 * <DeploymentCard> renders a plain "Deploy" button. When it isn't void, the
 * panel passes <DeploymentCard deployForm={...}> and its form calls
 * `deployment.deploy(input)`.
 *
 * `join` takes no user input because it also runs unattended: on reload the
 * remembered address is re-joined automatically. With persistent private
 * state it should reuse the stored state when there is one (see
 * joinCalculator in the api file).
 */
export interface DeploymentOps<T, I = void> {
  deploy: (providers: CalculatorProviders, input: I) => Promise<{ contract: T; address: ContractAddress }>;
  join: (providers: CalculatorProviders, address: ContractAddress) => Promise<T>;
}

export interface Deployment<T, I = void> {
  providers: CalculatorProviders | null;
  providersError: string | null;
  networkId: string | null;
  /** Handle for callTx; null until deployed/joined with the current providers. */
  contract: T | null;
  /**
   * The deployed/joined address, or the remembered one while it is being (or
   * failed to be) re-joined. `contract === null` with an address set means the
   * re-join hasn't succeeded; `error` says why and `rejoin()` retries.
   */
  address: ContractAddress | null;
  /** Label of the operation in flight ("deploying", "joining", or a run() kind). */
  busy: string | null;
  error: string | null;
  deploy: (input: I) => Promise<void>;
  join: (address: string) => Promise<void>;
  /** Retry joining the remembered address (after a failed automatic re-join). */
  rejoin: () => Promise<void>;
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
 *
 * A failed re-join keeps the address (the indexer may just be down, and with
 * persistent private state that address is the key to the user's game or
 * funds). The card offers Retry and Forget; only Forget drops it.
 */
export function useDeployment<T, I = void>(ops: DeploymentOps<T, I>): Deployment<T, I> {
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

  const rejoinSaved = useCallback(
    (isCancelled: () => boolean) => {
      if (!providers) return;
      const saved = storage.get(addressKey);
      setAddress(saved);
      if (!saved) return;
      setBusy("joining");
      setError(null);
      opsRef.current
        .join(providers, saved)
        .then((c) => {
          if (isCancelled()) return;
          setContract(c);
        })
        .catch((err: unknown) => {
          if (isCancelled()) return;
          setError(errorMessage(err, `Could not re-join ${saved}`));
        })
        .finally(() => !isCancelled() && setBusy(null));
    },
    [providers, addressKey],
  );

  useEffect(() => {
    setContract(null);
    let cancelled = false;
    rejoinSaved(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [rejoinSaved]);

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

  const deploy = (input: I) =>
    run("deploying", async () => {
      if (!providers) return;
      const { contract: c, address: a } = await opsRef.current.deploy(providers, input);
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

  const rejoin = async () => rejoinSaved(() => false);

  const forget = () => {
    storage.remove(addressKey);
    setContract(null);
    setAddress(null);
    setError(null);
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
    rejoin,
    forget,
    run,
  };
}
