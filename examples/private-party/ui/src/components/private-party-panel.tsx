// The private party, built on the seed `yarn new:ui` generated: step 1 is the
// template's <DeploymentCard> (deploy takes a party size and an entry fee),
// then the party itself. Everything the panel decides (organizer or guest, on
// the list or not, which buttons are live and why) comes from partyView /
// actionError in @/midnight/private-party-api, which the circuits test checks
// against the real contract.
//
// Every call passes this browser's secret (from its encrypted private state)
// as the circuit's `_secret` argument, and circuits that take an address get
// the wallet's own unshielded address. Nothing here asks the user to paste a
// secret or an address.
//
// Seed file: generated once by `yarn new:ui`, then yours to edit. The drift
// check ignores it.
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DeploymentCard } from "@/components/deployment-card";
import { useContractState } from "@/hooks/use-contract-state";
import { useDeployment } from "@/hooks/use-deployment";
import { useWallet } from "@/hooks/use-wallet";
import { walletUserAddress, type UserAddressValue } from "@/lib/addresses";
import { errorMessage } from "@/lib/errors";
import { formatLedgerValue, type LedgerField } from "@/lib/ledger-format";
import { cn } from "@/lib/utils";
import type { Ledger, PrivatePartyPrivateState } from "@/midnight/contract";
import {
  actionError,
  checkIn,
  claimFees,
  closeEntry,
  deployInputError,
  deployPrivateParty,
  joinPrivateParty,
  ledger$,
  PartyState,
  partyView,
  readPrivateState,
  rsvp,
  startParty,
  UINT16_MAX,
  type PartyCircuit,
  type PartyDeployInput,
  type PartyView,
  type PrivatePartyContract,
} from "@/midnight/private-party-api";

/** Exported ledger fields and how they're stored, from contract-info.json. */
const LEDGER_FIELDS: LedgerField[] = [
  { name: "organizer", storage: "Cell" },
  { name: "maxListSize", storage: "Cell" },
  { name: "entryFee", storage: "Cell" },
  { name: "partyState", storage: "Cell", enumValues: ["NOT_STARTED", "READY", "STARTED", "DOORS_CLOSED", "FEES_CLAIMED"] },
  { name: "hashedPartyGoers", storage: "Set" },
  { name: "checkedInParty", storage: "Set" },
];

const STATE_LABEL: Record<PartyState, string> = {
  [PartyState.NOT_STARTED]: "Taking RSVPs",
  [PartyState.READY]: "List full",
  [PartyState.STARTED]: "Party on: check-in open",
  [PartyState.DOORS_CLOSED]: "Doors closed",
  [PartyState.FEES_CLAIMED]: "Fees claimed",
};

/** The buttons each role sees, in party order. */
const ACTIONS: Record<PartyView["role"], { circuit: PartyCircuit; label: string }[]> = {
  guest: [
    { circuit: "rsvp", label: "RSVP" },
    { circuit: "checkIn", label: "Check in and pay" },
  ],
  organizer: [
    { circuit: "startParty", label: "Start the party" },
    { circuit: "closeEntry", label: "Close the doors" },
    { circuit: "claimFees", label: "Claim fees" },
  ],
};

export function PrivatePartyPanel() {
  const deployment = useDeployment<PrivatePartyContract, PartyDeployInput>({
    deploy: deployPrivateParty,
    // Reuses this browser's stored secret for the party if it has one (a
    // reload, or the organizer coming back); otherwise a fresh guest secret.
    join: (providers, address) => joinPrivateParty(providers, address),
  });
  const { providers, contract, address, busy, error, run } = deployment;
  const { connectedApi, networkId } = useWallet();

  const ledgerObservable = useMemo(
    () => (providers && address ? ledger$(providers, address) : null),
    [providers, address],
  );
  const { state, error: stateError } = useContractState(ledgerObservable);

  // This browser's secret for the party. It only changes on deploy/join, but
  // re-reading per ledger update is cheap and matches the battleship panel.
  const [ps, setPs] = useState<PrivatePartyPrivateState | null>(null);
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

  // The wallet's unshielded address: rsvp/checkIn commit to it, claimFees pays to it.
  const [me, setMe] = useState<UserAddressValue | null>(null);
  const [meError, setMeError] = useState<string | null>(null);
  useEffect(() => {
    if (!connectedApi || !networkId) return;
    let cancelled = false;
    walletUserAddress(connectedApi, networkId)
      .then((a) => {
        if (cancelled) return;
        setMe(a);
        setMeError(null);
      })
      .catch((e: unknown) => !cancelled && setMeError(errorMessage(e, "unknown error")));
    return () => {
      cancelled = true;
    };
  }, [connectedApi, networkId]);

  const view = state && ps && me ? partyView(state, ps.secret, me) : null;

  const submit = (circuit: PartyCircuit) =>
    void run(circuit, async () => {
      if (!contract || !ps || !me) return;
      switch (circuit) {
        case "rsvp":
          await rsvp(contract, me, ps.secret);
          break;
        case "startParty":
          await startParty(contract, ps.secret);
          break;
        case "checkIn":
          await checkIn(contract, me, ps.secret);
          break;
        case "closeEntry":
          await closeEntry(contract, ps.secret);
          break;
        case "claimFees":
          await claimFees(contract, me, ps.secret);
          break;
      }
    });

  return (
    <div className="flex flex-col gap-6">
      <DeploymentCard
        deployment={deployment}
        deployForm={
          <PartyForm
            busy={busy === "deploying"}
            disabled={busy !== null}
            onSubmit={(input) => void deployment.deploy(input)}
          />
        }
      />

      {providers && address && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>2. The party</CardTitle>
              <CardDescription>
                The guest list holds commitments, not addresses: only you can tell that yours is on
                it. Checking in pays the entry fee in NIGHT and makes your address public.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {state === null || view === null ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {meError ? `Couldn't read your wallet address: ${meError}` : "Loading the party..."}
                </p>
              ) : (
                <>
                  <PartySummary state={state} view={view} />
                  <div className="flex flex-col gap-3">
                    {ACTIONS[view.role].map(({ circuit, label }) => {
                      const reason = actionError(circuit, state, view);
                      return (
                        <div key={circuit} className="flex flex-wrap items-center gap-3">
                          <Button
                            onClick={() => submit(circuit)}
                            disabled={busy !== null || !contract || reason !== null}
                          >
                            {busy === circuit && <Loader2 className="animate-spin" />}
                            {label}
                            {circuit === "checkIn" && ` (${state.entryFee} STAR)`}
                          </Button>
                          <span className="text-xs text-muted-foreground">
                            {reason ?? actionHint(circuit, state)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
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

/** What pressing an enabled button does, beyond its label. */
function actionHint(circuit: PartyCircuit, state: Ledger): string {
  switch (circuit) {
    case "rsvp":
      return "Adds a commitment to your secret and address. Your address stays private.";
    case "startParty":
      return "Opens check-in and closes RSVPs.";
    case "checkIn":
      return `Your wallet pays ${state.entryFee} STAR to the contract.`;
    case "closeEntry":
      return "Ends check-in, so you can claim the fees.";
    case "claimFees":
      return `Sends ${state.checkedInParty.size() * state.entryFee} STAR to your wallet's unshielded address.`;
  }
}

function PartySummary({ state, view }: { state: Ledger; view: PartyView }) {
  const you =
    view.role === "organizer"
      ? "You are the organizer."
      : view.checkedIn
        ? "You're checked in."
        : view.onList
          ? "You're on the list."
          : "You're not on the list.";
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{STATE_LABEL[state.partyState]}</Badge>
        <span>{you}</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted-foreground">RSVPs</dt>
        <dd>
          {state.hashedPartyGoers.size().toString()} of {state.maxListSize.toString()}
        </dd>
        <dt className="text-muted-foreground">Checked in</dt>
        <dd>{state.checkedInParty.size().toString()}</dd>
        <dt className="text-muted-foreground">Entry fee</dt>
        <dd>{state.entryFee.toString()} STAR</dd>
      </dl>
    </div>
  );
}

/** Party size and entry fee, pre-checked the way the constructor checks them. */
function PartyForm(props: { busy: boolean; disabled: boolean; onSubmit: (input: PartyDeployInput) => void }) {
  const [size, setSize] = useState("");
  const [fee, setFee] = useState("");
  const parse = (t: string) => (/^\d+$/.test(t.trim()) ? BigInt(t.trim()) : null);
  const partySize = parse(size);
  const entryFee = parse(fee);
  const input = partySize !== null && entryFee !== null ? { partySize, fee: entryFee } : null;
  const reason = input ? deployInputError(input) : null;

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (input && reason === null) props.onSubmit(input);
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Party size"
          inputMode="numeric"
          placeholder="Party size"
          value={size}
          onChange={(e) => setSize(e.target.value)}
          className="w-32"
        />
        <Input
          aria-label="Entry fee"
          inputMode="numeric"
          placeholder="Entry fee"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          className="w-32"
        />
        <Button type="submit" disabled={props.disabled || !input || reason !== null}>
          {props.busy && <Loader2 className="animate-spin" />}
          Deploy new party
        </Button>
      </div>
      <p className={cn("text-xs", reason ? "text-destructive" : "text-muted-foreground")}>
        {reason ??
          `Guests (1 to ${UINT16_MAX}) and the fee each pays at check-in, in STAR (1 NIGHT = 1,000,000 STAR). ` +
            "You become the organizer through a new secret that stays in this browser."}
      </p>
    </form>
  );
}
