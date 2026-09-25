// The two private-state stores a generated UI can use. contract.ts's
// PRIVATE_STATE_STORAGE (set by `yarn new:ui --private-state`) picks one:
//
//   "memory"      inMemoryPrivateStateProvider: plain Maps, lost on reload.
//                 Fine when private state is re-derivable or throwaway.
//   "persistent"  persistentPrivateStateProvider: midnight-js's own
//                 levelPrivateStateProvider on IndexedDB, AES-GCM encrypted
//                 under a passphrase the user types each session. Needed
//                 when losing private state locks the user out (a secret key
//                 that is their on-chain identity, a commitment's randomness).
import type { PrivateStateProvider } from "@midnight-ntwrk/midnight-js-types";
import type { ContractAddress, SigningKey } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";

export type PrivateStateStorage = "memory" | "persistent";

/** The IndexedDB database the persistent store lives in (one per UI). */
export const PERSISTENT_DB_NAME = "hello-world-ui-private-state";

/**
 * levelPrivateStateProvider scopes keys by `${contractAddress}:${id}`, and
 * never checks the password until it decrypts a value. We store one canary
 * under a reserved pseudo-address so a wrong passphrase is reported at unlock
 * time, not later as an opaque decrypt failure in the middle of a tx.
 */
const CANARY_ADDRESS = "passphrase-check";
const CANARY_ID = "canary";

export class WrongPassphraseError extends Error {
  constructor(cause: unknown) {
    super(
      "That passphrase doesn't open this browser's private state for this wallet account. " +
        "Use the passphrase you chose the first time.",
      { cause },
    );
    this.name = "WrongPassphraseError";
  }
}

/**
 * Encrypted IndexedDB private state, via @midnight-ntwrk/midnight-js-level-private-state-provider
 * (the same provider the Node harness uses; `level` resolves to `browser-level`
 * in the browser build).
 *
 * - `accountId` scopes the store (the provider hashes it), so two wallet
 *   accounts in one browser never see each other's state. Use the wallet's
 *   shielded coin public key.
 * - `passphrase` must pass midnight-js-utils' `validatePassword` (16+ chars,
 *   3 character classes, no runs/sequences). It is only ever held in memory.
 * - There is no recovery: clearing site data or forgetting the passphrase
 *   loses the private state for good (the provider's own warning).
 *
 * Imported lazily, so UIs that use "memory" don't bundle `level`.
 */
export async function persistentPrivateStateProvider<PSI extends string, PS>(options: {
  accountId: string;
  passphrase: string;
}): Promise<PrivateStateProvider<PSI, PS>> {
  const { levelPrivateStateProvider } = await import(
    "@midnight-ntwrk/midnight-js-level-private-state-provider"
  );
  const provider = levelPrivateStateProvider<PSI, PS>({
    midnightDbName: PERSISTENT_DB_NAME,
    accountId: options.accountId,
    privateStoragePasswordProvider: () => options.passphrase,
    cryptoBackend: "webcrypto",
  });

  // Validate the passphrase against the store before handing it out. midnight-js
  // calls setContractAddress itself before every access, so leaving the canary
  // address set here is harmless.
  const canary = provider as unknown as PrivateStateProvider<string, { ok: true }>;
  canary.setContractAddress(CANARY_ADDRESS);
  let existing: { ok: true } | null;
  try {
    existing = await canary.get(CANARY_ID);
  } catch (err: unknown) {
    throw new WrongPassphraseError(err);
  }
  if (existing === null) await canary.set(CANARY_ID, { ok: true });
  return provider;
}

/**
 * Session-scoped, in-memory implementation of the full PrivateStateProvider
 * interface: private state and signing keys live in plain Maps for the
 * lifetime of the page.
 *
 * This implements the complete 13-method PrivateStateProvider<PSI, PS>
 * contract. The export/import methods are not meaningful for an ephemeral
 * in-memory store, so they reject. Use persistentPrivateStateProvider
 * (`yarn new:ui --private-state persistent`) for cross-session private state.
 */
export function inMemoryPrivateStateProvider<
  PSI extends string,
  PS,
>(): PrivateStateProvider<PSI, PS> {
  const states = new Map<PSI, PS>();
  const signingKeys = new Map<ContractAddress, SigningKey>();

  return {
    // Contract-address scoping is a no-op for this flat in-memory store; the
    // private state IDs are already unique within a single browser session.
    setContractAddress: (_address: ContractAddress) => {},

    set: async (id: PSI, state: PS) => {
      states.set(id, state);
    },
    get: async (id: PSI) => states.get(id) ?? null,
    remove: async (id: PSI) => {
      states.delete(id);
    },
    clear: async () => {
      states.clear();
    },

    setSigningKey: async (address: ContractAddress, signingKey: SigningKey) => {
      signingKeys.set(address, signingKey);
    },
    getSigningKey: async (address: ContractAddress) =>
      signingKeys.get(address) ?? null,
    removeSigningKey: async (address: ContractAddress) => {
      signingKeys.delete(address);
    },
    clearSigningKeys: async () => {
      signingKeys.clear();
    },

    exportPrivateStates: async () => {
      throw new Error(
        "inMemoryPrivateStateProvider does not support exportPrivateStates; " +
          "use a persistent encrypting provider for exports.",
      );
    },
    importPrivateStates: async () => {
      throw new Error(
        "inMemoryPrivateStateProvider does not support importPrivateStates; " +
          "use a persistent encrypting provider for imports.",
      );
    },
    exportSigningKeys: async () => {
      throw new Error(
        "inMemoryPrivateStateProvider does not support exportSigningKeys; " +
          "use a persistent encrypting provider for exports.",
      );
    },
    importSigningKeys: async () => {
      throw new Error(
        "inMemoryPrivateStateProvider does not support importSigningKeys; " +
          "use a persistent encrypting provider for imports.",
      );
    },
  };
}
