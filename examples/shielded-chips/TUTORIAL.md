# Shielded Chips Tutorial

This tutorial walks you through writing the two Compact smart contracts at the
heart of this example:

1. `chips.compact` — a **native shielded token** implementing
   [MIP-0011](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0011-native-shielded-token.md),
   which the house mints and hands out to players. Chip holdings live inside
   zswap UTXOs rather than in a public balance map.
2. `roulette.compact` — a RED/BLACK betting game that takes chip coins as
   bets and pays winners 2×.

The repo provides everything else. This tutorial focuses on the
shielded-token operations (minting, sending, receiving, and custodying
coins) and stays deliberately brief on the parts that aren't token-specific
(enum plumbing, the roulette-wheel color table, identity hashing).

It also spends real time on one thing that is easy to get wrong and hard to
notice: **where a coin's nonce ends up**. Two contracts can use the same token
primitives, look equally "shielded", and differ completely in whether an
observer can name the wallets involved. [Section 0.1](#01-the-rule-that-shapes-both-contracts)
explains the rule, and you will see it drive concrete decisions in both files.

---

## Prerequisites

Before you begin this tutorial, ensure you have:

- [Installed the toolchain](https://docs.midnight.network/getting-started/installation)
- A Compact compiler that supports `pragma language_version 0.23` — run
  `compact check` to see what you have, and `compact update` to get the latest
- Node.js v22+
- Docker, with the engine running — `compose.yml` provides the local devnet
- Completed a beginner tutorial (optional)

You do **not** need to start a proof server yourself. `yarn env:up` brings up
the node, the indexer, and a proof server together, and `src/config.ts` already
points at them.

This example lives in the `mn-examples` monorepo. Run `corepack enable` and
`yarn install` once from the repo root (one lockfile for the whole workspace);
every other command below runs from `examples/shielded-chips`.

---

## 0. What you start with, and what you'll build

The example directory already has the full TypeScript scaffolding:

```
src/
  config.ts        # network endpoints
  providers.ts     # wires wallet + proof server + indexer into a provider set
  wallet.ts        # MidnightWalletProvider, wallet sync, splitShieldedCoin
  test/roulette.test.ts   # the end-to-end game, driven through the SDK
  test/privacy.test.ts    # asserts no secret nonce or wallet key reaches the chain
contract/
  index.ts         # exports the compiled contracts to TS (CompiledContract.make)
  witnesses.ts     # localSecretKey (shared) + the roulette escrow witnesses
compose.yml        # local devnet (node + indexer + proof server)
scripts/           # wait-for-dust.ts, used by `yarn wait:dust`
package.json       # `yarn compile`, `yarn test:local`, etc.
```

The two things you write in this tutorial are:

- `contract/chips.compact`
- `contract/roulette.compact`

and then you run `yarn compile`, which generates the missing
`contract/managed/` directory with compiled circuits, proving/verifying keys, and
the TypeScript type definitions the scaffolding imports.

The mental model for the two contracts:

```
  chips.compact (MIP-0011)               roulette.compact
  ────────────────────────               ────────────────
  house mints a shielded token   ──────► players bet chip COINS
  color = tokenType(domain,      color         (custodied by the contract)
          contract address)      ──────► winners get 2× back via sendShielded
```

The roulette contract never mints chips. It only ever receives, holds,
and sends chip coins that the chips contract created — which is exactly what
makes the shielded-token plumbing the interesting part.

### 0.1 The rule that shapes both contracts

Before writing either file, learn one protocol fact. It determines several
design decisions that would otherwise look arbitrary.

**A coin commitment is a deterministic function of `(nonce, color, value, owner)`.**
That is what lands on chain when a coin is created. The owner is inside the hash,
so the commitment itself reveals nothing.

**But every coin derived from a coin has a nonce derived from the source nonce
alone.** Both `sendShielded` and `mergeCoin` compute their output nonce as
roughly:

```
outputNonce = hash("midnight:kernel:nonce_evolve", sourceNonce)
```

Nothing about the recipient, the value, or the transaction enters that
derivation. So if you know a coin's nonce, you know the nonce of the coin it is
spent into, and the coin after that, indefinitely.

Put those two facts together and you get the rule:

> **Any coin nonce in public ledger state is a linkability oracle.**

Given a guessed wallet key, anyone can recompute `commitment(nonce, color,
value, guess)` and check whether it appears on chain. A match is a confirmation;
a mismatch is a refutation. It works in both directions:

- **inbound** — which wallet funded the coin you stored;
- **outbound** — which wallet was paid out of it, because the payout nonce
  follows from the stored nonce.

Guessing a wallet key sounds hard, but in practice the attacker rarely has to
guess. A token issuer knows every recipient it paid. Any past counterparty knows
yours. Published or registered addresses hand them over for free. The candidate
set for a real application is small, and the oracle turns a small candidate set
into certainty.

The consequence for this tutorial: deriving a pseudonym from a secret unrelated
to your wallet keys — which both contracts do — is **necessary but nowhere near
sufficient**. A pseudonym is only as private as the coins recorded under it. You
will see this shape the code three times:

| Where | Decision | Why |
|---|---|---|
| `chips.compact` §1.3 | caller-supplied secret nonce, no nonce chain on the ledger | a nonce derivable from public state makes every mint recipient recomputable |
| `roulette.compact` §2.4 | store a *commitment* to the escrowed coin, not the coin | `insertCoin` would publish the player's nonce |
| `roulette.compact` §2.6 | player's coin is `mergeCoin`'s **first** argument | the merged nonce is derived from the first input only |

---

## Part 1 — `chips.compact`: a MIP-0011 native shielded token

Create the chips contract from the repo root:
```bash
touch contract/chips.compact
```

Rather than invent a token interface, this contract implements
[MIP-0011, the Native Shielded Token Standard](https://github.com/midnightntwrk/midnight-improvement-proposals/blob/main/mips/mip-0011-native-shielded-token.md).
A *native shielded token* is an asset that exists **only** as Zswap shielded
UTXOs, never as a balance in contract state. The issuing contract mints and
burns; it is not a balance keeper. That is why there is no `balanceOf` here and
never can be — once a player holds a chip, it moves wallet-to-wallet at the
protocol level with no contract call and nothing for the contract to observe.

Two choices to make up front, both of which the standard asks you to state:

- **Profile: Fungible.** MIP-0011 defines a *Fungible* profile (one token type,
  domain fixed at construction) and a *Family* profile (many token types, domain
  as a per-call parameter). Chips are one asset, so Fungible. The Family profile
  exists because Midnight has no cheap clone-factory deployment — a contract
  cannot instantiate another — so a multi-asset issuer must mint every color from
  one contract.
- **Extensions: supply accounting, yes. Derived-nonce minting, no.** The reason
  for the second is §0.1, and it is worth dwelling on below.

### 1.1 Required state

```compact
pragma language_version 0.23;
import CompactStandardLibrary;

// --- MIP-0011 required state (Fungible profile) ---
export sealed ledger _name: Opaque<"string">;
export sealed ledger _symbol: Opaque<"string">;
export sealed ledger _decimals: Uint<8>;
export sealed ledger _domain: Bytes<32>;

// --- MIP-0011 supply accounting extension (scalar) ---
export ledger _totalMinted: Uint<128>;
export ledger _totalBurned: Uint<128>;

// --- consumer state: treasury + authorization ---
export ledger _treasury: Map<Bytes<32>, QualifiedShieldedCoinInfo>;
export sealed ledger theHouse: Bytes<32>;

witness localSecretKey(): Bytes<32>;
```

The metadata block is the standard's core state, and it is all `sealed` —
immutable after construction. In the Fungible profile the sealed `_domain` is
what forces token setup into the constructor: a sealed field can only be written
once.

Note the underscore prefixes. Those are the standard's convention for state and
for the unrestricted building-block circuits, and keeping them makes it obvious
which parts of the file are the standard and which are ours.

`_totalMinted` / `_totalBurned` come from the optional supply extension. `Uint<128>`
is not decoration: the standard requires the counters to revert on overflow, which
a `Uint<128>` cast gives you for free.

`_treasury` and `theHouse` are not part of MIP-0011 — they are this contract's
own additions. `theHouse` gates minting (§1.5), and `_treasury` holds chips the
contract minted to itself so the second burn variant has something to burn (§1.4).

### 1.2 Construction and metadata

```compact
constructor(
    name_: Opaque<"string">,
    symbol_: Opaque<"string">,
    decimals_: Uint<8>,
    domain_: Bytes<32>
) {
    _name = disclose(name_);
    _symbol = disclose(symbol_);
    _decimals = disclose(decimals_);
    _domain = disclose(domain_);

    const _sk = localSecretKey();
    theHouse = disclose(getDappPublicKey(_sk));
}

export circuit name(): Opaque<"string">   { return _name; }
export circuit symbol(): Opaque<"string"> { return _symbol; }
export circuit decimals(): Uint<8>        { return _decimals; }

export circuit tokenColor(): Bytes<32> {
    return tokenType(_domain, kernel.self());
}
```

MIP-0011 does not prescribe *how* you initialize, only that name, symbol,
decimals and the domain are set at construction and immutable after. Doing it in
the constructor is the simplest way to satisfy that.

`decimals` is a display convention only — the protocol operates on integers.
Chips are whole units, so this example passes `0`.

`tokenColor` has one MUST worth memorizing: **it has to be computed at call
time, never precomputed in the constructor**, because `kernel.self()` resolves
differently during construction. A color cached at deploy time is simply wrong.

That raises a practical question: if there's no stored color field, how does
roulette bind to it at deploy time? Off chain, from the same inputs:

```ts
chipColorHex = rawTokenType(CHIP_DOMAIN, chipsAddress);
```

`tokenType(domain, address)` in-circuit and `rawTokenType(domain, address)` in
TypeScript compute the same value, so no transaction is needed to learn the
color. The e2e test derives it this way and the whole game runs on it, which is
also a decent check that the two derivations really do agree.

### 1.3 `mint` — and why this contract refuses the derived-nonce extension

MIP-0011's core mint is:

```compact
circuit _mint(
    recipient: Either<ZswapCoinPublicKey, ContractAddress>,
    amount: Uint<64>,
    nonce: Bytes<32>
): ShieldedCoinInfo {
    assert(!isZeroTarget(recipient), "NativeShieldedToken: mint to the zero address");
    return mintShieldedToken(_domain, disclose(amount), disclose(nonce), disclose(recipient));
}
```

Three requirements are packed in here:

1. **Reject the zero recipient.** The zero key *is* the burn address, so a zeroed
   recipient would silently destroy the mint. The standard requires checking both
   arms of the `Either`.
2. **`Uint<64>` for the amount.** This cap is the ledger's, not Compact's:
   `shieldedMints` is recorded as `Map<[u8; 32], u64>`. Larger issuance needs
   multiple mints.
3. **The caller owns nonce uniqueness.** Reuse a nonce for the same
   `(domain, value, recipient)` and you produce a duplicate commitment, which the
   ledger rejects.

That third point is where the interesting decision lives. MIP-0011 offers an
optional **derived-nonce** extension — `_mintWithDerivedNonce` — which keeps a
nonce chain in ledger state so callers don't have to manage nonces at all. It is
convenient, and this contract does not use it. The standard says why, in its own
words:

> Its derivation inputs are public state, so the commitment is recomputable by
> enumerating candidate recipient keys: implementations SHOULD document this
> circuit as **recipient-public**, and an issuer needing recipient privacy uses
> the base `_mint` with a secret nonce.

That is exactly §0.1's rule, arrived at from the other direction. And an earlier
version of *this very contract* kept precisely such a public nonce chain
(`nonceSeed` on the ledger, ratcheted per mint) — with the result that every
single mint recipient could be identified from chain data alone, exactly as the
standard warns. The fix and the standard's advice are the same thing: **base
`_mint`, secret nonce.**

So the caller supplies a fresh random nonce. It is a circuit argument, so it is
never published, and without it nobody can rebuild a recipient's commitment:

```ts
// src/test/roulette.test.ts
const mintNonce = (): Uint8Array => new Uint8Array(randomBytes(32));
```

One consequence of minting straight to a wallet, which the standard flags:
contract-initiated outputs carry no coin ciphertext, so a recipient's wallet
cannot find the coin by scanning the chain. The returned `ShieldedCoinInfo` is
the recipient's only copy and callers SHOULD deliver it out of band. In this repo
the SDK handles it via `additionalCoinEncPublicKeyMappings`, which attaches
ciphertexts for the keys you name:

```ts
args: [recipient, BET_SIZE, mintNonce()],
additionalCoinEncPublicKeyMappings: encMap,
```

### 1.4 The two burn circuits

MIP-0011 requires two, because the correct Zswap spend path depends on where the
coin lives — and conflating them is one of the failure modes the standard was
written to prevent.

| | `_burn` | `_burnFromContract` |
|---|---|---|
| Coin location | provided in this tx (same-tx) | already held by the contract |
| Coin type | `ShieldedCoinInfo` | `QualifiedShieldedCoinInfo` |
| Receive step | `receiveShielded(coin)` | none — already owned |
| Spend path | `sendImmediateShielded` (transient) | `sendShielded` (Merkle) |
| Change | forwarded to `refundTo` | auto-received, returned |

A coin created by an output of the current transaction is not yet in the global
commitment tree, so it **must** be spent transiently. Trying to spend it with a
Merkle proof gives you an unsatisfiable circuit, or one that trusts a
caller-supplied tree index.

```compact
circuit _burn(
    coin: ShieldedCoinInfo,
    amount: Uint<128>,
    refundTo: Either<ZswapCoinPublicKey, ContractAddress>
): Maybe<ShieldedCoinInfo> {
    assert(coin.color == tokenType(_domain, kernel.self()),
           "NativeShieldedToken: wrong token color");
    assert(disclose(amount) <= disclose(coin.value),
           "NativeShieldedToken: burn amount exceeds coin value");
    assert(!isZeroTarget(refundTo), "NativeShieldedToken: refund to the zero address");

    receiveShielded(disclose(coin));
    const burned = sendImmediateShielded(
        disclose(coin), shieldedBurnAddress(), disclose(amount)
    );

    if (burned.change.is_some) {
        const refunded = sendImmediateShielded(
            burned.change.value, disclose(refundTo),
            burned.change.value.value as Uint<128>
        );
        return some<ShieldedCoinInfo>(refunded.sent);
    } else {
        return none<ShieldedCoinInfo>();
    }
}
```

The color check is the load-bearing assertion: it is the only barrier stopping a
multi-domain contract from burning token A while accounting it against token B.
The protocol-level receive does **not** validate color for you.

Note the coin comes in *unqualified*, deliberately. A same-tx coin has no
meaningful `mt_index`, so accepting a qualified one would just invite the caller
to supply an arbitrary value.

Burning is a send to `shieldedBurnAddress()` — the all-zero key, which has no
known secret, so the coins are unspendable forever. And note why `refundTo` gets
a zero-check of its own: the zero key is that same burn address, so a zeroed
`refundTo` would silently burn the change too.

The contract-held variant is shorter:

```compact
circuit _burnFromContract(
    coin: QualifiedShieldedCoinInfo,
    amount: Uint<128>
): Maybe<ShieldedCoinInfo> {
    assert(coin.color == tokenType(_domain, kernel.self()), "…wrong token color");
    assert(disclose(amount) <= disclose(coin.value), "…exceeds coin value");

    const burned = sendShielded(disclose(coin), shieldedBurnAddress(), disclose(amount));
    return burned.change;
}
```

No `receiveShielded`: the coin is already owned, and claiming a receive would
require a fresh output that does not exist. The change is auto-received by the
contract and returned, and the standard says the consumer SHOULD persist it —
it replaces `coin` as the contract's holding and is not otherwise recoverable.
Drop it and the remainder is stranded in the contract forever. That is what the
`_treasury` bookkeeping in §1.5 is for.

### 1.5 Gating, and the treasury

MIP-0011 ships `_mint` / `_burn` / `_burnFromContract` as an **unrestricted**
module: they have no authorization of their own, and the standard states plainly
that a consuming contract MUST gate them. This file is a standalone contract
rather than a module to compose, so the standard circuits stay internal and the
exported entry points are gated wrappers:

```compact
export circuit mint(
    recipient: ZswapCoinPublicKey, amount: Uint<64>, nonce: Bytes<32>
): ShieldedCoinInfo {
    requireHouse();
    assert(disclose(amount) > 0, "Mint amount must be positive");

    const coin = _mint(left<ZswapCoinPublicKey, ContractAddress>(recipient), amount, nonce);
    _addMinted(disclose(amount) as Uint<128>);
    return coin;
}
```

Every successful mint MUST be paired with the minted counter — that is what
makes `totalMinted` exact.

**The privileged surface is every circuit that changes supply**: `mint`,
`mintToTreasury`, `burn`, `burnFromTreasury`. All four call `requireHouse()`.
Nothing else in the contract writes state, so that is the whole of it — the seven
metadata and supply getters are deliberately open, since they only read and all
ledger state is public regardless.

```compact
circuit requireHouse(): [] {
    const _sk = localSecretKey();
    assert(getDappPublicKey(_sk) == theHouse, "Only the house can do that");
}
```

There is one authentication rule in the standard worth quoting, because it is
easy to get backwards: implementations **MUST NOT** authenticate callers with
`ownPublicKey()`, since it is a caller-supplied witness not bound to the proof.
Anyone could pass someone else's key. That is why `requireHouse()` checks
`getDappPublicKey(localSecretKey()) == theHouse` instead — the caller proves
knowledge of the secret behind `theHouse` inside the circuit, so the check is
bound to the proof. This is the hash-based commitment pattern MIP-0004 describes,
which MIP-0011 points at for exactly this purpose.

Using `ownPublicKey()` as a *payout or refund destination* is a completely
different thing and is fine — nothing is authorized by it, and in `burn` the
caller has already been authenticated by `requireHouse()` before it is used.

Be precise about what the gate buys, because it is easy to over-read:

- **It does not stop chips being destroyed.** A holder can always send a coin to
  `shieldedBurnAddress()` straight from their wallet, or submit an imbalanced
  Zswap offer. Neither path touches this contract. So gating `burn` makes
  `totalBurned` a *weaker* lower bound, not a complete one — you are choosing who
  may perform an *accounted* burn, not who may destroy value.
- **It does not stop chips moving.** Once minted, a coin transfers
  wallet-to-wallet at the protocol level with no contract call. That is what a
  native shielded token is.
- **It is only as strong as the house's witness secret.** In this example that
  same `sk` is also the roulette contract's identity *and* the blinding factor
  for its winning-number commitment — so publishing that opening to prove
  fairness would hand over mint authority with it. Use a separate blinding
  witness in real code.

Gating `burn` is a product decision as much as a security one: players cash out
through the house rather than destroying chips themselves. If you want the
opposite — holders may redeem their own chips — drop `requireHouse()` from `burn`
only. It is safe to do: `_burn` calls `receiveShielded`, so zswap already
enforces that the caller can actually spend the coin. The gate is about who moves
accounted supply, not about preventing theft.

The treasury pair exists so the Merkle-spend burn is real code rather than
unreachable:

```compact
export circuit mintToTreasury(amount: Uint<64>, nonce: Bytes<32>): [] {
    requireHouse();
    const coin = _mint(right<ZswapCoinPublicKey, ContractAddress>(kernel.self()), amount, nonce);
    _treasury.insertCoin(disclose(coin.nonce), disclose(coin),
        right<ZswapCoinPublicKey, ContractAddress>(kernel.self()));
    _addMinted(disclose(amount) as Uint<128>);
}
```

Minting to `kernel.self()` is allowed — mint-to-self needs no `receiveShielded`.
Minting to a *different* contract is not, today: the node rejects it (`186`),
because the recipient contract would have to run `receiveShielded` in the same
transaction and Compact has no cross-contract calls yet. So today, mint to a
wallet or to the issuing contract.

`burnFromTreasury` then closes the loop, and persisting the change is the point:

```compact
    _treasury.remove(disclose(key));
    if (change.is_some) {
        _treasury.insertCoin(disclose(change.value.nonce), disclose(change.value),
            right<ZswapCoinPublicKey, ContractAddress>(kernel.self()));
    }
```

Publishing these treasury coins is safe for the reason §0.1 gives: they are
contract-owned coins with contract-chosen nonces, so there is no user wallet on
either side to link. The audit confirms it — the treasury nonces match no
candidate wallet at any generation of derivation.

### 1.6 Supply accounting is a privacy trade

```compact
export circuit totalMinted(): Uint<128>  { return _totalMinted; }
export circuit totalBurned(): Uint<128>  { return _totalBurned; }
export circuit totalSupply(): Uint<128>  { return _totalMinted - _totalBurned; }
```

The standard is unusually careful about what these mean, and the honesty is the
useful part:

- `totalMinted` is **exact**. Color derivation guarantees every coin of this
  contract's colors came from one of its mints.
- `totalBurned` is a **lower bound** — it counts only contract-mediated burns.
- `totalSupply` is therefore an **upper bound** on circulating supply.

Exact circulating supply is *not knowable* for a native shielded token, on chain
or off. Two destruction paths bypass the contract entirely: a holder can send to
the burn address themselves, or submit an imbalanced Zswap offer. Any standard
presenting a contract-tracked total as exact is misleading its indexers.

And composing this extension costs privacy, precisely:

> `disclose()` is a compiler permission marker, **not** a disclosure. […] the
> **only** thing that puts a burned amount into the public transcript is the
> supply counter's ledger write.

Coin operations emit commitments and nullifiers, never values. So a bare burn
hides the amount; adding the counter publishes it. That is the trade this
contract accepts in exchange for an on-chain `totalSupply` — and it is the same
`disclose`-is-not-publication distinction drawn in §2.4, arrived at
independently by the standard.

Mint amounts are public either way, via the `shieldedMints` effect. The extension
changes burn visibility, not mint visibility.

### 1.7 Where this deviates from the standard

Worth being explicit, since "conforms to MIP-0011" should be checkable:

- The standard's circuits are **internal**, reached through gated exported
  wrappers (`mint`, `burn`, `burnFromTreasury`, `mintToTreasury`). The MIP's
  reference implementation exports them as an unrestricted module for a consumer
  to gate; there is no module to compose in a standalone contract, and exporting
  them ungated would let anyone mint.
- `_treasury` and `theHouse` are additions, not part of the standard.

Everything an external caller reads — `name`, `symbol`, `decimals`,
`tokenColor`, `totalMinted`, `totalBurned`, `totalSupply` — matches the standard
exactly, as do the mint and burn semantics.

That's the entire chips contract.
---

## Part 2 — `roulette.compact`: a game that custodies chip coins

Create `roulette.compact`:

```bash
touch contract/roulette.compact
```

The roulette contract is longer, but game logic accounts for most of that length
(assertions, the wheel, commit/reveal of the winning number). This tutorial moves
quickly through those and slows down every time a chip coin moves.

### 2.1 Header, enums, ledger state, witnesses

```compact
pragma language_version 0.23;
import CompactStandardLibrary;

export enum BetState { CLOSED, OPEN }
export enum Color { GREEN, RED, BLACK }   // GREEN = the zero pocket only

export sealed ledger theHouse: Bytes<32>;
export sealed ledger chipColor: Bytes<32>;
export sealed ledger winningNumHash: Bytes<32>;
export ledger betState: BetState;
export ledger winningColor: Color;
export ledger bets: Map<Bytes<32>, Color>;
export ledger betCommits: Map<Bytes<32>, Bytes<32>>;
export ledger betValues: Map<Bytes<32>, Uint<64>>;
export ledger paidWinners: Set<Bytes<32>>;
export ledger houseCoins: Map<Bytes<32>, QualifiedShieldedCoinInfo>;

witness localSecretKey(): Bytes<32>;
witness escrowSalt(): Bytes<32>;
witness escrowedCoin(): QualifiedShieldedCoinInfo;
```

The interesting part is the deliberate asymmetry between how the contract stores
the house's coins and how it stores the players':

- `houseCoins: Map<Bytes<32>, QualifiedShieldedCoinInfo>` — the house's
  pre-deposited "match" coins, stored **as coins**. Storing a
  `QualifiedShieldedCoinInfo` in ledger state is the normal way a contract keeps
  custody of a coin between transactions: it received the coin earlier, and it
  remembers the qualified handle so it can `sendShielded` that exact coin later.
- `betCommits: Map<Bytes<32>, Bytes<32>>` — each player's escrowed chip, stored
  **as a commitment**. The contract holds the coin, but nothing that identifies
  the coin reaches the chain.
- `betValues: Map<Bytes<32>, Uint<64>>` — the bet size, public on purpose. A
  value on its own identifies nobody, and `claimWinnings` needs it to check the
  house's match coin.

Why the difference? §0.1. A stored coin publishes its nonce, and a published
nonce identifies the wallet on both sides of it. For the house that is acceptable
and documented — the house is publicly identified by `theHouse` anyway, and it
needs its pool coins spendable by a circuit that only it calls. For a player it
would defeat the entire point of the pseudonym.

That choice has a price, and it is worth being upfront about it: because only the
player can reopen their own commitment, **only the player can move their
escrowed coin.** The house cannot sweep a loser's stake; the loser has to call
`forfeit()` (§2.7). Privacy and unilateral recovery are in genuine tension here,
and this contract picks privacy.

The two extra witnesses exist to make the commitment reopenable:

- `escrowSalt()` — the player's blinding factor. Without it, the chip issuer,
  who knows the exact coin it minted you, could recompute your commitment
  directly and match it to your pseudonym.
- `escrowedCoin()` — the coin itself, replayed from private state at claim time.
  The contract cannot look this up. That is the point.

`chipColor` is `sealed`, and the constructor binds it at deploy time — this is
the color the game accepts, read straight from the chips contract's
`tokenColor`.

### 2.2 Constructor

Bind the chip color and commit to the winning number:

```compact
constructor(_winningNum: Uint<8>, allowedChipColor: Bytes<32>) {
    assert(_winningNum >= 0 && _winningNum <= 36, "Cheat Detected: theHouse: Please keep the number on the table");
    const _sk = localSecretKey();
    theHouse = disclose(getDappPublicKey(_sk));
    chipColor = disclose(allowedChipColor);
    winningNumHash = commitWithSk(_winningNum as Bytes<32>, _sk);
    betState = BetState.OPEN;
}
```

The one token-relevant line is `chipColor = disclose(allowedChipColor)`: the
deployer passes in the chips contract's published color, and from now on the game
only accepts coins of that color. The constructor stores the winning number as a
*commitment* (`commitWithSk` hashes it with the house secret) and reveals it
later — standard commit/reveal, not token-specific.

One thing to fix before you ship anything like this: `commitWithSk` reuses `_sk`,
the dapp identity secret, as the commitment's blinding factor — and that same
`_sk` is also the mint authority over in `chips.compact`. Publishing the
commitment opening to prove you didn't cheat would hand over mint authority with
it. Use a separate blinding witness in real code.

### 2.3 Two helper circuits

Both circuits that take custody of a coin need these, so write them first.

```compact
// Bind an escrowed coin to a player-held salt. mt_index is deliberately left
// out: it is assigned when the transaction lands, so it is not known here and
// would make the commitment impossible to reopen.
circuit escrowCommit(coin: QualifiedShieldedCoinInfo, salt: Bytes<32>): Bytes<32> {
    return persistentCommit<Vector<3, Bytes<32>>>(
        [coin.nonce, coin.color, coin.value as Bytes<32>],
        salt
    );
}

// Take custody of an incoming coin and hand back an equivalent coin that the
// *contract* owns under a freshly derived nonce, safe to record publicly.
// The caller must have already called receiveShielded on `coin`.
circuit reNonceToSelf(coin: ShieldedCoinInfo): ShieldedCoinInfo {
    const qualified = QualifiedShieldedCoinInfo {
        nonce: coin.nonce,
        color: coin.color,
        value: coin.value,
        mt_index: 0 as Uint<64>
    };
    const result = sendShielded(
        disclose(qualified),
        right<ZswapCoinPublicKey, ContractAddress>(kernel.self()),
        disclose(coin.value) as Uint<128>
    );
    return result.sent;
}
```

`escrowCommit` is the commit half of a commit/reveal over a coin. Note what it
omits: `mt_index` is assigned by the ledger when the transaction is included, so
it is unknown at commit time. Commit to `(nonce, color, value)` and let the
claimant supply `mt_index` separately — it is not a secret, it is just not known
yet.

`reNonceToSelf` is the trick for coins you *do* want to store publicly. Sending
a coin to `kernel.self()` produces a new contract-owned coin whose nonce is
derived from the input's. Because the derivation is one-way, the nonce you then
write to the ledger cannot be walked back to the coin that was in the sender's
wallet. It costs one extra coin operation and it keeps `houseCoins` from leaking
the wallet that funded each deposit.

Re-noncing is a genuinely useful tool, but note its limit, because it is easy to
over-trust: it protects the coin on the way **in**, not on the way **out**. If
you publish a re-nonced coin and later `sendShielded` it to somebody, the payout
nonce is derived from the published one, and the recipient is confirmable again.
That is why player coins get commitments rather than re-noncing, and why
`claimWinnings` in §2.6 is built the way it is.

### 2.4 `houseDeposit` and `betColor` — two ways to take custody

Before any bets pay out, the house parks matching coins in the contract:

```compact
export circuit houseDeposit(coin: ShieldedCoinInfo): [] {
    const _sk = localSecretKey();
    assert(getDappPublicKey(_sk) == theHouse, "Only the house can deposit match funds");
    assert(coin.color == chipColor, "Deposit must be made with roulette chips");

    receiveShielded(disclose(coin));
    const escrowed = reNonceToSelf(coin);
    houseCoins.insertCoin(
        disclose(escrowed.nonce),
        disclose(escrowed),
        right<ZswapCoinPublicKey, ContractAddress>(kernel.self())
    );
}
```

This is the receive side of shielded tokens:

1. `receiveShielded(coin)` accepts an incoming coin into the contract's
   custody. A shielded coin sent to a contract address is not automatically
   spendable — the receiving contract must explicitly call `receiveShielded` to
   take it into its zswap state. Skip that call and the coin strands.

   The coin comes in as a plain `ShieldedCoinInfo` (the caller's wallet built it
   as an input to this transaction). Note the guard `coin.color == chipColor`:
   the contract refuses anything that isn't a roulette chip.

2. `reNonceToSelf` swaps it for an equivalent contract-owned coin, per §2.3.

3. `houseCoins.insertCoin(key, coin, owner)` records the coin in ledger map
   state so the contract can find and spend it in a later transaction.
   `insertCoin` is a ledger-`Map` method specific to coin storage: it takes a
   `ShieldedCoinInfo` and stores it as a `QualifiedShieldedCoinInfo` (the
   qualified form carries the `mt_index` needed to spend it later), attributing
   ownership to `right(kernel.self())` — the contract itself. Keying by the
   coin's own nonce is unique, so you need no separate deposit counter.

Now the player side. Same custody problem, different privacy requirement:

```compact
export circuit betColor(coin: ShieldedCoinInfo, colorBet: Color): [] {
    assert(betState == BetState.OPEN, "Not ready to accept bets yet");
    assert(colorBet == Color.RED || colorBet == Color.BLACK, "Only RED or BLACK bets are allowed");

    const _sk = localSecretKey();
    const player = getDappPublicKey(_sk);
    assert(player != theHouse, "theHouse cannot make bets");

    const pubPlayer = disclose(player);
    assert(!betCommits.member(pubPlayer), "Already placed a bet this round");
    assert(disclose(coin.color) == chipColor, "Bet must be made with roulette chips");

    receiveShielded(disclose(coin));

    const q = QualifiedShieldedCoinInfo {
        nonce: coin.nonce,
        color: coin.color,
        value: coin.value,
        mt_index: 0 as Uint<64>
    };
    betCommits.insert(pubPlayer, disclose(escrowCommit(q, escrowSalt())));
    betValues.insert(pubPlayer, disclose(coin.value) as Uint<64>);
    bets.insert(pubPlayer, disclose(colorBet));
}
```

`receiveShielded` is identical. **There is no `insertCoin` call, and that
omission is the fix.** The natural thing to write is the same receive+insert pair
as `houseDeposit`:

```compact
// DON'T DO THIS for a coin that came from a user
betCoins.insertCoin(pubPlayer, disclose(coin), right(kernel.self()));
```

That publishes `{nonce, color, value, mt_index}` for a coin the player's wallet
owned, keyed by their pseudonym. Anyone with a candidate wallet key can then
confirm who is behind the pseudonym, and — because the payout nonce derives from
the escrow nonce — who got paid later. Measured on a live devnet, this single
line was enough to resolve both test players to their wallets exactly, with wrong
candidates cleanly refuted.

Instead the contract stores `persistentCommit([nonce, color, value], salt)`. The
coin is in custody, the contract can prove later that a claimant's coin is the
one they escrowed, and nothing coin-shaped is readable on chain.

The bet's `value` and `colorBet` still go in the clear. That is the deliberate
tradeoff: **behaviour is public, identity is not.** An observer can read that
some pseudonym staked 100 on RED and won; they cannot tell whose wallet that was.
Hiding value and color too is the same technique applied twice more — commit to
them and re-prove on claim.

### 2.5 `revealWinningNumber`

Bets are in and `theHouse` can now spin the wheel and reveal the winningNumber:

```compact
export circuit revealWinningNumber(winningNum: Uint<8>): [] {
    const _sk = localSecretKey();
    assert(getDappPublicKey(_sk) == theHouse, "Only the House can reveal the number");
    const hash = commitWithSk(winningNum as Bytes<32>, _sk);
    assert(hash == winningNumHash, "Cheat Detected: theHouse: tried to change the winning number");
    betState = BetState.CLOSED;
    winningColor = getColor(disclose(winningNum));
}
```

No tokens move. The house re-hashes the number and checks it against the
commitment made at deploy time so it can't change the outcome after seeing the
bets, closes betting, and publishes the winning color.

### 2.6 `claimWinnings` — paying 2× in one circuit, unlinkably

A winner gets 2× their stake: their own coin plus a matching coin from the house.

```compact
export circuit claimWinnings(matchKey: Bytes<32>): [] {
    assert(betState == BetState.CLOSED, "Winning number has not been revealed");

    const _sk = localSecretKey();
    const player = disclose(getDappPublicKey(_sk));

    assert(bets.member(player), "You did not place a bet");
    assert(bets.lookup(player) == winningColor, "You did not place a winning bet");
    assert(!paidWinners.member(player), "Already claimed");

    // Reopen the escrow commitment from private state.
    const coin = escrowedCoin();
    assert(betCommits.lookup(player) == disclose(escrowCommit(coin, escrowSalt())),
           "Escrowed coin does not match your commitment");

    assert(houseCoins.member(disclose(matchKey)), "Match coin not available");
    const matchCoin = houseCoins.lookup(disclose(matchKey));
    assert(matchCoin.value == betValues.lookup(player) as Uint<128>,
           "Match coin must equal your bet value");

    const merged = mergeCoin(disclose(coin), matchCoin);
    const mergedQ = QualifiedShieldedCoinInfo {
        nonce: merged.nonce,
        color: merged.color,
        value: merged.value,
        mt_index: 0 as Uint<64>
    };
    sendShielded(
        mergedQ,
        left<ZswapCoinPublicKey, ContractAddress>(ownPublicKey()),
        merged.value as Uint<128>
    );

    houseCoins.remove(disclose(matchKey));
    betCommits.remove(player);
    betValues.remove(player);
    paidWinners.insert(player);
}
```

Four things to take from this circuit.

- **Reopening the commitment.** `escrowedCoin()` and `escrowSalt()` come from the
  player's private state; the assertion against `betCommits.lookup(player)` is
  what makes the witness trustworthy. A player who supplies a different coin
  fails the check. This is the reveal half of the commit from §2.4, and it is
  what lets a contract custody a coin it cannot describe.

- **`mergeCoin` argument order is a privacy decision.**
  `mergeCoin(a, b) -> ShieldedCoinInfo` combines two coins the contract owns, and
  the merged coin's nonce is derived **from `a`'s nonce only**. Passing the
  player's secret escrow coin first means the payout coin inherits a nonce nobody
  can recompute. Swap the arguments and the merged nonce derives from
  `matchCoin`, whose nonce is sitting in `houseCoins` in plain view — and the
  winner becomes identifiable to anyone holding a candidate wallet key. Same two
  coins, same 2×, same everything else; argument order alone decides whether the
  payout is private.

- **One circuit, not two.** Merging first means the payout is a single
  `sendShielded` of one 2× coin, which fits inside the node's per-circuit effects
  budget (roughly 3 coin operations — exceed it and you get
  `EffectsCheckFailure 186`). Paying the stake and the match as two separate
  sends would blow that budget, which is why a naive version of this contract has
  to split the claim across two transactions. Merging is both cheaper on
  transactions and better on privacy. It is not free: `claimWinnings` compiles to
  ~42k rows at k=16, against ~17k for `betColor`.

- **The circuit enforces value equality.** `matchCoin.value ==
  betValues.lookup(player)` reads both sides from public ledger state, so the 2×
  is mechanically exactly 2× with no off-chain trust between house and player.
  This is the one place the public `betValues` map earns its keep.

`ownPublicKey()` returns the transaction author's `ZswapCoinPublicKey` — the real
wallet calling the circuit. A payout has to land in an actual wallet key, and
using `ownPublicKey()` is safe here precisely because the circuit already
authenticated the caller against `bets` and `paidWinners`. Note that it is a
*recipient*, never an identifier the contract writes down.

### 2.7 `forfeit` — the cost of the private escrow

A loser's stake belongs to the house, but the house cannot take it: only the
player can reopen their commitment. So the loser hands it over.

```compact
export circuit forfeit(): [] {
    assert(betState == BetState.CLOSED, "Winning number has not been revealed");

    const _sk = localSecretKey();
    const player = disclose(getDappPublicKey(_sk));

    assert(bets.member(player), "You did not place a bet");
    assert(bets.lookup(player) != winningColor, "You won — claim instead");
    assert(betCommits.member(player), "Nothing to forfeit");

    const coin = escrowedCoin();
    assert(betCommits.lookup(player) == disclose(escrowCommit(coin, escrowSalt())),
           "Escrowed coin does not match your commitment");

    // Re-nonce on the way into the public pool.
    const result = sendShielded(
        disclose(coin),
        right<ZswapCoinPublicKey, ContractAddress>(kernel.self()),
        disclose(coin.value) as Uint<128>
    );
    houseCoins.insertCoin(
        disclose(result.sent.nonce),
        disclose(result.sent),
        right<ZswapCoinPublicKey, ContractAddress>(kernel.self())
    );

    betCommits.remove(player);
    betValues.remove(player);
}
```

The coin moves from the private escrow into the public `houseCoins` pool,
re-nonced on the way so the coin the house eventually sweeps isn't the one that
was in the player's wallet. After that it is an ordinary pool coin and
`houseClaimMatch` handles it.

Be honest with yourself about this circuit: **a losing player has no incentive to
call it.** In this tutorial that is fine, and the e2e test simply has Charlie do
it. A real deployment needs something structural — a bond posted at bet time, a
deadline after which the stake is claimable some other way, or a design where the
stake never sits in a form only the player can move. This is the concrete cost of
keeping the escrowed coin off chain, and it is the right kind of tradeoff to
notice before you copy the pattern.

### 2.8 `houseClaimMatch` — sweeping the pool

```compact
export circuit houseClaimMatch(matchKey: Bytes<32>): [] {
    const _sk = localSecretKey();
    assert(getDappPublicKey(_sk) == theHouse, "Only the house can sweep");
    assert(houseCoins.member(disclose(matchKey)), "Match coin not available");

    const coin = houseCoins.lookup(disclose(matchKey));
    sendShielded(
        coin,
        left<ZswapCoinPublicKey, ContractAddress>(ownPublicKey()),
        coin.value as Uint<128>
    );
    houseCoins.remove(disclose(matchKey));
}
```

The plainest shape in the file: look up a custodied `QualifiedShieldedCoinInfo`,
`sendShielded` it to `ownPublicKey()`, remove it from the map. It handles both
unused match coins and forfeited stakes, since both live in `houseCoins`.

This circuit is also the one accepted identity leak in the contract. It spends a
coin whose nonce is public, so the payout nonce is derivable, so the house's
wallet key is confirmable by anyone who cares to guess it. That is fine here —
`theHouse` is public and the house wants to be identified — but it is worth
seeing clearly, because the same code in a player-facing circuit would be a bug.
In a live run this is exactly what a post-fix audit still finds: the two sweeps
resolve to the house's wallet, and no player resolves to anything.

### 2.9 Wheel + identity helpers

```compact
circuit getOdd(num: Uint<8>): Boolean { /* returns true for the RED numbers */ }
circuit getColor(num: Uint<8>): Color {
    if (num == 0) { return Color.GREEN; }
    if (getOdd(num) == true) { return Color.RED; } else { return Color.BLACK; }
}
circuit getDappPublicKey(_secret: Bytes<32>): Bytes<32> {
    return persistentHash<Vector<2, Bytes<32>>>([pad(32, "roulette:pk:"), _secret]);
}
circuit commitWithSk(_winningNum: Bytes<32>, _sk: Bytes<32>): Bytes<32> {
    return disclose(persistentHash<Vector<2, Bytes<32>>>([_winningNum, _sk]));
}
```

Pure helper circuits: the standard single-zero roulette color table (single zero
is back!), the shared pseudonym derivation (identical to the chips contract), and
the winning-number commitment. Copy `getOdd` in full from the reference source —
it's just the list of RED pockets `1,3,5,…,35`.

---

## Part 3 — The player's side of a private escrow

Storing a commitment instead of a coin moves work to the client. Two pieces of
`src/` exist for that, and they're worth reading even though you didn't write
them.

### 3.1 Recovering `mt_index`

`escrowCommit` deliberately excludes `mt_index`, and the contract never stores
the coin, so nothing on chain carries it. But `claimWinnings` needs it to spend
the coin. The claimant recovers it themselves: it is the index of the shielded
output their own bet transaction created, which the indexer reports as
`zswapStartIndex` on that transaction.

```ts
// src/test/roulette.test.ts — escrowMtIndex, simplified
const query = `{ block(offset:{height:${blockHeight}}) { transactions {
    ... on RegularTransaction { zswapStartIndex }
    contractActions { address ... on ContractCall { entryPoint } } } } }`;
```

The test then writes the full coin into private state so the witnesses can serve
it later:

```ts
await providers.privateStateProvider.set(
    privateStateId,
    rememberEscrow(base, { nonce, color, value, mt_index: mtIndex }),
);
```

`mt_index` is not secret — it is a public tree position. It just isn't known
until the transaction lands, which is why it stays out of the commitment and
comes in through a witness.

### 3.2 `splitShieldedCoin` — closing the issuer's view

One residual link survives everything in Part 2, and it belongs to exactly one
party: **the chip issuer knows the precise coin it minted you.** Same nonce, same
value. The roulette contract never publishes your coin, but Alice minted it, so
Alice can still recognise it — and derive your payout coin from it.

The fix is client-side and cheap: spend the coin before you bet with it. A
self-transfer replaces it with a coin carrying wallet-chosen randomness the
issuer has never seen.

```ts
// src/wallet.ts
await bobWallet.splitShieldedCoin(chipColorHex, BET_SIZE);
```

The e2e test does this for Bob and asserts the nonce actually changes:

```
Bob's chip nonce before split: c57a839d2dd96d4e027a832665220679f325b63cdf132c820183257baba41000
Bob's chip nonce after split:  3dc7ce358ce0090453be7ecfe1f25624dce2842b0760f84a1c5c582b17f214d2
```

The important property is that the second is not *any* derivation of the first —
the wallet chose fresh randomness rather than ratcheting, so the chain of
derivation the issuer could follow simply stops. Note that
`splitShieldedCoin` waits for the new coin to be indexed before returning:
`submitTransaction` resolves when the transaction is accepted, not when it is on
chain, and in between the old coin is spent while the new one isn't visible yet.

---

## Part 4 — Compile

With both `.compact` files written, generate the compiled artifacts:

```bash
yarn compile
```

Successful output:

```
Compiling 6 circuits:
  circuit "betColor" (k=15, rows=17250)
  circuit "claimWinnings" (k=16, rows=41915)
  circuit "forfeit" (k=16, rows=35067)
  circuit "houseClaimMatch" (k=15, rows=16756)
  circuit "houseDeposit" (k=16, rows=34428)
  circuit "revealWinningNumber" (k=14, rows=8542)
Overall progress [====================] 6/6
Compiling 11 circuits:
  circuit "burn" (k=16, rows=41600)
  circuit "burnFromTreasury" (k=16, rows=32984)
  circuit "decimals" (k=6, rows=26)
  circuit "mint" (k=14, rows=14775)
  circuit "mintToTreasury" (k=15, rows=20305)
  circuit "name" (k=6, rows=26)
  circuit "symbol" (k=6, rows=26)
  circuit "tokenColor" (k=13, rows=3969)
  circuit "totalBurned" (k=6, rows=26)
  circuit "totalMinted" (k=6, rows=26)
  circuit "totalSupply" (k=9, rows=86)
```

The compile script compiles both the chips and the roulette contracts.

Worth reading the row counts as a cost signal:

- **Reads are almost free.** `name`, `symbol`, `decimals`, `totalMinted`,
  `totalBurned` are 26 rows each. MIP-0011 specifies them as circuits so on-chain
  consumers can call them; off chain you just read the ledger directly and pay
  nothing. `tokenColor` costs more (3969) because it hashes.
- **Coin operations dominate everything else.** `revealWinningNumber` moves no
  coins: 8.5k. `betColor` receives one coin and commits: 17k. Anything that
  *spends* — `houseDeposit` and `forfeit` (re-nonce), `claimWinnings`
  (merge + send), `burn` (receive + two transient sends) — jumps to k=16 and
  33–42k rows.
- **Cheaper is sometimes also more standard.** `mint` is 14775 rows here against
  30828 in an earlier draft, because MIP-0011's `_mint` goes straight to the
  recipient instead of minting to the contract and then sending. One fewer coin
  operation, half the circuit.

So privacy and standards work that adds a send is not free — it is just usually
worth it.

---

## Part 5 — Run the game end to end

The end-to-end test in `src/test/roulette.test.ts` plays a full round against a
local devnet: Alice (the house) deploys chips, mints to Alice/Bob/Charlie,
deploys roulette bound to the chip color, deposits two match coins, Bob
re-nonces his chips and bets RED (wins), Charlie bets BLACK (loses), Alice
reveals RED, Bob claims 2× in a single call, Charlie forfeits, and Alice sweeps
the pool. It then exercises both MIP-0011 burn paths, both house-only: Alice
burns half a swept coin (transient), and mints into the treasury and burns part
of it (Merkle), checking that the change is persisted rather than stranded.
Finally it proves the gate holds — Bob cannot burn a coin he owns, and cannot
mint, mint to the treasury, or burn from it.

Be sure that the Docker engine is running and start the local devnet:

```bash
yarn env:up
yarn wait:dust     # wait until the genesis wallet has DUST to pay fees
```

Run the test script:

```bash
yarn test:local
```

This runs both suites one after the other: `roulette.test.ts` below, then
`privacy.test.ts` (see [`privacy-tests.md`](./privacy-tests.md)). Tear the
devnet down with `yarn env:down` when you are done.

Successful output looks like this (wallet-sync chatter trimmed):

```
08:11:21.567 All providers initialized.
08:11:21.570 Deploying chips contract...
08:11:38.517 Chips contract deployed at 0fb4e8de6d341124484ac978753cec387c22c0ef0bdf0991c82a1c556ac7afb6
08:11:38.529 Chip token color: d5d6604c70a548f0b9be1e2de66817bb1682259de800f6402b001b1cb070e0aa
08:11:38.676 Alice minting 100 chips to herself (coin #1)...
08:11:55.917 Alice minting 100 chips to herself (coin #2)...
08:12:14.726 Alice minting 100 chips to Bob...
08:12:32.059 Alice minting 100 chips to Charlie...
08:12:50.889 Deploying roulette contract bound to chip color d5d6604c70a548f0b9be1e2de66817bb1682259de800f6402b001b1cb070e0aa...
08:13:08.265 Roulette deployed at e0fae36467c895294f02fd9381087e952db53615f8eb1c1b4b9cd554fd060932
08:13:08.275 Alice depositing match coin #1 (value=100)...
08:13:32.333 Alice depositing match coin #2 (value=100)...
08:13:56.485 Self-transferring 100 of d5d6604c70a548f0… to re-nonce
08:14:14.872 Re-nonced coin is visible; split complete
08:14:14.877 Bob's chip nonce before split: 2b5ed0d342151b010b1a4408e9de062a74e33b78ccf17585f22b8fed8fb53150
08:14:14.877 Bob's chip nonce after split:  2fcae523dc876687005321bd7bcb247eebfb2d0dfd13d24f1b91d491f7ecd8be
08:14:14.962 Bob is betting a chip coin (value=100) on RED
08:14:38.025 Escrow recorded at mt_index=199
08:14:38.112 Charlie is betting a chip coin (value=100) on BLACK
08:15:02.171 Escrow recorded at mt_index=200
08:15:02.178 Alice revealing the winning number...
08:15:20.904 Bob claiming with match key=8f3b3d87a4b4afcfd36e64f5dacad0ae1d61a68ad1489172bca9ec66a87c9400
08:15:45.044 Bob chip balance after claimWinnings: 200
08:16:09.060 Alice sweeping first pool coin=3716595af71c0baea7bf6c0bcfd01bb5fa29c83c2dc577eb0cc1fc204f17b100
08:16:31.846 Alice sweeping second pool coin=004ecfe3945b412f77138e78aad9549468a51b777812d463ecc0c62bcf4ada00
08:16:55.988 Alice chip balance after sweeping the pool: 200
08:16:56.088 Alice burning 50 of a 100-chip coin...
08:17:26.795 Alice chip balance after burning 50: 150
08:17:26.910 Alice minting 60 chips into the treasury...
08:17:50.924 Alice burning 25 of the 60 treasury chips...
 ✓ src/test/roulette.test.ts (17 tests) 418753ms
     ✓ Alice deploys the chips contract  20753ms
     ✓ Alice mints chips to herself (2 for matches), Bob, and Charlie  72210ms
     ✓ Alice deploys the roulette contract bound to the chip color  17428ms
     ✓ Alice deposits two match coins so the house can cover both bets  53466ms
     ✓ Bob re-nonces his chips in his own wallet before betting  19651ms
     ✓ Bob bets RED with a 100-chip coin  23209ms
     ✓ Charlie bets BLACK with a 100-chip coin  24077ms
     ✓ Alice reveals the winning number (RED)  17346ms
     ✓ Bob claims his 2x in a single call (escrow coin merged with a match coin)  24099ms
     ✓ Charlie forfeits her losing bet into the house pool  24105ms
     ✓ Alice sweeps both pool coins (unused match + forfeited bet)  48242ms
     ✓ Alice burns half of her swept chips — the same-tx transient burn path  24051ms
     ✓ Alice mints into the treasury and burns it — the Merkle-spend burn path  48125ms
 ✓ src/test/privacy.test.ts (12 tests) 185019ms
     …

 Test Files  2 passed (2)
      Tests  29 passed (29)
```

`Bob chip balance after claimWinnings: 200` is the 2× arriving as a single
merged coin, and `after burning 50: 150` is the transient burn taking half of a
swept coin back out of existence. Proof generation dominates the runtime — the
roulette suite is roughly 7 minutes of wall clock, and the privacy suite adds
about 3 more.

Four of the seventeen tests are sub-second negative checks that vitest elides
from the tree above (the `17 passed` count is the authority): a loser cannot
claim; Bob cannot burn a coin he owns; Bob cannot mint, mint to the treasury, or
burn from it; and the house cannot burn more than a coin holds. Each asserts on
the *specific* revert message — `/Only the house/`, `/burn amount exceeds coin
value/` — rather than merely that something threw, so a test cannot pass because
of an unrelated error. That distinction matters more than it looks: a gate test
written as a bare `rejects.toThrow()` will happily pass on a typo in its own
arguments and tell you nothing about the gate.

### 5.1 Reading the chain back

The habit worth building: don't infer what's public from the `disclose` calls,
read the chain. Every contract call's state is readable from the indexer, so you
can check your own privacy claims directly. After a round, the roulette state
looks like this:

```
theHouse       = 12ff5b093f1d54acb8f02b7cc8792284394552ecbcf8c1c5bb10b71d0cf10b0c
chipColor      = 8487ed1df634a057d44ee84b789fb45f692e23cafb4d1a62414b6c547499b822
winningNumHash = 56ae8ecd83e61036610ef23904eb40cc16dc232096d93ae3eb2cbcc4cba9b271
betState = CLOSED   winningColor = RED

bets[e67e3482…]       = RED        bets[7ed8d598…]       = BLACK
betValues[e67e3482…]  = 100        betValues[7ed8d598…]  = 100
betCommits[e67e3482…] = b82ed733…  betCommits[7ed8d598…] = 9b6bd1a9…
houseCoins[d2cea124…] = value 100, mt_index 91
houseCoins[37f1dbd2…] = value 100, mt_index 89
```

Two things to notice. The pseudonyms and their behaviour are fully legible —
who bet what, and who won. And there is no coin nonce anywhere for a player, so
there is nothing to test a candidate wallet key against. That is the whole
design in one screenful: **behaviour public, identity private.**

If you want to check this properly, take the attacker's position. For each public
nonce, and each wallet key you can guess, recompute the commitment across a few
generations of nonce derivation and search the chain for it. Done against this
contract, players resolve to nothing and the only hits are the house's own
sweeps.

---

## Shielded-token cheat-sheet

| Operation | Function | Coin in | Coin out |
|-----------|----------|---------|----------|
| Create a coin | `mintShieldedToken(domainSep, value:Uint<64>, nonce, recipient)` | — | `ShieldedCoinInfo` |
| Derive a token color | `tokenType(domainSep, contractAddress)` | — | `Bytes<32>` |
| Fresh nonce from a seed | `evolveNonce(index:Uint<128>, seed)` | — | `Bytes<32>` |
| Accept an incoming coin | `receiveShielded(coin)` | `ShieldedCoinInfo` | `[]` |
| Store a coin in a ledger `Map` | `map.insertCoin(key, coin, owner)` | `ShieldedCoinInfo` | (stored `QualifiedShieldedCoinInfo`) |
| Spend a tree-resident coin | `sendShielded(qualified, recipient, value:Uint<128>)` | `QualifiedShieldedCoinInfo` | `ShieldedSendResult` |
| Spend a same-tx coin | `sendImmediateShielded(coin, target, value:Uint<128>)` | `ShieldedCoinInfo` | `ShieldedSendResult` |
| Combine two coins | `mergeCoin(a, b)` | two `QualifiedShieldedCoinInfo` | `ShieldedCoinInfo` |
| Destroy a coin | send to `shieldedBurnAddress()` | | |
| Commit to a coin | `persistentCommit<...>([nonce, color, value], salt)` | — | `Bytes<32>` |
| This contract's address | `kernel.self()` → wrap with `right(...)` | | |
| Caller's wallet key (witness) | `ownPublicKey()` → wrap with `left(...)` | | |

Spend-path rule, straight from MIP-0011: a coin whose commitment was created by
an output of the **current** transaction is not in the global tree yet and MUST
be spent with `sendImmediateShielded`. A coin already in the tree needs
`sendShielded` and a valid `mt_index`. Conflating them yields unsatisfiable
circuits, or circuits that trust a caller-supplied tree index.

Key type reminders:

- `ShieldedCoinInfo = { nonce, color, value }` — a coin created this
  transaction.
- `QualifiedShieldedCoinInfo = { nonce, color, value, mt_index }` — a coin the
  ledger already committed, spendable. Use `mt_index: 0` only for a coin you
  create in the current transaction.
- `ShieldedSendResult = { change: Maybe<ShieldedCoinInfo>, sent: ShieldedCoinInfo }`.
- Recipients are `Either<ZswapCoinPublicKey, ContractAddress>`: `left` = wallet
  key, `right` = contract address.

### Privacy rules, in one place

- **Coin values in a transfer never reach public state.** A send publishes a
  commitment, not an amount.
- **Mint amounts do.** `mintShieldedToken` records the value in
  `Effects.shielded_mints`. Minting hides the recipient, not the amount.
- **Circuit arguments are not published.** A `ZswapCoinPublicKey` passed as an
  argument does not appear on chain.
- **Ledger writes are what publish.** `disclose(...)` is a compiler
  acknowledgement at a trust boundary, not a statement that a value went on
  chain. Read the state to find out which values did.
- **Never write a user's coin nonce to public state.** It identifies the wallet
  that funded the coin and the wallet paid out of it. Store a commitment and
  reopen it from a witness.
- **`sendShielded` and `mergeCoin` derive the output nonce from the input nonce
  alone** — `mergeCoin` from its *first* argument. Ordering is a privacy
  decision, and derivation chains are only as private as their root.
- **Re-noncing protects inbound, not outbound.** Sending to `kernel.self()`
  breaks the link to the sender's wallet. It does nothing for whoever you later
  pay out of the re-nonced coin.
- **A pseudonym is only as private as the coins recorded under it.** An unrelated
  `sk` is necessary and not sufficient.
- **Burn amounts are private until you count them.** A bare burn publishes only
  commitments; MIP-0011's supply counter write is the single thing that puts the
  amount in the transcript. On-chain `totalSupply` and private burn amounts are
  mutually exclusive — pick deliberately.
- **A derived nonce is a public nonce.** MIP-0011's derived-nonce mint is
  *recipient-public* by its own documentation, because its inputs are public
  ledger state. Use a caller-supplied secret nonce when recipients matter.

---

## Next Steps

Things to try, roughly in order of how much they'll teach you:

1. **Break it on purpose.** Put `betCoins.insertCoin(...)` back into `betColor`,
   re-run the round, then compute `commitment(nonce, color, value, walletKey)`
   for each test wallet and search the chain for it. Watching a pseudonym resolve
   to a wallet exactly is the fastest way to internalise §0.1.
2. **Swap the `mergeCoin` arguments** in `claimWinnings` and re-run the same
   check. Nothing about the game changes; the winner becomes identifiable.
3. **Hide the bet value.** Commit to `colorBet` and the value alongside the coin
   and re-prove them on claim. This is the same commit/reveal shape as the
   escrow, applied twice more, and it removes the last public behaviour.
4. **Fix the leftover rough edges** noted along the way: give `winningNumHash` a
   blinding witness separate from the identity secret, and mix `kernel.self()`
   into `getDappPublicKey` for per-deployment unlinkability. (The old `Uint<16>`
   overflow on `totalMinted` is gone — MIP-0011's supply counters are `Uint<128>`
   and revert on overflow.)
5. **Give `forfeit` teeth.** Design an incentive that makes a losing player
   settle — a bond at bet time, or a deadline-based fallback — without putting
   the escrowed coin back into public state.
6. **Run multiple rounds per deployment**, which will force you to think about
   round-scoped pseudonyms and clearing state between rounds.
