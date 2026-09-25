# Battleship UI

Browser frontend for `examples/battleship`: connect a Midnight wallet (Lace),
deploy or join the contract, watch its public ledger, and call its circuits.

Scaffolded by `yarn new:ui battleship` from `templates/ui/`. See
`AGENTS.md` next to this file for which files are template-owned and
which are yours, and for the verification checklist.

A two-player game in two browsers (or two browser profiles, each with its own
Lace wallet):

1. **Player 1** places two ships on cells 1–20 and deploys. The constructor
   stores only `persistentHash([cell, sk])` for each ship.
2. **Player 2** joins by address, places their ships and accepts.
3. Players alternate: one fires at a cell, and the other *checks* the shot.
   The checker's witness answers HIT or MISS from its private ships. The
   circuit recomputes the commitment and rejects a false answer, so a player
   can't move their ships after the fact (see the cheat cases in
   `src/__tests__/battleship-circuits.test.ts`).
4. Two hits win.

The UI only offers the moves the contract would accept for your seat and the
current `turn` (`nextAction` in `src/midnight/battleship-api.ts`). Inputs are
pre-checked the same way the contract checks them (`placementError`,
`shotError`), and the tests run those pre-checks against the real circuits.

**Private state is persistent** (`ui/new-ui.json`: `"privateState":
"persistent"`). Your secret key *is* your seat: the contract identifies a
player by `getDappPubKey(sk)`. So the key and your ship cells are kept in this
browser's IndexedDB, encrypted under a passphrase you type once per session.
Reloading resumes the game. Forgetting the passphrase or clearing site data
forfeits it, and there is no recovery.

## TODO: end-to-end verification with Lace

Not yet run. Everything below needs a human to approve wallet prompts. What
*has* been verified (unit tests, build, in-browser circuits, IndexedDB
round-trip) is in the table in `AGENTS.md` under "What was actually verified".
When you run these, tick them off. Once all pass, mark the Lace columns ✅ in
that table (in `templates/ui/AGENTS.md`, then `yarn new:ui --sync-all`) and
delete this section.

Setup: `yarn env:up && yarn wait:dust` here, `yarn workspace
@midnight-ntwrk/example-battleship-ui dev`, and two Chrome profiles (A and B),
each with its own Lace wallet on `undeployed`. Fund both with
`yarn fund:wallet <mn_dust_…> [mn_addr_…]` (a root script).

- [ ] **Unlock:** A connects and sets a passphrase; the panel appears. A
      weak passphrase is refused with the policy reason.
- [ ] **Deploy (wallet proving):** A places ships (e.g. 1, 2) and deploys;
      the address shows and the game card says "You are player 1 … waiting
      for an opponent".
- [ ] **Join + accept:** B joins by address, sets its own passphrase,
      places ships (e.g. 10, 11) and accepts. Both see `board2State` SET and
      A gets the Fire control.
- [ ] **Turn gating:** B sees only "waiting" while it's A's turn; A can't
      fire at a cell that is already a hit.
- [ ] **Shoot/check loop:** A fires (miss) → B reports miss → B fires (hit)
      → A reports hit. The boards show hits and the pending shot as each tx
      finalizes.
- [ ] **Reload mid-game:** reload A. After the same passphrase the page
      re-joins the remembered address, still says "player 1", shows A's
      ships, and A can make the next move.
- [ ] **Wrong passphrase:** reload B, enter a different passphrase; it is
      refused with the "doesn't open this browser's private state" message,
      and the correct one works.
- [ ] **Win:** play to two hits; both profiles show the game-over banner
      with the right winner, and further moves are not offered.
- [ ] **Local proving:** repeat one shoot/check round with the proving
      toggle set to the local proof server (`yarn proof:up`).
- [ ] **Failed re-join:** stop the indexer (`docker compose stop indexer`),
      reload, confirm the address is kept with Retry/Forget, restart the
      indexer, Retry works.
- [ ] **Preprod:** repeat deploy → accept → one round on preprod.

## Run

```bash
yarn workspace @midnight-ntwrk/example-battleship run compile   # contract first
cd examples/battleship && yarn env:up && yarn wait:dust            # local devnet
yarn workspace @midnight-ntwrk/example-battleship-ui dev           # http://localhost:5173
```

On the local devnet, give **each** browser wallet DUST with
`yarn fund:wallet <mn_dust_…> [mn_addr_…]`, from anywhere in the repo. The UI shows the
exact command when the connected wallet has none.

## Scripts

| Script | What it does |
|---|---|
| `dev` | copies ZK assets into `public/`, then runs Vite |
| `build` | copies ZK assets, typechecks, builds to `dist/` |
| `typecheck` | `tsc -b` |
| `test:unit` | vitest (jsdom + an in-memory circuit test) |
