# ZK Loan Example

A privacy-preserving loan application. An applicant's credit profile (score,
income, tenure) stays in their private state; a registered attestation provider
signs it off-chain, and the contract verifies that Schnorr signature on the
Jubjub curve **inside the ZK proof** before applying tier rules. Only the
outcome — loan status and authorized amount — is published. Identity comes from
a secret in private state (hashed with a PIN into a rotatable user key, and
separately into an admin key), never from the wallet. Ported from
[midnightntwrk/example-zkloan](https://github.com/midnightntwrk/example-zkloan).

| Tier | Requirement | Max amount |
|---|---|---|
| 1 | score ≥ 700, income ≥ 2000, tenure ≥ 24 months | 10,000 |
| 2 | score ≥ 600, income ≥ 1500 | 7,000 |
| 3 | score ≥ 580 | 3,000 |
| — | otherwise | Rejected |

Requesting more than your tier allows creates a `Proposed` loan at the tier
maximum, which you then accept (`Approved`) or decline (`NotAccepted`) with
`respondToLoan`.

## Set up

Install dependencies (from the repo root — one lockfile for the whole workspace):

```bash
yarn install
```

## Compile the contract

The contract is `contract/zk-loan.compact`; it imports the Schnorr verifier module in `contract/schnorr.compact`.

```bash
yarn compile
```

## Run the unit tests (no network)

```bash
npx vitest run src/test/zk-loan.simulator.test.ts src/test/attestation-api
```

## Run the attestation API

`attestation-api/` is the credit provider: it Schnorr-signs a borrower's
profile, bound to a hash of their derived identity. The on-chain tests start
it in-process; to run it on its own:

```bash
yarn attestation:start            # PORT=4000, PROVIDER_ID=1, ephemeral key
PROVIDER_SECRET_KEY=<hex> yarn attestation:start   # stable key across restarts
```

| Endpoint | Purpose |
|---|---|
| `GET /provider-info` | `{ providerId, publicKey }` — what the admin passes to `registerProvider` |
| `POST /attest` | `{ creditScore, monthlyIncome, monthsAsCustomer, userPubKeyHash }` → signature |
| `GET /health` | liveness |

It is a demo signer: it trusts the figures in the request. A real provider
would source them from its own records and authenticate the caller.

## Run the UI

A browser front end (React + Lace wallet) lives in [`ui/`](ui/README.md):

```bash
yarn attestation:start      # in one terminal, from examples/zk-loan
cd ui && yarn dev           # in another
```

It targets preprod by default and needs Lace with tDUST. See `ui/README.md`.

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
