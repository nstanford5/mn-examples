# Fast sync (pre-seed)

> ⚠️ **Development wallets only — never a mainnet wallet holding real funds.**
>
> What makes a wallet safe to pre-seed is not where its seed came from but
> whether we know, and recorded, the height it was created at. The two paths
> here mint the seed themselves and write down the chain tip at that instant, so
> the birthday is true by construction: `yarn wallets:new` (into
> `.env.<network>`) and hello-world's throwaway wallet (into
> `.fast-sync-wallets/`).
>
> Any **pre-existing** wallet — one you were already using, or restored from a
> mnemonic — must sync from genesis. Seeding it starts it past its own history
> and **silently hides funds**. `isSeedable()` refuses it as long as no birthday
> is recorded for it, which is why hand-writing a `_BIRTHDAY` line is the one
> edit that can turn this from slow-but-correct into silently wrong. See
> [Safety](#safety--read-this-before-trusting-it).

A brand-new wallet on preprod takes **~78 minutes** to sync for the first time.
Almost none of that is your transactions — it is DUST: the wallet has to build a
chain-wide generation tree by streaming ~1.4M global ledger events before it can
report a balance. Every new account pays it, on every device.

This repo **pre-seeds** new wallets. A throwaway empty wallet is synced to chain
tip once, its state is serialized into a **reference bundle** shipped under
`preseed/` at the repo root, and every fresh wallet `restore()`s from that bundle
(with its own keys swapped in) instead of walking the chain from genesis.

The machinery lives in `packages/fast-sync` and is shared by all eight examples.

The technique, and the safety rules that make it safe, come from moth-wallet's
field guide: `docs/patterns/preseed-sync-acceleration.md` in that repo. This is a
faithful, self-contained port onto the SDK's `restore()` API — it does **not**
depend on moth-wallet.

## Running the examples against a remote network

```bash
cd examples/hello-world && yarn proof:up   # a local proof server is still required
cd ../..

yarn preseed:cut     # 1. re-cut the reference bundle        (~10 min)
yarn wallets:new     # 2. mint 4 wallets, print 4 addresses
#                      3. fund those addresses at the faucet  (manual)
yarn test:preprod    # 4. run every suite
```

**Step 1 must come before step 2.** See [Ordering](#ordering-cut-before-you-mint).

`yarn wallets:new` writes four seeds to a repo-root `.env.<network>` (gitignored,
mode 0600) together with a `_BIRTHDAY` for each — the chain tip at the moment the
seed was minted. One file serves all eight examples: each `vitest.config.ts` loads
it with vite's `loadEnv` from the repo root, and shell env still wins over file
values.

The four wallets are **Alice, Bob, Charlie and Dave**. Suites that think in other
role names (silent-auction's `ORGANIZER` / `BIDDER_ONE` / `BIDDER_TWO`) alias onto
them in `packages/fast-sync/src/resolve.ts`, so you fund four wallets once instead
of a set per example.

Dave is the odd one out: he needs tNIGHT but **must not** have DUST. The DUST
sponsorship suite in `examples/private-party` exists to show Alice paying his fees,
and it asserts he has none, so the funding gate skips DUST registration for him.

### The birthday is what enables fast-sync

`_BIRTHDAY` is not a convenience — it is the safety argument. The guard below only
seeds a wallet whose birthday is at or after the reference height, and a seed with
no recorded birthday is indistinguishable from a wallet with arbitrary history. So:

- **Only `yarn wallets:new` should ever write a `_BIRTHDAY` line.** It reads the
  chain tip at the instant it generates the seed, so the value is true by
  construction.
- **Never add one next to a wallet you already had.** Omit it and that wallet does
  a normal full sync — slow, but correct.

A seed with no birthday still works everywhere; it just does not fast-sync.

### Ordering: cut before you mint

`isSeedable()` requires `reference.height <= birthday`. A bundle cut *after* the
wallets were minted is newer than their birthdays, so the guard correctly refuses
to seed them and every run silently pays the full ~78 minutes. Watch for this line:

```
Fast-sync: reference (height N) is newer than birthday M — syncing from genesis
```

The same rule means **re-cutting invalidates fast-sync for already-funded
wallets**: seeding them from a newer reference would start them past their own
funding transaction. A re-cut therefore implies re-running `yarn wallets:new` and
re-funding at the faucet. That is the cost of a fresh bundle; weigh it against the
catch-up time a stale one charges.

### hello-world without any setup

`examples/hello-world` keeps a zero-configuration path: with no `.env.<network>`
present it generates a throwaway wallet at the current tip (cached, gitignored,
under `.fast-sync-wallets/<network>.json`), fast-syncs it, prints its address and
pauses until you fund it. Useful as a smoke test before committing to the shared
four.

### What a run proves

The first sync emission shows each sub-wallet's `appliedIndex` starting at the
**reference cursor**, not 0. Verified on preview (reference at height 519,470):

```
seeded=[shielded,unshielded,dust] referenceHeight=519470
Wallet sync [1]: shielded=false (141061/…), unshielded=false (0/0), dust=false (141062/…)
```

Dust began at event **141,062** instead of 0 — skipping ~79% of the event stream
— then caught up to tip and reached fully-synced with no errors.

### Measured: preprod, fresh wallet

| phase | time |
|---|---|
| key derivation + gunzip + key-swap | ~0.7s |
| **`dust.restore()`** — deserialize the ~10.9 MB generation tree into WASM | **~72s** |
| sync catch-up (indexer, ~21.8k stale events) | ~53s |
| **total** | **~126s** |
| baseline, no reference | ~78 min |

**~37× faster**, but note where the time goes on preprod: not the network — the
long pole is `dust.restore()` deserializing the large global generation tree into
WASM. That cost scales with chain length (the tree), not with staleness, and it is
inherent to loading a reference of this size; it is not reducible from outside the
SDK. It shrinks to seconds on smaller chains (preview's dust state is ~260 KB, so
its restore is sub-second and a seeded preview wallet syncs in well under a minute).
Set `LOG_LEVEL=debug` to see the per-phase `[timing]` breakdown.

> The "~53s catch-up" line above was measured against a **near-fresh** reference
> and does not extrapolate. The often-quoted "~½ second of catch-up per hour of
> age" would predict ~7 minutes for a month-old bundle; in practice a month-old
> preprod bundle did not catch up at all — see
> [When a bundle goes bad](#when-a-bundle-goes-bad-observed-2026-09-23-preprod).
> Treat catch-up cost as unmeasured beyond a few days of staleness.

### Measured: preprod, `--from-genesis` cut (2026-09-23)

Cutting a bundle from genesis, which is what a wallet with no usable reference
does:

| phase | value |
|---|---|
| shielded | 1,557,318 events, complete in **~4 min** |
| unshielded | complete almost immediately (no commitment tree) |
| **dust** | 1,557,3xx events at **~338 events/sec** — the long pole |
| **total** | **~77 min** |

Dust dominates, and it is steady: the rate held at 338–378 events/sec across the
run. This is the number to plan against for any wallet that cannot fast-sync.

## How it works

| file | role |
|---|---|
| `packages/fast-sync/src/reference-bundle.ts` | Load + validate a shipped reference (fail-closed to a full sync). |
| `packages/fast-sync/src/preseed.ts` | Key-swap the reference into a new wallet's snapshots; the `height <= birthday` safety guard. |
| `packages/fast-sync/src/dedup.ts` | Client-side workaround for an SDK boundary-event off-by-one that a catch-up sync would otherwise trip. |
| `packages/fast-sync/src/submission.ts` | A lazy, single-connection submission service; the SDK default's reconnect churn broke NIGHT→DUST registration on preprod. |
| `packages/fast-sync/src/fast-wallet.ts` | `assembleWallet` — build a `WalletFacade` from `restore()`d sub-wallets (mirrors testkit's `WalletFactory`); the engine behind `MidnightWalletProvider.build`. |
| `packages/fast-sync/src/resolve.ts` | Map a suite's role name onto one of the four canonical wallets; read its seed and birthday from `.env.<network>`. |
| `packages/fast-sync/src/funding.ts` | The faucet gate: wait for NIGHT, register NIGHT→DUST, wait for spendable DUST. `registerDust: false` for Dave. |
| `packages/fast-sync/src/test-wallet.ts` | Get-or-create hello-world's throwaway wallet and record its birthday. |
| `packages/fast-sync/scripts/cut-preseed.ts` | Mint a new reference bundle from an empty wallet synced to tip. |
| `packages/fast-sync/scripts/new-preprod-wallets.ts` | Mint the four wallets, write `.env.<network>`, print addresses. |
| `src/wallet.ts` → `MidnightWalletProvider.build(…, { fastSync })` | Per-example entry point; pass `fastSync` to pre-seed, omit it for the normal `FluentWalletBuilder` path. |
| `preseed/<network>/` | The shipped reference bundles (`manifest.json` + gzipped state per sub-wallet). |

The reference contains **no secret and no user-specific data** — it is public
chain state plus a public key that gets replaced — which is what makes it safe to
ship in the repo.

## Safety — read this before trusting it

Pre-seeding done wrong **silently hides funds**. The one rule that prevents it:

> Only seed a wallet whose **birthday** (its creation height) is at or after the
> reference's height. Seeding a wallet that could have been active earlier starts
> it past its own history, and those coins never get scanned.

`isSeedable()` enforces this. Both paths that enable fast-sync record the birthday
at the moment they mint the seed — `yarn wallets:new` into `.env.<network>`, and
hello-world's throwaway wallet into `.fast-sync-wallets/` — so in both cases the
birthday is true by construction and seeding is safe.

A wallet **restored from a mnemonic**, or any wallet you already had, must never be
seeded: it may hold funds at any height and has to sync from genesis. The guard
refuses when there is no birthday to compare, falling back to a full sync — which
is why you must never hand-write a `_BIRTHDAY` line to "speed up" an existing
wallet. That single edit is the one way to turn this from slow-but-correct into
silently wrong.

The technique and its rules come from moth-wallet's field guide,
`docs/patterns/preseed-sync-acceleration.md` in that repo.

### What `cut-preseed` must guarantee

The cutting wallet is generated fresh inside the script and **never funded**. The
bundle is safe to commit only because it contains public chain state plus a public
key that gets replaced on restore; a funded wallet's own coins would end up in it.
The script also loads its own output back through `loadReferenceBundle` before
declaring success, so a malformed bundle fails loudly at cut time rather than
degrading to a silent full sync weeks later.

## When a bundle goes bad (observed 2026-09-23, preprod)

A bundle does not only go *stale*. It can become **unusable**, and the failure
looks like a slow sync rather than an error:

```
values inserted non-linearly into zswap commitment tree; expected index 19466, but received 19459
values inserted non-linearly into dust  commitment tree; expected index 1075630, but received 1075608
```

These repeat indefinitely. `unshielded` reaches `isStrictlyComplete()` — it has
no commitment tree — while `shielded` and `dust` never do, so the wallet retries
the same batch forever. CPU and memory keep ticking up, which reads exactly like
progress. A 50-minute run produced zero forward movement before the sync timeout
fired.

`dedup.ts` does not catch this. It filters by **event id** against
`appliedIndex`; these indices are **commitment-tree positions**, a different
counter. The restored tree state and the event cursor in the bundle no longer
agree with what the indexer streams — the SDK-internals fragility noted under
Caveats, arriving in practice.

**Diagnosing it.** Watch the applied index, not the booleans. `cut-preseed`
prints `shielded=false (19459/…)` and a stuck `appliedIndex` across successive
emissions is the tell. Booleans alone cannot distinguish a stall from a slow
sync.

**Fixing it.** `yarn preseed:cut --from-genesis` skips `restore()` and the dedup
path entirely and syncs a throwaway wallet from genesis (~78 min on preprod).
Slower, but it is the only path that does not depend on an existing bundle being
consistent, and it is how a first bundle for a network gets made. Bootstrapping
from the existing bundle stays the default because it is much faster when the
bundle is healthy.

**The implication for test runs is the same.** Every wallet that fast-syncs uses
this code path, so a bad bundle breaks the suites, not just the cutter. If
preprod runs suddenly hang in `beforeAll`, check for these errors before
assuming the network is slow.

## Caveats

- **This is an interim technique.** It depends on the shape of the SDK's
  serialized sub-wallet state (JSON with `publicKeys`/`publicKey`, `state`,
  `protocolVersion`, `offset`), which is not a public contract and can change
  between SDK releases. Every failure path falls back to a normal sync, so an SDK
  bump costs time, never correctness. It retires when the wallet-sdk consumes the
  indexer's collapsed-update endpoints.
- **The shipped reference goes stale.** A stale reference is only slower, never
  wrong — the wallet syncs forward from it (~½ second of catch-up per hour of age).
  Re-cut with `yarn preseed:cut`, and read
  [Ordering](#ordering-cut-before-you-mint) first: a re-cut means re-minting and
  re-funding the wallets.
- **Reference size grows with the chain.** The preprod dust state is ~5 MB
  gzipped and will keep growing; mainnet's will be largest.
