import { beforeEach, describe, expect, it, vi } from "vitest";

// jsdom has no IndexedDB, so replace levelPrivateStateProvider with a fake
// that behaves like it where it matters here: values are scoped by
// `${contractAddress}:${id}` per database + account, and reading a value
// written under a different password throws (AES-GCM auth failure). The real
// provider in a real browser is covered by the checklist in AGENTS.md.
const stores = vi.hoisted(() => new Map<string, Map<string, { password: string; value: unknown }>>());
const levelPrivateStateProvider = vi.hoisted(() =>
  vi.fn(
    (config: {
      midnightDbName: string;
      accountId: string;
      privateStoragePasswordProvider: () => string;
    }) => {
      const key = `${config.midnightDbName}/${config.accountId}`;
      const store = stores.get(key) ?? new Map();
      stores.set(key, store);
      let address: string | null = null;
      const scoped = (id: string) => `${address}:${id}`;
      return {
        setContractAddress: (a: string) => {
          address = a;
        },
        get: async (id: string) => {
          const entry = store.get(scoped(id));
          if (!entry) return null;
          if (entry.password !== config.privateStoragePasswordProvider()) {
            throw new Error("Unsupported state or unable to authenticate data");
          }
          return entry.value;
        },
        set: async (id: string, value: unknown) => {
          store.set(scoped(id), { password: config.privateStoragePasswordProvider(), value });
        },
      };
    },
  ),
);
vi.mock("@midnight-ntwrk/midnight-js-level-private-state-provider", () => ({
  levelPrivateStateProvider,
}));

const { persistentPrivateStateProvider, PERSISTENT_DB_NAME, WrongPassphraseError } = await import(
  "../midnight/private-state"
);

const PASS = "Correct-Horse-Battery-9";

describe("persistentPrivateStateProvider", () => {
  beforeEach(() => {
    stores.clear();
    levelPrivateStateProvider.mockClear();
  });

  it("opens the account's encrypted store in this UI's database", async () => {
    await persistentPrivateStateProvider({ accountId: "acct-1", passphrase: PASS });
    expect(levelPrivateStateProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        midnightDbName: PERSISTENT_DB_NAME,
        accountId: "acct-1",
        cryptoBackend: "webcrypto",
      }),
    );
  });

  it("keeps private state across re-opens with the same passphrase", async () => {
    const first = await persistentPrivateStateProvider<"ps", { sk: string }>({
      accountId: "acct-1",
      passphrase: PASS,
    });
    first.setContractAddress("addr");
    await first.set("ps", { sk: "secret" });

    const second = await persistentPrivateStateProvider<"ps", { sk: string }>({
      accountId: "acct-1",
      passphrase: PASS,
    });
    second.setContractAddress("addr");
    expect(await second.get("ps")).toEqual({ sk: "secret" });
  });

  it("rejects a different passphrase at unlock time", async () => {
    await persistentPrivateStateProvider({ accountId: "acct-1", passphrase: PASS });
    await expect(
      persistentPrivateStateProvider({ accountId: "acct-1", passphrase: "Wrong-Horse-Battery-9" }),
    ).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it("lets another account choose its own passphrase", async () => {
    await persistentPrivateStateProvider({ accountId: "acct-1", passphrase: PASS });
    await expect(
      persistentPrivateStateProvider({ accountId: "acct-2", passphrase: "Other-Horse-Battery-9" }),
    ).resolves.toBeDefined();
  });
});
