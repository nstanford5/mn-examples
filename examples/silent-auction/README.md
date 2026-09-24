# Silent Auction Example

A "silent" auction for a single NFT. The organizer commits to a secret reserve
(minimum) price that stays hidden from bidders until bidding closes — while the
bids themselves and the current high bid are public. It combines a
**commit-reveal** scheme (`persistentCommit`) with a ledger **state machine**
(`RECEIVE → OPEN → CLOSED → PAID`), organizer/bidder access control derived from
a witness secret, and **unshielded token** flows: a NIGHT deposit that
incentivizes the organizer to finish, minting the auctioned NFT, and paying out
the winner and organizer at settlement.

## Set up

Install dependencies (from the repo root — one lockfile for the whole workspace):

```bash
yarn install
```

## Compile the contract

Write your contract in `contract/silent-auction.compact`, then:

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
