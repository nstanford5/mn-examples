import { useEffect, useState } from "react";
import { useWallet } from "@/hooks/use-wallet";

/**
 * Polls the connected wallet's DUST balance. Every tx (deploy, circuit calls)
 * pays its fee in DUST, and a wallet with 0 DUST fails at the balancing step
 * with `Wallet.InsufficientFunds`. The UI uses this to warn before that.
 * `cap` is the most DUST the wallet's registered NIGHT can generate; it stays
 * 0 until some NIGHT is registered for DUST generation.
 */
export function useDustBalance(intervalMs = 10_000): { balance: bigint; cap: bigint } | null {
  const { connectedApi, status } = useWallet();
  const [dust, setDust] = useState<{ balance: bigint; cap: bigint } | null>(null);

  useEffect(() => {
    if (status !== "connected" || !connectedApi) {
      setDust(null);
      return;
    }
    let cancelled = false;
    const poll = () =>
      connectedApi
        .getDustBalance()
        .then((d) => !cancelled && setDust(d))
        .catch(() => !cancelled && setDust(null));
    void poll();
    const id = window.setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [connectedApi, status, intervalMs]);

  return dust;
}
