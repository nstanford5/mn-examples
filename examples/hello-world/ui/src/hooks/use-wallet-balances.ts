// Template-owned: edit templates/ui/src/hooks/use-wallet-balances.ts, then
// `yarn new:ui --sync-all`.
import { useEffect, useState } from "react";
import { useWallet } from "@/hooks/use-wallet";

/** The wallet's balances per token color (hex), in each token's smallest unit. */
export interface WalletBalances {
  unshielded: Record<string, bigint>;
  shielded: Record<string, bigint>;
}

/**
 * Polls the connected wallet's unshielded and shielded balances, like
 * useDustBalance does for DUST. For contracts that move tokens: a mint, send
 * or receive isn't ledger state, but when the wallet is the counterparty its
 * balances show the move. Change `refreshKey` (e.g. after each call) to poll
 * at once instead of waiting for the interval.
 */
export function useWalletBalances(refreshKey: unknown = null, intervalMs = 10_000): WalletBalances | null {
  const { connectedApi, status } = useWallet();
  const [balances, setBalances] = useState<WalletBalances | null>(null);

  useEffect(() => {
    if (status !== "connected" || !connectedApi) {
      setBalances(null);
      return;
    }
    let cancelled = false;
    const poll = () =>
      Promise.all([connectedApi.getUnshieldedBalances(), connectedApi.getShieldedBalances()])
        .then(([unshielded, shielded]) => !cancelled && setBalances({ unshielded, shielded }))
        .catch(() => !cancelled && setBalances(null));
    void poll();
    const id = window.setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [connectedApi, status, intervalMs, refreshKey]);

  return balances;
}
