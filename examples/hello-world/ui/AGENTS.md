# AGENTS.md — hello-world/ui (reference frontend pattern)

Instructions for agents adding a browser frontend to an example in this repo.
This UI is the reference implementation: it runs an example's existing contract
and test-suite calls in the browser behind a Midnight wallet. For how to run it,
see `README.md` next to this file.

**Verified against:** `midnight-js-*` 4.1.1, `@midnight-ntwrk/dapp-connector-api`
4.0.1, Vite 6.4.3, vitest 4.1, React 19, Node 22, Lace on the local devnet.

## What was actually verified

Don't claim more than this when you reuse the pattern:

- **Checked:** typecheck against the real SDK types, 14 unit tests, production
  build, page load in Chrome, the WASM ledger and circuit running in the page,
  ZK assets served as binaries, and a deploy tx built and proven by the local
  proof server. `yarn fund:wallet` got DUST to a Lace wallet.
- **Not yet confirmed end to end with Lace:** deploy → `storeMessage` → live
  update; wallet-delegated proving; preprod; contracts with witnesses or
  private state (hello-world has none). Treat those paths as unverified until
  you've run them.
- **Since the Lace deploy check:** the deploy/join/forget logic moved out of the
  panel into the template-owned `hooks/use-deployment.ts` and
  `components/deployment-card.tsx`. That change was only checked with
  typecheck, unit tests and build. Re-run the Lace deploy before calling it verified.
- Do **not** use `examples/zk-loan/ui` as a reference. It isn't authoritative.
  Use this directory and the plugin docs, and check both against the installed
  types in `node_modules`.

## The core idea

An example's Node test harness already contains every Midnight call the UI
needs. The UI reuses the same **contract** and the same **midnight-js calls**,
and swaps only the **providers** for browser versions:

| Piece | Node harness (`examples/<name>/src/`) | Browser (`ui/src/midnight/`) |
|---|---|---|
| Compiled contract | `contract/index.ts` (uses `node:path`) | `contract.ts`: imports `contract/managed/<name>/contract/index.js` directly |
| Public data | `indexerPublicDataProvider(config…)` | same, URIs from the wallet's `getConfiguration()`, **plus `window.WebSocket`** |
| ZK config | `NodeZkConfigProvider(zkConfigPath)` | `FetchZkConfigProvider(origin + "/managed/<name>")` |
| Proofs | `httpClientProofProvider(proofServer)` | `dappConnectorProofProvider(api, zk, CostModel.initialCostModel())` or `httpClientProofProvider` (user toggle) |
| Wallet/submit | wallet-sdk `WalletFacade` | DApp Connector: `balanceUnsealedTransaction` + `submitTransaction` (hex) |
| Private state | `levelPrivateStateProvider` | `inMemoryPrivateStateProvider` (lost on reload) |
| Contract calls | `deployContract` / `submitCallTx` in `test/*.test.ts` | the same calls in `<name>-api.ts` |

If the test suite passes, the contract side is right. Most UI bugs are in the
provider swap and the bundler, not in contract calls.

## Recipe: add `examples/<name>/ui`

UIs are scaffolded by a script, not by hand. It is **phase 2**, after
`yarn new:example` (phase 1). Run it only once the example's contract compiles
and `yarn test:local` is green, because it reads the compiled output.

```bash
yarn new:ui <name> [--contract <managed-dir>]
yarn install          # the new workspace changes yarn.lock; commit it
yarn workspace @midnight-ntwrk/example-<name>-ui typecheck
yarn workspace @midnight-ntwrk/example-<name>-ui test:unit
yarn workspace @midnight-ntwrk/example-<name>-ui build
```

The root `workspaces` glob already includes `examples/*/ui`, so no root
`package.json` change is needed.

### 1. What the generator derives, and from where

It never works from memory. Its only inputs are the compiled contract and the
witnesses file:

| Input | Used for |
|---|---|
| `contract/managed/<c>/compiler/contract-info.json` | provable circuits (union type, one `callTx` wrapper each), exported ledger fields, whether witnesses exist |
| `contract/managed/<c>/contract/index.d.ts` | only whether the constructor takes arguments |
| `contract/witnesses.ts` | the `create<X>PrivateState` factory (it aborts if the file imports `node:*`) |

It refuses to run when:
- the example doesn't exist
- nothing is compiled
- `ui/` already exists
- more than one contract is compiled and `--contract` isn't given (e.g.
  `shielded-chips`). Multi-contract UIs aren't scaffolded; see §5.

### 2. Template-owned files: don't edit them in an example

Everything except the seed files below comes from `templates/ui/`, rendered by
name substitution. This covers configs, providers, wallet context, hooks,
`lib/`, generic components (including `deployment-card.tsx` and
`hooks/use-deployment.ts`), `midnight/contract.ts`, `midnight/providers.ts` and
the generic tests.

- CI runs `yarn new:ui <name> --check` for every generated UI. It fails when an
  example's copy differs from the template.
- To change generic UI behaviour, edit `templates/ui/`. Then run
  `yarn new:ui <name> --sync` in each generated UI (hello-world today) and
  review the `git diff`.
- If a change is truly example-specific, it belongs in a seed file, not in a
  template-owned one.

`midnight/contract.ts` is generated per contract:
- circuit union
- `PRIVATE_STATE_ID`
- private-state type and `createInitialPrivateState`
- `withVacantWitnesses` or `withWitnesses(witnesses)`

It is still template-owned, because every value in it comes from the compiled
contract. `providers.ts` keeps the parts that cost debugging time:
- the explicit `window.WebSocket`
- `parse{Coin,Enc}PublicKeyToHex`
- the hex round-trip through `Transaction.deserialize("signature","proof","binding", …)`
- `tx.identifiers()[0]` for the tx id

### 3. Seed files: yours to edit

These are generated once as a working starting point. `--check` and `--sync`
ignore them.

- **`src/midnight/<name>-api.ts`:**
  - `deploy<Name>` / `join<Name>`
  - one typed wrapper per provable circuit
    (`(contract, ...args: Parameters<Contract["callTx"]["<c>"]>)`)
  - `ledger$`, the whole decoded `Ledger` as an observable

  Add projections (hello-world adds `message$`) and match each step of
  `src/test/*.test.ts`.
- **`src/components/<name>-panel.tsx`:** `<DeploymentCard>` (step 1), a
  best-effort ledger readout, and a TODO list of circuits. Replace the last two
  with one form per circuit, and run each call in `deployment.run("<label>", …)`
  so busy and error state are shared.
- **`src/__tests__/<name>-circuits.test.ts`:** constructs the real contract in
  memory and decodes its ledger. Extend it with one `impureCircuits.<c>` call
  per circuit (see `message.test.ts` here).
- **`README.md`**

When deploying needs constructor args, or the private-state factory takes
arguments, the generator cannot invent values:
- `deploy<Name>` / `join<Name>` take them as parameters.
- The panel's deploy and join reject with a `TODO` error until you supply them.
- The circuits test is `it.todo`.

Take the values from the example's Node test.

### 4. Pins (already set by the template; keep them)

- **Exact versions:** `midnight-js-*` `4.1.1` and
  `@midnight-ntwrk/dapp-connector-api` `4.0.1`.
- **No separate runtime packages:** no direct `ledger-v8`, `compact-runtime` or
  `compact-js`. Import them via
  `@midnight-ntwrk/midnight-js-protocol/{ledger,compact-runtime,compact-js}`.
- **Vite:** `"vite": "6.4.3"`, matching the hoisted root Vite (see root
  `AGENTS.md`).
- **Scripts:** only `copy:zk`, `dev`, `build`, `preview`, `typecheck` and
  `test:unit`. **Never** add `compile`, `test`, `test:local`, `env:up` or
  `wait:dust`: root aggregates would pull the UI into CI's local-network runs.
  `copy:zk` is chained explicitly because Yarn 4 doesn't run `pre*` scripts.

After `yarn install`, check the hoisting didn't move:

```bash
node -p "require('./node_modules/vite/package.json').version"   # 6.4.3
node -p "require('./node_modules/bn.js/package.json').version"  # 5.2.5
```

Don't scaffold with `/midnight-dapp-dev:init` or by copying this directory.
The generator produces the same result deterministically and keeps it
drift-checked.

### 5. Contracts with private state or witnesses

The generator wires witnesses and the private-state factory. When it was
built, the generated `calculator` UI ran `divide` (which calls the `divMod`
witness) in memory in the browser. Deploying and calling through Lace with
witnesses has **not** been confirmed yet.

- **Lost on reload:** `inMemoryPrivateStateProvider` keeps state only for the
  page's lifetime. If the contract's correctness depends on private state
  surviving (secret keys, commitments' randomness, a player's board), a reload
  loses it and the user can no longer act. Say so in the UI, or implement an
  encrypted persistent provider (e.g. IndexedDB). Don't store secrets in
  `localStorage`.
- **Joining gets a fresh private state:** `findDeployedContract` with
  `initialPrivateState` installs a new private state for that id. A second
  browser that joins has its own private state, not the deployer's.
- **Multiple contracts** (e.g. `shielded-chips`): one `CompiledContract`, one
  `ZK_ASSETS_PATH`, and one `FetchZkConfigProvider` per contract. `copy:zk`
  copies each `managed/<contract>/{keys,zkir}`. Build a providers bundle per
  contract (the `zkConfigProvider` differs; the rest can be shared).

### 6. Funding on the local devnet

A new wallet has 0 DUST, and the first tx fails at balancing with
`Wallet.InsufficientFunds: could not balance dust`. Lace has no "register for
DUST" button, and the local devnet has no faucet.

`examples/hello-world/scripts/fund-wallet.ts` solves this without any wallet
action:
1. Genesis (Alice) sends NIGHT to a throwaway sponsor wallet.
2. The sponsor registers that NIGHT for DUST generation with the browser
   wallet's DUST address as `dustReceiverAddress`.

To reuse it:
- Run it from `examples/hello-world`; it works for any browser wallet on the
  same local devnet.
- Or copy it together with `transferNight` / `registerNightForDust` from
  `examples/hello-world/src/wallet.ts`.
- If a second UI needs it, move it into `packages/fast-sync` rather than
  copying it again.

Never point it at Alice's own NIGHT: re-registering would redirect the test
suites' DUST.

## Gotchas (all hit while building this UI)

- **`isomorphic-ws`:** `indexerPublicDataProvider`'s default WebSocket is
  `undefined` once bundled for the browser (named import from a default-only
  module). Pass `window.WebSocket`. The Vite build warning about it remains
  and is harmless.
- **`optimizeDeps.exclude`:** it must be exactly `ledger-v8`,
  `onchain-runtime-v3` and `midnight-js-protocol`.
  - Excluding `midnight-js-protocol` is required because esbuild can't
    enumerate `export *` from an excluded package.
  - Excluding `compact-runtime` breaks its CommonJS `object-inspect` import.
- **Polyfills:** `nodePolyfills` needs `globals: { Buffer: true, process: true }`.
- **Multiple wallets:** `window.midnight` can hold several wallets, plus
  Lace's `mnLace` alias pointing at the same object. Enumerate, dedupe by
  object identity, default to Lace, and let the user choose. Taking the first
  entry picked the wrong wallet on a real machine.
- **Network id:** `connect(networkId)` must match the network the wallet is set
  to. Let the user pick it before connecting; everything else comes from
  `getConfiguration()`.
- **Error shapes:** connector errors are plain objects
  (`type === "DAppConnectorAPIError"`; use no `instanceof`). Wallet fee
  failures are Effect `FiberFailure`s with an empty `message`; the reason is in
  `cause.failure`. Use `lib/errors.ts`.
- **ZK asset 404s:** a missing ZK asset returns Vite's SPA fallback
  (`text/html`), not a 404. Check the content-type when debugging.
- **Node version:** use Node 22 (`.nvmrc`). A shell defaulting to Node 20
  crashed the dev server here.

## Verification checklist

Run the checks in order, and report which ones you actually ran.

1. `yarn install` (then `yarn install --immutable` passes), and check the
   hoisting as in step 2.
2. `yarn workspace @midnight-ntwrk/example-<name>-ui typecheck`: the real
   proof that provider wiring matches the SDK types.
3. `yarn workspace @midnight-ntwrk/example-<name>-ui test:unit`, with at least:
   - wallet connect, error and selection tests (mocked `window.midnight`)
   - a test that the proving toggle picks the right factory (mock the two
     proof-provider modules)
   - a `// @vitest-environment node` test that runs the **real compiled
     circuits** in memory (`createConstructorContext`,
     `createCircuitContext`, `contract.impureCircuits.<c>`) and checks your
     ledger observable decodes the resulting states
4. `yarn workspace @midnight-ntwrk/example-<name>-ui build`.
5. No regression: the example's `yarn env:up && yarn wait:dust && yarn test:local`
   still passes, and so does one other example's vitest run.
6. In the browser (`yarn dev`), before involving the wallet:
   - In the page console, `import('/src/midnight/contract.ts')` and run a
     circuit in memory (this proves WASM loads).
   - `fetch('/managed/<name>/keys/<circuit>.verifier')` returns binary data,
     not `text/html`.
7. With the wallet (needs a human for the approvals):
   - `yarn env:up`, then `yarn fund:wallet <mn_dust_…>`.
   - Deploy, call each circuit, and watch the ledger update, in both proving
     modes.
   - Join from a second profile.
   - Then repeat on preprod.
