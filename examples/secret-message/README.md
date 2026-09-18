# Secret Message Example

The natural next step after `hello-world`. Where `hello-world` writes a message
to the chain in the clear, this contract keeps the message **private** and
publishes only its hash. The plaintext lives in the caller's private state; a
witness hands it to a circuit, which hashes it with `persistentHash` and writes
the resulting `Bytes<32>` commitment on-chain. The message itself never crosses
the privacy boundary. Because the hashing helper is `export`ed, anyone can later
verify a guessed message by re-hashing it off-chain and comparing to the
published hash — the standard shape of a hash commitment.

## Set up

Install dependencies (from the repo root — one lockfile for the whole workspace):

```bash
yarn install
```

## Compile the contract

Write your contract in `contract/secret-message.compact`, then:

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
