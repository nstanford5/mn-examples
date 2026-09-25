import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WalletBalancesCard } from "../components/wallet-balances-card";
import { NIGHT_COLOR } from "../lib/tokens";
import { WalletContext, type WalletContextValue } from "../providers/wallet-context";

const CUSTOM = "ab".repeat(32);
const OTHER = "cd".repeat(32);

function withWallet(api: object | null) {
  const wallet = {
    status: api ? "connected" : "disconnected",
    connectedApi: api,
    networkId: "undeployed",
  } as unknown as WalletContextValue;
  return (ui: React.ReactNode) => <WalletContext.Provider value={wallet}>{ui}</WalletContext.Provider>;
}

describe("WalletBalancesCard", () => {
  it("lists non-zero balances, labelling NIGHT (in STAR) and known colors", async () => {
    const api = {
      getUnshieldedBalances: async () => ({ [NIGHT_COLOR]: 1_500_000n, [CUSTOM]: 400n, [OTHER]: 0n }),
      getShieldedBalances: async () => ({ [OTHER]: 300n }),
    };
    render(withWallet(api)(<WalletBalancesCard labels={{ [CUSTOM]: "custom token" }} />));
    expect(await screen.findByText("1500000 STAR (1.5 NIGHT)")).toBeInTheDocument();
    expect(screen.getByText("custom token")).toBeInTheDocument();
    expect(screen.getByText("400")).toBeInTheDocument();
    // The zero unshielded OTHER is hidden; the shielded one shows, shortened.
    expect(screen.getAllByText("cdcdcdcdcdcd…")).toHaveLength(1);
    expect(screen.getByText("300")).toBeInTheDocument();
  });

  it("asks for a wallet when none is connected", () => {
    render(withWallet(null)(<WalletBalancesCard />));
    expect(screen.getByText("Connect a wallet to see its balances.")).toBeInTheDocument();
  });
});
