# Calculator Example

A minimal Compact contract that keeps a single public `result` on-chain and
updates it with basic arithmetic circuits. It is a small step up from
`hello-world`: still easy to read, but it introduces a **witness** and the
verify-off-chain-work pattern.

This example demonstrates:

- A public `ledger` value (`result: Uint<16>`) updated by exported circuits.
- Simple arithmetic circuits: `add`, `subtract`, `multiply`, `square`.
- The **verify-off-chain-work pattern**: `divide` calls the `divMod` witness
  (integer division computed off-chain in TypeScript), re-checks it on-chain
  with `assert(rem < num2 && quo * num2 + rem == num1)`, then stores the
  quotient. The heavy lifting happens off-chain; the circuit only verifies it.

## Set up project

Install dependencies (from the repo root, one lockfile for the whole workspace):

```bash
yarn install
```

## Compile the contract

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

This repository is currently only set up to support a local devnet running via
Docker. Configurations for other networks are stubbed in `src/config.ts` and can
be enabled by supplying a funded wallet seed via `.env.<network>`.
