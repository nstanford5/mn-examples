// Contract operations the UI calls. Each one is the browser counterpart of a
// step in the Node test (examples/battleship/src/test/); the only difference is
// where `providers` came from.
//
// On top of the generated wrappers, this file holds the game rules the panel
// needs, derived only from the public ledger plus this browser's private
// state: which player this browser is (roleOf), what it may do next
// (nextAction), and pre-checks that mirror the contract's asserts
// (placementError, shotError). __tests__/battleship-circuits.test.ts runs them
// against the real compiled circuits so they can't drift from the contract.
//
// Seed file: generated once by `yarn new:ui` from contract-info.json, then
// yours to edit. The drift check ignores it.
import {
  deployContract,
  findDeployedContract,
  type FoundContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import type { ContractAddress } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import { map, type Observable } from "rxjs";
import {
  CompiledBattleshipContract,
  createInitialPrivateState,
  type BattleshipPrivateState,
  ledger,
  PRIVATE_STATE_ID,
  pureCircuits,
  type Contract,
  type Ledger,
} from "./contract";
import {
  BoardState,
  ShotState,
  TurnState,
  WinState,
} from "../../../contract/managed/battleship/contract/index.js";

export { BoardState, ShotState, TurnState, WinState };
import type { BattleshipProviders } from "./providers";

export type BattleshipContract = FoundContract<Contract>;

/** Where a player hides their two ships: two distinct cells in 1..BOARD_SIZE. */
export interface ShipPlacement {
  x1: bigint;
  x2: bigint;
}

/** The board is a line of cells 1..20 (the contract's bounds checks). */
export const BOARD_SIZE = 20n;

/**
 * A fresh private state with a new random secret key. `sk` is this player's
 * identity: the contract stores getDappPubKey(sk) as player1/player2 and
 * commits each ship as persistentHash([cell, sk]). It never leaves this
 * browser (the persistent store keeps it encrypted in IndexedDB), and losing
 * it means losing the game.
 *
 * Joining without ships yet is fine: acceptGame's localSetBoard witness
 * writes x1/x2 into the private state, and midnight-js stores the updated
 * state once the tx is final.
 */
export function newPrivateState(ships: ShipPlacement = { x1: 0n, x2: 0n }): BattleshipPrivateState {
  const sk = crypto.getRandomValues(new Uint8Array(32));
  return createInitialPrivateState(ships.x1, ships.x2, BoardState.UNSET, ShotState.MISS, sk);
}

/**
 * Deploy a fresh battleship game as player 1 with these ships. The
 * constructor commits to them on chain (hashed with the new secret key); the
 * wallet is asked to balance and sign the deploy tx.
 */
export async function deployBattleship(
  providers: BattleshipProviders,
  ships: ShipPlacement,
): Promise<{ contract: BattleshipContract; address: ContractAddress }> {
  const deployed = await deployContract(providers, {
    compiledContract: CompiledBattleshipContract,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: newPrivateState(ships),
    args: [ships.x1, ships.x2],
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
 * stored state when there is one (a reload, or the deployer re-joining with a
 * persistent store) and only fall back to a fresh initial state otherwise.
 */
export async function joinBattleship(
  providers: BattleshipProviders,
  address: ContractAddress,
  initialPrivateState: () => BattleshipPrivateState = newPrivateState,
): Promise<BattleshipContract> {
  providers.privateStateProvider.setContractAddress(address);
  const stored = await providers.privateStateProvider.get(PRIVATE_STATE_ID);
  if (stored !== null) {
    return findDeployedContract(providers, {
      compiledContract: CompiledBattleshipContract,
      contractAddress: address,
      privateStateId: PRIVATE_STATE_ID,
    });
  }
  return findDeployedContract(providers, {
    compiledContract: CompiledBattleshipContract,
    contractAddress: address,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: initialPrivateState(),
  });
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

/** Circuit `acceptGame(_x1, _x2)`. */
export async function acceptGame(
  contract: BattleshipContract,
  ...args: CircuitArgs<"acceptGame">
) {
  return contract.callTx.acceptGame(...args);
}

/** Circuit `player1Shoot(x)`. */
export async function player1Shoot(
  contract: BattleshipContract,
  ...args: CircuitArgs<"player1Shoot">
) {
  return contract.callTx.player1Shoot(...args);
}

/** Circuit `player2Shoot(x)`. */
export async function player2Shoot(
  contract: BattleshipContract,
  ...args: CircuitArgs<"player2Shoot">
) {
  return contract.callTx.player2Shoot(...args);
}

/** Circuit `checkBoard1()`. */
export async function checkBoard1(
  contract: BattleshipContract,
  ...args: CircuitArgs<"checkBoard1">
) {
  return contract.callTx.checkBoard1(...args);
}

/** Circuit `checkBoard2()`. */
export async function checkBoard2(
  contract: BattleshipContract,
  ...args: CircuitArgs<"checkBoard2">
) {
  return contract.callTx.checkBoard2(...args);
}

/**
 * Live view of the public ledger. The indexer pushes each new contract state
 * over its websocket, and the compiler-generated `ledger()` decodes it.
 */
export function ledger$(
  providers: BattleshipProviders,
  address: ContractAddress,
): Observable<Ledger> {
  return providers.publicDataProvider
    .contractStateObservable(address, { type: "latest" })
    .pipe(map((state) => ledger(state.data)));
}

/** This browser's private state for a game, or null if it has none yet. */
export async function readPrivateState(
  providers: BattleshipProviders,
  address: ContractAddress,
): Promise<BattleshipPrivateState | null> {
  providers.privateStateProvider.setContractAddress(address);
  return providers.privateStateProvider.get(PRIVATE_STATE_ID);
}

// --- game rules (pure: ledger + private state in, answer out) ---------------

export type Role = "player1" | "player2" | "none";

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Which seat this browser holds, found the same way the circuits check the
 * caller: getDappPubKey(sk) against the stored player keys. getDappPubKey is
 * a pure circuit, so this runs locally with no proof. player2 is only
 * meaningful once board2 is SET (before acceptGame it is all zeroes).
 */
export function roleOf(state: Ledger, ps: BattleshipPrivateState | null): Role {
  if (!ps) return "none";
  const pk = pureCircuits.getDappPubKey(ps.sk);
  if (sameBytes(state.player1, pk)) return "player1";
  if (state.board2State === BoardState.SET && sameBytes(state.player2, pk)) return "player2";
  return "none";
}

export type Action =
  | { kind: "accept" }
  | { kind: "shoot" }
  /** Report whether the opponent's pending `shot` hit one of our ships. */
  | { kind: "check"; shot: bigint }
  | { kind: "wait"; reason: string }
  | { kind: "over"; winner: "player1" | "player2" };

/**
 * What `role` can do in `state`. Mirrors the circuits' state checks: who may
 * call acceptGame / player{1,2}Shoot / checkBoard{1,2} for each TurnState.
 */
export function nextAction(state: Ledger, role: Role): Action {
  if (state.winState === WinState.PLAYER_1_WINS) return { kind: "over", winner: "player1" };
  if (state.winState === WinState.PLAYER_2_WINS) return { kind: "over", winner: "player2" };
  if (state.board2State === BoardState.UNSET) {
    return role === "player1"
      ? { kind: "wait", reason: "Waiting for an opponent to accept the game." }
      : { kind: "accept" };
  }
  if (role === "none") return { kind: "wait", reason: "Both seats are taken; you are watching." };
  switch (state.turn) {
    case TurnState.PLAYER_1_SHOOT:
      return role === "player1" ? { kind: "shoot" } : { kind: "wait", reason: "Player 1 is aiming." };
    case TurnState.PLAYER_2_SHOOT:
      return role === "player2" ? { kind: "shoot" } : { kind: "wait", reason: "Player 2 is aiming." };
    case TurnState.PLAYER_2_CHECK:
      return role === "player2"
        ? { kind: "check", shot: state.player1Shot.head().value }
        : { kind: "wait", reason: "Player 2 is checking your shot." };
    case TurnState.PLAYER_1_CHECK:
      return role === "player1"
        ? { kind: "check", shot: state.player2Shot.head().value }
        : { kind: "wait", reason: "Player 1 is checking your shot." };
  }
}

/** The constructor's and acceptGame's input asserts, as a readable reason. */
export function placementError(ships: ShipPlacement): string | null {
  const { x1, x2 } = ships;
  if (x1 === x2) return "Place the two ships on different cells.";
  if (x1 < 1n || x2 < 1n || x1 > BOARD_SIZE || x2 > BOARD_SIZE) {
    return `Ships must be on cells 1 to ${BOARD_SIZE}.`;
  }
  return null;
}

/**
 * player{1,2}Shoot's input asserts. The contract only rejects repeating a
 * shot that already HIT (misses aren't recorded on chain), so that's all this
 * checks too.
 */
export function shotError(state: Ledger, role: Role, x: bigint): string | null {
  if (x < 1n || x > BOARD_SIZE) return `Shoot at a cell from 1 to ${BOARD_SIZE}.`;
  const opponentHits = role === "player1" ? state.board2Hits : state.board1Hits;
  if (opponentHits.member(x)) return `Cell ${x} is already a hit.`;
  return null;
}
