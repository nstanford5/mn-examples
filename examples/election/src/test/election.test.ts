// This file is part of example-election.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * End-to-end suite for the election contract, driven through midnight-js against
 * a running network. It walks a single election from deployment to a declared
 * winner and asserts the on-chain ledger at every step.
 *
 * There is one organizer and three voters, but only a single wallet. Each
 * participant's on-chain identity is derived *inside the circuit* from the `sk`
 * held in their private state (see contract/witnesses.ts), never from the
 * wallet — so one wallet can act as every identity simply by swapping which
 * private state it presents for a call. That is why, unlike the token examples,
 * this suite does not need multiple funded seeds.
 *
 * Candidate 0 corresponds to a `VoteChoice.BAD` vote and candidate 1 to
 * `VoteChoice.WORSE` (the contract's enum names, not a judgement on the
 * candidates). In this run candidate 1 wins two votes to one.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  deployContract,
  submitCallTx,
  type DeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { SucceedEntirely } from '@midnight-ntwrk/midnight-js-types';
import { type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import pino from 'pino';

import { getConfig } from '../config.js';
import {
  MidnightWalletProvider,
  syncWallet,
} from '../wallet.js';
import { resolveWallet, waitForNightThenDust } from '@midnight-ntwrk/example-fast-sync';
import { buildProviders, type ElectionProviders } from '../providers.js';
import {
  createElectionPrivateState,
  type ElectionPrivateState,
} from '../../contract/witnesses.js';
import {
  CompiledElectionContract,
  Contract,
  ledger,
  zkConfigPath,
} from '../../contract/index.js';
import {
  VoteChoice,
  VotingState,
} from '../../contract/managed/election/contract/index.js';

// Required for GraphQL subscriptions in Node.js
// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;


// Every participant stores their private state under a distinct id, keyed to the
// deployed contract. The witnesses read whichever id a given call names.
const PRIVATE_STATE_IDS = {
  ORGANIZER: 'organizerElectionState',
  VOTER_ONE: 'voterOneElectionState',
  VOTER_TWO: 'voterTwoElectionState',
  VOTER_THREE: 'voterThreeElectionState',
  // Same sk as voter one but a different vote — used to prove the commitment
  // binds a voter to the vote they committed.
  VOTER_ONE_TAMPERED: 'voterOneTamperedElectionState',
  // A never-registered voter, used to prove registration closes once voting opens.
  VOTER_UNREGISTERED: 'voterUnregisteredElectionState',
} as const;

const CANDIDATE_0 = 'Ada';
const CANDIDATE_1 = 'Grace';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';


describe(`Election Contract (${network})`, () => {
  let wallet: MidnightWalletProvider;
  let providers: ElectionProviders;
  let contractAddress: ContractAddress;

  const config = getConfig();
  const isRemote = network !== 'local';
  const syncTimeoutMs = Number(
    process.env['MIDNIGHT_SYNC_TIMEOUT_MS'] ?? (isRemote ? 60 * 60_000 : 10 * 60_000),
  );

  // The organizer's identity comes from its own sk; the vote it carries is never
  // used. Each voter has a distinct sk and the vote it will commit to.
  const organizerState: ElectionPrivateState = createElectionPrivateState(
    randomBytes(32),
    VoteChoice.BAD,
  );
  const voterOneState: ElectionPrivateState = createElectionPrivateState(
    randomBytes(32),
    VoteChoice.BAD,
  );
  const voterTwoState: ElectionPrivateState = createElectionPrivateState(
    randomBytes(32),
    VoteChoice.WORSE,
  );
  const voterThreeState: ElectionPrivateState = createElectionPrivateState(
    randomBytes(32),
    VoteChoice.WORSE,
  );
  // Voter one's sk, but voting the other way — a would-be vote-changer.
  const voterOneTamperedState: ElectionPrivateState = createElectionPrivateState(
    voterOneState.sk,
    VoteChoice.WORSE,
  );
  // Never registered.
  const voterUnregisteredState: ElectionPrivateState = createElectionPrivateState(
    randomBytes(32),
    VoteChoice.BAD,
  );

  // Reads the contract's public ledger state.
  async function queryLedger() {
    const state = await providers.publicDataProvider.queryContractState(contractAddress);
    expect(state).not.toBeNull();
    return ledger(state!.data);
  }

  // Store a participant's private state so the witnesses can present it, keyed to
  // the deployed contract.
  async function setPrivateState(id: string, state: ElectionPrivateState): Promise<void> {
    providers.privateStateProvider.setContractAddress(contractAddress);
    await providers.privateStateProvider.set(id, state);
  }

  beforeAll(async () => {
    setNetworkId(config.networkId);

    const envConfig: EnvironmentConfiguration = {
      walletNetworkId: config.networkId,
      networkId: config.networkId,
      indexer: config.indexer,
      indexerWS: config.indexerWS,
      node: config.node,
      nodeWS: config.nodeWS,
      faucet: config.faucet,
      proofServer: config.proofServer,
    };

    // Alice, fast-syncing from the shipped reference bundle when the root
    // .env.<network> records a birthday for her. See FAST-SYNC.md.
    const setup = resolveWallet(network);
    wallet = await MidnightWalletProvider.build(logger, envConfig, setup.secret, {
      fastSync: setup.fastSync,
    });
    await wallet.start();
    await syncWallet(logger, wallet.wallet, syncTimeoutMs);

    if (isRemote) {
      // Synced is not funded: a wallet with no DUST fails its first submit.
      await waitForNightThenDust(
        logger,
        wallet.wallet,
        wallet.unshieldedKeystore,
        envConfig,
        config.faucet,
        { label: setup.role },
      );
    }

    providers = buildProviders(wallet, zkConfigPath, config);
    logger.info(`Providers initialized on '${network}'. Ready to test!`);
  });

  afterAll(async () => {
    if (wallet) {
      logger.info('Stopping wallet...');
      await wallet.stop();
    }
  });

  // ---------------------------------------------------------------------------
  // Deployment — the organizer runs the constructor, which records their pubkey
  // (derived from sk), the two candidates, and opens registration (CLOSED).
  // ---------------------------------------------------------------------------

  it('deploys the contract with voting closed (organizer)', async () => {
    const deployed: DeployedContract<Contract> = await (deployContract<Contract>)(providers, {
      compiledContract: CompiledElectionContract,
      privateStateId: PRIVATE_STATE_IDS.ORGANIZER,
      // The constructor invokes localSk(): deploy as the organizer.
      initialPrivateState: organizerState,
      args: [CANDIDATE_0, CANDIDATE_1],
    });

    contractAddress = deployed.deployTxData.public.contractAddress;
    logger.info(`Contract deployed at: ${contractAddress}`);
    expect(contractAddress).toBeDefined();
    expect(contractAddress.length).toBeGreaterThan(0);

    // Make every participant's private state available for the calls below.
    await setPrivateState(PRIVATE_STATE_IDS.ORGANIZER, organizerState);
    await setPrivateState(PRIVATE_STATE_IDS.VOTER_ONE, voterOneState);
    await setPrivateState(PRIVATE_STATE_IDS.VOTER_TWO, voterTwoState);
    await setPrivateState(PRIVATE_STATE_IDS.VOTER_THREE, voterThreeState);
    await setPrivateState(PRIVATE_STATE_IDS.VOTER_ONE_TAMPERED, voterOneTamperedState);
    await setPrivateState(PRIVATE_STATE_IDS.VOTER_UNREGISTERED, voterUnregisteredState);

    const state = await queryLedger();
    expect(state.votingState).toEqual(VotingState.CLOSED);
    expect(state.candidate0).toEqual(CANDIDATE_0);
    expect(state.candidate1).toEqual(CANDIDATE_1);
    expect(state.organizer).toBeInstanceOf(Uint8Array);
    expect(state.registeredVoters.isEmpty()).toBe(true);
    expect(state.hashedVoteMap.isEmpty()).toBe(true);
    expect(state.totalVoteCount).toEqual(0n);
    expect(state.candidate0VoteCounter).toEqual(0n);
    expect(state.candidate1VoteCounter).toEqual(0n);
  });

  // ---------------------------------------------------------------------------
  // registerToVote — anyone, while voting is CLOSED, once per identity.
  // ---------------------------------------------------------------------------

  it('registers three voters', async () => {
    for (const id of [
      PRIVATE_STATE_IDS.VOTER_ONE,
      PRIVATE_STATE_IDS.VOTER_TWO,
      PRIVATE_STATE_IDS.VOTER_THREE,
    ]) {
      const res = await (submitCallTx<Contract, 'registerToVote'>)(providers, {
        compiledContract: CompiledElectionContract,
        contractAddress,
        privateStateId: id,
        circuitId: 'registerToVote',
      });
      expect(res.public.status).toEqual(SucceedEntirely);
    }

    const state = await queryLedger();
    expect(state.registeredVoters.size()).toEqual(3n);
  });

  it('rejects a duplicate registration', async () => {
    await expect(
      (submitCallTx<Contract, 'registerToVote'>)(providers, {
        compiledContract: CompiledElectionContract,
        contractAddress,
        privateStateId: PRIVATE_STATE_IDS.VOTER_ONE,
        circuitId: 'registerToVote',
      }),
    ).rejects.toThrow();

    expect((await queryLedger()).registeredVoters.size()).toEqual(3n);
  });

  // ---------------------------------------------------------------------------
  // openVoting — organizer-only, while CLOSED, with at least one voter.
  // ---------------------------------------------------------------------------

  it('rejects openVoting from a non-organizer', async () => {
    await expect(
      (submitCallTx<Contract, 'openVoting'>)(providers, {
        compiledContract: CompiledElectionContract,
        contractAddress,
        privateStateId: PRIVATE_STATE_IDS.VOTER_ONE,
        circuitId: 'openVoting',
      }),
    ).rejects.toThrow();

    expect((await queryLedger()).votingState).toEqual(VotingState.CLOSED);
  });

  it('rejects committing a vote before voting opens', async () => {
    await expect(
      (submitCallTx<Contract, 'commitVote'>)(providers, {
        compiledContract: CompiledElectionContract,
        contractAddress,
        privateStateId: PRIVATE_STATE_IDS.VOTER_ONE,
        circuitId: 'commitVote',
      }),
    ).rejects.toThrow();

    expect((await queryLedger()).totalVoteCount).toEqual(0n);
  });

  it('lets the organizer open voting (CLOSED -> OPEN)', async () => {
    const res = await (submitCallTx<Contract, 'openVoting'>)(providers, {
      compiledContract: CompiledElectionContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_IDS.ORGANIZER,
      circuitId: 'openVoting',
    });
    expect(res.public.status).toEqual(SucceedEntirely);

    expect((await queryLedger()).votingState).toEqual(VotingState.OPEN);
  });

  it('rejects registering once voting has opened', async () => {
    await expect(
      (submitCallTx<Contract, 'registerToVote'>)(providers, {
        compiledContract: CompiledElectionContract,
        contractAddress,
        privateStateId: PRIVATE_STATE_IDS.VOTER_UNREGISTERED,
        circuitId: 'registerToVote',
      }),
    ).rejects.toThrow();

    expect((await queryLedger()).registeredVoters.size()).toEqual(3n);
  });

  // ---------------------------------------------------------------------------
  // commitVote — registered voters only, while OPEN, once each, BAD or WORSE.
  // ---------------------------------------------------------------------------

  it('rejects an invalid vote (TIE is not a real choice)', async () => {
    // Reuse voter one's identity but present TIE, which commitVote must refuse.
    const tieId = 'voterOneTieElectionState';
    await setPrivateState(tieId, createElectionPrivateState(voterOneState.sk, VoteChoice.TIE));

    await expect(
      (submitCallTx<Contract, 'commitVote'>)(providers, {
        compiledContract: CompiledElectionContract,
        contractAddress,
        privateStateId: tieId,
        circuitId: 'commitVote',
      }),
    ).rejects.toThrow();

    expect((await queryLedger()).totalVoteCount).toEqual(0n);
  });

  it('records a vote from voter one (BAD)', async () => {
    const res = await (submitCallTx<Contract, 'commitVote'>)(providers, {
      compiledContract: CompiledElectionContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_IDS.VOTER_ONE,
      circuitId: 'commitVote',
    });
    expect(res.public.status).toEqual(SucceedEntirely);

    const state = await queryLedger();
    expect(state.totalVoteCount).toEqual(1n);
    expect(state.hashedVoteMap.size()).toEqual(1n);
    // Tallies stay at zero until votes are revealed.
    expect(state.candidate0VoteCounter).toEqual(0n);
    expect(state.candidate1VoteCounter).toEqual(0n);
  });

  it('records votes from voter two and voter three (both WORSE)', async () => {
    for (const id of [PRIVATE_STATE_IDS.VOTER_TWO, PRIVATE_STATE_IDS.VOTER_THREE]) {
      const res = await (submitCallTx<Contract, 'commitVote'>)(providers, {
        compiledContract: CompiledElectionContract,
        contractAddress,
        privateStateId: id,
        circuitId: 'commitVote',
      });
      expect(res.public.status).toEqual(SucceedEntirely);
    }

    const state = await queryLedger();
    expect(state.totalVoteCount).toEqual(3n);
    expect(state.hashedVoteMap.size()).toEqual(3n);
  });

  it('rejects a double vote', async () => {
    await expect(
      (submitCallTx<Contract, 'commitVote'>)(providers, {
        compiledContract: CompiledElectionContract,
        contractAddress,
        privateStateId: PRIVATE_STATE_IDS.VOTER_ONE,
        circuitId: 'commitVote',
      }),
    ).rejects.toThrow();

    expect((await queryLedger()).totalVoteCount).toEqual(3n);
  });

  // ---------------------------------------------------------------------------
  // revealVote — after voting closes, each voter re-opens their commitment and
  // the matching candidate's tally is incremented.
  // ---------------------------------------------------------------------------

  it('rejects revealing a vote while voting is still open', async () => {
    await expect(
      (submitCallTx<Contract, 'revealVote'>)(providers, {
        compiledContract: CompiledElectionContract,
        contractAddress,
        privateStateId: PRIVATE_STATE_IDS.VOTER_ONE,
        circuitId: 'revealVote',
      }),
    ).rejects.toThrow();

    expect((await queryLedger()).candidate0VoteCounter).toEqual(0n);
  });

  it('rejects closeVoting from a non-organizer', async () => {
    await expect(
      (submitCallTx<Contract, 'closeVoting'>)(providers, {
        compiledContract: CompiledElectionContract,
        contractAddress,
        privateStateId: PRIVATE_STATE_IDS.VOTER_ONE,
        circuitId: 'closeVoting',
      }),
    ).rejects.toThrow();

    expect((await queryLedger()).votingState).toEqual(VotingState.OPEN);
  });

  it('lets the organizer close voting (OPEN -> CLOSED)', async () => {
    const res = await (submitCallTx<Contract, 'closeVoting'>)(providers, {
      compiledContract: CompiledElectionContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_IDS.ORGANIZER,
      circuitId: 'closeVoting',
    });
    expect(res.public.status).toEqual(SucceedEntirely);

    expect((await queryLedger()).votingState).toEqual(VotingState.CLOSED);
  });

  it('rejects revealing a vote that differs from the commitment', async () => {
    // Voter one committed BAD; presenting WORSE fails the commitment check.
    await expect(
      (submitCallTx<Contract, 'revealVote'>)(providers, {
        compiledContract: CompiledElectionContract,
        contractAddress,
        privateStateId: PRIVATE_STATE_IDS.VOTER_ONE_TAMPERED,
        circuitId: 'revealVote',
      }),
    ).rejects.toThrow();

    const state = await queryLedger();
    expect(state.candidate0VoteCounter).toEqual(0n);
    expect(state.candidate1VoteCounter).toEqual(0n);
  });

  it('reveals every vote and tallies them (candidate 1 wins 2-1)', async () => {
    // Voter one -> BAD (candidate 0); voters two and three -> WORSE (candidate 1).
    for (const id of [
      PRIVATE_STATE_IDS.VOTER_ONE,
      PRIVATE_STATE_IDS.VOTER_TWO,
      PRIVATE_STATE_IDS.VOTER_THREE,
    ]) {
      const res = await (submitCallTx<Contract, 'revealVote'>)(providers, {
        compiledContract: CompiledElectionContract,
        contractAddress,
        privateStateId: id,
        circuitId: 'revealVote',
      });
      expect(res.public.status).toEqual(SucceedEntirely);
    }

    const state = await queryLedger();
    expect(state.candidate0VoteCounter).toEqual(1n);
    expect(state.candidate1VoteCounter).toEqual(2n);
  });

  it('rejects revealing a second time (no double counting)', async () => {
    // Voter one already revealed above; the revealedVoters guard must refuse a
    // repeat so the tally cannot be inflated.
    await expect(
      (submitCallTx<Contract, 'revealVote'>)(providers, {
        compiledContract: CompiledElectionContract,
        contractAddress,
        privateStateId: PRIVATE_STATE_IDS.VOTER_ONE,
        circuitId: 'revealVote',
      }),
    ).rejects.toThrow();

    const state = await queryLedger();
    expect(state.candidate0VoteCounter).toEqual(1n);
    expect(state.candidate1VoteCounter).toEqual(2n);
  });

  // ---------------------------------------------------------------------------
  // checkWinner — organizer-only, after voting closes, records the winner.
  // ---------------------------------------------------------------------------

  it('rejects checkWinner from a non-organizer', async () => {
    await expect(
      (submitCallTx<Contract, 'checkWinner'>)(providers, {
        compiledContract: CompiledElectionContract,
        contractAddress,
        privateStateId: PRIVATE_STATE_IDS.VOTER_ONE,
        circuitId: 'checkWinner',
      }),
    ).rejects.toThrow();

    // `winner` still holds its default (the first enum member) until the
    // organizer runs checkWinner.
    expect((await queryLedger()).winner).toEqual(VoteChoice.BAD);
  });

  it('lets the organizer declare the winner (candidate 1 / WORSE)', async () => {
    const res = await (submitCallTx<Contract, 'checkWinner'>)(providers, {
      compiledContract: CompiledElectionContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_IDS.ORGANIZER,
      circuitId: 'checkWinner',
    });
    expect(res.public.status).toEqual(SucceedEntirely);

    const state = await queryLedger();
    expect(state.winner).toEqual(VoteChoice.WORSE);
    expect(state.candidate1VoteCounter).toBeGreaterThan(state.candidate0VoteCounter);
  });
});
