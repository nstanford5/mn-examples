# AGENTS.md — generated browser UIs (`yarn new:ui`)

Instructions for agents adding or changing a browser frontend for an example in
this repo. Every generated UI runs its example's existing contract and
test-suite calls in the browser behind a Midnight wallet. For how to run this
one (`examples/calculator/ui`), see `README.md` next to this file.

This file is template-owned. Its source is `templates/ui/AGENTS.md`, and
every generated UI gets an identical copy. Edit the template, then run
`yarn new:ui <name> --sync` for each UI. The worked examples:

- `examples/hello-world/ui`: no witnesses.
- `examples/calculator/ui`: a witness, custom forms.
- `examples/battleship/ui`: constructor args, a private-state factory with
  arguments, persistent private state, two roles, and a pure circuit used to
  find "which seat am I".

**Verified against:** `midnight-js-*` 4.1.1, `@midnight-ntwrk/dapp-connector-api`
4.0.1, Vite 6.4.3, vitest 4.1, React 19, Node 22, Lace on the local devnet.

## What was actually verified

Don't claim more than this when you reuse the pattern:

- **Checked (hello-world/ui):** typecheck against the real SDK types, unit
  tests, production build, page load in Chrome, the WASM ledger and circuit
  running in the page, ZK assets served as binaries, and a deploy tx built and
  proven by the local proof server. `yarn fund:wallet` got DUST to a Lace
  wallet.
- **Witnesses in the browser:** `examples/calculator/ui` runs `divide`, which
  calls the `divMod` witness, in memory in Chrome (checklist step 6), and in its
  vitest suite. That covers the witness wiring only, not a deploy or call
  through Lace.
- **Not yet confirmed end to end with Lace:** deploy → `storeMessage` → live
  update; wallet-delegated proving; preprod; any contract with witnesses or
  private state. Treat those paths as unverified until you've run them.
- **Since the Lace deploy check:** the deploy/join/forget logic moved out of the
  panel into the template-owned `hooks/use-deployment.ts` and
  `components/deployment-card.tsx`. That change was only checked with
  typecheck, unit tests and build. Re-run the Lace deploy before calling it verified.
- **Generic circuit forms** (`components/circuit-form.tsx`): unit-tested, and
  generated panels for every compiled example in the repo typecheck, test and
  build. No form has submitted a real transaction yet.
- **Persistent private state (battleship/ui), in Chrome, without Lace:**
  `persistentPrivateStateProvider` wrote a battleship private state to real
  IndexedDB. After a page reload it read the state back, with `bigint`
  fields and a byte-identical `Uint8Array` secret key. A wrong passphrase was
  rejected at unlock with `WrongPassphraseError`. In the same page, the
  battleship constructor, `acceptGame` (witnesses included) and the pure
  `getDappPubKey` ran in memory. The in-memory vitest suite replays the whole
  Node-test game, both cheat attempts included.
- **Not yet run for battleship:** deploy/accept/shoot/check through Lace, the
  passphrase card and re-join-after-reload in the full app, and a second
  profile joining. The new deploy-input slot and non-destructive re-join in
  `use-deployment.ts` and `deployment-card.tsx` are checked only by
  typecheck, unit tests and build.
- Do **not** use `examples/zk-loan/ui` as a reference. It isn't authoritative.
  Use the generated UIs and the plugin docs, and check both against the installed
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
| Private state | `levelPrivateStateProvider` (disk) | `--private-state persistent`: the same `levelPrivateStateProvider` on IndexedDB, behind a passphrase; `memory`: `inMemoryPrivateStateProvider` (lost on reload) |
| Contract calls | `deployContract` / `submitCallTx` in `test/*.test.ts` | the same calls in `<name>-api.ts` |

If the test suite passes, the contract side is right. Most UI bugs are in the
provider swap and the bundler, not in contract calls.

## Recipe: add `examples/<name>/ui`

UIs are scaffolded by a script, not by hand. It is **phase 2**, after
`yarn new:example` (phase 1). Run it only once the example's contract compiles
and `yarn test:local` is green, because it reads the compiled output.

```bash
yarn new:ui <name> [--contract <managed-dir>] [--private-state memory|persistent]
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
| `contract/managed/<c>/compiler/contract-info.json` | provable circuits (union type, one `callTx` wrapper each), their argument types (the panel's generic forms), exported ledger fields, whether witnesses exist |
| `contract/managed/<c>/contract/index.d.ts` | only whether the constructor takes arguments |
| `contract/managed/<c>/contract/index.d.ts` | also the constructor's parameter list, named in the TODOs |
| `contract/witnesses.ts` | the `create<X>PrivateState` factory and its parameters (it aborts if the file imports `node:*`) |
| `contract-info.json` `ledger[].storage` / `.type` | the typed ledger readout: enum member names, Set/List/Map contents |

The create-time choices, `--contract` and `--private-state`, are written to
`ui/new-ui.json`. `--check` and `--sync` read them back, so they re-render
exactly what was created (CI runs `--check` with no flags). To change a
choice, edit `new-ui.json` and `--sync`.

`--private-state` defaults to `persistent` when the contract has witnesses
and its private-state factory takes arguments (per-user values such as a
secret key), and to `memory` otherwise. Pass it explicitly when that
heuristic is wrong for your contract.

It refuses to run when:
- the example doesn't exist
- nothing is compiled
- `ui/` already exists
- more than one contract is compiled and `--contract` isn't given (e.g.
  `shielded-chips`). Multi-contract UIs aren't scaffolded; see §5.
- the running Node is older than the root `engines.node` (22). Yarn 4 doesn't
  enforce `engines`; run `nvm use` first.

### 2. Template-owned files: don't edit them in an example

Everything except the seed files below comes from `templates/ui/`, rendered by
name substitution. This covers configs, providers, wallet context, hooks,
`lib/` (including `circuit-args.ts` and `ledger-format.ts`), generic
components (including `deployment-card.tsx`, `circuit-form.tsx`,
`passphrase-card.tsx` and `hooks/use-deployment.ts`), `midnight/contract.ts`,
`midnight/providers.ts`, `midnight/private-state.ts`, the generic tests and
this `AGENTS.md`.

- `ui/.template-files` lists the template-owned files as of the last create or
  sync. Don't edit it. `ui/new-ui.json` holds the create-time choices (see
  §1); edit it only to change one, then `--sync`.
- CI runs `yarn new:ui <name> --check` for every generated UI, then typecheck,
  unit tests and a production build. `--check` fails when an example's copy
  differs from the template, when `.template-files` is missing or out of date,
  or when a file the template no longer has is still present. `--sync` fixes
  the last two, deleting the stale files.
- To change generic UI behaviour, edit `templates/ui/`. Then run
  `yarn new:ui <name> --sync` in each generated UI (hello-world and calculator
  today) and review the `git diff`.
- If a change is truly example-specific, it belongs in a seed file, not in a
  template-owned one.

`midnight/contract.ts` is generated per contract:
- circuit union
- `PRIVATE_STATE_ID` and `PRIVATE_STATE_STORAGE` (`"memory"` or `"persistent"`)
- private-state type and `createInitialPrivateState`
- `withVacantWitnesses` or `withWitnesses(witnesses)`
- re-exports `pureCircuits` (they run locally, with no proof and no tx)

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
    (`(contract, ...args: CircuitArgs<"<c>">)`, the circuit's own parameters
    minus its `CircuitContext`)
  - `ledger$`, the whole decoded `Ledger` as an observable

  Add projections (hello-world adds `message$`, calculator `result$`) and
  match each step of `src/test/*.test.ts`.

  `join<Name>` reuses the private state already stored for that address, and
  only builds a fresh one when there is none (see "Rejoining" in §5). When
  the factory takes arguments, `join<Name>` takes a *factory*
  (`() => PrivateState`) rather than a value, because a fresh state may mean a
  fresh secret key, and that should only happen once.
- **`src/components/<name>-panel.tsx`:** `<DeploymentCard>` (step 1), a
  typed ledger readout (`lib/ledger-format.ts`: enum names, collection
  contents), and one generic `<CircuitForm>` per circuit. The
  forms work for arguments of type Uint, Field, Boolean, `Opaque<"string">`,
  Bytes, Enum, and aliases of those (see the table in `lib/circuit-args.ts`).
  A circuit with any other argument type (struct, tuple, vector, ...) gets a
  TODO line instead. The forms already submit and work as-is. Replace them
  with purpose-built UI where the example deserves it, as hello-world and
  calculator do. Run each call in `deployment.run("<label>", …)` so busy and
  error state are shared.
- **`src/__tests__/<name>-circuits.test.ts`:** constructs the real contract in
  memory and decodes its ledger, with one `it.todo` per circuit. Replace each
  todo with a real `impureCircuits.<c>` call (see `message.test.ts` in
  hello-world, or calculator's, which replays the Node test's sequence). It
  also holds type-level checks, run by `typecheck`, that each wrapper hits the
  submitting `callTx` overload and takes exactly the circuit's arguments. Keep
  them when you edit the wrappers.
- **Input validation:** a circuit's own checks (Uint range casts, asserts,
  a throwing witness) reject bad input while midnight-js runs the circuit
  locally, before proving or any wallet prompt. The raw message is a
  `CompactError` such as "cast from Field or Uint value to smaller Uint value
  failed". If you pre-check inputs in the panel for a readable reason, test the
  pre-check against the real circuits so the two can't drift (calculator's
  `evaluate()` is checked this way on an edge-value grid).
- **`README.md`**

When deploying needs constructor args, or the private-state factory takes
arguments, the generator cannot invent values:
- `deploy<Name>` / `join<Name>` take them as parameters.
- The panel's deploy and join reject with a `TODO` error until you supply them.
- The circuits test's construction case is `it.todo`. Its comment names the
  constructor's and the factory's parameters.

Take the values from the example's Node test. To collect deploy input from
the user, type the hook as `useDeployment<Contract, Input>({ deploy, join })`,
where `deploy(providers, input)` receives it. Pass the form as
`<DeploymentCard deployment={…} deployForm={<YourForm/>} />`: it replaces the
plain Deploy button and calls `deployment.deploy(input)`. `join` never takes
user input, because it also runs unattended when a reload re-joins. See
battleship's `ShipForm`.

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

Don't scaffold with `/midnight-dapp-dev:init` or by copying another UI.
The generator produces the same result deterministically and keeps it
drift-checked.

### 5. Contracts with private state or witnesses

The generator wires witnesses and the private-state factory.
`examples/calculator/ui` runs a stateless witness. `examples/battleship/ui`
runs witnesses that read and update per-player private state (a secret key
and ship cells).

- **Choose the store** with `--private-state` (§1). Losing private state
  locks the user out when it holds a secret key that is their on-chain
  identity, a commitment's opening, or anything the contract later checks
  against a commitment. Use `persistent` for those. `memory` is fine when
  the state is throwaway or re-derivable.
- **`persistent`** (`midnight/private-state.ts`) is midnight-js's own
  `levelPrivateStateProvider`. In the browser, `level` resolves to
  `browser-level` (IndexedDB). It is AES-GCM encrypted with the `webcrypto`
  backend, and scoped by the wallet's shielded coin public key, so each Lace
  account has its own store. The template adds:
  - a `PassphraseCard` that App shows instead of the panel until unlocked.
    The passphrase is held in React state only; never put it in storage.
  - a **canary** entry. The provider never checks the password until it
    decrypts something, so without the canary a wrong passphrase would
    surface later as an opaque AES-GCM failure in the middle of a tx.
  - the passphrase policy (`validatePassword`: 16+ chars, 3 character
    classes, no runs or sequences), checked in the card before unlocking.
  - **no recovery**: clearing site data or forgetting the passphrase loses
    the state (the provider's own warning). Say so in the UI.
  - a lazy `import()`. With `memory`, `PRIVATE_STATE_STORAGE` is a constant,
    so Rollup drops the import and `level` isn't bundled at all.
- **Rejoining must not clobber private state.** `findDeployedContract`
  *overwrites* whatever is stored under `privateStateId` whenever it is
  passed `initialPrivateState` (`setOrGetInitialPrivateState` in
  `midnight-js-contracts`). With a persistent store, that replaces the
  player's secret key on every reload. The generated `join<Name>` checks
  `privateStateProvider.get(PRIVATE_STATE_ID)` first and omits
  `initialPrivateState` when a state exists. Keep that if you rewrite it.
- **A failed automatic re-join keeps the address.** `useDeployment` no longer
  forgets the remembered address when a re-join fails: the indexer may just
  be down, and the address may be the user's only way back to their game.
  The card shows Retry and Forget.
- **Witness updates are stored after each finalized call** (midnight-js sets
  `nextPrivateState`). So a witness that records user input, like
  battleship's `localSetBoard` storing player 2's ships during `acceptGame`,
  persists without any UI code. The deploy is different: it stores the
  `initialPrivateState` you passed, not the constructor's output.
- **Joining gets a fresh private state** when the browser has none for that
  address. A second browser that joins has its own state, not the
  deployer's.
- **Pure circuits** (`pureCircuits`, re-exported from `contract.ts`) run
  locally. Use them to derive what the ledger stores from private state, e.g.
  battleship's `roleOf` compares `getDappPubKey(sk)` with `player1`/`player2`.
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

## Gotchas (all hit while building these UIs)

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
  crashed the dev server in hello-world/ui.
- **`Parameters<>` on `callTx`:** each `contract.callTx.<c>` is overloaded as
  `(...args)` and `(txCtx, ...args)`. `Parameters<typeof callTx.c>` picks the
  last overload, so a wrapper typed with it demands a `TransactionContext`
  first. Derive argument types from `Contract["provableCircuits"][c]` minus the
  context instead (`CircuitArgs` in the generated api file).
- **`findDeployedContract` overwrites private state** when given
  `initialPrivateState`; see §5 "Rejoining".
- **Contract bounds aren't type bounds:** a generic form for `Uint<8>` allows
  0–255, but a contract may assert 1–20 (battleship). The circuit's own check
  still rejects bad input, with the raw assert message. Pre-check in the panel,
  and test the pre-check against the circuits over an edge grid.
- **Wide `Uint` bounds:** `contract-info.json` stores `maxval` as a JSON
  number, and `Uint<64>` and wider exceed 2^53. `JSON.parse` silently rounds
  them. The generator reads the exact source text instead; do the same if you
  read the file yourself.

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
   - In the page console, run a circuit in memory (this proves WASM loads).
     The runtime isn't pre-bundled, so import it by its `/@id/` path:
     ```js
     const rt = await import('/@id/@midnight-ntwrk/midnight-js-protocol/compact-runtime');
     const m = await import('/src/midnight/contract.ts');
     const c = new m.Contract({});  // or the witnesses, via '/@fs/<abs path>/contract/witnesses.ts'
     const pk = '00'.repeat(32);
     const { currentContractState: s } = c.initialState(rt.createConstructorContext({}, pk));
     const ctx = rt.createCircuitContext(rt.dummyContractAddress(), pk, s.data, {});
     m.ledger(c.impureCircuits.<circuit>(ctx, ...args).context.currentQueryContext.state);
     ```
   - `fetch('/managed/<name>/keys/<circuit>.verifier')` returns binary data,
     not `text/html`. (Vite may send no content-type at all; that's fine.
     Check that the byte length matches the file.)
   - With `persistent` private state: in the console,
     `persistentPrivateStateProvider({ accountId, passphrase })` from
     `/src/midnight/private-state.ts`, `setContractAddress`, `set` a state,
     reload, open it again and `get` it back. Then check that a wrong
     passphrase throws `WrongPassphraseError`. Delete the test database
     afterwards (`indexedDB.deleteDatabase("level-js-<name>-ui-private-state")`).
7. With the wallet (needs a human for the approvals):
   - `yarn env:up`, then `yarn fund:wallet <mn_dust_…>`.
   - Deploy, call each circuit, and watch the ledger update, in both proving
     modes.
   - Join from a second profile.
   - With `persistent` private state: reload mid-use. After the passphrase,
     the page re-joins and the user can still act. A wrong passphrase is
     refused.
   - Then repeat on preprod.
