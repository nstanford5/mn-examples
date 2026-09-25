# Hello World — browser frontend

A minimal React dApp for the hello-world contract. It connects a Midnight
wallet (Lace), deploys a hello-world contract or joins an existing one, shows
the public `message` ledger field live, and calls `storeMessage`.

Everything Midnight-specific lives in [`src/midnight/`](src/midnight/). Each
file is the browser counterpart of a piece of the Node test harness in
[`../src/`](../src/):

| Browser (`src/midnight/`) | Node harness (`../src/`) | What changes |
|---|---|---|
| `contract.ts` | `../contract/index.ts` | Imports the generated contract JS directly; no `node:path` |
| `providers.ts` | `providers.ts`, `wallet.ts` | Wallet = Lace via the DApp Connector; keys fetched over HTTP; wallet or local proving; in-memory private state |
| `hello-world-api.ts` | `test/hw.test.ts` | `deployContract` / `findDeployedContract` / `callTx.storeMessage`, plus a live `message$` stream |

It is the reference output of `yarn new:ui` (Vite, React 19, Tailwind v4,
shadcn), pinned to this repo's toolchain: `midnight-js-*` 4.1.1,
`dapp-connector-api` 4.0.1, and Vite 6.4.3, which matches the hoisted root Vite
(see the root `AGENTS.md`). Everything except `hello-world-api.ts`,
`components/hello-world-panel.tsx`, `__tests__/message.test.ts` and this README
is rendered from `templates/ui/`. Edit those files there, not here. CI fails
if the two drift apart (see `AGENTS.md`).

## Prerequisites

- Chrome with a Midnight wallet extension (Lace). If several Midnight wallets
  are installed, pick one in the header.
- DUST in that wallet on the network you'll use, to pay fees.
- The compiled contract. From the repo root:
  ```bash
  yarn workspace @midnight-ntwrk/example-hello-world run compile
  ```

## Run

```bash
cd examples/hello-world/ui
yarn dev          # runs copy:zk, then Vite on http://localhost:5173
```

`copy:zk` copies `../contract/managed/hello-world/{keys,zkir}` into
`public/managed/hello-world/` (gitignored). `FetchZkConfigProvider` fetches
the prover key, verifier key and ZKIR from there. Yarn 4 doesn't run `pre*`
scripts, so `dev` and `build` call `copy:zk` explicitly.

Then, in the page:

1. Choose the network your wallet is set to (`undeployed`, `preview` or
   `preprod`) and click **Connect Wallet**. The requested network has to match
   the wallet's.
2. **Deploy new contract**, or paste an address and **Join**. The address is
   remembered per network, so a reload re-joins automatically.
3. Type a message and click **storeMessage**. The message card updates when the
   indexer reports the new state.

### Local devnet

```bash
cd examples/hello-world
yarn env:up      # node :9944, indexer :8088, proof server :6300 (network id `undeployed`)
```

Point the wallet at the local network (node `http://127.0.0.1:9944`, indexer
`http://127.0.0.1:8088/api/v4/graphql`, proof server `http://127.0.0.1:6300`).

A new wallet has no DUST, so its first deploy fails at balancing with
`Wallet.InsufficientFunds: could not balance dust`. The local devnet has no
faucet, and DUST can't be transferred. It accrues from NIGHT registered for DUST
generation, and whoever registers the NIGHT can name any DUST address as the
receiver. `fund:wallet` uses that:

```bash
# from anywhere in the repo (packages/fast-sync/scripts/fund-wallet.ts)
yarn fund:wallet <your mn_dust_undeployed1… address> [mn_addr_undeployed1… for some NIGHT too]
```

It sends NIGHT from the genesis wallet to a throwaway sponsor wallet, and the
sponsor registers it with *your* DUST address as receiver. DUST starts accruing
to your wallet within a few blocks; you don't need to do anything in the wallet.
While the balance is 0, the UI shows the command with your DUST address filled in. The UI reads every endpoint from the wallet's `getConfiguration()`,
so there's nothing to configure in the app itself.

### Preview / Preprod

Set the wallet to that network, get tNIGHT from the faucet, and let it generate
DUST. Pick the same network in the header.

## Proving: wallet vs local proof server

The **Proving** card switches how ZK proofs are generated. Changing it rebuilds
the providers and re-joins the contract.

- **Wallet proves** (default): `dappConnectorProofProvider` hands the circuit
  and key material to the wallet (`ConnectedAPI.getProvingProvider`), and the
  wallet generates the proof. There's nothing extra to run.
- **Local proof server**: `httpClientProofProvider` against a proof server you
  run yourself (`yarn proof:up` in `examples/hello-world`, default
  `http://127.0.0.1:6300`). This is the same setup as the Node test harness.

Don't point either mode at a proof server you don't control: the proof server
sees your circuit inputs.

## Scripts

| Script | What it does |
|---|---|
| `yarn dev` | `copy:zk` + Vite dev server |
| `yarn build` | `copy:zk` + `tsc -b` + production build into `dist/` |
| `yarn typecheck` | `tsc -b` against the real SDK types |
| `yarn test:unit` | vitest (jsdom). Mocked wallet and proof providers; one test runs the real compiled circuit in memory to check `message$` decoding |

The UI deliberately has no `compile`, `test` or `test:local` script. Root
`yarn compile` / `yarn test*` run on every workspace (`foreach --all`), and
the UI must not join CI's local-network runs.

## Gotchas found while wiring this up

- **`isomorphic-ws` in the browser.** `indexerPublicDataProvider` defaults its
  WebSocket to `ws.WebSocket` from `import * as ws from 'isomorphic-ws'`. The
  browser build of `isomorphic-ws` only has a default export, so that default
  is `undefined` once bundled. `providers.ts` passes `window.WebSocket`
  explicitly.
- **`optimizeDeps.exclude` must stay minimal.** Only `ledger-v8`,
  `onchain-runtime-v3` (the WASM packages) and `midnight-js-protocol` (which
  `export *`s ledger-v8) are excluded. Excluding `compact-runtime` too breaks
  its CommonJS `object-inspect` import in dev.
- **Several wallets.** `window.midnight` can hold more than one wallet (and
  Lace adds an `mnLace` alias). Taking the first entry can pick the wrong
  wallet, so the UI lists them and defaults to Lace.
- **Unfunded wallets fail with an empty message.** Lace reports fee failures
  as an Effect `FiberFailure` whose top-level `message` is `""`. The real
  reason is in `cause.failure`. `src/lib/errors.ts` unwraps it.
- **Connector keys are Bech32m.** `getShieldedAddresses()` returns encoded
  keys; `providers.ts` normalizes them to hex with `parse*ToHex`.
