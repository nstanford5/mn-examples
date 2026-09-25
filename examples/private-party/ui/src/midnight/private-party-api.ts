// Contract operations the UI calls. Each one is the browser counterpart of a
// step in the Node test (examples/private-party/src/test/party.test.ts); the
// only difference is where `providers` came from.
//
// private-party declares no witnesses. Every circuit instead takes the
// caller's `_secret` as an argument, and circuit arguments are private inputs
// to the proof: they never reach the chain unless the circuit discloses them.
// So this browser keeps the secret in its private state (encrypted, see
// contract.ts's PRIVATE_STATE_STORAGE) and passes it to each call, exactly as
// the Node test reads `privateStateProvider.get(...).secret`.
//
// On top of the generated wrappers, this file holds the party rules the panel
// needs, derived only from the public ledger, this browser's secret and the
// wallet's address: who this browser is (partyView) and whether each circuit
// would accept the call right now (actionError). The circuits test runs them
// against the real compiled contract so they can't drift from its asserts.
//
// Seed file: generated once by `yarn new:ui` from contract-info.json, then
// yours to edit. The drift check ignores it.
import {
  deployContract,
  findDeployedContract,
  type FoundContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentCommit,
  persistentHash,
  type ContractAddress,
} from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import { map, type Observable } from "rxjs";
import type { UserAddressValue } from "@/lib/addresses";
import {
  CompiledPrivatePartyContract,
  createInitialPrivateState,
  type PrivatePartyPrivateState,
  ledger,
  PRIVATE_STATE_ID,
  type Contract,
  type Ledger,
} from "./contract";
import { PartyState } from "../../../contract/managed/private-party/contract/index.js";
import type { PrivatePartyProviders } from "./providers";

export { PartyState };

export type PrivatePartyContract = FoundContract<Contract>;

/** The contract constructor's arguments (everything after the context). */
export type ConstructorArgs =
  Parameters<Contract["initialState"]> extends [unknown, ...infer A] ? A : never;

/** What the organizer chooses when deploying (the constructor's public args). */
export interface PartyDeployInput {
  partySize: bigint;
  /** Entry fee in STAR (1 NIGHT = 1,000,000 STAR), paid by each guest at checkIn. */
  fee: bigint;
}

/** Both are `Uint<16>` in the contract. */
export const UINT16_MAX = 65535n;

/**
 * A fresh private state with a new random secret. The secret is this
 * browser's identity for one party: the organizer's is hashed into
 * `organizer` by the constructor, and a guest's is folded into their list
 * commitment by rsvp. It never leaves this browser, and losing it means the
 * organizer can't start the party or claim fees, and a guest can't check in.
 */
export function newPrivateState(): PrivatePartyPrivateState {
  return createInitialPrivateState(crypto.getRandomValues(new Uint8Array(32)));
}

/** The constructor's input asserts (and the Uint<16> casts), as a readable reason. */
export function deployInputError(input: PartyDeployInput): string | null {
  if (input.partySize <= 0n) return "The party size must be greater than zero.";
  if (input.fee <= 0n) return "The entry fee must be greater than zero.";
  if (input.partySize > UINT16_MAX || input.fee > UINT16_MAX) {
    return `Party size and fee are at most ${UINT16_MAX}.`;
  }
  return null;
}

/**
 * Deploy a fresh party as its organizer. The new secret is both the stored
 * private state and the constructor's `_secret` (as in the Node test); the
 * wallet is asked to balance and sign the deploy tx.
 */
export async function deployPrivateParty(
  providers: PrivatePartyProviders,
  input: PartyDeployInput,
): Promise<{ contract: PrivatePartyContract; address: ContractAddress }> {
  const initialPrivateState = newPrivateState();
  const args: ConstructorArgs = [input.partySize, input.fee, initialPrivateState.secret];
  const deployed = await deployContract(providers, {
    compiledContract: CompiledPrivatePartyContract,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState,
    args,
  });
  return {
    contract: deployed,
    address: deployed.deployTxData.public.contractAddress,
  };
}

/**
 * Attach to an existing deployment by address. findDeployedContract fetches
 * the on-chain state and checks that its verifier keys match the ones we serve
 * (a wrong address or a different contract fails here, before any tx).
 *
 * Private state: findDeployedContract *overwrites* whatever is stored under
 * PRIVATE_STATE_ID whenever it is given an `initialPrivateState`. So reuse the
 * stored state when there is one (a reload, or the organizer re-joining) and
 * only fall back to a fresh secret otherwise (a new guest).
 */
export async function joinPrivateParty(
  providers: PrivatePartyProviders,
  address: ContractAddress,
  initialPrivateState: () => PrivatePartyPrivateState = newPrivateState,
): Promise<PrivatePartyContract> {
  providers.privateStateProvider.setContractAddress(address);
  const stored = await providers.privateStateProvider.get(PRIVATE_STATE_ID);
  if (stored !== null) {
    return findDeployedContract(providers, {
      compiledContract: CompiledPrivatePartyContract,
      contractAddress: address,
      privateStateId: PRIVATE_STATE_ID,
    });
  }
  return findDeployedContract(providers, {
    compiledContract: CompiledPrivatePartyContract,
    contractAddress: address,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: initialPrivateState(),
  });
}

/** This browser's private state for a party, or null if it has none yet. */
export async function readPrivateState(
  providers: PrivatePartyProviders,
  address: ContractAddress,
): Promise<PrivatePartyPrivateState | null> {
  providers.privateStateProvider.setContractAddress(address);
  return providers.privateStateProvider.get(PRIVATE_STATE_ID);
}

// One wrapper per provable circuit. midnight-js runs the circuit locally,
// proves it (wallet or proof server), then gets the wallet to balance and
// submit it. Each resolves once the tx is final on chain.

/**
 * A circuit's arguments without its leading CircuitContext, i.e. what
 * `contract.callTx.<circuit>(...)` takes. Not `Parameters<callTx[c]>`: callTx
 * members are overloaded, and `Parameters` picks the last overload, whose
 * first parameter is a TransactionContext.
 */
export type CircuitArgs<K extends keyof Contract["provableCircuits"]> =
  Parameters<Contract["provableCircuits"][K]> extends [unknown, ...infer A] ? A : never;

/** Circuit `rsvp(_address, _secret)`: a guest joins the list, privately. */
export async function rsvp(
  contract: PrivatePartyContract,
  ...args: CircuitArgs<"rsvp">
) {
  return contract.callTx.rsvp(...args);
}

/** Circuit `startParty(_secret)`: organizer only. */
export async function startParty(
  contract: PrivatePartyContract,
  ...args: CircuitArgs<"startParty">
) {
  return contract.callTx.startParty(...args);
}

/**
 * Circuit `checkIn(address, _secret)`: a listed guest pays the entry fee in
 * unshielded NIGHT, and their address becomes public in `checkedInParty`.
 * The wallet has to add the NIGHT input when it balances the tx.
 */
export async function checkIn(
  contract: PrivatePartyContract,
  ...args: CircuitArgs<"checkIn">
) {
  return contract.callTx.checkIn(...args);
}

/** Circuit `closeEntry(_secret)`: organizer only. */
export async function closeEntry(
  contract: PrivatePartyContract,
  ...args: CircuitArgs<"closeEntry">
) {
  return contract.callTx.closeEntry(...args);
}

/** Circuit `claimFees(address, _secret)`: the organizer is paid to `address`. */
export async function claimFees(
  contract: PrivatePartyContract,
  ...args: CircuitArgs<"claimFees">
) {
  return contract.callTx.claimFees(...args);
}

/**
 * Live view of the public ledger. The indexer pushes each new contract state
 * over its websocket, and the compiler-generated `ledger()` decodes it.
 */
export function ledger$(
  providers: PrivatePartyProviders,
  address: ContractAddress,
): Observable<Ledger> {
  return providers.publicDataProvider
    .contractStateObservable(address, { type: "latest" })
    .pipe(map((state) => ledger(state.data)));
}

// --- party rules (pure: ledger + secret + address in, answer out) -----------
//
// The contract's two helpers, getDappPublicKey and commitAddress, aren't
// exported, so `pureCircuits` is empty. They are recomputed here with the
// same runtime builtins the compiled contract calls
// (contract/managed/private-party/contract/index.js); the circuits test checks
// both against ledgers the real circuits wrote.

const BYTES32 = new CompactTypeBytes(32);
const PK_INPUT = new CompactTypeVector(2, BYTES32);
/** `pad(32, "private-party:pk:")`: the domain separator, zero-padded. */
const PK_DOMAIN = (() => {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode("private-party:pk:"));
  return out;
})();

/** `getDappPublicKey(_secret)`: what the constructor stores as `organizer`. */
export function dappPublicKey(secret: Uint8Array): Uint8Array {
  return persistentHash(PK_INPUT, [PK_DOMAIN, secret]);
}

/**
 * The entry rsvp inserts into `hashedPartyGoers`. The circuits call
 * `commitAddress(_secret, address.bytes)`, and commitAddress is
 * `persistentCommit(first, second)`: so the secret is the committed value and
 * the address bytes are the opening. Keep this argument order; it is what the
 * contract does, whatever its parameter names suggest.
 */
export function guestCommitment(secret: Uint8Array, address: UserAddressValue): Uint8Array {
  return persistentCommit(BYTES32, secret, address.bytes);
}

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Who this browser is at this party, from public data plus its own secret. */
export interface PartyView {
  role: "organizer" | "guest";
  /** Our commitment is in `hashedPartyGoers` (only we can tell). */
  onList: boolean;
  /** Our address is in `checkedInParty` (public to everyone). */
  checkedIn: boolean;
}

export function partyView(state: Ledger, secret: Uint8Array, me: UserAddressValue): PartyView {
  return {
    role: sameBytes(dappPublicKey(secret), state.organizer) ? "organizer" : "guest",
    onList: state.hashedPartyGoers.member(guestCommitment(secret, me)),
    checkedIn: state.checkedInParty.member(me),
  };
}

export type PartyCircuit = "rsvp" | "startParty" | "checkIn" | "closeEntry" | "claimFees";

/**
 * Why `circuit` would reject this call right now, or null if it would run.
 * Mirrors each circuit's asserts in order, reworded; the contract still has
 * the final say (and its raw message if this ever drifts).
 */
export function actionError(circuit: PartyCircuit, state: Ledger, view: PartyView): string | null {
  const s = state.partyState;
  const organizer = view.role === "organizer";
  switch (circuit) {
    case "rsvp":
      if (organizer) return "The organizer can't RSVP to their own party.";
      if (s !== PartyState.NOT_STARTED) return "RSVPs are closed: the list is full or the party has started.";
      if (state.hashedPartyGoers.size() >= state.maxListSize) return "The list is full.";
      if (view.onList) return "You're already on the list.";
      return null;
    case "startParty":
      if (!organizer) return "Only the organizer can start the party.";
      if (s !== PartyState.READY && s !== PartyState.NOT_STARTED) return "The party has already started.";
      return null;
    case "checkIn":
      if (s !== PartyState.STARTED) return "Check-in opens when the organizer starts the party.";
      if (state.checkedInParty.size() >= state.hashedPartyGoers.size()) return "Every guest has checked in.";
      if (!view.onList) return "You're not on the list.";
      if (view.checkedIn) return "You've already checked in.";
      return null;
    case "closeEntry":
      if (!organizer) return "Only the organizer can close the doors.";
      if (s !== PartyState.STARTED) return "The doors can only close once the party has started.";
      return null;
    case "claimFees":
      if (!organizer) return "Only the organizer can claim the fees.";
      if (s !== PartyState.DOORS_CLOSED) return "Fees can be claimed once the doors are closed.";
      if (state.checkedInParty.size() === 0n) return "No one has checked in, so there are no fees.";
      return null;
  }
}
