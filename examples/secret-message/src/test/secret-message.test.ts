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
import {
  encodeContractAddress,
  type ContractAddress,
} from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import pino from 'pino';

import { getConfig } from '../config.js';
import {
  MidnightWalletProvider,
  syncWallet,
} from '../wallet.js';
import { resolveWallet, waitForNightThenDust } from '@midnight-ntwrk/example-fast-sync';
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

const PRIVATE_STATE_ID = 'AliceSecretMessageState';
// A second deployment of the *same* contract with the *same* secret, used to
// show what the contract-address domain separator buys you.
const SECOND_PRIVATE_STATE_ID = 'AliceSecretMessageStateSecondInstance';

// Alice's secret. It lives in private state and is never sent on-chain — only its
// hash is published. Anyone who later guesses this text can recompute the hash
// (via `pureCircuits.hashMessage`) and confirm the match, but the ledger alone
// never reveals it.
const SECRET_MESSAGE = 'meet me at midnight';

// Owner secret keys. These are passed as *circuit parameters* rather than read
// from private state, which is the other way to keep a value private: a circuit
// parameter is a private input to the proof, so only the derived public key ever
// reaches the ledger. Never reuse these outside a test.
const ALICE_OWNER_KEY = new Uint8Array(32).fill(0xa1);
const MALLORY_OWNER_KEY = new Uint8Array(32).fill(0x33);

// The zero `Bytes<32>` — what `default<Bytes<32>>` produces in the contract, and
// what both ledger fields hold before anything is published.
const ZERO_32 = new Uint8Array(32);

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';


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
  async function queryLedger(address: ContractAddress = contractAddress) {
    const state = await providers.publicDataProvider.queryContractState(address);
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
      compiledContract: CompiledSecretMessageContract,
      privateStateId: PRIVATE_STATE_ID,
      initialPrivateState: createSecretMessagePrivateState(SECRET_MESSAGE),
    });

    contractAddress = deployed.deployTxData.public.contractAddress;
    logger.info(`Contract deployed at: ${contractAddress}`);
    expect(contractAddress).toBeDefined();
    expect(contractAddress.length).toBeGreaterThan(0);
  });

  it('starts with both ledger fields at the zero Bytes<32>', async () => {
    const state = await queryLedger();

    // `Bytes<32>` has no "unset" state — the constructor leaves both fields as
    // 32 zero bytes, which is why the ownership check below can use
    // `messageOwner == default<Bytes<32>>` to mean "unclaimed".
    expect(state.messageHash).toEqual(ZERO_32);
    expect(state.messageOwner).toEqual(ZERO_32);
  });

  // ---------------------------------------------------------------------------
  // 1. publishMessageHash — the bare hash commitment
  // ---------------------------------------------------------------------------

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

  it('leaves the bare hash open to a brute-force guess', async () => {
    const state = await queryLedger();

    // The weakness circuit 2 exists to fix. `hashMessage` is deterministic and
    // takes nothing but the message, so anyone can hash a candidate list and
    // look for a match — no interaction with Alice required. Here the "attacker"
    // guesses correctly from a small list of plausible phrases.
    const guesses = ['open sesame', 'hello world', SECRET_MESSAGE, 'swordfish'];
    const cracked = guesses.find((guess) =>
      Buffer.from(pureCircuits.hashMessage(encodeMessage(guess)))
        .equals(Buffer.from(state.messageHash)),
    );

    expect(cracked).toBe(SECRET_MESSAGE);
  });

  // ---------------------------------------------------------------------------
  // 2. publishMessageHashWithSeparator — a static domain separator
  // ---------------------------------------------------------------------------

  it('publishes a domain-separated hash of the same secret', async () => {
    await (submitCallTx<Contract, 'publishMessageHashWithSeparator'>)(providers, {
      compiledContract: CompiledSecretMessageContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_ID,
      circuitId: 'publishMessageHashWithSeparator',
    });

    const state = await queryLedger();
    const encoded = encodeMessage(SECRET_MESSAGE);

    expect(state.messageHash).toEqual(pureCircuits.hashMessageWithSeparator(encoded));

    // Same message, different domain tag, different commitment. That is the
    // whole point: a hash from this contract can never be confused with — or
    // replayed against — a hash computed for another purpose.
    expect(state.messageHash).not.toEqual(pureCircuits.hashMessage(encoded));
  });

  it('separates the message domain from the owner-key domain', async () => {
    // A domain separator only helps if each purpose gets its own tag. Feed the
    // *same* 32 bytes through both derivations and they must diverge — otherwise
    // a published message hash and a published owner key would be interchangeable.
    const shared = new Uint8Array(32).fill(0x7e);

    expect(pureCircuits.hashMessageWithSeparator(shared))
      .not.toEqual(pureCircuits.getDappPubKey(shared));
  });

  // ---------------------------------------------------------------------------
  // 3. publishMessageWithSeparator — the contract address as the separator
  // ---------------------------------------------------------------------------

  it('publishes a hash separated by this contract instance', async () => {
    await (submitCallTx<Contract, 'publishMessageWithSeparator'>)(providers, {
      compiledContract: CompiledSecretMessageContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_ID,
      circuitId: 'publishMessageWithSeparator',
    });

    const state = await queryLedger();
    const encoded = encodeMessage(SECRET_MESSAGE);

    // `kernel.self().bytes` inside the circuit is the deployed contract address,
    // which off-chain is the same 32 bytes `encodeContractAddress` produces.
    expect(state.messageHash).toEqual(
      pureCircuits.hashMessageWithAddress(encodeContractAddress(contractAddress), encoded),
    );

    // Distinct from both earlier commitments to the same message.
    expect(state.messageHash).not.toEqual(pureCircuits.hashMessage(encoded));
    expect(state.messageHash).not.toEqual(pureCircuits.hashMessageWithSeparator(encoded));
  });

  it('gives a second deployment a different hash for the same secret', async () => {
    // The static separator of circuit 2 is identical in every deployment, so two
    // instances holding the same message would publish the same commitment — an
    // observer could link them. The address separator breaks that link.
    const second: DeployedContract<Contract> = await (deployContract<Contract>)(providers, {
      compiledContract: CompiledSecretMessageContract,
      privateStateId: SECOND_PRIVATE_STATE_ID,
      initialPrivateState: createSecretMessagePrivateState(SECRET_MESSAGE),
    });
    const secondAddress = second.deployTxData.public.contractAddress;
    expect(secondAddress).not.toEqual(contractAddress);

    await (submitCallTx<Contract, 'publishMessageWithSeparator'>)(providers, {
      compiledContract: CompiledSecretMessageContract,
      contractAddress: secondAddress,
      privateStateId: SECOND_PRIVATE_STATE_ID,
      circuitId: 'publishMessageWithSeparator',
    });

    const first = await queryLedger(contractAddress);
    const other = await queryLedger(secondAddress);
    const encoded = encodeMessage(SECRET_MESSAGE);

    // Same contract, same secret, two addresses — two unlinkable commitments.
    expect(other.messageHash).not.toEqual(first.messageHash);
    expect(other.messageHash).toEqual(
      pureCircuits.hashMessageWithAddress(encodeContractAddress(secondAddress), encoded),
    );

    // Whereas the static separator would have produced the same value in both.
    expect(pureCircuits.hashMessageWithSeparator(encoded))
      .toEqual(pureCircuits.hashMessageWithSeparator(encoded));
  });

  // ---------------------------------------------------------------------------
  // 4. publishMessageHashWithOwner — access control
  // ---------------------------------------------------------------------------

  it('claims ownership on the first owned publish', async () => {
    await (submitCallTx<Contract, 'publishMessageHashWithOwner'>)(providers, {
      compiledContract: CompiledSecretMessageContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_ID,
      circuitId: 'publishMessageHashWithOwner',
      args: [ALICE_OWNER_KEY],
    });

    const state = await queryLedger();

    // The ledger holds the *derived public key*, never the secret key itself.
    expect(state.messageOwner).toEqual(pureCircuits.getDappPubKey(ALICE_OWNER_KEY));
    expect(state.messageOwner).not.toEqual(ALICE_OWNER_KEY);
    expect(state.messageOwner).not.toEqual(ZERO_32);

    expect(state.messageHash).toEqual(
      pureCircuits.hashMessageWithAddress(
        encodeContractAddress(contractAddress),
        encodeMessage(SECRET_MESSAGE),
      ),
    );
  });

  it('lets the established owner publish again', async () => {
    // messageOwner is now non-zero, so the second disjunct of the assert carries
    // the call: the caller proves knowledge of the key behind the stored pubkey.
    await (submitCallTx<Contract, 'publishMessageHashWithOwner'>)(providers, {
      compiledContract: CompiledSecretMessageContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_ID,
      circuitId: 'publishMessageHashWithOwner',
      args: [ALICE_OWNER_KEY],
    });

    const state = await queryLedger();
    expect(state.messageOwner).toEqual(pureCircuits.getDappPubKey(ALICE_OWNER_KEY));
  });

  it('rejects an owned publish from a non-owner', async () => {
    await expect(
      (submitCallTx<Contract, 'publishMessageHashWithOwner'>)(providers, {
        compiledContract: CompiledSecretMessageContract,
        contractAddress,
        privateStateId: PRIVATE_STATE_ID,
        circuitId: 'publishMessageHashWithOwner',
        args: [MALLORY_OWNER_KEY],
      }),
    ).rejects.toThrow(/not the owner/i);

    // The assert fails locally, before any proof is built, so nothing changed.
    const state = await queryLedger();
    expect(state.messageOwner).toEqual(pureCircuits.getDappPubKey(ALICE_OWNER_KEY));
  });

  // ---------------------------------------------------------------------------
  // 5. removeMessageHash — owner-only teardown
  // ---------------------------------------------------------------------------

  it('rejects a takedown from a non-owner and leaves the state intact', async () => {
    const before = await queryLedger();

    await expect(
      (submitCallTx<Contract, 'removeMessageHash'>)(providers, {
        compiledContract: CompiledSecretMessageContract,
        contractAddress,
        privateStateId: PRIVATE_STATE_ID,
        circuitId: 'removeMessageHash',
        args: [MALLORY_OWNER_KEY],
      }),
    ).rejects.toThrow(/not the owner/i);

    const after = await queryLedger();
    expect(after.messageHash).toEqual(before.messageHash);
    expect(after.messageOwner).toEqual(before.messageOwner);
  });

  it('lets the owner take the message down', async () => {
    await (submitCallTx<Contract, 'removeMessageHash'>)(providers, {
      compiledContract: CompiledSecretMessageContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_ID,
      circuitId: 'removeMessageHash',
      args: [ALICE_OWNER_KEY],
    });

    const state = await queryLedger();
    expect(state.messageHash).toEqual(ZERO_32);
    expect(state.messageOwner).toEqual(ZERO_32);
  });

  it('reopens ownership to anyone once the message is taken down', async () => {
    // Worth being explicit about: the takedown resets messageOwner to the zero
    // value, which is exactly the "unclaimed" sentinel. Ownership is not sticky —
    // the next caller, owner or not, claims the slot.
    await (submitCallTx<Contract, 'publishMessageHashWithOwner'>)(providers, {
      compiledContract: CompiledSecretMessageContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_ID,
      circuitId: 'publishMessageHashWithOwner',
      args: [MALLORY_OWNER_KEY],
    });

    const state = await queryLedger();
    expect(state.messageOwner).toEqual(pureCircuits.getDappPubKey(MALLORY_OWNER_KEY));
    expect(state.messageOwner).not.toEqual(pureCircuits.getDappPubKey(ALICE_OWNER_KEY));
  });

  // ---------------------------------------------------------------------------
  // The witness boundary — no network needed
  // ---------------------------------------------------------------------------

  it('encodes any message to exactly the 32 bytes the circuit expects', () => {
    expect(encodeMessage('')).toEqual(ZERO_32);
    expect(encodeMessage(SECRET_MESSAGE)).toHaveLength(32);

    // Right-padded with zeros, so the text is a prefix of the encoding.
    const encoded = encodeMessage('hi');
    expect(encoded.subarray(0, 2)).toEqual(new TextEncoder().encode('hi'));
    expect(encoded.subarray(2)).toEqual(new Uint8Array(30));

    // Anything past 32 bytes is silently truncated — two messages sharing a
    // 32-byte prefix therefore commit to the same hash.
    const long = 'x'.repeat(40);
    expect(encodeMessage(long)).toEqual(encodeMessage('x'.repeat(32)));
    expect(pureCircuits.hashMessage(encodeMessage(long)))
      .toEqual(pureCircuits.hashMessage(encodeMessage('x'.repeat(32))));
  });
});
