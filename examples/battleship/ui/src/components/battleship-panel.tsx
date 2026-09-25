// The battleship game, built on the seed `yarn new:ui` generated: step 1 is
// the template's <DeploymentCard> (deploy takes a ship placement), then the
// game itself. Everything the panel decides (whose seat, whose turn, which
// cells are valid) comes from roleOf / nextAction / placementError /
// shotError in @/midnight/battleship-api, which the circuits test checks
// against the real contract.
//
// Seed file: generated once by `yarn new:ui`, then yours to edit. The drift
// check ignores it.
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DeploymentCard } from "@/components/deployment-card";
import { useContractState } from "@/hooks/use-contract-state";
import { useDeployment } from "@/hooks/use-deployment";
import { formatLedgerValue, type LedgerField } from "@/lib/ledger-format";
import { cn } from "@/lib/utils";
import type { BattleshipPrivateState, Ledger } from "@/midnight/contract";
import {
  acceptGame,
  BOARD_SIZE,
  checkBoard1,
  checkBoard2,
  deployBattleship,
  joinBattleship,
  ledger$,
  nextAction,
  placementError,
  player1Shoot,
  player2Shoot,
  readPrivateState,
  roleOf,
  shotError,
  type Action,
  type BattleshipContract,
  type Role,
  type ShipPlacement,
} from "@/midnight/battleship-api";

/** Exported ledger fields and how they're stored, from contract-info.json. */
const LEDGER_FIELDS: LedgerField[] = [
  { name: "player1", storage: "Cell" },
  { name: "player2", storage: "Cell" },
  { name: "turn", storage: "Cell", enumValues: ["PLAYER_1_SHOOT", "PLAYER_1_CHECK", "PLAYER_2_SHOOT", "PLAYER_2_CHECK"] },
  { name: "board1", storage: "Set" },
  { name: "board2", storage: "Set" },
  { name: "board1State", storage: "Cell", enumValues: ["UNSET", "SET"] },
  { name: "board2State", storage: "Cell", enumValues: ["UNSET", "SET"] },
  { name: "player1Shot", storage: "List" },
  { name: "player2Shot", storage: "List" },
  { name: "board1Hits", storage: "Set" },
  { name: "board2Hits", storage: "Set" },
  { name: "winState", storage: "Cell", enumValues: ["CONTINUE_PLAY", "PLAYER_1_WINS", "PLAYER_2_WINS"] },
  { name: "board1HitCount", storage: "Counter" },
  { name: "board2HitCount", storage: "Counter" },
];

const CELLS = Array.from({ length: Number(BOARD_SIZE) }, (_, i) => BigInt(i + 1));

export function BattleshipPanel() {
  const deployment = useDeployment<BattleshipContract, ShipPlacement>({
    deploy: deployBattleship,
    // Reuses this browser's stored private state for the game if it has one
    // (a reload, or player 1 coming back); otherwise a fresh secret key.
    join: (providers, address) => joinBattleship(providers, address),
  });
  const { providers, contract, address, busy, error, run } = deployment;

  const ledgerObservable = useMemo(
    () => (providers && address ? ledger$(providers, address) : null),
    [providers, address],
  );
  const { state, error: stateError } = useContractState(ledgerObservable);

  // This browser's private state. Re-read on every ledger update: a circuit
  // call's witnesses can change it (acceptGame records our ships), and
  // midnight-js stores the new one once the tx is final.
  const [ps, setPs] = useState<BattleshipPrivateState | null>(null);
  useEffect(() => {
    if (!providers || !address || !contract) {
      setPs(null);
      return;
    }
    let cancelled = false;
    readPrivateState(providers, address)
      .then((p) => !cancelled && setPs(p))
      .catch(() => !cancelled && setPs(null));
    return () => {
      cancelled = true;
    };
  }, [providers, address, contract, state]);

  const role = state ? roleOf(state, ps) : "none";
  const action = state ? nextAction(state, role) : null;

  return (
    <div className="flex flex-col gap-6">
      <DeploymentCard
        deployment={deployment}
        deployForm={
          <ShipForm
            submitLabel="Deploy new game"
            busy={busy === "deploying"}
            disabled={busy !== null}
            onSubmit={(ships) => void deployment.deploy(ships)}
          />
        }
      />

      {providers && address && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>2. Game</CardTitle>
              <CardDescription>
                {role === "none" ? "You don't hold a seat in this game." : `You are ${seat(role)}.`}{" "}
                Your secret key and ship cells stay in this browser, encrypted; the chain only holds
                commitments to them, which every check is verified against.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {state === null || action === null ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading the game...
                </p>
              ) : (
                <>
                  <ActionPanel
                    action={action}
                    state={state}
                    role={role}
                    ps={ps}
                    busy={busy}
                    disabled={busy !== null || !contract}
                    onAccept={(ships) =>
                      void run("acceptGame", async () => {
                        if (contract) await acceptGame(contract, ships.x1, ships.x2);
                      })
                    }
                    onShoot={(x) =>
                      void run("shooting", async () => {
                        if (!contract) return;
                        await (role === "player1" ? player1Shoot(contract, x) : player2Shoot(contract, x));
                      })
                    }
                    onCheck={() =>
                      void run("checking", async () => {
                        if (!contract) return;
                        await (role === "player1" ? checkBoard1(contract) : checkBoard2(contract));
                      })
                    }
                  />
                  <Boards state={state} role={role} ps={ps} />
                </>
              )}
              {stateError && <p className="text-xs text-destructive">{stateError.message}</p>}
            </CardContent>
          </Card>

          {state && (
            <details className="rounded-md border px-4 py-3 text-sm">
              <summary className="cursor-pointer text-muted-foreground">Raw public ledger</summary>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                {LEDGER_FIELDS.map((field) => (
                  <div key={field.name} className="contents">
                    <dt className="font-mono text-muted-foreground">{field.name}</dt>
                    <dd className="break-all font-mono">
                      {formatLedgerValue(field, state[field.name as keyof Ledger])}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

const seat = (role: Role) => (role === "player1" ? "player 1" : "player 2");

function ActionPanel(props: {
  action: Action;
  state: Ledger;
  role: Role;
  ps: BattleshipPrivateState | null;
  busy: string | null;
  disabled: boolean;
  onAccept: (ships: ShipPlacement) => void;
  onShoot: (x: bigint) => void;
  onCheck: () => void;
}) {
  const { action, state, role, ps, busy, disabled } = props;
  const [target, setTarget] = useState("");

  switch (action.kind) {
    case "over":
      return (
        <p className="rounded-md bg-muted px-3 py-2 text-sm font-medium" role="status">
          Game over: {seat(action.winner)} wins
          {role === "none" ? "." : role === action.winner ? ". You won!" : ". You lost."}
        </p>
      );
    case "wait":
      return <p className="text-sm text-muted-foreground">{action.reason}</p>;
    case "accept":
      return (
        <div className="flex flex-col gap-2">
          <p className="text-sm">No opponent yet. Hide your two ships to take the second seat:</p>
          <ShipForm
            submitLabel="Accept game"
            busy={busy === "acceptGame"}
            disabled={disabled}
            onSubmit={props.onAccept}
          />
        </div>
      );
    case "check": {
      // What our own witness will answer; the circuit then checks that answer
      // against our on-chain commitment, so it can't be a lie.
      const hit = ps !== null && (action.shot === ps.x1 || action.shot === ps.x2);
      return (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">
            Your opponent fired at cell <strong>{action.shot.toString()}</strong>: that&apos;s a{" "}
            <strong>{hit ? "HIT" : "MISS"}</strong>. Report it to take your turn.
          </p>
          <Button onClick={props.onCheck} disabled={disabled}>
            {busy === "checking" && <Loader2 className="animate-spin" />}
            Report {hit ? "hit" : "miss"}
          </Button>
        </div>
      );
    }
    case "shoot": {
      const x = /^\d+$/.test(target.trim()) ? BigInt(target.trim()) : null;
      const reason = x === null ? null : shotError(state, role, x);
      return (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (x !== null && reason === null) props.onShoot(x);
          }}
        >
          <p className="text-sm">Your turn: pick a cell on the enemy board, or type one.</p>
          <div className="flex gap-2">
            <Input
              aria-label="Target cell"
              inputMode="numeric"
              placeholder={`1-${BOARD_SIZE}`}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="w-24"
            />
            <Button type="submit" disabled={disabled || x === null || reason !== null}>
              {busy === "shooting" && <Loader2 className="animate-spin" />}
              Fire
            </Button>
          </div>
          {reason && <p className="text-xs text-destructive">{reason}</p>}
          <EnemyPicker state={state} role={role} onPick={(cell) => setTarget(cell.toString())} />
        </form>
      );
    }
  }
}

/** Two distinct ship cells, pre-checked the way the contract checks them. */
function ShipForm(props: {
  submitLabel: string;
  busy: boolean;
  disabled: boolean;
  onSubmit: (ships: ShipPlacement) => void;
}) {
  const [x1, setX1] = useState("");
  const [x2, setX2] = useState("");
  const parse = (t: string) => (/^\d+$/.test(t.trim()) ? BigInt(t.trim()) : null);
  const a = parse(x1);
  const b = parse(x2);
  const ships = a !== null && b !== null ? { x1: a, x2: b } : null;
  const reason = ships ? placementError(ships) : null;

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (ships && reason === null) props.onSubmit(ships);
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="First ship cell"
          inputMode="numeric"
          placeholder="Ship 1"
          value={x1}
          onChange={(e) => setX1(e.target.value)}
          className="w-24"
        />
        <Input
          aria-label="Second ship cell"
          inputMode="numeric"
          placeholder="Ship 2"
          value={x2}
          onChange={(e) => setX2(e.target.value)}
          className="w-24"
        />
        <Button type="submit" disabled={props.disabled || !ships || reason !== null}>
          {props.busy && <Loader2 className="animate-spin" />}
          {props.submitLabel}
        </Button>
      </div>
      <p className={cn("text-xs", reason ? "text-destructive" : "text-muted-foreground")}>
        {reason ?? `Two different cells from 1 to ${BOARD_SIZE}. Only hashes of them go on chain.`}
      </p>
    </form>
  );
}

/** Cells of the enemy board you can still fire at, as buttons. */
function EnemyPicker({ state, role, onPick }: { state: Ledger; role: Role; onPick: (x: bigint) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {CELLS.map((x) => {
        const blocked = shotError(state, role, x) !== null;
        return (
          <button
            key={x.toString()}
            type="button"
            disabled={blocked}
            onClick={() => onPick(x)}
            className="size-8 rounded border text-xs hover:bg-accent disabled:opacity-40"
            aria-label={`Target cell ${x}`}
          >
            {x.toString()}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Your waters (your ships from private state, hits on you from the ledger) and
 * enemy waters (your hits on them). Misses aren't on chain, so only the shot
 * awaiting a check is shown besides hits.
 */
function Boards({ state, role, ps }: { state: Ledger; role: Role; ps: BattleshipPrivateState | null }) {
  if (role === "none") {
    return (
      <div className="flex flex-col gap-3">
        <Strip label="Player 1's waters" hits={state.board1Hits} pending={pending(state.player2Shot)} />
        <Strip label="Player 2's waters" hits={state.board2Hits} pending={pending(state.player1Shot)} />
      </div>
    );
  }
  const mine = role === "player1";
  const ships = ps && ps.x1 > 0n ? [ps.x1, ps.x2] : [];
  return (
    <div className="flex flex-col gap-3">
      <Strip
        label="Your waters"
        hits={mine ? state.board1Hits : state.board2Hits}
        pending={pending(mine ? state.player2Shot : state.player1Shot)}
        ships={ships}
      />
      <Strip
        label="Enemy waters"
        hits={mine ? state.board2Hits : state.board1Hits}
        pending={pending(mine ? state.player1Shot : state.player2Shot)}
      />
    </div>
  );
}

const pending = (shots: Ledger["player1Shot"]) => (shots.isEmpty() ? null : shots.head().value);

function Strip(props: {
  label: string;
  hits: Ledger["board1Hits"];
  pending: bigint | null;
  ships?: bigint[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{props.label}</span>
      <div className="flex flex-wrap gap-1" role="list" aria-label={props.label}>
        {CELLS.map((x) => {
          const hit = props.hits.member(x);
          const ship = props.ships?.includes(x) ?? false;
          const incoming = props.pending === x;
          return (
            <div
              key={x.toString()}
              role="listitem"
              title={[`cell ${x}`, ship && "your ship", hit && "hit", incoming && "shot awaiting check"]
                .filter(Boolean)
                .join(", ")}
              className={cn(
                "flex size-8 items-center justify-center rounded border text-xs",
                ship && "bg-primary/15 font-semibold",
                hit && "bg-destructive text-destructive-foreground",
                incoming && !hit && "ring-2 ring-amber-500",
              )}
            >
              {hit ? "✕" : x.toString()}
            </div>
          );
        })}
      </div>
    </div>
  );
}
