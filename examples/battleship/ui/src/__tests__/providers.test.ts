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

// The storage mode is fixed per UI in contract.ts. Override it so both paths
// are tested whichever one this UI was generated with.
const storage = vi.hoisted(() => ({ mode: "memory" as "memory" | "persistent" }));
vi.mock("../midnight/contract", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../midnight/contract")>()),
  get PRIVATE_STATE_STORAGE() {
    return storage.mode;
  },
}));
const persistentStore = { kind: "persistent-private-state" };
vi.mock("../midnight/private-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../midnight/private-state")>()),
  persistentPrivateStateProvider: vi.fn(async () => persistentStore),
}));

const { dappConnectorProofProvider } = await import(
  "@midnight-ntwrk/midnight-js-dapp-connector-proof-provider"
);
const { httpClientProofProvider } = await import(
  "@midnight-ntwrk/midnight-js-http-client-proof-provider"
);
const { createProviders } = await import("../midnight/providers");
const { persistentPrivateStateProvider } = await import("../midnight/private-state");

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
  beforeEach(() => {
    vi.clearAllMocks();
    storage.mode = "memory";
  });

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

  it("serves ZK assets from /managed/battleship on the page origin and exposes wallet keys", async () => {
    const providers = await createProviders(fakeApi(), {
      mode: "wallet",
      proofServerUrl: "",
    });

    const zk = providers.zkConfigProvider as unknown as { baseURL: string };
    expect(zk.baseURL).toBe(`${window.location.origin}/managed/battleship`);
    expect(providers.walletProvider.getCoinPublicKey()).toBe(COIN_PK);
    expect(providers.walletProvider.getEncryptionPublicKey()).toBe(ENC_PK);
  });

  it("keeps private state in memory when PRIVATE_STATE_STORAGE is memory", async () => {
    const providers = await createProviders(fakeApi(), { mode: "wallet", proofServerUrl: "" });
    expect(providers.privateStateProvider).not.toBe(persistentStore);
    expect(persistentPrivateStateProvider).not.toHaveBeenCalled();
  });

  it("opens the encrypted store for this wallet account when persistent", async () => {
    storage.mode = "persistent";
    const proving = { mode: "wallet", proofServerUrl: "" } as const;
    await expect(createProviders(fakeApi(), proving)).rejects.toThrow(/locked/);

    const providers = await createProviders(fakeApi(), proving, "Correct-Horse-Battery-9");
    expect(providers.privateStateProvider).toBe(persistentStore);
    expect(persistentPrivateStateProvider).toHaveBeenCalledWith({
      accountId: COIN_PK,
      passphrase: "Correct-Horse-Battery-9",
    });
  });
});
