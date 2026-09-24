# Shielded Chips — Local Run & Privacy Verification Report

Verifies that the DApp runs end-to-end on a local devnet **and** that its
documented privacy assumptions actually hold against live on-chain state.

- **Date:** 2026-09-24 (first run in the `mn-examples` monorepo; the original
  report from the standalone repo was dated 2026-07-30 with the same results)
- **Toolchain:** compact 0.31.1, Node 22, Yarn 4 (repo-pinned)
- **Devnet images:** `midnight-node:1.0.0`, `indexer-standalone:4.3.3`, `proof-server:8.1.0`
- **Language:** `pragma language_version 0.23`

---

## 1. Ran the DApp on local — 17/17 e2e tests passed

`yarn compile` built both contracts with full PLONK proving keys
(`chips.compact` → 11 circuits, `roulette.compact` → 6 circuits). `yarn
test:local` then drove the whole flow against the live devnet with real proofs.

**`src/test/roulette.test.ts` — 17 passed / 17 (419 s):**

| Test | Result |
|---|---|
| Alice deploys the chips contract | ✅ |
| Alice mints chips to herself (2 for matches), Bob, and Charlie | ✅ |
| Alice deploys the roulette contract bound to the chip color | ✅ |
| Alice deposits two match coins so the house can cover both bets | ✅ |
| Bob re-nonces his chips in his own wallet before betting | ✅ |
| Bob bets RED with a 100-chip coin | ✅ |
| Charlie bets BLACK with a 100-chip coin | ✅ |
| Alice reveals the winning number (RED) | ✅ |
| Bob claims his 2x in a single call (escrow coin merged with a match coin) | ✅ |
| Charlie forfeits her losing bet into the house pool | ✅ |
| Alice sweeps both pool coins (unused match + forfeited bet) | ✅ |
| Charlie cannot claim winnings (bet BLACK, winner RED) | ✅ |
| Alice burns half of her swept chips — the same-tx transient burn path | ✅ |
| Bob cannot burn, even chips he owns — burn is house-only | ✅ |
| Alice mints into the treasury and burns it — the Merkle-spend burn path | ✅ |
| Every supply-changing circuit rejects a non-house caller | ✅ |
| The house cannot burn more than a coin holds | ✅ |

---

## 2. Verified the privacy assumptions — 12/12 mechanical checks passed

Re-reading the source only shows intent. `src/test/privacy.test.ts` runs its own
focused `bet → reveal → claim` round, **captures the ephemeral secrets** that
should never leak, then queries the **actual on-chain public ledger state** of
both contracts back from the indexer and asserts the secrets are absent. Run it
with `LOG_LEVEL=info` to see the captured nonces and pseudonym logged.

**`src/test/privacy.test.ts` — 12 passed / 12 (185 s):**

| # | Claim under test | Result |
|---|---|---|
| **P1** | inbound — escrowed bet-coin nonce absent from all public state | ✅ |
| **P2** | outbound — payout-coin nonce absent, and ≠ the public house match nonce | ✅ |
| **P3** | player's Zswap wallet coin public key never appears on chain | ✅ |
| **P4** | `betCommits` stores a commitment, not the coin | ✅ |
| **P5** | behavior *is* public — pseudonym, bet color (RED), bet value (100), paid outcome all readable | ✅ |
| **P6** | winning number private pre-reveal — only a 32-byte hash on chain, `winningColor` still default | ✅ |
| **P7** | recipient-private mint — Bob's minted-coin nonce leaves no trace in chips public state | ✅ |
| **P8** | issuer residual mitigated — self-transfer produces a nonce ≠ the minted one | ✅ |

(The remaining four of the twelve are the setup, bet, and reveal/claim steps
that capture the secrets, plus a closing summary check.)

The `"identity-private, behavior-public"` design holds against live chain data:
no player coin nonce and no player wallet key ever reach public state, while the
pseudonym and betting behavior are deliberately readable.

### How the leak checks work

`collectRouletteBytes` / `collectChipsBytes` walk **every** `Uint8Array` in each
contract's typed `Ledger` — which *is* the entirety of that contract's on-chain
public state — and `findLeak` reports the field name if a captured secret's hex
matches any of them. A `null` result means the secret is nowhere in public state.

If either contract gains a new ledger field that holds bytes, add it to the
matching `collect*Bytes` function, or the leak check silently stops covering it.

---

## 3. Honest scope notes

- **P2's derivation formula** (`mergeCoin` deriving the merged nonce from its
  *first* argument) is verified by its observable consequence — the payout nonce
  is absent from public state and differs from the public match nonce — not by
  independently re-deriving the hash. That absence is the property that matters
  for unlinkability.
- The README is candid about residual leaks, and these are **by design, not
  bugs**:
  - **Mint amounts are public** (recorded in `Effects.shielded_mints`).
  - **Bet color and bet value are public** (the behavior-public tradeoff).
  - **The house key is confirmable**, because the house sweeps pool coins whose
    nonces are public.
  - The pseudonym mixes in only the constant `"roulette:pk:"`, so **the same
    `sk` yields the same pseudonym across deployments**. Per-table
    unlinkability would require mixing in `kernel.self()`.

---

## 4. Reproduce

From `examples/shielded-chips` (after `yarn install` at the repo root):

```bash
yarn compile          # both contracts + ZK keys
yarn env:up           # node + indexer + proof-server
yarn wait:dust        # genesis wallet has DUST for fees

yarn test:local                                   # both suites, sequentially (29 tests)
MIDNIGHT_NETWORK=local yarn vitest run src/test/privacy.test.ts   # privacy checks only (12 tests)

yarn env:down         # tear down the devnet
```

Proof generation dominates runtime (~7 min for the e2e, ~3 min for the privacy
round); the vitest timeouts are set high to match.
