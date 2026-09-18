// This file is part of example-secret-message.
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

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  deployContract,
  submitCallTx,
  type DeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import pino from 'pino';

import { getConfig } from '../config.js';
import {
  MidnightWalletProvider,
  syncWallet,
  type WalletSecret,
} from '../wallet.js';
import { buildProviders, type SecretMessageProviders } from '../providers.js';
import {
  createSecretMessagePrivateState,
  encodeMessage,
} from '../../contract/witnesses.js';
import {
  CompiledSecretMessageContract,
  Contract,
  ledger,
  pureCircuits,
  zkConfigPath,
} from '../../contract/index.js';

// Required for GraphQL subscriptions in Node.js
// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

const ALICE_LOCAL_SEED =
  '0000000000000000000000000000000000000000000000000000000000000001';
const PRIVATE_STATE_ID = 'AliceSecretMessageState';

// Alice's secret. It lives in private state and is never sent on-chain — only its
// hash is published. Anyone who later guesses this text can recompute the hash
// (via `pureCircuits.hashMessage`) and confirm the match, but the ledger alone
// never reveals it.
const SECRET_MESSAGE = 'meet me at midnight';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';

// Local uses the pre-funded devnet seed. For a remote network, supply a funded
// wallet seed via .env.<network> (e.g. MIDNIGHT_PREVIEW_SEED).
function resolveSecret(net: string): WalletSecret {
  if (net === 'local') return { kind: 'seed', value: ALICE_LOCAL_SEED };
  const seed = process.env[`MIDNIGHT_${net.toUpperCase()}_SEED`]?.trim();
  if (!seed) {
    throw new Error(
      `Set MIDNIGHT_${net.toUpperCase()}_SEED in .env.${net} to run against '${net}'.`,
    );
  }
  return { kind: 'seed', value: seed };
}

describe(`Secret Message Contract (${network})`, () => {
  let wallet: MidnightWalletProvider;
  let providers: SecretMessageProviders;
  let contractAddress: ContractAddress;

  const config = getConfig();
  const isRemote = network !== 'local';
  const syncTimeoutMs = Number(
    process.env['MIDNIGHT_SYNC_TIMEOUT_MS'] ?? (isRemote ? 60 * 60_000 : 10 * 60_000),
  );

  // Reads the contract's public ledger state. Adapt the returned fields to your
  // own `ledger` declaration.
  async function queryLedger() {
    const state = await providers.publicDataProvider.queryContractState(contractAddress);
    expect(state).not.toBeNull();
    return ledger(state!.data);
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

    wallet = await MidnightWalletProvider.build(logger, envConfig, resolveSecret(network));
    await wallet.start();
    await syncWallet(logger, wallet.wallet, syncTimeoutMs);

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
  // Everything above is generated boilerplate. Your tests begin here.
  // ---------------------------------------------------------------------------

  it('deploys the contract', async () => {
    const deployed: DeployedContract<Contract> = await (deployContract<Contract>)(providers, {
      compiledContract: CompiledSecretMessageContract,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: createSecretMessagePrivateState(SECRET_MESSAGE),
    });

    contractAddress = deployed.deployTxData.public.contractAddress;
    logger.info(`Contract deployed at: ${contractAddress}`);
    expect(contractAddress).toBeDefined();
    expect(contractAddress.length).toBeGreaterThan(0);
  });

  it('publishes the hash of the secret, not the secret itself', async () => {
    await (submitCallTx<Contract, 'publishMessageHash'>)(providers, {
      compiledContract: CompiledSecretMessageContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_ID,
      circuitId: 'publishMessageHash',
    });

    const state = await queryLedger();

    // The on-chain value is the persistent hash of the secret. We recompute the
    // expected hash off-chain from the plaintext, exactly as a verifier would.
    const expectedHash = pureCircuits.hashMessage(encodeMessage(SECRET_MESSAGE));
    expect(state.messageHash).toEqual(expectedHash);
    expect(state.messageHash).toHaveLength(32);

    // The plaintext (its byte encoding) is never what lands on-chain.
    expect(state.messageHash).not.toEqual(encodeMessage(SECRET_MESSAGE));
  });

  it('lets a verifier reject a wrong guess by re-hashing', async () => {
    const state = await queryLedger();

    // A wrong guess hashes to a different value, so it fails the comparison…
    const wrongGuess = pureCircuits.hashMessage(encodeMessage('open sesame'));
    expect(state.messageHash).not.toEqual(wrongGuess);

    // …while the correct message reproduces the published hash.
    const correctGuess = pureCircuits.hashMessage(encodeMessage(SECRET_MESSAGE));
    expect(state.messageHash).toEqual(correctGuess);
  });
});
