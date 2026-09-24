// This file is part of example-token-transfers.
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
import {
  type ContractAddress,
  encodeUserAddress,
  encodeCoinPublicKey,
} from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { SucceedEntirely } from '@midnight-ntwrk/midnight-js-types';
import { type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { firstValueFrom } from 'rxjs';
import pino from 'pino';

import { getConfig } from '../config.js';
import {
  MidnightWalletProvider,
  syncWallet,
} from '../wallet.js';
import { resolveWallet, waitForNightThenDust } from '@midnight-ntwrk/example-fast-sync';
import { buildProviders, type TokenTransfersProviders } from '../providers.js';
import {
  CompiledTokenTransfersContract,
  Contract,
  ledger,
  zkConfigPath,
} from '../../contract/index.js';

// Required for GraphQL subscriptions in Node.js
// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

const PRIVATE_STATE_ID = 'AliceTokenTransfersState';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';


describe(`Token Transfers Contract (${network})`, () => {
  let wallet: MidnightWalletProvider;
  let providers: TokenTransfersProviders;
  let contractAddress: ContractAddress;

  const config = getConfig();
  const isRemote = network !== 'local';
  const syncTimeoutMs = Number(
    process.env['MIDNIGHT_SYNC_TIMEOUT_MS'] ?? (isRemote ? 60 * 60_000 : 10 * 60_000),
  );

  // This contract declares no `ledger` state (`Ledger` is `{}`), so its effects
  // are observed on the token layer, not the public contract state.
  //
  // Each circuit call is first checked for on-chain acceptance
  // (`status === SucceedEntirely`): the node rejects a token transaction that
  // does not balance (wrong signatures, insufficient funds, unbalanced
  // mint/receive), so acceptance already proves the token operation was valid.
  // We then confirm the *movement* end-to-end against the test wallet's own
  // balances — the wallet is a real counterparty to every send/receive, and its
  // synced balance reflects exactly what moved. (The indexer's contract-address
  // unshielded-balance query reports deploy-time balances for a contract whose
  // latest action is a call, so it cannot confirm post-call balances.)
  void ledger;

  const toHex = (b: Uint8Array): string =>
    Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

  // The test wallet's current unshielded balance for a token type (hex color).
  async function aliceUnshielded(tokenTypeHex: string): Promise<bigint> {
    const state = await firstValueFrom(wallet.wallet.state());
    const balances = (state.unshielded.balances ?? {}) as Record<string, bigint>;
    return BigInt(balances[tokenTypeHex.toLowerCase()] ?? 0n);
  }

  // The wallet syncs from the indexer a moment after a call finalizes, so poll
  // its balance until it reaches the expected value (or time out and return the
  // last value seen, letting the caller's assertion produce a clear diff).
  async function waitForAliceUnshielded(
    tokenTypeHex: string,
    expected: bigint,
    timeoutMs = 60_000,
  ): Promise<bigint> {
    const start = Date.now();
    let last = await aliceUnshielded(tokenTypeHex);
    while (last !== expected && Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      last = await aliceUnshielded(tokenTypeHex);
    }
    return last;
  }

  // The NIGHT/native token type is the all-zero 32-byte token color.
  const NIGHT = '0'.repeat(64);

  // The test wallet's own addresses, as the { bytes } structs circuits expect.
  const aliceUserAddress = () => ({
    bytes: encodeUserAddress(wallet.unshieldedKeystore.getAddress()),
  });
  const aliceCoinPublicKey = () => ({
    bytes: encodeCoinPublicKey(wallet.getCoinPublicKey()),
  });

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
  // Everything above is generated boilerplate. Your tests begin here.
  // ---------------------------------------------------------------------------

  it('deploys the contract', async () => {
    const deployed: DeployedContract<Contract> = await (deployContract<Contract>)(providers, {
      compiledContract: CompiledTokenTransfersContract,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: {},
    });

    contractAddress = deployed.deployTxData.public.contractAddress;
    logger.info(`Contract deployed at: ${contractAddress}`);
    expect(contractAddress).toBeDefined();
    expect(contractAddress.length).toBeGreaterThan(0);
  });

  // The token color of the custom unshielded token this contract mints. It is
  // derived from a domain separator plus the contract address, so it is only
  // known once the contract is deployed; mintAndReceive returns it.
  let customColor: string;

  // ===========================================================================
  // Unshielded custom token — a full mint → send → receive round trip.
  //
  // These run in order and share the deployed contract. mintAndReceive mints a
  // contract-owned custom token; sendToUser moves some to Alice's wallet;
  // receiveTokens pulls that same value back out of Alice into the contract.
  // We assert against Alice's wallet balance for the custom token, which starts
  // at zero and returns to zero after the round trip.
  // ===========================================================================

  it('mintAndReceive mints a custom unshielded token into the contract', async () => {
    const amount = 1_000n;
    const res = await (submitCallTx<Contract, 'mintAndReceive'>)(providers, {
      compiledContract: CompiledTokenTransfersContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_ID,
      circuitId: 'mintAndReceive',
      args: [amount],
    });

    expect(res.public.status).toEqual(SucceedEntirely);
    // The circuit returns the newly minted token's color (Bytes<32>).
    const color = res.private.result;
    expect(color).toBeInstanceOf(Uint8Array);
    expect(color.length).toEqual(32);
    customColor = toHex(color);
    logger.info(`Minted custom token color: ${customColor}`);

    // The mint credits the contract, not the wallet: Alice holds none of it yet.
    expect(await aliceUnshielded(customColor)).toEqual(0n);
  });

  it('sendToUser transfers the custom token from the contract to Alice', async () => {
    const sendAmount = 400n;
    const before = await aliceUnshielded(customColor);

    const res = await (submitCallTx<Contract, 'sendToUser'>)(providers, {
      compiledContract: CompiledTokenTransfersContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_ID,
      circuitId: 'sendToUser',
      args: [sendAmount, aliceUserAddress()],
    });

    expect(res.public.status).toEqual(SucceedEntirely);
    // Alice's custom-token balance rises by the sent amount.
    const expected = before + sendAmount;
    expect(await waitForAliceUnshielded(customColor, expected)).toEqual(expected);
  });

  it('receiveTokens pulls the custom token back from Alice into the contract', async () => {
    const receiveAmount = 400n;
    const before = await aliceUnshielded(customColor);
    expect(before).toEqual(receiveAmount); // Alice holds what sendToUser gave her.

    const res = await (submitCallTx<Contract, 'receiveTokens'>)(providers, {
      compiledContract: CompiledTokenTransfersContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_ID,
      circuitId: 'receiveTokens',
      args: [receiveAmount],
    });

    expect(res.public.status).toEqual(SucceedEntirely);
    // Alice's custom-token balance falls back to where it started.
    const expected = before - receiveAmount;
    expect(await waitForAliceUnshielded(customColor, expected)).toEqual(expected);
  });

  // ===========================================================================
  // Unshielded NIGHT (the native token) — receive from Alice, then send back.
  // Fees are paid in DUST, so Alice's NIGHT balance moves only by the transfer
  // amounts.
  // ===========================================================================

  it('receiveNightTokens pulls NIGHT into the contract', async () => {
    const amount = 5_000n;
    const before = await aliceUnshielded(NIGHT);

    const res = await (submitCallTx<Contract, 'receiveNightTokens'>)(providers, {
      compiledContract: CompiledTokenTransfersContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_ID,
      circuitId: 'receiveNightTokens',
      args: [amount],
    });

    expect(res.public.status).toEqual(SucceedEntirely);
    // NIGHT leaves Alice's wallet for the contract.
    const expected = before - amount;
    expect(await waitForAliceUnshielded(NIGHT, expected)).toEqual(expected);
  });

  it('sendNightTokensToUser sends NIGHT from the contract to Alice', async () => {
    const sendAmount = 2_000n;
    const before = await aliceUnshielded(NIGHT);

    const res = await (submitCallTx<Contract, 'sendNightTokensToUser'>)(providers, {
      compiledContract: CompiledTokenTransfersContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_ID,
      circuitId: 'sendNightTokensToUser',
      args: [sendAmount, aliceUserAddress()],
    });

    expect(res.public.status).toEqual(SucceedEntirely);
    // NIGHT returns from the contract to Alice's wallet.
    const expected = before + sendAmount;
    expect(await waitForAliceUnshielded(NIGHT, expected)).toEqual(expected);
  });

  // ===========================================================================
  // Shielded tokens — verified through circuit return values and tx status,
  // since shielded balances are not exposed on the public contract state.
  // ===========================================================================

  it('mintShieldedToSelf mints a shielded coin to the contract', async () => {
    const domainSep = new Uint8Array(32).fill(7);
    const nonce = new Uint8Array(32).fill(9);
    const value = 250n;

    const res = await (submitCallTx<Contract, 'mintShieldedToSelf'>)(providers, {
      compiledContract: CompiledTokenTransfersContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_ID,
      circuitId: 'mintShieldedToSelf',
      args: [domainSep, value, nonce],
    });

    expect(res.public.status).toEqual(SucceedEntirely);
    // Returns the freshly minted ShieldedCoinInfo { nonce, color, value }.
    const coin = res.private.result;
    expect(coin.value).toEqual(value);
    expect(coin.color).toBeInstanceOf(Uint8Array);
    expect(coin.nonce).toBeInstanceOf(Uint8Array);
    logger.info(`Minted shielded coin color: ${toHex(coin.color)} value: ${coin.value}`);
  });

  // The shielded coin mintAndSendShielded sends to Alice; reused by
  // receiveShieldedTokens below to pull it back into the contract.
  let sentShieldedCoin: { nonce: Uint8Array; color: Uint8Array; value: bigint };

  it('mintAndSendShielded mints a shielded coin and sends it to Alice', async () => {
    const domainSep = new Uint8Array(32).fill(3);
    const mintNonce = new Uint8Array(32).fill(5);
    const mintValue = 500n;
    const sendValue = 300n;

    const res = await (submitCallTx<Contract, 'mintAndSendShielded'>)(providers, {
      compiledContract: CompiledTokenTransfersContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_ID,
      circuitId: 'mintAndSendShielded',
      args: [domainSep, mintValue, mintNonce, aliceCoinPublicKey(), sendValue],
    });

    expect(res.public.status).toEqual(SucceedEntirely);
    // ShieldedSendResult { change, sent }: `sent` is the coin Alice receives,
    // `change` is the remainder returned to the contract.
    const result = res.private.result;
    expect(result.sent.value).toEqual(sendValue);
    expect(result.change.is_some).toEqual(true);
    expect(result.change.value.value).toEqual(mintValue - sendValue);
    sentShieldedCoin = result.sent;
    logger.info(`Sent shielded coin to Alice; value: ${result.sent.value}`);
  });

  it('receiveShieldedTokens pulls the shielded coin back from Alice', async () => {
    // Feed back the exact coin Alice received above; the contract receives it.
    const res = await (submitCallTx<Contract, 'receiveShieldedTokens'>)(providers, {
      compiledContract: CompiledTokenTransfersContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_ID,
      circuitId: 'receiveShieldedTokens',
      args: [sentShieldedCoin],
    });

    expect(res.public.status).toEqual(SucceedEntirely);
  });

  // sendShieldedToUser is intentionally not exercised here. It requires a
  // QualifiedShieldedCoinInfo — a shielded coin the contract already holds,
  // together with its Merkle-tree index in the on-chain Zswap commitment tree.
  // Obtaining that index for a contract-held coin needs Zswap-state bookkeeping
  // beyond this single-wallet harness; mintAndSendShielded already covers
  // sendShielded for a freshly minted coin (mt_index 0).
  it.skip('sendShieldedToUser (requires a contract-held qualified shielded coin)', () => {});
});
