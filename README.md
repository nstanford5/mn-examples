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
│   ├── hello-world/      # environment smoke test + minimal contract/test suite
│   ├── calculator/       # public ledger value + arithmetic circuits + a divMod witness
│   ├── private-party/    # private on-chain data, access control, DUST sponsorship
│   ├── token-transfers/  # mint/send/receive for unshielded, NIGHT, and shielded tokens
│   ├── silent-auction/   # sealed reserve price (commit-reveal), NFT auction state machine
│   ├── election/   # TODO: one-line description
│   ├── secret-message/   # private message: publish a hash commitment, not the plaintext
│   └── battleship/       # Compact contract as a state machine, RBAC, private state
├── templates/example/    # scaffold copied by `yarn new:example`
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

## Adding / working with examples

- **Scaffold a new example with `yarn new:example <name> [--witnesses]`.** It
  copies `templates/example/` into `examples/<name>`, wires the harness, and
  registers the example in the CI matrix and the docs tables. You then only
  write the `.compact` contract and the test bodies. See `templates/example/`.
- The `.compact` **source is committed** (only generated `contract/managed/` output is
  gitignored). Do not re-introduce a `.gitignore` rule that hides `*.compact`.
- Each example carries an `AGENTS.md` describing what it teaches and how to run it.
- See `AGENTS.md` at the repo root for agent-oriented conventions.

## License

Apache-2.0. See [LICENSE](./LICENSE).
