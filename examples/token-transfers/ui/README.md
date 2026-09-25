# Token Transfers UI

Browser frontend for `examples/token-transfers`: connect a Midnight wallet (Lace),
deploy or join the contract, and move unshielded and shielded tokens between
the contract and your wallet.

Scaffolded by `yarn new:ui token-transfers` from `templates/ui/`. See
`AGENTS.md` next to this file for which files are template-owned and
which are yours, and for the verification checklist.

What it adds on top of the scaffold:

- **Wallet balances instead of a ledger:** the contract has no public ledger
  (`Ledger` is `{}`), so there is nothing to stream. Each call moves tokens in
  or out of your wallet, and the template's `<WalletBalancesCard>` polls its
  unshielded and shielded balances, labelling NIGHT (in STAR) and this
  contract's custom token. The contract's own holdings aren't shown: the
  indexer reports a contract's balance as of its deploy (see the Node test's
  comment).
- **The custom token's color from the address:** `customTokenColor(address)` is
  `rawTokenType(pad(32, "simple:receive"), address)`, which is what the contract
  computes. It's known without minting, and the circuits test checks it against
  `mintAndReceive`'s return value.
- **Generic forms for most circuits:** the five unshielded circuits (with
  **Use my address** for `UserAddress` arguments) and `receiveShieldedTokens`.
  Each form shows what its circuit returned, e.g. `mintAndReceive`'s color.
- **Two small forms for the shielded mints:** a label picks the token (it is
  padded into the domain separator), the mint nonce is fresh random bytes on
  every call (a reused nonce mints the same coin), and `mintAndSendShielded`
  sends to the wallet's own coin key (`myCoinPublicKey`). Its pre-check
  (`mintAndSendError`: no sending more than you minted) is checked against the
  real circuit on an edge grid.
- **Returning a shielded coin:** both mints book the coins they return in the
  template's coin book, and `receiveShieldedTokens`' coin field picks from it.
  Pick the one labelled "→ sent" (it's in your wallet); "→ change" and a
  mint-to-self stayed with the contract. The book is in memory, so a reload
  forgets it; the coins stay in the wallet.
- **`sendShieldedToUser` has no form.** It spends a coin the contract holds, by
  its Zswap commitment-tree index, and neither the Node test nor this UI tracks
  the contract's coins.

Private state is `memory`: the contract declares no witnesses and keeps no
secrets.

Amounts of NIGHT are in STAR (1 NIGHT = 1,000,000 STAR). `receiveNightTokens`
pays NIGHT from your wallet, so it needs NIGHT as well as DUST. On the local
devnet, `yarn fund:wallet <mn_dust_…> <mn_addr_…>` arranges both.

## TODO: end-to-end verification with Lace

Not yet run. Everything below needs a human to approve wallet prompts. What *has* been
verified is in `templates/ui/VERIFIED.md`, generated from this UI's
`verification.json`. When you run these, tick them off. Once all pass, set
`laceDeploy` and `laceCalls` to `verified` in `verification.json` (with the
date and what ran), run `yarn new:ui token-transfers --sync`, and delete this section.

Setup: `yarn env:up && yarn wait:dust` in `examples/token-transfers`, `yarn
workspace @midnight-ntwrk/example-token-transfers-ui dev`, and a Lace wallet on
`undeployed` funded with `yarn fund:wallet <mn_dust_…> <mn_addr_…>`.

- [ ] **Deploy (wallet proving):** the "Your wallet" card appears, with NIGHT
      and no custom token.
- [ ] **mintAndReceive 1000:** the returned color matches "This contract's
      custom token color"; the wallet still holds none of it.
- [ ] **sendToUser 400, Use my address:** the custom token appears in the
      wallet with 400.
- [ ] **receiveTokens 400:** Lace must add the 400 custom-token input while
      balancing; the wallet's custom token goes back to 0.
- [ ] **receiveNightTokens 5000:** Lace adds the NIGHT input; the wallet's
      NIGHT drops by 5000 STAR (fees are DUST).
- [ ] **sendNightTokensToUser 2000, Use my address:** NIGHT rises by 2000 STAR.
- [ ] **mintShieldedToSelf:** succeeds; the wallet's shielded balances don't
      change (the coin is the contract's).
- [ ] **mintAndSendShielded 500 / 300:** a shielded balance of 300 appears in
      the wallet, and receiveShieldedTokens' coin field offers the "→ sent"
      coin (value 300) and the "→ change" one (200).
- [ ] **receiveShieldedTokens with the "→ sent" coin:** Lace must spend exactly
      that coin while balancing; the shielded balance drops back and the coin
      leaves the picker.
- [ ] Repeat one unshielded and one shielded call with **local proving** (proof
      server at `http://127.0.0.1:6300`).
- [ ] **Join:** reload; the page re-joins the remembered address and the
      custom token is still labelled.

## Run

```bash
yarn workspace @midnight-ntwrk/example-token-transfers run compile   # contract first
cd examples/token-transfers && yarn env:up && yarn wait:dust            # local devnet
yarn workspace @midnight-ntwrk/example-token-transfers-ui dev           # http://localhost:5173
```

On the local devnet, give your browser wallet DUST (and NIGHT) with
`yarn fund:wallet <mn_dust_…> [mn_addr_…]`, run from anywhere in the repo. The
page prints the exact command when the connected wallet has no DUST.

## Scripts

| Script | What it does |
|---|---|
| `dev` | copies ZK assets into `public/`, then runs Vite |
| `build` | copies ZK assets, typechecks, builds to `dist/` |
| `typecheck` | `tsc -b` |
| `test:unit` | vitest (jsdom + an in-memory circuit test) |
