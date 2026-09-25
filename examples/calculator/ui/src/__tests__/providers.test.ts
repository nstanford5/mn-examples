import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";

// Replace the two proof-provider factories with spies. This test only checks
// that the proving toggle picks the right one and passes the right inputs.
const walletProof = { kind: "wallet-proof-provider" };
const httpProof = { kind: "http-proof-provider" };
vi.mock("@midnight-ntwrk/midnight-js-dapp-connector-proof-provider", () => ({
  dappConnectorProofProvider: vi.fn(async () => walletProof),
}));
vi.mock("@midnight-ntwrk/midnight-js-http-client-proof-provider", () => ({
  httpClientProofProvider: vi.fn(() => httpProof),
}));

const { dappConnectorProofProvider } = await import(
  "@midnight-ntwrk/midnight-js-dapp-connector-proof-provider"
);
const { httpClientProofProvider } = await import(
  "@midnight-ntwrk/midnight-js-http-client-proof-provider"
);
const { createProviders } = await import("../midnight/providers");

// 32-byte keys in hex. parse*ToHex passes hex through unchanged.
const COIN_PK = "11".repeat(32);
const ENC_PK = "22".repeat(32);

function fakeApi(): ConnectedAPI {
  return {
    getConfiguration: vi.fn().mockResolvedValue({
      indexerUri: "http://127.0.0.1:8088/api/v4/graphql",
      indexerWsUri: "ws://127.0.0.1:8088/api/v4/graphql/ws",
      substrateNodeUri: "http://127.0.0.1:9944",
      networkId: "undeployed",
    }),
    getShieldedAddresses: vi.fn().mockResolvedValue({
      shieldedAddress: "unused",
      shieldedCoinPublicKey: COIN_PK,
      shieldedEncryptionPublicKey: ENC_PK,
    }),
  } as unknown as ConnectedAPI;
}

describe("createProviders", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses wallet-delegated proving by default", async () => {
    const api = fakeApi();
    const providers = await createProviders(api, {
      mode: "wallet",
      proofServerUrl: "http://127.0.0.1:6300",
    });

    expect(providers.proofProvider).toBe(walletProof);
    expect(dappConnectorProofProvider).toHaveBeenCalledWith(
      api,
      providers.zkConfigProvider,
      expect.anything(),
    );
    expect(httpClientProofProvider).not.toHaveBeenCalled();
  });

  it("uses the configured local proof server when selected", async () => {
    const providers = await createProviders(fakeApi(), {
      mode: "local",
      proofServerUrl: "http://localhost:9999",
    });

    expect(providers.proofProvider).toBe(httpProof);
    expect(httpClientProofProvider).toHaveBeenCalledWith(
      "http://localhost:9999",
      providers.zkConfigProvider,
    );
    expect(dappConnectorProofProvider).not.toHaveBeenCalled();
  });

  it("serves ZK assets from /managed/calculator on the page origin and exposes wallet keys", async () => {
    const providers = await createProviders(fakeApi(), {
      mode: "wallet",
      proofServerUrl: "",
    });

    const zk = providers.zkConfigProvider as unknown as { baseURL: string };
    expect(zk.baseURL).toBe(`${window.location.origin}/managed/calculator`);
    expect(providers.walletProvider.getCoinPublicKey()).toBe(COIN_PK);
    expect(providers.walletProvider.getEncryptionPublicKey()).toBe(ENC_PK);
  });
});
