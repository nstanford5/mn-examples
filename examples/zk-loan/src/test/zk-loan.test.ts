// This file is part of example-zk-loan.
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
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  deployContract,
  submitCallTx,
  type DeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import {
  type ContractAddress,
  CompactTypeBytes,
  transientHash,
} from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { resolveWallet, waitForNightThenDust } from '@midnight-ntwrk/example-fast-sync';
import pino from 'pino';

import { getConfig } from '../config.js';
import { MidnightWalletProvider, syncWallet } from '../wallet.js';
import { buildProviders, type ZkLoanCircuits, type ZkLoanProviders } from '../providers.js';
import { createZkLoanPrivateState, type ZkLoanPrivateState } from '../../contract/witnesses.js';
import {
  CompiledZkLoanContract,
  Contract,
  LoanStatus,
  ledger,
  pureCircuits,
  zkConfigPath,
} from '../../contract/index.js';
import type restify from 'restify';
import { createServer } from '../../attestation-api/server.js';
import { generateKeyPair } from '../../attestation-api/signing.js';
import type { AttestationResponse, ProviderInfoResponse } from '../../attestation-api/types.js';

// Required for GraphQL subscriptions in Node.js
// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

// Both parties share ONE wallet (it only pays fees). Their contract identities
// live in separate private states, each holding its own 32-byte userSecretKey —
// which is the point: in this contract identity comes from the witness secret,
// not from the wallet that submits the transaction.
const ALICE_STATE_ID = 'AliceZkLoanState'; // deployer => admin, and a borrower
const BOB_STATE_ID = 'BobZkLoanState'; // a second borrower, not admin

const PROVIDER_ID = 1n; // the id the attestation API is started with
const ALICE_PIN = 1234n;
const ALICE_NEW_PIN = 5678n;
const BOB_PIN = 4321n;

const bytes32 = new CompactTypeBytes(32);

// Circuit id -> its argument tuple, read off the generated contract types.
type ZkLoanCircuitId = ZkLoanCircuits;
type CircuitArgs<K extends ZkLoanCircuitId> = Parameters<
  Contract<ZkLoanPrivateState>['impureCircuits'][K]
> extends [unknown, ...infer A]
  ? A
  : never;

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';

describe(`Zk Loan Contract (${network})`, () => {
  let wallet: MidnightWalletProvider;
  let providers: ZkLoanProviders;
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

    // Locally this is the genesis-funded Alice seed. On a remote network it is
    // the shared Alice wallet from the repo-root .env.<network>, fast-syncing
    // from the reference bundle when a birthday is recorded. Pass a role name
    // (e.g. resolveWallet(network, 'BOB')) if your suite needs more than one.
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

    // Fresh ephemeral provider key per run, like `yarn attestation:start`
    // without PROVIDER_SECRET_KEY.
    attestationServer = createServer(generateKeyPair().sk, Number(PROVIDER_ID));
    await new Promise<void>((resolve) => attestationServer.listen(0, '127.0.0.1', resolve));
    const addr = attestationServer.address();
    attestationUrl = `http://127.0.0.1:${typeof addr === 'string' ? addr : addr.port}`;
    logger.info(`Attestation API at ${attestationUrl}`);

    logger.info(`Providers initialized on '${network}'. Ready to test!`);
  });

  afterAll(async () => {
    if (attestationServer) {
      await new Promise<void>((resolve) => attestationServer.close(() => resolve()));
    }
    if (wallet) {
      logger.info('Stopping wallet...');
      await wallet.stop();
    }
  });

  // ---------------------------------------------------------------------------
  // Everything above is generated boilerplate. Your tests begin here.
  // ---------------------------------------------------------------------------

  // The attestation provider: the real attestation API (attestation-api/),
  // started in-process on an ephemeral port. The admin registers the public key
  // it reports; borrowers ask it to sign their profile and keep the signature
  // in private state.
  let attestationServer: restify.Server;
  let attestationUrl: string;
  const aliceSecret = new Uint8Array(randomBytes(32));
  const bobSecret = new Uint8Array(randomBytes(32));

  // Off-chain mirror of `deriveUserPublicKey` — the same pure circuit, so the
  // bytes match what the contract computes in-circuit.
  const userPk = (secret: Uint8Array, pin: bigint): Uint8Array =>
    pureCircuits.deriveUserPublicKey(secret, pin);

  // Ask the attestation API to sign a profile bound to (secret, pin), and build
  // the private state the witnesses will present. Only the HASH of the derived
  // user key is sent — the provider never sees the secret or the PIN. The
  // signature covers transientHash(userPk), exactly as `requestLoan` binds it.
  async function attestedState(
    secret: Uint8Array,
    pin: bigint,
    creditScore: number,
    monthlyIncome: number,
    monthsAsCustomer: number,
  ): Promise<ZkLoanPrivateState> {
    const userPubKeyHash = transientHash(bytes32, userPk(secret, pin));
    const res = await fetch(`${attestationUrl}/attest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creditScore,
        monthlyIncome,
        monthsAsCustomer,
        userPubKeyHash: userPubKeyHash.toString(),
      }),
    });
    expect(res.status).toBe(200);
    const { signature } = (await res.json()) as AttestationResponse;
    return {
      creditScore: BigInt(creditScore),
      monthlyIncome: BigInt(monthlyIncome),
      monthsAsCustomer: BigInt(monthsAsCustomer),
      // JSON carries bigints as decimal strings.
      attestationSignature: {
        announcement: { x: BigInt(signature.announcement.x), y: BigInt(signature.announcement.y) },
        response: BigInt(signature.response),
      },
      attestationProviderId: PROVIDER_ID,
      userSecretKey: secret,
    };
  }

  // Store a party's private state so the witnesses can present it, keyed to the
  // deployed contract.
  async function setPrivateState(id: string, state: ZkLoanPrivateState): Promise<void> {
    providers.privateStateProvider.setContractAddress(contractAddress);
    await providers.privateStateProvider.set(id, state);
  }

  // Thin wrapper over submitCallTx so each step reads as the circuit call it is.
  async function call<K extends ZkLoanCircuitId>(
    privateStateId: string,
    circuitId: K,
    ...args: CircuitArgs<K>
  ) {
    return (submitCallTx<Contract, K>)(providers, {
      compiledContract: CompiledZkLoanContract,
      contractAddress,
      privateStateId,
      circuitId,
      args,
    } as any);
  }

  // ---------------------------------------------------------------------------
  // Deployment — the constructor pins deriveAdminPublicKey(aliceSecret).
  // ---------------------------------------------------------------------------

  it('deploys the contract with the deployer as admin', async () => {
    const deployed: DeployedContract<Contract> = await (deployContract<Contract>)(providers, {
      compiledContract: CompiledZkLoanContract,
      privateStateId: ALICE_STATE_ID,
      initialPrivateState: createZkLoanPrivateState(aliceSecret),
    });

    contractAddress = deployed.deployTxData.public.contractAddress;
    logger.info(`Contract deployed at: ${contractAddress}`);
    expect(contractAddress).toBeDefined();
    expect(contractAddress.length).toBeGreaterThan(0);

    const state = await queryLedger();
    // Only the derived admin PUBLIC key is on-chain — never the secret.
    expect(state.contractAdmin).toEqual(pureCircuits.deriveAdminPublicKey(aliceSecret));
    expect(state.loans.isEmpty()).toBe(true);
    expect(state.providers.isEmpty()).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Admin: register the attestation provider's Jubjub public key.
  // ---------------------------------------------------------------------------

  it("lets the admin register the attestation API's public key", async () => {
    const res = await fetch(`${attestationUrl}/provider-info`);
    expect(res.status).toBe(200);
    const info = (await res.json()) as ProviderInfoResponse;
    expect(BigInt(info.providerId)).toEqual(PROVIDER_ID);
    const providerPk = { x: BigInt(info.publicKey.x), y: BigInt(info.publicKey.y) };

    await call(ALICE_STATE_ID, 'registerProvider', PROVIDER_ID, providerPk);

    const state = await queryLedger();
    expect(state.providers.member(PROVIDER_ID)).toBe(true);
    const pk = state.providers.lookup(PROVIDER_ID);
    expect(pk.x).toEqual(providerPk.x);
    expect(pk.y).toEqual(providerPk.y);
  });

  it('rejects provider registration by a non-admin', async () => {
    await setPrivateState(BOB_STATE_ID, createZkLoanPrivateState(bobSecret));
    // Fails while building the proof: Bob's secret does not hash to contractAdmin.
    await expect(
      call(BOB_STATE_ID, 'registerProvider', 2n, generateKeyPair().pk),
    ).rejects.toThrow();
    expect((await queryLedger()).providers.member(2n)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Borrowing — the profile is private; only status + amount hit the ledger.
  // ---------------------------------------------------------------------------

  it('approves a Tier 1 loan within the limit', async () => {
    // Tier 1: score >= 700, income >= 2000, tenure >= 24 => up to 10,000.
    await setPrivateState(ALICE_STATE_ID, await attestedState(aliceSecret, ALICE_PIN, 720, 2500, 24));
    await call(ALICE_STATE_ID, 'requestLoan', 5000n, ALICE_PIN);

    const state = await queryLedger();
    const aliceKey = userPk(aliceSecret, ALICE_PIN);
    expect(state.loans.member(aliceKey)).toBe(true);
    const loan = state.loans.lookup(aliceKey).lookup(1n);
    expect(loan.status).toEqual(LoanStatus.Approved);
    expect(loan.authorizedAmount).toEqual(5000n);
  });

  it('proposes a capped amount when the request exceeds the tier, and the borrower accepts', async () => {
    await call(ALICE_STATE_ID, 'requestLoan', 15000n, ALICE_PIN);

    const aliceKey = userPk(aliceSecret, ALICE_PIN);
    let loan = (await queryLedger()).loans.lookup(aliceKey).lookup(2n);
    expect(loan.status).toEqual(LoanStatus.Proposed);
    expect(loan.authorizedAmount).toEqual(10000n);

    await call(ALICE_STATE_ID, 'respondToLoan', 2n, ALICE_PIN, true);

    loan = (await queryLedger()).loans.lookup(aliceKey).lookup(2n);
    expect(loan.status).toEqual(LoanStatus.Approved);
    expect(loan.authorizedAmount).toEqual(10000n);
  });

  it('rejects a request whose credit data was tampered with after signing', async () => {
    const signed = await attestedState(bobSecret, BOB_PIN, 650, 1600, 10);
    // Bob inflates his score; the provider's signature no longer matches.
    await setPrivateState(BOB_STATE_ID, { ...signed, creditScore: 800n });
    await expect(call(BOB_STATE_ID, 'requestLoan', 5000n, BOB_PIN)).rejects.toThrow();
    expect((await queryLedger()).loans.member(userPk(bobSecret, BOB_PIN))).toBe(false);
  });

  it('records a Tier 2 loan for a second borrower under a separate identity', async () => {
    // Tier 2: score >= 600, income >= 1500 => up to 7,000.
    await setPrivateState(BOB_STATE_ID, await attestedState(bobSecret, BOB_PIN, 650, 1600, 10));
    await call(BOB_STATE_ID, 'requestLoan', 9000n, BOB_PIN);

    const state = await queryLedger();
    const loan = state.loans.lookup(userPk(bobSecret, BOB_PIN)).lookup(1n);
    expect(loan.status).toEqual(LoanStatus.Proposed);
    expect(loan.authorizedAmount).toEqual(7000n);
    // Bob declines the lower offer.
    await call(BOB_STATE_ID, 'respondToLoan', 1n, BOB_PIN, false);
    const declined = (await queryLedger()).loans.lookup(userPk(bobSecret, BOB_PIN)).lookup(1n);
    expect(declined.status).toEqual(LoanStatus.NotAccepted);
    expect(declined.authorizedAmount).toEqual(0n);
  });

  // ---------------------------------------------------------------------------
  // Blacklist — keyed by the derived user public key.
  // ---------------------------------------------------------------------------

  it('blocks a blacklisted borrower until the admin removes them', async () => {
    const bobKey = userPk(bobSecret, BOB_PIN);
    await call(ALICE_STATE_ID, 'blacklistUser', bobKey);
    expect((await queryLedger()).blacklist.member(bobKey)).toBe(true);

    await expect(call(BOB_STATE_ID, 'requestLoan', 1000n, BOB_PIN)).rejects.toThrow();

    await call(ALICE_STATE_ID, 'removeBlacklistUser', bobKey);
    expect((await queryLedger()).blacklist.member(bobKey)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // PIN rotation — batched migration to a new, unlinkable identity.
  // ---------------------------------------------------------------------------

  it('migrates all loans to the identity derived from a new PIN', async () => {
    const oldKey = userPk(aliceSecret, ALICE_PIN);
    const newKey = userPk(aliceSecret, ALICE_NEW_PIN);

    // Alice has 2 loans, below the batch size of 5, so one call finishes.
    await call(ALICE_STATE_ID, 'changePin', ALICE_PIN, ALICE_NEW_PIN);

    const state = await queryLedger();
    expect(state.loans.member(oldKey)).toBe(false);
    expect(state.onGoingPinMigration.member(oldKey)).toBe(false);
    const migrated = state.loans.lookup(newKey);
    expect(migrated.size()).toEqual(2n);
    expect(migrated.lookup(1n).authorizedAmount).toEqual(5000n);
    expect(migrated.lookup(2n).authorizedAmount).toEqual(10000n);
  });

  // ---------------------------------------------------------------------------
  // Admin rotation — hand the role over by public key only.
  // ---------------------------------------------------------------------------

  it('rotates the admin role to a new admin public key', async () => {
    const bobAdminPk = pureCircuits.deriveAdminPublicKey(bobSecret);
    await call(ALICE_STATE_ID, 'rotateAdmin', bobAdminPk);
    expect((await queryLedger()).contractAdmin).toEqual(bobAdminPk);

    // The old admin is now locked out; the new one can act.
    await expect(call(ALICE_STATE_ID, 'removeProvider', PROVIDER_ID)).rejects.toThrow();
    await call(BOB_STATE_ID, 'removeProvider', PROVIDER_ID);
    expect((await queryLedger()).providers.member(PROVIDER_ID)).toBe(false);
  });
});
