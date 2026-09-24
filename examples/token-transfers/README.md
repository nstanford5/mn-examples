# Token Transfers Example

A Compact contract that exercises Midnight's token primitives end to end —
minting, sending, and receiving across all three token flavors: contract-domain
**unshielded** tokens (color derived from a domain separator), the native
**NIGHT** token, and **shielded** (zswap) coins. Each circuit is a small, focused
example of one operation rather than a full application.

## Set up

Install dependencies (from the repo root — one lockfile for the whole workspace):

```bash
yarn install
```

## Compile the contract

Write your contract in `contract/token-transfers.compact`, then:

```bash
yarn compile
```

## Start the local Midnight network

Ensure the Docker engine is running, then:

```bash
yarn env:up
```

## Run the test suite

```bash
yarn wait:dust     # wait until the dev wallet has spendable DUST for fees
yarn test:local
```

Tear the network down when finished:

```bash
yarn env:down
```

This example is set up for a local devnet running via Docker.

To run it against **preprod** or **preview** instead, see
[FAST-SYNC.md](../../FAST-SYNC.md) at the repo root. In short: start a local proof
server (`yarn proof:up`), then from the repo root run `yarn preseed:cut` followed
by `yarn wallets:new`, fund the printed addresses at the faucet, and run
`yarn test:preprod`. The wallet seeds live in one repo-root `.env.<network>` that
every example shares.
