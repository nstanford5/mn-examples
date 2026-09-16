# AGENTS.md — private-party

**Verified against:** Compact language `0.23`, compiler `0.31.1`,
`@midnight-ntwrk/midnight-js-*` `4.1.1`, wallet SDK `1.2.0`, Node 22.

## What it teaches

- **Private data on chain** — keeping participant data private while proving
  facts about it.
- **Access control** on circuits.
- **Unshielded tokens (NIGHT)**.
- **DUST fee sponsorship** — a sponsor pays transaction fees on behalf of a
  user. See `docs/SPONSORSHIP.md`, `src/sponsor.ts`,
  `scripts/sponsor-service.ts`, and `src/test/sponsorship.test.ts`.

## Layout

- `contract/private-party.compact` (committed), `contract/index.ts`,
  `contract/witnesses.ts`.
- `src/` harness incl. `sponsor.ts`; tests `test/party.test.ts`,
  `test/sponsorship.test.ts`.

## Run

```bash
yarn compile
yarn env:up && yarn wait:dust
yarn test:local            # full suite
yarn test:sponsorship      # sponsorship flow only
yarn env:down
```

## Notes for agents

- The `.compact` source is committed (upstream gitignored it — fixed here).
- `contract/managed/` is generated and gitignored.
