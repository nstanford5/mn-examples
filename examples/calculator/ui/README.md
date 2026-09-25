# Calculator UI

Browser frontend for `examples/calculator`: connect a Midnight wallet (Lace),
deploy or join the contract, watch its public ledger, and call its circuits.

Scaffolded by `yarn new:ui calculator` from `templates/ui/`. See
`AGENTS.md` next to this file for which files are template-owned and
which are yours, and for the verification checklist.

On top of the scaffold it adds:

- **Result**: the public `result` ledger field (`result$` in
  `src/midnight/calculator-api.ts`), updated live after every operation.
- **Operations**: two operand fields and a button per circuit (`add`,
  `subtract`, `multiply`, `square`, `divide`). Each button previews what the
  contract would store. A button is disabled, with the reason shown, when the
  circuit would reject its inputs: an operand or result outside `Uint<16>`
  (0..65535), a negative difference, or division by zero. `evaluate()` mirrors
  those rules, and `src/__tests__/calculator-circuits.test.ts` checks it against
  the real compiled circuits.
- `divide` runs the `divMod` witness from `examples/calculator/contract/witnesses.ts`
  in the browser: the quotient is computed off-chain and the circuit only
  verifies `rem < num2 && quo * num2 + rem == num1`. The calculator has no
  private state, so a reload loses nothing.

## Run

```bash
yarn workspace @midnight-ntwrk/example-calculator run compile   # contract first
cd examples/calculator && yarn env:up && yarn wait:dust            # local devnet
yarn workspace @midnight-ntwrk/example-calculator-ui dev           # http://localhost:5173
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
