# Migration provenance — Phase 1

This monorepo was seeded by consolidating three standalone example repos. Each
was copied from its canonical `midnightntwrk` repository at the commit below
(working-tree state, tracked files only, plus the `.compact` source that upstream
had gitignored). History was not carried over; the canonical history remains in
the source repositories.

| Example | Source repo | Source commit |
|---|---|---|
| `examples/hello-world` | `midnightntwrk/example-hello-world` | `8af06315ebed89aff41a8344695649718928b501` |
| `examples/private-party` | `midnightntwrk/example-private-party` | `93711db25d0f8911d86845ff3ea9803a101e0366` |
| `examples/battleship` | `midnightntwrk/example-battleship` | `3c2579334ee48c7997beb399c605b83eb650b7a9` |

> `private-party` was taken from the **canonical** `midnightntwrk/example-private-party`,
> not the personal `nstanford5/example-private-party` fork.

## Changes applied during migration

- **Workspace:** converted from standalone Yarn-classic / npm projects to Yarn 4
  (Berry) workspaces with a single root lockfile (`node-modules` linker).
- **Contract source bug fixed:** `example-hello-world` and `example-private-party`
  gitignored their own `.compact` source. Those files are now committed; only
  generated `contract/managed/` output is ignored.
- **Directory naming:** `hello-world` used `contracts/` (plural); renamed to
  `contract/` (singular) to match the other examples. Updated the `compile`
  script and the `src/test/hw.test.ts` import.
- **Package names:** normalized to `@midnight-ntwrk/example-<name>`.
- **Vitest:** bumped `private-party` from `^3.0.0` to `^4.1.0` to unify the test
  runner across the workspace.
- **Node pin:** single root `.nvmrc` = `22`.
- **`resolutions`:** hoisted hello-world's `@midnight-ntwrk/wallet-sdk` pin to the
  root package.json (Berry honors `resolutions` only at the workspace root).
- **CI:** replaced per-repo workflows with one root matrix workflow that compiles
  and runs each example (same pinned action SHAs and compiler `0.31.1`).

## Known follow-ups (deferred, per plan)

- **wallet-sdk scope drift:** `hello-world` depends on `@midnight-ntwrk/wallet-sdk`
  (hyphenated, needs the root `resolutions` pin) while `private-party` and
  `battleship` use `@midnightntwrk/wallet-sdk` (no hyphen, whose `latest` is
  `1.2.0`). Both publish `1.2.0`. Consolidating onto one name touches source
  imports and is deferred to the version-bump pass.
- **Yarn build scripts:** Berry disables build scripts by default; `classic-level`,
  `ssh2`, `cpu-features`, etc. may need `dependenciesMeta.*.built: true` for the
  test runtime (level-db private state, testcontainers). Confirm when wiring the
  local-network test run in CI.
