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
  type HelloWorldProviders,
  type ProvingMode,
  type ProvingOptions,
} from "@/midnight/providers";
import { useWallet } from "@/hooks/use-wallet";
import { errorMessage } from "@/lib/errors";
import { storage } from "@/lib/storage";

const PROVING_KEY = "hello-world-ui:proving";

interface MidnightProvidersContextValue {
  providers: HelloWorldProviders | null;
  isReady: boolean;
  error: string | null;
  proving: ProvingOptions;
  setProving: (next: ProvingOptions) => void;
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
  const [providers, setProviders] = useState<HelloWorldProviders | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proving, setProvingState] = useState<ProvingOptions>(initialProving);

  const setProving = useCallback((next: ProvingOptions) => {
    setProvingState(next);
    storage.set(PROVING_KEY, JSON.stringify(next));
  }, []);

  useEffect(() => {
    if (status !== "connected" || !connectedApi) {
      setProviders(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setProviders(null);
    createProviders(connectedApi, proving)
      .then((p) => {
        if (!cancelled) {
          setProviders(p);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err, "Failed to create providers"));
      });

    return () => {
      cancelled = true;
    };
  }, [connectedApi, status, proving]);

  return (
    <MidnightProvidersContext.Provider
      value={{ providers, isReady: providers !== null, error, proving, setProving }}
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
