# Lessons from auditing and fixing this example

> Ported from the standalone [`shielded-chips`](https://github.com/nstanford5/shielded-chips)
> repo. The audit transcripts below are historical output from that repo, where
> the third player was named **Claire**; in this monorepo she is **Charlie**, so
> she maps onto the shared `CHARLIE` wallet.

A privacy audit of this repo turned up two ways to deanonymize every participant
from public chain data alone. Both are fixed. This file records what was learned,
because the mistakes were not exotic — they were the natural thing to write, they
compiled, they passed tests, and the code carried comments confidently claiming
the opposite of what was true.

Everything below was verified against a local devnet (node 1.0.0, indexer 4.3.3,
proof-server 8.1.0) by replaying every block, deserializing every transaction and
contract state, and attempting the attacks. Where a claim is inference rather than
observation, it says so.

---

## 1. The one rule

A coin commitment is a deterministic function of `(nonce, color, value, owner)`.
The owner is inside the hash, so a commitment on its own reveals nothing.

But **every coin derived from a coin takes its nonce from the source nonce
alone.** From the compiler-generated code:

| Operation | Output nonce derived from |
|---|---|
| `evolveNonce(index, seed)` | `("midnight:kernel:nonce_evolve", index, seed)` |
| `sendShielded(input, recipient, value)` | `("midnight:kernel:nonce_evolve", input.nonce)` |
| `sendShielded` change coin | a distinct 30-byte domain, still `input.nonce` |
| `mergeCoin(a, b)` | `a.nonce` only — `b` does not enter it |

No recipient, value, or transaction data enters any of these. Therefore:

> **Any coin nonce in public ledger state is a linkability oracle.**

Given a candidate wallet key, anyone recomputes `commitment(nonce, color, value,
guess)` and searches the chain. A hit confirms, a miss refutes. It works both
directions: *inbound* (which wallet funded the coin you stored) and *outbound*
(which wallet was paid out of it, since the payout nonce follows from the stored
one).

The attacker usually doesn't have to guess. A token issuer knows every recipient
it paid. Any past counterparty knows yours. Registered or published addresses are
free. Small candidate sets plus an exact oracle equals certainty.

**Corollary that cost us two rounds of fixing: an unrelated identity secret is
necessary but nowhere near sufficient.** A pseudonym is only as private as the
coins recorded under it.

---

## 2. What was actually broken

### 2.1 A ledger field holding a nonce seed (chips.compact)

The original contract kept `nonceSeed: Bytes<32>` on the ledger and ratcheted it
per mint. Since `evolveNonce` and `sendShielded`'s derivation are both
deterministic, a published seed makes the nonce of every minted *and* sent coin
recomputable. Color is public, and mint amounts are public (§4), so every
recipient's coin commitment can be rebuilt.

Using only public data, all four mint recipients resolved exactly:

```
mint #1 (block 48) derived nonce a18194681591b033…  alice  *** CONFIRMED ***
mint #2 (block 52) derived nonce 696dfe65da72415b…  alice  *** CONFIRMED ***
mint #3 (block 56) derived nonce 0953c4afca819b20…  bob    *** CONFIRMED ***
mint #4 (block 60) derived nonce 4bd83b9e35932041…  claire *** CONFIRMED ***
```

Wrong candidates produced no match — an exact test, not a heuristic.

**First fix:** derive the seed from the house's witness secret and keep only
`nonceCounter` public. Uniqueness is all the counter was ever for. The seed never
needs to be on chain, and `disclose(mintNonce)` into `mintShieldedToken` does not
publish it — only a ledger write did.

**Where it landed:** the later MIP-0011 rewrite (§8) went further and dropped the
nonce chain entirely. The mint nonce is now a caller-supplied random circuit
argument, so there is no nonce state on chain at all — which is precisely what
the standard prescribes for a recipient-private mint.

### 2.2 `Map.insertCoin` on a coin that came from a user (roulette.compact)

`insertCoin` stores a full `QualifiedShieldedCoinInfo`, so
`betCoins.insertCoin(pseudonym, coin, …)` publishes `{nonce, color, value,
mt_index}` for a coin a player's wallet owned, keyed by their pseudonym. One line,
total break:

```
pseudonym d36a08db…  nonce 0953c4afca819b20…
    alice  -> 6a3299d26d5af7d70901…  no match
    bob    -> 6832663e58cd37932a5d…  MATCH in blk56(mint)
    claire -> c3d24d9198664339281c…  no match
```

**Fix:** store `persistentCommit([nonce, color, value], salt)` and have the
claimant replay the coin from private state at claim time, asserted against the
commitment.

---

## 3. The most useful lesson: the first fix was wrong, and only re-running the attack caught it

The initial fix for 2.2 was to re-nonce on receipt — `receiveShielded`, then
`sendShielded` to `kernel.self()`, then store *that* coin. The stored nonce
belongs to a contract-owned coin no wallet ever held, and the derivation is
one-way, so it cannot be walked back to the player's coin.

It compiled. All 12 tests passed. The direct attack went from 2/2 breaking to
0/2. It looked done.

Re-running the full attack — including *forward* derivations — showed the leak
had simply moved to the other leg:

```
betCoins[f64b3b78…]  published nonce 5141eafa…
    bob    forward=MATCH blk593 (claimMyBet)   ← winner still identified
```

The escrow nonce was public, and the payout was `sendShielded` from it, so the
payout coin's nonce was computable and the recipient confirmable. Re-noncing
*outbound* doesn't help either: every hop stays deterministic from the published
root, so N generations of re-noncing are N derivations an attacker just iterates.

Three things fall out of this:

- **Re-noncing protects inbound, not outbound.** It is a real tool — it is why
  `houseDeposit` doesn't leak the depositing wallet — but it only breaks the link
  to *where a coin came from*, never to *where it goes next*.
- **A partial fix on this class of bug reads exactly like a complete one.** The
  headline metric improved, the tests were green, and the residual was invisible
  unless you specifically tested the direction that still leaked.
- **Test the attack, in every direction, not the absence of the old symptom.**
  The audit script that found the original bug would have reported the re-nonce
  fix as clean, because it only tested inbound.

The exposure did narrow meaningfully in between: non-claiming players became
private, because a loser's escrow coin only forward-matched *the house* (the
sweeper). Only parties who received a payout stayed exposed. Worth knowing that
partial progress is real progress — it just isn't a fix.

---

## 4. Primitive-level facts worth memorizing

Verified by reading transcripts and state off a live chain, not from docs:

- **Mint amounts are public.** `mintShieldedToken` records the value in the
  transaction's `Effects.shielded_mints` (`{roulette:chip: → 100}`) so the ledger
  can track supply per token type. **Transferring an already-minted coin is not**
  — a send's effects carry only `claimed_shielded_receives: Commitment(...)`, no
  value. So "shielded" hides transfer values, never mint values. Minting hides
  *who*, not *how much*.
- **Circuit arguments are not published.** A `ZswapCoinPublicKey` passed as a
  circuit parameter does not reach the chain. Across a full round, no test
  wallet's coin public key or encryption public key appeared in any of the 15
  transactions or any contract state. This is the one thing worth being *less*
  paranoid about.
- **`disclose(...)` is not publication.** It is a compiler-level acknowledgement
  at a trust boundary. What publishes a value is a ledger write, or an effect
  that records it. `disclose(mintNonce)` publishes nothing; a `nonceSeed = …`
  assignment publishes everything. Reading `disclose` calls to determine what is
  public is the wrong instrument.
- **The indexer publishes the circuit name.** `ContractCall.entryPoint` is
  readable per transaction, so *which action* a pseudonym took is always public
  even when the arguments aren't.
- **`mt_index` is a public tree position, not a secret** — it is just not known
  at commit time, since the ledger assigns it when the transaction lands. In
  observed runs it equals the transaction's `zswapStartIndex` when the tx creates
  one shielded output for the contract, which is how a claimant recovers it.
- **`totalMinted.increment(amount as Uint<16>)` rejects amounts > 65535** even
  though the parameter is `Uint<64>` (confirmed in generated code — it raises
  `cast from Field or Uint value to smaller Uint value failed`). Since fixed —
  the MIP-0011 rewrite uses `Uint<128>` counters (see §8). The real cap is the
  ledger's: `shieldedMints` is a `u64` map, so a single mint tops out at
  `Uint<64>`.

---

## 5. Patterns that worked

- **Commitment escrow.** Store `persistentCommit([nonce, color, value], salt)`
  instead of the coin; reopen from a witness at claim time and assert. Leave
  `mt_index` out of the commitment — unknown at commit time — and let the
  claimant supply it separately. A player-held salt matters: without it the token
  issuer, who knows the coin it minted you, can recompute your commitment
  directly.
- **`mergeCoin` argument order as a privacy control.** Merging the player's
  secret escrow coin *first* with a public house coin yields a merged nonce
  derived from the secret one, so the 2× payout is unlinkable. Swap the arguments
  and the winner becomes identifiable. Same two coins, same result, same
  everything else — ordering alone decides.
- **Merging to fit the effects budget.** The repo's existing comment says a
  circuit doing `sendShielded` caps out around 3 coin operations
  (`EffectsCheckFailure 186`), which is why the original split a 2× payout across
  two circuits. Merging first makes the payout a single send of one 2× coin, so
  one circuit does it. Cheaper in transactions *and* better for privacy. Verified
  to work on chain; the exact budget figure is the repo's claim, not something
  measured here.
- **Client-side re-nonce before acting.** A wallet self-transfer replaces a coin
  with one carrying wallet-chosen randomness. Verified that the new nonce is not
  *any* derivation of the old one, so the derivation chain an issuer could follow
  stops dead:

  ```
  before c57a839d2dd96d4e027a8326…
  after  3dc7ce358ce0090453be7ecf…   (not derive^n(before) for any n)
  ```

  One caveat that bit us: `submitTransaction` resolves on acceptance, not
  inclusion. In between, the old coin is spent and the new one isn't visible —
  wait for the balance to reappear or the next step fails confusingly.

## 6. Patterns that didn't

- Publishing any nonce for a user's coin (§2.2).
- Keeping ratchet state for nonces on the ledger (§2.1).
- Re-noncing as a complete fix (§3).
- Reusing one secret for several jobs. Here `sk` is dapp identity, mint authority
  *and* the blinding factor for `winningNumHash` — so publishing the commitment
  opening to prove fairness would hand over mint authority. Still unfixed; use a
  separate blinding witness.
- A pseudonym derived from a constant prefix only. The same `sk` yields the same
  pseudonym in every deployment, so there is no per-round unlinkability. Mix in
  `kernel.self()`.

---

## 7. Accepted leaks, stated deliberately

Not everything got closed, and saying which is part of the deliverable:

- **The house's wallet key is confirmable.** `houseClaimMatch` spends pool coins
  whose nonces are public, so the payout nonce is derivable and the house's wallet
  can be confirmed. Accepted because `theHouse` is public anyway and the house
  wants to be identified. The identical code in a player-facing circuit would be a
  bug. Post-fix, this is the *only* thing the audit still finds — two hits, both
  the house's own sweeps, and no player resolving to anything.
- **Behaviour is public.** Bet color, bet size and win/loss are all readable per
  pseudonym. Deliberate: "behaviour public, identity private." Hiding them is the
  same commit-and-reprove technique applied twice more.
- **The issuer can follow a coin it minted you** unless you re-nonce client-side
  first (§5). This one is irreducible in-contract — the issuer knows the coin — so
  the mitigation has to live in the wallet.
- **Privacy cost recovery something.** Because only a player can reopen their own
  escrow commitment, only they can move their escrowed coin: the house cannot
  sweep a loser's stake, so a loser must call `forfeit()`, which they have no
  incentive to do. A real deployment needs a bond or a deadline-based fallback.
  That tension is genuine, and this example chose privacy.

---

## 8. Corroboration: MIP-0011 says the same things

After this audit, `chips.compact` was rewritten to conform to
[MIP-0011, the Native Shielded Token Standard](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0011-native-shielded-token.md).
Reading it afterwards was a useful check, because the standard reaches several of
the conclusions above independently — which is reassuring about the findings and
worth recording:

- **The nonce oracle (§1, §2.1).** MIP-0011's optional derived-nonce mint keeps a
  nonce chain in public ledger state, and the standard documents it as
  *recipient-public*: "Its derivation inputs are public state, so the commitment
  is recomputable by enumerating candidate recipient keys… an issuer needing
  recipient privacy uses the base `_mint` with a secret nonce." Our original
  `nonceSeed` field was an unlabelled instance of exactly that, and the fix is
  exactly the remedy the standard prescribes.
- **`disclose` is not publication (§4).** In the standard's words: "`disclose()`
  is a compiler permission marker, **not** a disclosure. A value only actually
  becomes public when it reaches an operation that writes it somewhere
  observable." It makes the same point we had to derive from transcripts, and
  applies it to burn amounts: the supply counter's ledger write is the only thing
  that puts a burned amount on chain.
- **Mint amounts are public, transfers are not (§4).** Same conclusion, same
  mechanism (`shieldedMints`).
- **Do not authenticate with `ownPublicKey()`** — it is a caller-supplied witness
  not bound to the proof. This repo never did, but it is worth stating: using it
  as a *payout destination* (as `claimWinnings` and `burn` do) is fine and
  different.

Two things the standard taught us that this audit had not surfaced:

- **Spend paths are not interchangeable.** A coin created by an output of the
  current transaction is not in the commitment tree yet and MUST be spent with
  `sendImmediateShielded`; a tree-resident coin needs `sendShielded` and a valid
  `mt_index`. Conflating them gives unsatisfiable circuits, or circuits that
  trust a caller-supplied index. That is why MIP-0011 has two burn variants.
- **Contract-tracked supply is an upper bound, not a measurement.** Holders can
  destroy coins without the contract — a burn-address send or an imbalanced Zswap
  offer — so `totalSupply` over-reports by construction. Naming it exact
  misleads indexers.

Conforming also closed one of the loose ends listed in §4: the supply counters
are now `Uint<128>` and revert on overflow, so the old `Uint<16>` mint cap is
gone. The remaining §6 items — the overloaded `sk` and the un-salted pseudonym —
are untouched.

---

## 9. Access control, added afterwards

Every supply-changing circuit in `chips.compact` is now gated to `theHouse`:
`mint`, `mintToTreasury`, `burn`, `burnFromTreasury`. Nothing else writes state,
so that is the entire privileged surface; the seven metadata and supply getters
stay open because they only read and all ledger state is public anyway.

Three things worth carrying forward:

- **Authenticate with a proof-bound secret, not `ownPublicKey()`.** MIP-0011
  states implementations MUST NOT authenticate with it — it is a caller-supplied
  witness the proof does not bind, so anyone can pass someone else's key. The gate
  here checks `getDappPublicKey(localSecretKey()) == theHouse`, the hash-based
  commitment pattern from MIP-0004. Using `ownPublicKey()` as a *payout or refund
  destination* is a different thing and is fine.
- **Be precise about what a gate buys.** Gating `burn` does not stop chips being
  destroyed: a holder can send to `shieldedBurnAddress()` from their own wallet or
  submit an imbalanced Zswap offer, and neither touches the contract. So the gate
  chooses who may perform an *accounted* burn, and the side effect is that
  `totalBurned` becomes a weaker lower bound than before. Nor does it stop coins
  moving — that is what a native shielded token is. The gate is not load-bearing
  against theft either: `_burn` calls `receiveShielded`, so zswap already enforces
  that the caller can spend the coin.
- **A gate test that only asserts "it threw" proves almost nothing.** The first
  version of these tests used a bare `rejects.toThrow()`, which passes on any
  error — including a typo in the test's own arguments. Asserting the specific
  revert message (`/Only the house/`) is what turns them into evidence that the
  gate is the thing rejecting. Same lesson as §3 in a different costume: test the
  mechanism, not the symptom.

The gate is only as strong as the house's witness secret, which in this example
is still overloaded three ways (§6). That remains the most valuable unfixed item
in the repo, and it is now squarely an access-control problem rather than a
hygiene one: publishing the winning-number commitment's opening to prove fairness
would hand over mint authority.

---

## 10. Process notes

- **Compilation proves nothing about privacy, and neither do passing tests.**
  Every broken version here compiled and went 12/12 green. The leaks lived in what
  the chain *recorded*, which no test asserted on.
- **Read the chain back.** Deserialize the contract state and the transaction
  transcripts and look. Every claim in this repo's docs that turned out to be
  false would have been caught by one state dump. Eight specific claims across
  `README.md`, `TUTORIAL.md` and the contract comments asserted privacy the chain
  contradicted — including one file that contradicted itself 40 lines apart.
- **Write the attack, not an assertion.** The useful artifact was a script taking
  the attacker's position: for each public nonce, each candidate wallet, and
  several generations of derivation, recompute the commitment and search the
  chain. It found the original bug, then caught the incomplete fix, then confirmed
  the real one. Keeping it runnable is worth more than a comment claiming privacy.
- **The regression is now in-repo.** `src/test/privacy.test.ts` captures each
  round's secret nonces (escrowed bet coin, payout coin) and the player's wallet
  key and asserts none of them appear in either contract's public ledger state —
  the "write the attack, keep it runnable" principle wired into `yarn test`, so a
  future change that reintroduces a §2-class leak fails a test instead of shipping.
- **Cheap negative controls make results trustworthy.** Testing all three
  candidate wallets against every coin meant a hit was meaningful: the two wrong
  candidates reliably missed. A single-candidate test would have proved much less.
- **Be specific about the adversary.** "Private" is not a property on its own.
  Public observer, token issuer, and counterparty have different views here, and
  the answers differ — most of §6 exists because those got separated.
