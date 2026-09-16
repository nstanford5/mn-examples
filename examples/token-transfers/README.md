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

This example is set up for a local devnet running via Docker. Configurations for
other networks live in `src/config.ts`; supply a funded wallet seed via
`.env.<network>` to run against them.
