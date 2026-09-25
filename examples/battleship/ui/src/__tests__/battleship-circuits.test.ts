// @vitest-environment node
//
// Runs the real compiled battleship contract, witnesses included, in memory
// (no network, no proofs) with two private states, one per player. It replays
// the Node test's game (src/test/battleship.test.ts), both cheating attempts
// included, and at every step checks that the panel's rules (roleOf,
// nextAction) and pre-checks (placementError, shotError) agree with what the
// circuits accept.
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
import { Contract, ledger, type BattleshipPrivateState } from "../midnight/contract";
import {
  acceptGame,
  BOARD_SIZE,
  BoardState,
  checkBoard1,
  checkBoard2,
  newPrivateState,
  nextAction,
  placementError,
  player1Shoot,
  player2Shoot,
  roleOf,
  shotError,
  TurnState,
  WinState,
  type ShipPlacement,
} from "../midnight/battleship-api";
import { witnesses } from "../../../contract/witnesses.js";

// The coin key only matters to Zswap; players are identified by their sk.
const COIN_PK = "00".repeat(32);
const contract = new Contract(witnesses);

type Circuit = "acceptGame" | "player1Shoot" | "player2Shoot" | "checkBoard1" | "checkBoard2";

/** One player's view: the shared ledger state plus their own private state. */
interface Step {
  state: ChargedState;
  ps: BattleshipPrivateState;
}

function deploy(ships: ShipPlacement): Step {
  const r = contract.initialState(createConstructorContext(newPrivateState(ships), COIN_PK), ships.x1, ships.x2);
  return { state: r.currentContractState.data, ps: r.currentPrivateState };
}

/** Run a circuit as the player owning `ps`; throws when the contract rejects. */
function call(state: ChargedState, ps: BattleshipPrivateState, circuit: Circuit, ...args: bigint[]): Step {
  const ctx = createCircuitContext(dummyContractAddress(), COIN_PK, state, ps);
  const fn = contract.impureCircuits[circuit] as (
    c: typeof ctx,
    ...xs: bigint[]
  ) => { context: typeof ctx };
  const { context } = fn(ctx, ...args);
  return { state: context.currentQueryContext.state, ps: context.currentPrivateState };
}

/** A copy of `ps` with different ship cells: what a cheater would try. */
const withShips = (ps: BattleshipPrivateState, x1: bigint, x2: bigint): BattleshipPrivateState => ({
  ...ps,
  x1,
  x2,
  sk: ps.sk,
});

// Same ship cells as the Node test.
const ALICE: ShipPlacement = { x1: 1n, x2: 2n };
const BOB: ShipPlacement = { x1: 10n, x2: 11n };

describe("battleship contract (in memory)", () => {
  it("replays the Node test's game; the panel's rules agree at every step", () => {
    // Alice deploys as player 1.
    let { state, ps: alice } = deploy(ALICE);
    let l = ledger(state);
    expect(l.board1State).toBe(BoardState.SET);
    expect(l.board2State).toBe(BoardState.UNSET);
    expect(roleOf(l, alice)).toBe("player1");
    expect(nextAction(l, "player1")).toEqual({ kind: "wait", reason: expect.any(String) });

    // Bob joins with a fresh private state (no ships yet) and accepts.
    let bob = newPrivateState();
    expect(roleOf(l, bob)).toBe("none");
    expect(nextAction(l, "none")).toEqual({ kind: "accept" });
    ({ state, ps: bob } = call(state, bob, "acceptGame", BOB.x1, BOB.x2));
    l = ledger(state);
    expect(l.board2State).toBe(BoardState.SET);
    expect(l.board2.size()).toBe(2n);
    expect(l.turn).toBe(TurnState.PLAYER_1_SHOOT);
    // localSetBoard recorded Bob's ships in his private state.
    expect([bob.x1, bob.x2]).toEqual([BOB.x1, BOB.x2]);
    expect(roleOf(l, bob)).toBe("player2");
    expect(nextAction(l, "player1")).toEqual({ kind: "shoot" });
    expect(nextAction(l, "player2").kind).toBe("wait");

    // Bob can't shoot out of turn.
    expect(() => call(state, bob, "player2Shoot", 1n)).toThrow(/not player2 turn/);

    // Alice misses at 5; Bob checks it (MISS) and it's his turn.
    ({ state, ps: alice } = call(state, alice, "player1Shoot", 5n));
    l = ledger(state);
    expect(l.player1Shot.head().value).toBe(5n);
    expect(nextAction(l, "player2")).toEqual({ kind: "check", shot: 5n });
    ({ state, ps: bob } = call(state, bob, "checkBoard2"));
    l = ledger(state);
    expect(l.board2HitCount).toBe(0n);
    expect(l.turn).toBe(TurnState.PLAYER_2_SHOOT);

    // Bob hits Alice at 1; Alice checks and reports the hit.
    ({ state, ps: bob } = call(state, bob, "player2Shoot", ALICE.x1));
    ({ state, ps: alice } = call(state, alice, "checkBoard1"));
    l = ledger(state);
    expect(l.board1HitCount).toBe(1n);
    expect(l.board1Hits.member(ALICE.x1)).toBe(true);
    expect(nextAction(l, "player1")).toEqual({ kind: "shoot" });

    // Alice hits Bob at 10.
    ({ state, ps: alice } = call(state, alice, "player1Shoot", BOB.x1));
    // Cheat: Bob moves his ships locally and claims a MISS. His private state
    // no longer matches his on-chain commitments, so checkBoard2 rejects.
    expect(() => call(state, withShips(bob, 15n, 16n), "checkBoard2")).toThrow(/Cheat Detected/);
    // With his real private state, the check goes through as a HIT.
    ({ state, ps: bob } = call(state, bob, "checkBoard2"));
    l = ledger(state);
    expect(l.board2HitCount).toBe(1n);
    expect(l.board2Hits.member(BOB.x1)).toBe(true);
    expect(shotError(l, "player1", BOB.x1)).toMatch(/already a hit/);
    expect(() => call(state, alice, "player1Shoot", BOB.x1)).toThrow(); // not her turn either way

    // Bob hits Alice's second ship at 2.
    ({ state, ps: bob } = call(state, bob, "player2Shoot", ALICE.x2));
    // Cheat: Alice moves her second ship from 2 to 10 to claim a MISS.
    expect(() => call(state, withShips(alice, 1n, 10n), "checkBoard1")).toThrow(/Cheat Detected/);
    ({ state, ps: alice } = call(state, alice, "checkBoard1"));
    l = ledger(state);
    expect(l.board1HitCount).toBe(2n);
    expect(l.winState).toBe(WinState.PLAYER_2_WINS);
    expect(nextAction(l, "player1")).toEqual({ kind: "over", winner: "player2" });
    expect(() => call(state, alice, "player1Shoot", 3n)).toThrow(/winner has already been declared/);
  });

  it("placementError agrees with the constructor and acceptGame", () => {
    const cells = [0n, 1n, 2n, BOARD_SIZE - 1n, BOARD_SIZE, BOARD_SIZE + 1n, 255n];
    for (const x1 of cells) {
      for (const x2 of cells) {
        const ships = { x1, x2 };
        const expected = placementError(ships) === null;
        const deploys = (() => {
          try {
            deploy(ships);
            return true;
          } catch {
            return false;
          }
        })();
        expect(deploys, `deploy(${x1}, ${x2})`).toBe(expected);

        const { state } = deploy(ALICE);
        const accepts = (() => {
          try {
            call(state, newPrivateState(), "acceptGame", x1, x2);
            return true;
          } catch {
            return false;
          }
        })();
        expect(accepts, `acceptGame(${x1}, ${x2})`).toBe(expected);
      }
    }
  });

  it("shotError agrees with player1Shoot", () => {
    let { state, ps: alice } = deploy(ALICE);
    let bob: BattleshipPrivateState;
    ({ state, ps: bob } = call(state, newPrivateState(), "acceptGame", BOB.x1, BOB.x2));
    // Get a HIT on record at Bob's 10 so the repeat-hit check has something to catch.
    ({ state, ps: alice } = call(state, alice, "player1Shoot", BOB.x1));
    ({ state, ps: bob } = call(state, bob, "checkBoard2"));
    ({ state, ps: bob } = call(state, bob, "player2Shoot", 20n));
    ({ state, ps: alice } = call(state, alice, "checkBoard1"));
    const l = ledger(state);
    expect(nextAction(l, "player1")).toEqual({ kind: "shoot" });

    for (const x of [0n, 1n, 5n, BOB.x1, BOARD_SIZE, BOARD_SIZE + 1n, 255n]) {
      const shoots = (() => {
        try {
          call(state, alice, "player1Shoot", x);
          return true;
        } catch {
          return false;
        }
      })();
      expect(shoots, `player1Shoot(${x})`).toBe(shotError(l, "player1", x) === null);
    }
  });
});

// Checked by `tsc -b` (the typecheck script); expectTypeOf does nothing at
// runtime. Each wrapper must hit the callTx overload that proves, submits and
// waits for finalization, and take exactly the circuit's arguments (counted
// from contract-info.json) after the contract handle.
describe("battleship circuit wrappers (types)", () => {
  it("submit through callTx with exactly the circuit's arguments", () => {
    expectTypeOf<Awaited<ReturnType<typeof acceptGame>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "acceptGame">
    >();
    expectTypeOf<Parameters<typeof acceptGame>["length"]>().toEqualTypeOf<3>();
    expectTypeOf<Awaited<ReturnType<typeof player1Shoot>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "player1Shoot">
    >();
    expectTypeOf<Parameters<typeof player1Shoot>["length"]>().toEqualTypeOf<2>();
    expectTypeOf<Awaited<ReturnType<typeof player2Shoot>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "player2Shoot">
    >();
    expectTypeOf<Parameters<typeof player2Shoot>["length"]>().toEqualTypeOf<2>();
    expectTypeOf<Awaited<ReturnType<typeof checkBoard1>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "checkBoard1">
    >();
    expectTypeOf<Parameters<typeof checkBoard1>["length"]>().toEqualTypeOf<1>();
    expectTypeOf<Awaited<ReturnType<typeof checkBoard2>>>().toEqualTypeOf<
      FinalizedCallTxData<Contract, "checkBoard2">
    >();
    expectTypeOf<Parameters<typeof checkBoard2>["length"]>().toEqualTypeOf<1>();
  });
});
