// The connected wallet's token balances, for contracts that move tokens.
// `yarn new:ui` puts one in the generated panel when the contract calls a
// token operation (mint, send or receive, shielded or unshielded).
//
// It shows the wallet's side only. A contract's own balance isn't here: the
// indexer's contract-balance query reports balances as of the deploy, not
// after later calls (see examples/token-transfers/src/test/).
//
// Template-owned: edit templates/ui/src/components/wallet-balances-card.tsx,
// then `yarn new:ui --sync-all`.
import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useWalletBalances } from "@/hooks/use-wallet-balances";
import { colorLabel, formatStar, NIGHT_COLOR } from "@/lib/tokens";

export function WalletBalancesCard({
  title = "Your wallet",
  description = "Your balances, polled from the wallet. Calls that pay tokens in or send them to you show up here.",
  labels = {},
  refreshKey = null,
  children,
}: {
  title?: string;
  description?: ReactNode;
  /** Names for known colors (lowercase hex), e.g. the contract's own token. NIGHT is built in. */
  labels?: Readonly<Record<string, string>>;
  /** Change it to poll now, e.g. after each call. */
  refreshKey?: unknown;
  /** Extra lines under the balances. */
  children?: ReactNode;
}) {
  const balances = useWalletBalances(refreshKey);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {balances === null ? (
          <p className="text-muted-foreground">Connect a wallet to see its balances.</p>
        ) : (
          <>
            <BalanceList title="Unshielded" balances={balances.unshielded} labels={labels} />
            <BalanceList title="Shielded" balances={balances.shielded} labels={labels} />
          </>
        )}
        {children}
      </CardContent>
    </Card>
  );
}

function BalanceList({
  title,
  balances,
  labels,
}: {
  title: string;
  balances: Record<string, bigint>;
  labels: Readonly<Record<string, string>>;
}) {
  const entries = Object.entries(balances).filter(([, v]) => v > 0n);
  return (
    <div>
      <h3 className="font-medium">{title}</h3>
      {entries.length === 0 ? (
        <p className="text-muted-foreground">none</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {entries.map(([color, value]) => (
            <div key={color} className="contents">
              <dt className="font-mono text-muted-foreground" title={color}>
                {colorLabel(color, labels)}
              </dt>
              <dd className="font-mono">
                {color.toLowerCase() === NIGHT_COLOR ? formatStar(value) : value.toString()}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
