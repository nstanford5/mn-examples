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

The root `workspaces` glob already includes `examples/*/ui`, so no root
`package.json` change is needed.

### 1. Scaffold

Copy this directory as a starting point (drop `node_modules/`, `dist/`,
`public/`), or run `/midnight-dapp-dev:init` from `examples/<name>` and then
apply every fix listed below. The plugin template is thinner and has known
gaps. If you use the plugin, fold its `api/` package into `ui/src/midnight/`
and delete `api/`, because `examples/*/api` is not a workspace.

Rename the package to `@midnight-ntwrk/example-<name>-ui`.

### 2. Keep `package.json` on the repo pins

- **Exact versions:** `midnight-js-*` `4.1.1` (contracts, types, network-id,
  indexer-public-data-provider, fetch-zk-config-provider,
  http-client-proof-provider, dapp-connector-proof-provider, utils, protocol)
  and `@midnight-ntwrk/dapp-connector-api` `4.0.1`.
- **No separate runtime packages:** don't add `ledger-v8`, `compact-runtime`
  or `compact-js` directly. Import them from
  `@midnight-ntwrk/midnight-js-protocol/{ledger,compact-runtime,compact-js}`,
  as the harnesses do. Root `resolutions` pin the underlying versions.
- **`"vite": "6.4.3"`,** not the plugin's `^7`. It must match the Vite hoisted
  to the root (see root `AGENTS.md`). Match already-hoisted ranges for the
  plugins too: `vite-plugin-node-polyfills ^0.24.0`,
  `vite-plugin-top-level-await ^1.6.0`, `vite-plugin-wasm ^3.6.0`,
  `@vitejs/plugin-react ^5.2.0`, and `vitest ^4.1.0`.
- **Scripts:** only `copy:zk`, `dev`, `build`, `preview`, `typecheck` and
  `test:unit`. **Never** add `compile`, `test`, `test:local`, `env:up` or
  `wait:dust` to a UI: root `yarn compile` / `yarn test*` run on every
  workspace and would pull the UI into CI's local-network runs.
- **Chain `copy:zk` explicitly** (`"dev": "yarn copy:zk && vite"`). Yarn 4
  does not run `pre*` scripts.

After `yarn install`, check the hoisting didn't move:

```bash
node -p "require('./node_modules/vite/package.json').version"   # 6.4.3
node -p "require('./node_modules/bn.js/package.json').version"  # 5.2.5
```

### 3. Files you copy unchanged

These are contract-agnostic:

- `vite.config.ts`, `vitest.config.ts`, `tsconfig*.json`, `index.html`
  (retitle it), `src/main.tsx`, `src/index.css`
- `src/lib/{errors,storage,utils}.ts`
- `src/midnight/private-state.ts`
- `src/providers/{wallet-context,midnight-providers}.tsx`
- `src/hooks/{use-wallet,use-contract-state,use-dust-balance}.ts`
- `src/components/{wallet-widget,network-badge,proving-settings}.tsx`,
  `src/components/ui/*`
- `scripts/copy-zk.mjs` (change the `hello-world` path segments)

### 4. Files you write per contract

**`src/midnight/contract.ts`**
- Re-export `Contract` and `ledger` from
  `../../../contract/managed/<name>/contract/index.js`.
- Define a circuit-id union with **every provable circuit**. The compiled
  `ProvableCircuits` type in `managed/<name>/contract/index.d.ts` lists them;
  those are the files in `managed/<name>/keys/`.
- Define `PRIVATE_STATE_ID`, the private-state type and `ZK_ASSETS_PATH`.
- Build the `CompiledContract` exactly as `contract/index.ts` does, with two
  changes:
  - Replace the `node:path` asset path with `withCompiledFileAssets(ZK_ASSETS_PATH)`.
    In the browser, keys come from `providers.zkConfigProvider`; this call only
    satisfies the type.
  - For witnesses, use `CompiledContract.withWitnesses(witnesses)` instead of
    `withVacantWitnesses`, importing from `../../../contract/witnesses.js`. The
    existing `contract/witnesses.ts` files only import types and
    `midnight-js-protocol/compact-runtime`, so they're browser-safe. Keep it that
    way: no `node:*` imports in witnesses.

**`src/midnight/providers.ts`**
- Copy it, then change only the type parameters (`<Name>Circuits`,
  `<Name>PrivateState`) and the imported constants.
- Keep these parts as they are:
  - the explicit `window.WebSocket` argument
  - `parse{Coin,Enc}PublicKeyToHex`
  - the hex round-trip through `Transaction.deserialize("signature","proof","binding", …)`
  - `tx.identifiers()[0]` for the tx id

**`src/midnight/<name>-api.ts`**
- Write one function per step of `src/test/*.test.ts`, calling the same
  midnight-js function with the same options.
- `deployContract` / `findDeployedContract` take
  `{ compiledContract, privateStateId, initialPrivateState }`. Use the same
  initial private state factory the test uses (e.g.
  `createCalculatorPrivateState()`).
- For calls, use `found.callTx.<circuit>(...args)`, or `submitCallTx` as the
  tests do.
- Expose the ledger as an observable:
  `publicDataProvider.contractStateObservable(addr, { type: "latest" })` piped
  through `ledger(state.data)`.

**The panel component** (see `components/hello-world-panel.tsx`)
- Deploy or join by address (remember the address per network in `storage`).
- Re-join when `providers` change: contract handles are bound to one providers
  bundle, and switching proving mode rebuilds it.
- One form per circuit.
- Render ledger fields from the observable.
- Keep the `useDustBalance` warning.

### 5. Contracts with private state or witnesses

Not yet exercised in a UI in this repo, so verify before relying on it.

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
