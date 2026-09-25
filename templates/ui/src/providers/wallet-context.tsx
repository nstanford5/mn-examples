import {
  createContext,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { ConnectedAPI, InitialAPI } from "@midnight-ntwrk/dapp-connector-api";
import { errorMessage } from "@/lib/errors";
import { storage } from "@/lib/storage";

const AUTOCONNECT_KEY = "__name__-ui:wallet-autoconnect";
const NETWORK_KEY = "__name__-ui:network-id";
const WALLET_KEY = "__name__-ui:wallet";

/**
 * Network ids a Midnight wallet recognizes. `undeployed` is the local devnet
 * from examples/__name__/compose.yml.
 */
export const NETWORK_IDS = ["undeployed", "preview", "preprod"] as const;
export type NetworkId = (typeof NETWORK_IDS)[number];

export type WalletConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface WalletState {
  status: WalletConnectionStatus;
  connectedApi: ConnectedAPI | null;
  shieldedAddress: string | null;
  networkId: string | null;
  error: string | null;
}

export interface WalletContextValue extends WalletState {
  /** Network id to request when connecting (the user picks it before connecting). */
  requestedNetworkId: NetworkId;
  setRequestedNetworkId: (id: NetworkId) => void;
  /** Wallet extensions detected in the page, and which one to connect to. */
  wallets: DetectedWallet[];
  selectedWalletKey: string | null;
  setSelectedWalletKey: (key: string) => void;
  connect: () => Promise<void>;
  disconnect: () => void;
}

export const WalletContext = createContext<WalletContextValue | null>(null);

const DISCONNECTED: WalletState = {
  status: "disconnected",
  connectedApi: null,
  shieldedAddress: null,
  networkId: null,
  error: null,
};

/** A wallet extension found in `window.midnight`. */
export interface DetectedWallet {
  key: string;
  name: string;
  api: InitialAPI;
}

/**
 * Every Midnight wallet injects itself into `window.midnight` under its own
 * key (a UUID; Lace also adds an `mnLace` alias pointing at the same object).
 * Several can be installed at once, so list them all, drop aliases, and let
 * the user pick.
 */
export function detectWallets(): DetectedWallet[] {
  if (typeof window === "undefined" || !window.midnight) return [];
  const seen = new Set<InitialAPI>();
  const wallets: DetectedWallet[] = [];
  for (const [key, api] of Object.entries(window.midnight)) {
    if (api == null || typeof api.connect !== "function" || seen.has(api)) continue;
    seen.add(api);
    wallets.push({ key, name: api.name || key, api });
  }
  return wallets;
}

/** Remembered choice first, then Lace, then whatever is there. */
function preferredWalletKey(wallets: DetectedWallet[], saved: string | null): string | null {
  if (saved && wallets.some((w) => w.key === saved)) return saved;
  const lace = wallets.find((w) => /lace/i.test(`${w.api.rdns} ${w.name}`));
  return (lace ?? wallets[0])?.key ?? null;
}

function initialNetworkId(): NetworkId {
  const saved = storage.get(NETWORK_KEY);
  return NETWORK_IDS.includes(saved as NetworkId) ? (saved as NetworkId) : "undeployed";
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>(DISCONNECTED);
  const [requestedNetworkId, setRequested] = useState<NetworkId>(initialNetworkId);

  const [wallets, setWallets] = useState<DetectedWallet[]>(detectWallets);
  const [selectedWalletKey, setSelectedWallet] = useState<string | null>(() =>
    preferredWalletKey(detectWallets(), storage.get(WALLET_KEY)),
  );

  const setRequestedNetworkId = useCallback((id: NetworkId) => {
    setRequested(id);
    storage.set(NETWORK_KEY, id);
  }, []);

  const setSelectedWalletKey = useCallback((key: string) => {
    setSelectedWallet(key);
    storage.set(WALLET_KEY, key);
  }, []);

  // Extensions can inject after the page script runs, so re-scan briefly.
  useEffect(() => {
    let tries = 0;
    const id = window.setInterval(() => {
      const found = detectWallets();
      setWallets((prev) => (prev.length === found.length ? prev : found));
      setSelectedWallet((prev) => prev ?? preferredWalletKey(found, storage.get(WALLET_KEY)));
      if (++tries >= 10) window.clearInterval(id);
    }, 300);
    return () => window.clearInterval(id);
  }, []);

  const connect = useCallback(async () => {
    setState((prev) => ({ ...prev, status: "connecting", error: null }));

    const found = detectWallets();
    const key = preferredWalletKey(found, selectedWalletKey);
    const wallet = found.find((w) => w.key === key)?.api;
    if (!wallet) {
      setState({
        ...DISCONNECTED,
        status: "error",
        error:
          "No Midnight wallet extension found. Install a Midnight wallet (e.g. Lace) to continue.",
      });
      return;
    }

    try {
      // connect(networkId) asks the user to authorize this site for that
      // network. It rejects if the wallet is set to a different one, so the
      // requested id has to match the wallet's current network.
      const api = await wallet.connect(requestedNetworkId);
      const config = await api.getConfiguration();
      const { shieldedAddress } = await api.getShieldedAddresses();

      setState({
        status: "connected",
        connectedApi: api,
        shieldedAddress,
        networkId: config.networkId,
        error: null,
      });
      storage.set(AUTOCONNECT_KEY, "true");
    } catch (err: unknown) {
      setState({
        ...DISCONNECTED,
        status: "error",
        error: errorMessage(err, "Failed to connect to wallet"),
      });
    }
  }, [requestedNetworkId, selectedWalletKey]);

  const disconnect = useCallback(() => {
    storage.remove(AUTOCONNECT_KEY);
    setState(DISCONNECTED);
  }, []);

  // Reconnect on page load if the user connected last time. Deliberately runs
  // only on mount, not every time the requested network changes.
  useEffect(() => {
    if (storage.get(AUTOCONNECT_KEY) === "true") void connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <WalletContext.Provider
      value={{
        ...state,
        requestedNetworkId,
        setRequestedNetworkId,
        wallets,
        selectedWalletKey,
        setSelectedWalletKey,
        connect,
        disconnect,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}
