// @vitest-environment node
//
// Runs the real compiled private-party contract in memory (no network, no
// proofs) with one secret and one address per person. It replays the Node
// test's party (src/test/party.test.ts), rejected calls included, and at
// every step checks, for every person and every circuit, that the panel's
// pre-check (actionError) predicts exactly what the circuit accepts. It also
// checks that dappPublicKey / guestCommitment, which re-derive the contract's
// unexported helpers, match what the circuits wrote to the ledger.
//
// Seed file: generated once by `yarn new:ui`, then yours to edit. The drift
// check ignores it.
import { describe, expect, expectTypeOf, it } from "vitest";
import type { FinalizedCallTxData } from "@midnight-ntwrk/midnight-js-contracts";
import {
  createCircuitContext,
  createConstructorContext,
  dummyContractAddress,
  type ChargedState,
} from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import type { UserAddressValue } from "../lib/addresses";
import { withUnshieldedBalance } from "./contract-balance";
import { Contract, createInitialPrivateState, ledger, type Ledger } from "../midnight/contract";
import {
  actionError,
  checkIn,
  claimFees,
  closeEntry,
  dappPublicKey,
  deployInputError,
  guestCommitment,
  PartyState,
  partyView,
  rsvp,
  startParty,
  type PartyCircuit,
} from "../midnight/private-party-api";

// The coin key only matters to Zswap; people are identified by their secret.
const COIN_PK = "00".repeat(32);
const contract = new Contract({});
const CIRCUITS: PartyCircuit[] = ["rsvp", "startParty", "checkIn", "closeEntry", "claimFees"];

interface Person {
  name: string;
  secret: Uint8Array;
  address: UserAddressValue;
}
const person = (name: string, seed: number): Person => ({
  name,
  secret: new Uint8Array(32).fill(seed),
  address: { bytes: new Uint8Array(32).fill(seed + 100) },
});
const alice = person("alice", 1); // organizer
const bob = person("bob", 2);
const charlie = person("charlie", 3);
const dave = person("dave", 4); // never RSVPs

function deploy(partySize: bigint, fee: bigint, organizer: Person): ChargedState {
  const ps = createInitialPrivateState(organizer.secret);
  return contract.initialState(createConstructorContext(ps, COIN_PK), partySize, fee, organizer.secret)
    .currentContractState.data;
}

/**
 * Run `circuit` as `who`, with the args the panel passes; throws when the
 * contract rejects.
 *
 * In memory the contract's balance starts empty (see contract-balance.ts), so
 * claimFees would always fail `unshieldedBalanceGte` ("Contract balance
 * wrong"). On chain, every checkIn paid `entryFee` NIGHT in, so give the
 * context that balance: checkedInParty.size() * entryFee.
 */
function call(state: ChargedState, circuit: PartyCircuit, who: Person): ChargedState {
  const l = ledger(state);
  const ctx = withUnshieldedBalance(
    createCircuitContext(dummyContractAddress(), COIN_PK, state, createInitialPrivateState(who.secret)),
    l.checkedInParty.size() * l.entryFee,
  );
  const c = contract.impureCircuits;
  const { context } =
    circuit === "startParty" || circuit === "closeEntry"
      ? c[circuit](ctx, who.secret)
      : c[circuit](ctx, who.address, who.secret);
  return context.currentQueryContext.state;
}

/** For every person and circuit: actionError says "ok" exactly when the circuit runs. */
function expectPreChecksAgree(state: ChargedState, people: Person[]) {
  const l = ledger(state);
  for (const who of people) {
    const view = partyView(l, who.secret, who.address);
    for (const circuit of CIRCUITS) {
      const predicted = actionError(circuit, l, view);
      let accepted: boolean;
      try {
        call(state, circuit, who);
        accepted = true;
      } catch {
        accepted = false;
      }
      expect({ who: who.name, circuit, accepted }).toEqual({ who: who.name, circuit, accepted: predicted === null });
    }
  }
}

const everyone = [alice, bob, charlie, dave];

describe("private-party contract (in memory)", () => {
  it("replays the Node test's party; the panel's pre-checks agree at every step", () => {
    // Same size and fee as the Node test's first deploy.
    let state = deploy(10n, 5n, alice);
    let l: Ledger = ledger(state);
    expect(l.partyState).toBe(PartyState.NOT_STARTED);
    expect(l.maxListSize).toBe(10n);
    expect(l.entryFee).toBe(5n);
    // Our re-derivation of getDappPublicKey matches what the constructor stored.
    expect(l.organizer).toEqual(dappPublicKey(alice.secret));
    expect(partyView(l, alice.secret, alice.address).role).toBe("organizer");
    expect(partyView(l, bob.secret, bob.address).role).toBe("guest");
    expectPreChecksAgree(state, everyone);

    // Bob RSVPs; the list holds exactly our re-derived commitment.
    state = call(state, "rsvp", bob);
    l = ledger(state);
    expect(l.hashedPartyGoers.size()).toBe(1n);
    expect([...l.hashedPartyGoers]).toEqual([guestCommitment(bob.secret, bob.address)]);
    expect(partyView(l, bob.secret, bob.address).onList).toBe(true);
    // The commitment binds both: Bob's secret with another address isn't listed.
    expect(partyView(l, bob.secret, dave.address).onList).toBe(false);
    expectPreChecksAgree(state, everyone);

    // Alice (organizer) can't RSVP: covered by the grid above. Charlie RSVPs.
    state = call(state, "rsvp", charlie);
    expect(ledger(state).hashedPartyGoers.size()).toBe(2n);
    expectPreChecksAgree(state, everyone);

    // Bob can't start the party (grid); Alice does.
    state = call(state, "startParty", alice);
    expect(ledger(state).partyState).toBe(PartyState.STARTED);
    expectPreChecksAgree(state, everyone);

    // Bob checks in and becomes public.
    state = call(state, "checkIn", bob);
    l = ledger(state);
    expect(l.checkedInParty.size()).toBe(1n);
    expect(l.checkedInParty.member(bob.address)).toBe(true);
    expect(partyView(l, bob.secret, bob.address).checkedIn).toBe(true);
    expectPreChecksAgree(state, everyone);

    // Bob can't close the doors (grid); Alice does.
    state = call(state, "closeEntry", alice);
    expect(ledger(state).partyState).toBe(PartyState.DOORS_CLOSED);
    expectPreChecksAgree(state, everyone);

    // Alice claims the fees to her own address; nothing is left to do.
    state = call(state, "claimFees", alice);
    expect(ledger(state).partyState).toBe(PartyState.FEES_CLAIMED);
    expectPreChecksAgree(state, everyone);
  });

  it("fills the list to READY, and closes the doors itself when everyone checks in", () => {
    let state = deploy(2n, 1n, alice);
    state = call(state, "rsvp", bob);
    state = call(state, "rsvp", charlie);
    expect(ledger(state).partyState).toBe(PartyState.READY);
    expectPreChecksAgree(state, everyone);

    state = call(state, "startParty", alice);
    state = call(state, "checkIn", bob);
    state = call(state, "checkIn", charlie);
    expect(ledger(state).partyState).toBe(PartyState.DOORS_CLOSED);
    expectPreChecksAgree(state, everyone);
  });

  it("rejects a closed party with no check-ins at claimFees", () => {
    let state = deploy(3n, 1n, alice);
    state = call(state, "rsvp", bob);
    state = call(state, "startParty", alice);
    state = call(state, "closeEntry", alice);
    expect(ledger(state).partyState).toBe(PartyState.DOORS_CLOSED);
    expectPreChecksAgree(state, everyone);
  });

  it("deployInputError matches the constructor on an edge grid", () => {
    for (const partySize of [0n, 1n, 65535n]) {
      for (const fee of [0n, 1n, 65535n]) {
        let accepted = true;
        try {
          deploy(partySize, fee, alice);
        } catch {
          accepted = false;
        }
        expect({ partySize, fee, accepted }).toEqual({
          partySize,
          fee,
          accepted: deployInputError({ partySize, fee }) === null,
        });
      }
    }
    expect(deployInputError({ partySize: 65536n, fee: 1n })).not.toBeNull();
  });
});

// Checked by `tsc -b` (the typecheck script); expectTypeOf does nothing at
// runtime. Each wrapper must hit the callTx overload that proves, submits and
// waits for finalization, and take exactly the circuit's arguments (counted
// from contract-info.json) after the contract handle.
describe("private-party circuit wrappers (types)", () => {
  it("submit through callTx with exactly the circuit's arguments", () => {
    expectTypeOf<Awaited<ReturnType<typeof rsvp>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "rsvp">
    >();
    expectTypeOf<Parameters<typeof rsvp>["length"]>().toEqualTypeOf<3>();
    expectTypeOf<Awaited<ReturnType<typeof startParty>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "startParty">
    >();
    expectTypeOf<Parameters<typeof startParty>["length"]>().toEqualTypeOf<2>();
    expectTypeOf<Awaited<ReturnType<typeof checkIn>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "checkIn">
    >();
    expectTypeOf<Parameters<typeof checkIn>["length"]>().toEqualTypeOf<3>();
    expectTypeOf<Awaited<ReturnType<typeof closeEntry>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "closeEntry">
    >();
    expectTypeOf<Parameters<typeof closeEntry>["length"]>().toEqualTypeOf<2>();
    expectTypeOf<Awaited<ReturnType<typeof claimFees>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "claimFees">
    >();
    expectTypeOf<Parameters<typeof claimFees>["length"]>().toEqualTypeOf<3>();
  });
});
