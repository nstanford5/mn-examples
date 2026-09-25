import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WalletProvider } from "../providers/wallet-context";
import { useWallet } from "../hooks/use-wallet";
import { WalletWidget } from "../components/wallet-widget";

function TestConsumer() {
  const { status, shieldedAddress, networkId, error, connect, disconnect, setRequestedNetworkId } =
    useWallet();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="address">{shieldedAddress ?? "none"}</span>
      <span data-testid="network">{networkId ?? "none"}</span>
      <span data-testid="error">{error ?? "none"}</span>
      <button onClick={() => setRequestedNetworkId("preprod")}>use preprod</button>
      <button onClick={connect}>connect</button>
      <button onClick={disconnect}>disconnect</button>
    </div>
  );
}

const win = window as unknown as { midnight?: Record<string, unknown> };

function installWallet(connect: ReturnType<typeof vi.fn>) {
  win.midnight = {
    "5f1c0d3e-uuid": { name: "Lace", apiVersion: "4.0.1", icon: "", rdns: "io.lace", connect },
  };
}

function mockConnectedApi(networkId: string) {
  return {
    getConfiguration: vi.fn().mockResolvedValue({
      indexerUri: "http://127.0.0.1:8088/api/v4/graphql",
      indexerWsUri: "ws://127.0.0.1:8088/api/v4/graphql/ws",
      substrateNodeUri: "http://127.0.0.1:9944",
      networkId,
    }),
    getShieldedAddresses: vi.fn().mockResolvedValue({
      shieldedAddress: "mn_shield-addr_test1abc123",
      shieldedCoinPublicKey: "coinpub",
      shieldedEncryptionPublicKey: "encpub",
    }),
  };
}

function renderWallet() {
  render(
    <WalletProvider>
      <TestConsumer />
      <WalletWidget />
    </WalletProvider>,
  );
}

describe("WalletContext", () => {
  beforeEach(() => {
    localStorage.clear();
    delete win.midnight;
  });

  it("starts disconnected", () => {
    renderWallet();
    expect(screen.getByTestId("status")).toHaveTextContent("disconnected");
    expect(screen.getByTestId("address")).toHaveTextContent("none");
  });

  it("reports a missing wallet extension", async () => {
    renderWallet();
    await userEvent.click(screen.getByText("connect"));
    expect(screen.getByTestId("status")).toHaveTextContent("error");
    expect(screen.getByTestId("error")).toHaveTextContent("No Midnight wallet extension found");
  });

  it("connects with the requested network id and reads the wallet's config", async () => {
    const connect = vi.fn().mockResolvedValue(mockConnectedApi("preprod"));
    installWallet(connect);
    renderWallet();

    await userEvent.click(screen.getByText("use preprod"));
    await userEvent.click(screen.getByText("connect"));

    await vi.waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("connected"));
    expect(connect).toHaveBeenCalledWith("preprod");
    expect(screen.getByTestId("network")).toHaveTextContent("preprod");
    expect(screen.getByTestId("address")).toHaveTextContent("mn_shield-addr_test1abc123");
  });

  it("surfaces DApp Connector errors by their reason", async () => {
    installWallet(
      vi.fn().mockRejectedValue({
        type: "DAppConnectorAPIError",
        code: "Rejected",
        reason: "User rejected the connection",
      }),
    );
    renderWallet();

    await userEvent.click(screen.getByText("connect"));

    await vi.waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("error"));
    expect(screen.getByTestId("error")).toHaveTextContent("User rejected the connection (Rejected)");
  });

  it("prefers Lace when several wallets are installed, and dedupes aliases", async () => {
    const other = vi.fn().mockResolvedValue(mockConnectedApi("undeployed"));
    const lace = {
      name: "lace",
      apiVersion: "4.0.1",
      icon: "",
      rdns: "io.lace.wallet",
      connect: vi.fn().mockResolvedValue(mockConnectedApi("undeployed")),
    };
    win.midnight = {
      "1am": { name: "1AM", apiVersion: "4.0.1", icon: "", rdns: "xyz.1am", connect: other },
      "feb7992d-uuid": lace,
      mnLace: lace, // alias pointing at the same object
    };
    renderWallet();

    const picker = await screen.findByLabelText("Wallet");
    expect(picker).toHaveValue("feb7992d-uuid");
    expect(picker.querySelectorAll("option")).toHaveLength(2);

    await userEvent.click(screen.getByText("connect"));
    await vi.waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("connected"));
    expect(lace.connect).toHaveBeenCalledWith("undeployed");
    expect(other).not.toHaveBeenCalled();
  });

  it("disconnects and clears state", async () => {
    installWallet(vi.fn().mockResolvedValue(mockConnectedApi("undeployed")));
    renderWallet();
    await userEvent.click(screen.getByText("connect"));
    await vi.waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("connected"));

    await userEvent.click(screen.getByText("disconnect"));

    expect(screen.getByTestId("status")).toHaveTextContent("disconnected");
    expect(screen.getByTestId("address")).toHaveTextContent("none");
  });
});
