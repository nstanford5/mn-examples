# Private Party UI

Browser frontend for `examples/private-party`: connect a Midnight wallet (Lace),
deploy or join the contract, watch its public ledger, and call its circuits.

Scaffolded by `yarn new:ui private-party` from `templates/ui/`. See
`AGENTS.md` next to this file for which files are template-owned and
which are yours, and for the verification checklist.

What it adds on top of the scaffold:

- **Deploy as organizer:** a party-size and entry-fee form. Deploying makes a
  fresh random secret, which becomes both the constructor's `_secret` and this
  browser's private state.
- **Join as a guest:** a browser that joins gets its own fresh secret.
- **Role-aware actions:** the organizer sees *Start*, *Close the doors* and
  *Claim fees*. A guest sees *RSVP* and *Check in and pay*. Each button is
  disabled with the reason when the contract would reject the call.
- **No pasted secrets or addresses:** every circuit gets the secret from the
  encrypted private state and the wallet's own unshielded address (via
  `lib/addresses.ts`).

Private state is `persistent`: the secret is the organizer's authority and a
guest's ticket, so losing it (clearing site data, forgetting the passphrase)
locks that person out of this party. The chain only holds
`getDappPublicKey(secret)` and each guest's commitment.

`checkIn` pays `entryFee` (in STAR: 1 NIGHT = 1,000,000 STAR) in unshielded
NIGHT, so a guest's wallet needs NIGHT as well as DUST. On the local devnet,
`yarn fund:wallet <mn_dust_…> <mn_addr_…>` arranges both: the page's "no DUST"
hint prints the command with your addresses.

## TODO: end-to-end verification with Lace

Not yet run. Everything below needs a human to approve wallet prompts. What
*has* been verified (unit tests, build, in-browser circuits, the persistent
store round-trip, `fund:wallet` against a throwaway wallet) is in the table in
`AGENTS.md` under "What was actually verified". When you run these, tick them
off. Once all pass, mark the Lace columns ✅ in that table (in
`templates/ui/AGENTS.md`, then `yarn new:ui --sync-all`) and delete this
section.

Setup: `yarn env:up && yarn wait:dust` in `examples/private-party`, `yarn
workspace @midnight-ntwrk/example-private-party-ui dev`, and two Chrome
profiles: O (organizer) and G (guest), each with its own Lace wallet on
`undeployed`. Fund both, NIGHT included, with `yarn fund:wallet <mn_dust_…>
<mn_addr_…>`; the page's "no DUST" hint prints the command.

- [ ] **Unlock:** O connects and sets a passphrase; the panel appears.
- [ ] **Deploy (wallet proving):** O deploys with size 2, fee 5; the party
      card says "You are the organizer" and "Taking RSVPs".
- [ ] **Organizer can't RSVP:** O sees no RSVP button (organizer actions only).
- [ ] **Join + RSVP:** G joins by address, sets its own passphrase, RSVPs.
      RSVPs shows 1 of 2 and G sees "You're on the list"; O can't tell who.
- [ ] **Start:** O starts the party; G's "Check in and pay" enables.
- [ ] **Check in (unshielded NIGHT in):** G checks in. Lace must add the
      5 STAR input while balancing. Checked in shows 1, and G's NIGHT
      balance drops by the fee.
- [ ] **Close + claim (unshielded NIGHT out):** O closes the doors, then claims
      fees; state shows "Fees claimed" and O's NIGHT balance rises by 5 STAR.
- [ ] **Reload mid-party:** reload G after RSVP. After the same passphrase
      it re-joins, still shows "You're on the list", and can check in.
- [ ] **Wrong passphrase:** reload O with a different passphrase; it is
      refused, and the correct one restores the organizer role.
- [ ] **Local proving:** repeat one call with the proving toggle set to the
      local proof server (`yarn proof:up`).
- [ ] **Preprod:** repeat deploy → RSVP → check-in → claim on preprod.

## Run

```bash
yarn workspace @midnight-ntwrk/example-private-party run compile   # contract first
cd examples/private-party && yarn env:up && yarn wait:dust            # local devnet
yarn workspace @midnight-ntwrk/example-private-party-ui dev           # http://localhost:5173
```

On the local devnet, give your browser wallet DUST (and NIGHT) with
`yarn fund:wallet <mn_dust_…> [mn_addr_…]`, run from anywhere in the repo. The
page prints the exact command when the connected wallet has no DUST.

## Scripts

| Script | What it does |
|---|---|
| `dev` | copies ZK assets into `public/`, then runs Vite |
| `build` | copies ZK assets, typechecks, builds to `dist/` |
| `typecheck` | `tsc -b` |
| `test:unit` | vitest (jsdom + an in-memory circuit test) |
