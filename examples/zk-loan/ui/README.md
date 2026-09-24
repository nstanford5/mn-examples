# ZK Loan UI

Browser front end for the zk-loan contract: React + MUI on Vite, talking to the
chain through the **Midnight Lace** wallet (DApp connector API). Ported from
[midnightntwrk/example-zkloan](https://github.com/midnightntwrk/example-zkloan)
(`zkloan-credit-scorer-ui`).

It lets you deploy or join a contract, pick a sample credit profile, set a PIN,
request a loan (fetching a signature from the attestation API first), and
accept or decline `Proposed` offers.

## Prerequisites

- The contract compiled: `yarn compile` in `examples/zk-loan`. The UI serves
  prover keys and zkir straight from `contract/managed/zk-loan` (Vite
  `publicDir`), so there is no copy step and no stale keys.
- The Midnight Lace extension, on the same network as `VITE_NETWORK_ID`
  (default **preprod**) and funded with tDUST. The wallet supplies the indexer
  and proof-server URLs, and balances/submits every transaction.
- The attestation API running: `yarn attestation:start` in `examples/zk-loan`
  (defaults to `http://localhost:4000`). Register its key on-chain as admin
  (`registerProvider`) before requesting a loan. The UI does not do that; use
  the key it prints at startup.

## Run

```bash
# from the repo root
yarn install
# from examples/zk-loan/ui
yarn dev          # http://localhost:5173
yarn build        # typecheck + production bundle in dist/
```

Settings are optional environment variables read at build/dev time. This repo
does not commit `.env.<network>` files, so set them in the shell:

| Variable | Default |
|---|---|
| `VITE_NETWORK_ID` | `preprod` |
| `VITE_ATTESTATION_API_URL` | `http://localhost:4000` |
| `VITE_LOGGING_LEVEL` | `info` |

```bash
VITE_NETWORK_ID=preview yarn dev
```

## Notes

- Identity is a random 32-byte `userSecretKey` generated per page load and kept
  in an **in-memory** private-state provider. Refreshing drops it, and with it
  access to your loans (and the admin role, if you deployed). That is
  intentional for the demo. A real app would persist it encrypted.
- The contract is imported from `../contract/managed/zk-loan/contract/index.js`
  and `../contract/witnesses.ts`, not `../contract/index.ts`, because the latter
  uses `node:path`.
- The indexer provider is given the browser `WebSocket` explicitly. Its
  default comes from `isomorphic-ws`, whose browser build lacks the named export.
- `vite-plugin-top-level-await` breaks with `@swc/core` 1.16 (`missing field
  'type'` at build time). The repo root pins it to 1.15.47 for that plugin only
  (`resolutions`).

## TODO: move to Vite 8

This UI keeps upstream's Vite 6 toolchain, which has a repo-wide side effect.
Yarn hoists Vite 6 to the repo root, so every example's `vitest.config.ts`
imports Vite **6.4.3** for `loadEnv`, where it used to get 8.2.2. vitest still
runs on its own nested Vite 8, and the configs load fine, but it is a quiet
change for every example.

Vite 6 cannot simply be contained to this workspace:

- **`installConfig.hoistingLimits: "workspaces"`** duplicates `compact-runtime`,
  `ledger-v8` and the other Midnight runtime packages into `ui/node_modules`,
  while the contract module keeps loading the root copy. That split is a
  runtime hazard.
- **Pinning Vite 8 at the root** pushes `vite-plugin-node-polyfills`, which has
  a peer dependency on `vite`, into `ui/node_modules`. Its injected
  `vite-plugin-node-polyfills/shims/*` imports inside root packages (React, the
  indexer client) then fail to resolve, and aliasing the shims did not help.

The fix is to move this UI to Vite 8, done as part of a coordinated
repo-wide version pass, not as a one-off:

- [ ] `vite` 8, `@vitejs/plugin-react` 6, `vite-plugin-node-polyfills` 0.28,
      `vite-plugin-wasm` 3.6
- [ ] Replace `vite-plugin-top-level-await`. It is swc-based and may not work
      under Vite 8's Rolldown bundler; try `build.target: 'esnext'` instead.
      That also removes the need for the root `@swc/core` resolution.
- [ ] Check whether `@originjs/vite-plugin-commonjs` is still needed.
- [ ] Confirm the root-hoisted `vite` is back on 8.x, rerun `yarn build` here,
      and do a Lace smoke test.
- [ ] Remove the Vite 6 notes from the root `AGENTS.md` and
      `examples/zk-loan/AGENTS.md`.
