# mn-examples

Official Midnight example DApps and smart contracts, consolidated into one
monorepo so that **every example compiles _and_ runs against a single, pinned
toolchain** — and stays that way. These examples are the shared, verified
source that feeds the Midnight docs, the `midnight-expert` skills/MCP tooling,
and the Kapa answer engine. If an example here is green, an agent or a developer
who copies it gets working code.

> Compilation is not correctness. Every example is expected to compile **and**
> execute its test suite against a local Midnight network in CI.

## Layout

```
mn-examples/
├── examples/
│   ├── hello-world/      # environment smoke test + minimal contract/test suite + browser UI (ui/)
│   ├── calculator/       # public ledger value + arithmetic circuits + a divMod witness
│   ├── private-party/    # private on-chain data, access control, DUST sponsorship
│   ├── token-transfers/  # mint/send/receive for unshielded, NIGHT, and shielded tokens
│   ├── silent-auction/   # sealed reserve price (commit-reveal), NFT auction state machine
│   ├── election/   # TODO: one-line description
│   ├── secret-message/   # private message: publish a hash commitment, not the plaintext
│   ├── zk-loan/   # private credit scoring: verify a signed attestation in-circuit, disclose only the outcome
│   ├── shielded-chips/   # shielded tokens: MIP-0011 chips + a roulette that custodies and pays out coins privately
│   └── battleship/       # Compact contract as a state machine, RBAC, private state
├── packages/
│   └── fast-sync/        # shared remote-network wallet harness (pre-seed, .env, funding gate)
├── preseed/              # pre-seed reference bundles, per network
├── templates/example/    # scaffold copied by `yarn new:example`
├── templates/ui/         # browser UI scaffold rendered by `yarn new:ui`
├── tsconfig.base.json    # shared TypeScript compiler options
├── vitest.config.ts      # aggregate test projects (per-example configs still own env)
└── .github/workflows/    # CI: compile-and-run every example on a matrix
```

Each example is a Yarn workspace and remains independently runnable.

## Pinned toolchain (Phase 1 baseline)

All Phase 1 examples are frozen on one generation. Do not bump these piecemeal;
version changes happen in a coordinated pass.

| Component | Version |
|---|---|
| Compact language (`pragma`) | `0.23` |
| Compact compiler (`setup-compact-action`) | `0.31.1` |
| `@midnight-ntwrk/midnight-js-*` | `4.1.1` |
| `@midnight-ntwrk/testkit-js` | `4.1.1` |
| wallet SDK | `1.2.0` |
| Node.js | `22` (see `.nvmrc`) |
| Yarn | `4.18.0` (Berry, `node-modules` linker) |
| Vitest | `4.1.0` |

## Prerequisites

- **Node.js 22** (`nvm use`).
- **Corepack** for Yarn 4: `corepack enable`.
- **Docker** (the examples spin up a local Midnight network via `docker compose`).
- **Compact compiler** on `PATH` (`compact`); CI installs it via `setup-compact-action`.

## Getting started

```bash
corepack enable
yarn install          # one lockfile for the whole workspace
yarn compile          # compile every example's contract (parallel)
```

Run a single example end-to-end (compile is already done above):

```bash
cd examples/battleship
yarn env:up           # start the local Midnight network (Docker)
yarn wait:dust        # wait for DUST to accrue for fees
yarn test:local       # run the test suite against the local network
yarn env:down
```

Run every example's tests from the root:

```bash
yarn test:local       # yarn workspaces foreach ... run test:local
```

## Running against a remote network (preprod / preview)

The examples also run against the public **preprod** and **preview** networks. A
local proof server is still required; everything else is remote.

The obstacle is wallet sync: a brand-new wallet on preprod takes **~78 minutes** to
reach chain tip, almost all of it building the chain-wide DUST generation tree. The
repo ships **pre-seed reference bundles** under `preseed/` that a fresh wallet
restores from instead, bringing that down to about **75 seconds**. See
[FAST-SYNC.md](./FAST-SYNC.md).

```bash
cd examples/hello-world && yarn proof:up   # local proof server on :6300
cd ../..

yarn preseed:cut     # 1. re-cut the reference bundle       (~10 min)
yarn wallets:new     # 2. mint 4 wallets, print 4 addresses
#                      3. fund those addresses at the faucet (manual)
yarn test:preprod    # 4. run every suite, sequentially
```

**Step 1 must come before step 2** — a bundle cut after the wallets exist cannot
be used to seed them, and every run silently falls back to the 78-minute sync.
FAST-SYNC.md explains why.

`yarn wallets:new` writes a repo-root `.env.preprod` (gitignored) holding four
seeds — **Alice, Bob, Charlie and Dave** — and prints their addresses for the
[faucet](https://midnight-tmnight-preprod.nethermind.dev/). One file serves all
eight examples; suites with other role names (silent-auction's
`ORGANIZER`/`BIDDER_ONE`/`BIDDER_TWO`) alias onto the same four wallets. Copy
`.env.preprod.example` instead if you want to supply your own.

Alice, Bob and Charlie need tNIGHT and the suites register them for DUST
automatically on first run. **Dave needs tNIGHT and nothing else** — the DUST
sponsorship suite in `private-party` exists to demonstrate Alice paying his fees,
and asserts that he has no DUST of his own.

> Keep remote runs **sequential**. All eight suites share the same four wallets,
> and concurrent spends of the same UTxOs produce nondeterministic balancing
> failures. The root `test:preprod` script is sequential by design.

## Adding / working with examples

- **Scaffold a new example with `yarn new:example <name> [--witnesses]`.** It
  copies `templates/example/` into `examples/<name>`, wires the harness, and
  registers the example in the CI matrix and the docs tables. You then only
  write the `.compact` contract and the test bodies. See `templates/example/`.
- **Add a browser UI with `yarn new:ui <name>`** once the contract compiles and
  its tests pass. It renders `templates/ui/` into `examples/<name>/ui`, deriving
  circuits, witnesses and ledger fields from the compiled contract, so the UI
  typechecks, tests and builds before any use-case code is written. See
  `examples/hello-world/ui/AGENTS.md`.
- The `.compact` **source is committed** (only generated `contract/managed/` output is
  gitignored). Do not re-introduce a `.gitignore` rule that hides `*.compact`.
- Each example carries an `AGENTS.md` describing what it teaches and how to run it.
- See `AGENTS.md` at the repo root for agent-oriented conventions.

## License

Apache-2.0. See [LICENSE](./LICENSE).
