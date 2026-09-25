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

## Run

```bash
yarn workspace @midnight-ntwrk/example-battleship run compile   # contract first
cd examples/battleship && yarn env:up && yarn wait:dust            # local devnet
yarn workspace @midnight-ntwrk/example-battleship-ui dev           # http://localhost:5173
```

On the local devnet, give **each** browser wallet DUST with
`yarn fund:wallet <mn_dust_…>` from `examples/hello-world`. The UI shows the
exact command when the connected wallet has none.

## Scripts

| Script | What it does |
|---|---|
| `dev` | copies ZK assets into `public/`, then runs Vite |
| `build` | copies ZK assets, typechecks, builds to `dist/` |
| `typecheck` | `tsc -b` |
| `test:unit` | vitest (jsdom + an in-memory circuit test) |
