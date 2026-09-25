import { WalletProvider } from "@/providers/wallet-context";
import { MidnightProvidersProvider } from "@/providers/midnight-providers";
import { WalletWidget } from "@/components/wallet-widget";
import { NetworkBadge } from "@/components/network-badge";
import { PassphraseCard } from "@/components/passphrase-card";
import { ProvingSettings } from "@/components/proving-settings";
import { PrivatePartyPanel } from "@/components/private-party-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWallet } from "@/hooks/use-wallet";
import { useMidnightProviders } from "@/providers/midnight-providers";

export function App() {
  return (
    <WalletProvider>
      <MidnightProvidersProvider>
        <div className="min-h-screen bg-background text-foreground">
          <header className="border-b">
            <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3">
              <h1 className="text-lg font-semibold">Midnight Private Party</h1>
              <div className="flex items-center gap-3">
                <NetworkBadge />
                <WalletWidget />
              </div>
            </div>
          </header>
          <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
            <Main />
          </main>
        </div>
      </MidnightProvidersProvider>
    </WalletProvider>
  );
}

function Main() {
  const { status } = useWallet();
  const { locked } = useMidnightProviders();

  if (status !== "connected") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Connect a wallet</CardTitle>
          <CardDescription>
            Pick the network your wallet is set to, then connect. You'll need DUST on that network
            to pay fees.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Proving</CardTitle>
          <CardDescription>Where zero-knowledge proofs are generated.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProvingSettings />
        </CardContent>
      </Card>
      {locked ? <PassphraseCard /> : <PrivatePartyPanel />}
    </>
  );
}
