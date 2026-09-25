import { Wallet, LogOut, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/use-wallet";
import { NETWORK_IDS, type NetworkId } from "@/providers/wallet-context";

function truncateAddress(address: string): string {
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}...${address.slice(-8)}`;
}

export function WalletWidget() {
  const {
    status,
    shieldedAddress,
    error,
    connect,
    disconnect,
    requestedNetworkId,
    setRequestedNetworkId,
    wallets,
    selectedWalletKey,
    setSelectedWalletKey,
  } = useWallet();

  if (status === "connecting") {
    return (
      <Button variant="outline" disabled>
        <Loader2 className="animate-spin" />
        Connecting...
      </Button>
    );
  }

  if (status === "connected" && shieldedAddress) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm text-muted-foreground" title={shieldedAddress}>
          {truncateAddress(shieldedAddress)}
        </span>
        <Button variant="ghost" size="icon" onClick={disconnect} aria-label="Disconnect">
          <LogOut />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {/* Only offer a choice when more than one Midnight wallet is installed. */}
        {wallets.length > 1 && (
          <>
            <label className="sr-only" htmlFor="wallet-key">
              Wallet
            </label>
            <select
              id="wallet-key"
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              value={selectedWalletKey ?? ""}
              onChange={(e) => setSelectedWalletKey(e.target.value)}
            >
              {wallets.map((w) => (
                <option key={w.key} value={w.key}>
                  {w.name}
                </option>
              ))}
            </select>
          </>
        )}
        {/* The requested network must match the one the wallet is set to. */}
        <label className="sr-only" htmlFor="network-id">
          Network
        </label>
        <select
          id="network-id"
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          value={requestedNetworkId}
          onChange={(e) => setRequestedNetworkId(e.target.value as NetworkId)}
        >
          {NETWORK_IDS.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <Button variant="outline" onClick={connect}>
          <Wallet />
          Connect Wallet
        </Button>
      </div>
      {status === "error" && error && (
        <p className="max-w-80 text-right text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
