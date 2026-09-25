import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  createProviders,
  DEFAULT_PROOF_SERVER_URL,
  type __Name__Providers,
  type ProvingMode,
  type ProvingOptions,
} from "@/midnight/providers";
import { PRIVATE_STATE_STORAGE } from "@/midnight/contract";
import { WrongPassphraseError } from "@/midnight/private-state";
import { useWallet } from "@/hooks/use-wallet";
import { errorMessage } from "@/lib/errors";
import { storage } from "@/lib/storage";

const PROVING_KEY = "__name__-ui:proving";

interface MidnightProvidersContextValue {
  providers: __Name__Providers | null;
  isReady: boolean;
  error: string | null;
  proving: ProvingOptions;
  setProving: (next: ProvingOptions) => void;
  /**
   * True while PRIVATE_STATE_STORAGE is "persistent" and no passphrase has
   * been accepted this session. Providers stay null until unlock() succeeds.
   */
  locked: boolean;
  /** Why the last unlock() failed (e.g. wrong passphrase), if it did. */
  unlockError: string | null;
  unlock: (passphrase: string) => void;
}

const MidnightProvidersContext =
  createContext<MidnightProvidersContextValue | null>(null);

function initialProving(): ProvingOptions {
  try {
    const saved = JSON.parse(storage.get(PROVING_KEY) ?? "null") as Partial<ProvingOptions> | null;
    const mode: ProvingMode = saved?.mode === "local" ? "local" : "wallet";
    return { mode, proofServerUrl: saved?.proofServerUrl || DEFAULT_PROOF_SERVER_URL };
  } catch {
    return { mode: "wallet", proofServerUrl: DEFAULT_PROOF_SERVER_URL };
  }
}

/**
 * Rebuilds the MidnightProviders bundle whenever the wallet connection or the
 * proving settings change. Components read it with useMidnightProviders().
 */
export function MidnightProvidersProvider({ children }: { children: ReactNode }) {
  const { connectedApi, status } = useWallet();
  const [providers, setProviders] = useState<__Name__Providers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proving, setProvingState] = useState<ProvingOptions>(initialProving);
  // Held in memory only: never written to storage. A reload asks again.
  const [passphrase, setPassphrase] = useState<string | null>(null);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const locked = PRIVATE_STATE_STORAGE === "persistent" && passphrase === null;

  const setProving = useCallback((next: ProvingOptions) => {
    setProvingState(next);
    storage.set(PROVING_KEY, JSON.stringify(next));
  }, []);

  useEffect(() => {
    if (status !== "connected" || !connectedApi || locked) {
      setProviders(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setProviders(null);
    createProviders(connectedApi, proving, passphrase)
      .then((p) => {
        if (!cancelled) {
          setProviders(p);
          setError(null);
          setUnlockError(null);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof WrongPassphraseError) {
          // Back to the passphrase prompt, with the reason.
          setPassphrase(null);
          setUnlockError(err.message);
        } else {
          setError(errorMessage(err, "Failed to create providers"));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [connectedApi, status, proving, passphrase, locked]);

  const unlock = useCallback((next: string) => {
    setUnlockError(null);
    setPassphrase(next);
  }, []);

  return (
    <MidnightProvidersContext.Provider
      value={{
        providers,
        isReady: providers !== null,
        error,
        proving,
        setProving,
        locked,
        unlockError,
        unlock,
      }}
    >
      {children}
    </MidnightProvidersContext.Provider>
  );
}

export function useMidnightProviders(): MidnightProvidersContextValue {
  const context = useContext(MidnightProvidersContext);
  if (!context) {
    throw new Error("useMidnightProviders must be used within a MidnightProvidersProvider");
  }
  return context;
}
