# AGENTS.md — mn-examples

Instructions for AI agents working in this repository. Humans: see `README.md`.

## What this repo is

A single monorepo of official Midnight examples. Each lives under `examples/<name>`
and is a Yarn 4 workspace. The whole repo shares one lockfile and one pinned
toolchain (see the version matrix in `README.md`). The point of the monorepo is
that these examples are **verified**: CI compiles every contract and runs its
test suite against a local Midnight network. Treat green examples as ground
truth over your own recollection of Midnight/Compact APIs.

## Golden rules

- **Do not trust memory for Midnight/Compact APIs.** Verify against the compiled
  output and the running tests. Compilation alone is not proof — code must run.
- **The `.compact` source files are committed on purpose.** Only the generated
  `contract/managed/` output is gitignored. Never add a `.gitignore` rule that
  hides `*.compact`.
- **Keep the toolchain pinned.** Do not bump `@midnight-ntwrk/*`, the compiler,
  Node, or Yarn versions for a single example. Version moves are a coordinated
  repo-wide pass.
- **Never commit secrets.** Real `.env.preprod` / `.env.preview` and
  `midnight-level-db/`, `logs/`, wallet preseed state are gitignored. Only the
  `.env.*.example` templates are tracked.

## Common commands

```bash
corepack enable          # Yarn 4 via packageManager field
yarn install             # whole-workspace install (one lockfile)
yarn compile             # compile all contracts (foreach, parallel)
yarn workspace @midnight-ntwrk/example-<name> run compile   # one example
```

Per example (from `examples/<name>`): `yarn env:up`, `yarn wait:dust`,
`yarn test:local`, `yarn env:down`. Running tests requires Docker.

## Examples

| Example | Teaches |
|---|---|
| `hello-world` | Environment smoke test; minimal contract + test harness; fast-sync preseed |
| `calculator` | Public `ledger` value updated by arithmetic circuits; a `divMod` witness verified on-chain (verify-off-chain-work pattern) |
| `private-party` | Private on-chain data, access control, unshielded (NIGHT), DUST sponsorship |
| `battleship` | Compact contract as a state machine, role-based access control, private state, on-chain verification of off-chain data |
| `token-transfers` | TODO: what it teaches |
| `silent-auction` | TODO: what it teaches |
| `ke-example` | TODO: what it teaches |
| `jay-example` | TODO: what it teaches |
| `election` | TODO: what it teaches |
| `secret-message` | Private on-chain data via hashing: a witness supplies a secret, the circuit publishes only its `persistentHash` commitment |

Each example has its own `AGENTS.md` with specifics.

## Conventions for new/edited examples

- **Prefer the generator:** `yarn new:example <name> [--witnesses]` scaffolds a
  new example from `templates/example/` (harness, config, compose, docs stubs,
  and a test skeleton up to the first `deployContract` call) and registers it in
  the CI matrix + docs tables. Author only writes the `.compact` and the tests.
  The conventions below describe what that template produces.
- Directory shape: `contract/` (singular) with the `.compact` source + `index.ts`
  (+ `witnesses.ts` where needed); `src/` for the TypeScript test harness;
  `scripts/` for helpers; `compose.yml` for the local network.
- Extend `../../tsconfig.base.json` in the example `tsconfig.json`.
- Provide `compile`, `test`, `test:local`, `env:up`, `env:down`, `wait:dust`
  scripts so the CI matrix and root aggregates work unchanged.
- Add meticulous comments in contracts and witnesses explaining the *how* and
  *why* — these examples are read by agents as much as by people.
