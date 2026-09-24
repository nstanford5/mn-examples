// This file is part of example-shielded-chips.
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
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  deployContract,
  submitCallTx,
  type DeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import {
  type ContractAddress,
  encodeCoinPublicKey,
  encodeRawTokenType,
} from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { rawTokenType } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import pino from 'pino';

import { getConfig } from '../config.js';
import { MidnightWalletProvider, syncWallet } from '../wallet.js';
import { buildProviders, type ShieldedChipsProviders } from '../providers.js';
import {
  CompiledRouletteContract,
  CompiledChipsContract,
  RouletteContract,
  ChipsContract,
  rouletteLedger,
  chipsLedger,
  BetState,
  Color,
  rouletteZkConfigPath,
  chipsZkConfigPath,
} from '../../contract/index.js';
import {
  createRoulettePrivateState,
  rememberEscrow,
  type QualifiedCoin,
  type RoulettePrivateState,
} from '../../contract/witnesses.js';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { resolveWallet, waitForNightThenDust } from '@midnight-ntwrk/example-fast-sync';
import { WebSocket } from 'ws';

// Required for GraphQL subscriptions in Node.js
// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
const isRemote = network !== 'local';
const syncTimeoutMs = Number(
  process.env['MIDNIGHT_SYNC_TIMEOUT_MS'] ?? (isRemote ? 60 * 60_000 : 10 * 60_000),
);

/**
 * Build, start, sync, and (on a remote network) fund-gate one wallet.
 *
 * Locally, ALICE/BOB/CHARLIE are the genesis-funded seeds 01/02/03. Remotely
 * they are the shared wallets in the repo-root .env.<network>, fast-syncing
 * from the reference bundle when a birthday is recorded. See FAST-SYNC.md.
 */
async function buildWallet(
  role: 'ALICE' | 'BOB' | 'CHARLIE',
  env: EnvironmentConfiguration,
  faucet: string,
): Promise<MidnightWalletProvider> {
  const setup = resolveWallet(network, role);
  const w = await MidnightWalletProvider.build(logger, env, setup.secret, {
    fastSync: setup.fastSync,
  });
  await w.start();
  await syncWallet(logger, w.wallet, syncTimeoutMs);
  if (isRemote) {
    // Synced is not funded: a wallet with no DUST fails its first submit.
    await waitForNightThenDust(logger, w.wallet, w.unshieldedKeystore, env, faucet, {
      label: setup.role,
    });
  }
  return w;
}

type ShieldedCoinArg = { nonce: Uint8Array; color: Uint8Array; value: bigint };

describe(`Roulette tutorial (RED/BLACK, 2x payouts, house match) (${network})`, () => {
  let aliceWallet: MidnightWalletProvider;
  let bobWallet: MidnightWalletProvider;
  let charlieWallet: MidnightWalletProvider;

  let aliceChipsProv: ShieldedChipsProviders;
  let bobChipsProv: ShieldedChipsProviders;
  let charlieChipsProv: ShieldedChipsProviders;
  let aliceRouletteProv: ShieldedChipsProviders;
  let bobRouletteProv: ShieldedChipsProviders;
  let charlieRouletteProv: ShieldedChipsProviders;

  let chipsAddress: ContractAddress;
  let chipColorBytes: Uint8Array;
  let chipColorHex: string;
  let rouletteAddress: ContractAddress;

  const config = getConfig();

  const ALICE_CHIPS_PRIVATE_ID = 'AliceChipsPrivateState';
  const ALICE_ROULETTE_PRIVATE_ID = 'AliceRoulettePrivateState';
  const BOB_CHIPS_PRIVATE_ID = 'BobChipsPrivateState';
  const BOB_ROULETTE_PRIVATE_ID = 'BobRoulettePrivateState';
  const CHARLIE_CHIPS_PRIVATE_ID = 'CharlieChipsPrivateState';
  const CHARLIE_ROULETTE_PRIVATE_ID = 'CharlieRoulettePrivateState';

  const BET_SIZE = 100n;
  // 1 is RED on a standard single-zero wheel. Bob bets RED → wins.
  const WINNING_NUMBER = 1n;

  // MIP-0011 Fungible profile metadata, fixed at construction.
  const CHIP_NAME = 'Roulette Chips';
  const CHIP_SYMBOL = 'CHIP';
  const CHIP_DECIMALS = 0n;
  // Same domain separator the contract used to derive its color:
  // pad(32, "roulette:chip:").
  const CHIP_DOMAIN = (() => {
    const d = new Uint8Array(32);
    d.set(new Uint8Array(Buffer.from('roulette:chip:', 'utf8')));
    return d;
  })();

  /**
   * A fresh, uniformly random mint nonce.
   *
   * MIP-0011 puts nonce uniqueness on the caller, and a *secret* nonce is
   * what makes the base `_mint` recipient-private: the nonce is a circuit
   * argument, so it never reaches the chain, and without it nobody can
   * recompute a recipient's coin commitment. The alternative — MIP-0011's
   * derived-nonce extension — is recipient-public by design.
   */
  const mintNonce = (): Uint8Array => new Uint8Array(randomBytes(32));

  const aliceSk = new Uint8Array(randomBytes(32));
  const bobSk = new Uint8Array(randomBytes(32));
  const charlieSk = new Uint8Array(randomBytes(32));

  // Each player's blinding factor for their escrow commitment. This is what
  // stops the chip issuer — who knows the coin it minted you — from
  // recomputing your commitment and unmasking your pseudonym.
  const bobSalt = new Uint8Array(randomBytes(32));
  const charlieSalt = new Uint8Array(randomBytes(32));

  /**
   * Find the Zswap tree index of the coin the contract took custody of in a
   * given bet transaction.
   *
   * The contract deliberately does not store the escrowed coin, so nothing on
   * chain carries its `mt_index`. The player has to recover it themselves, and
   * it is simply the index of the shielded output their own bet transaction
   * created — `zswapStartIndex` on that transaction.
   */
  async function escrowMtIndex(blockHeight: number, entryPoint: string): Promise<bigint> {
    const query = `{ block(offset:{height:${blockHeight}}) { transactions {
      ... on RegularTransaction { zswapStartIndex }
      contractActions { address ... on ContractCall { entryPoint } } } } }`;
    const res = await fetch(config.indexer, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const body = (await res.json()) as {
      data: {
        block: {
          transactions: {
            zswapStartIndex?: number;
            contractActions: { address: string; entryPoint?: string }[];
          }[];
        } | null;
      };
    };
    const txs = body.data.block?.transactions ?? [];
    const match = txs.find((t) =>
      t.contractActions?.some(
        (a) => a.address === rouletteAddress && a.entryPoint === entryPoint,
      ),
    );
    if (match?.zswapStartIndex === undefined) {
      throw new Error(`No ${entryPoint} tx with a zswap index in block ${blockHeight}`);
    }
    return BigInt(match.zswapStartIndex);
  }

  /** Persist the escrowed coin so claimWinnings/forfeit can reopen it. */
  async function recordEscrow(
    providers: ShieldedChipsProviders,
    privateStateId: string,
    base: RoulettePrivateState,
    coin: ShieldedCoinArg,
    blockHeight: number,
  ): Promise<QualifiedCoin> {
    const mtIndex = await escrowMtIndex(blockHeight, 'betColor');
    const escrowed: QualifiedCoin = {
      nonce: coin.nonce,
      color: coin.color,
      value: coin.value,
      mt_index: mtIndex,
    };
    await providers.privateStateProvider.set(privateStateId, rememberEscrow(base, escrowed));
    logger.info(`Escrow recorded at mt_index=${mtIndex}`);
    return escrowed;
  }

  async function queryRoulette() {
    const state =
      await aliceRouletteProv.publicDataProvider.queryContractState(rouletteAddress);
    expect(state).not.toBeNull();
    return rouletteLedger(state!.data);
  }

  async function takeChipCoin(
    walletProvider: MidnightWalletProvider,
  ): Promise<ShieldedCoinArg> {
    const facadeState = await walletProvider.wallet.waitForSyncedState();
    const coins = facadeState.shielded.availableCoins;
    const chip = coins.find((c) => c.coin.type === chipColorHex);
    if (!chip) {
      const seen = coins.map((c) => c.coin.type).join(', ');
      throw new Error(
        `No chip coin (type=${chipColorHex}) in wallet. Saw types: [${seen}]`,
      );
    }
    return {
      nonce: Uint8Array.from(Buffer.from(chip.coin.nonce, 'hex')),
      color: chipColorBytes,
      value: chip.coin.value,
    };
  }

  async function chipBalance(w: MidnightWalletProvider): Promise<bigint> {
    const state = await w.wallet.waitForSyncedState();
    return state.shielded.balances[chipColorHex] ?? 0n;
  }

  // Pick a still-available match coin whose value equals the requested
  // amount. claimWinnings enforces match.value == betValues[player] in-circuit, so
  // the player-side picker must filter by value.
  async function pickMatchKeyOfValue(value: bigint): Promise<Uint8Array> {
    const state = await queryRoulette();
    for (const [key, coin] of state.houseCoins) {
      if (coin.value === value) return key;
    }
    throw new Error(`No house match coin of value ${value} available`);
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

    aliceWallet = await buildWallet('ALICE', envConfig, config.faucet);
    bobWallet = await buildWallet('BOB', envConfig, config.faucet);
    charlieWallet = await buildWallet('CHARLIE', envConfig, config.faucet);

    aliceChipsProv = buildProviders(aliceWallet, chipsZkConfigPath, config, 'chips-alice');
    bobChipsProv = buildProviders(bobWallet, chipsZkConfigPath, config, 'chips-bob');
    charlieChipsProv = buildProviders(charlieWallet, chipsZkConfigPath, config, 'chips-charlie');
    aliceRouletteProv = buildProviders(aliceWallet, rouletteZkConfigPath, config, 'roulette-alice');
    bobRouletteProv = buildProviders(bobWallet, rouletteZkConfigPath, config, 'roulette-bob');
    charlieRouletteProv = buildProviders(charlieWallet, rouletteZkConfigPath, config, 'roulette-charlie');
    logger.info('All providers initialized.');
  });

  afterAll(async () => {
    if (aliceWallet) await aliceWallet.stop();
    if (bobWallet) await bobWallet.stop();
    if (charlieWallet) await charlieWallet.stop();
  });

  it('Alice deploys the chips contract', async () => {
    const alicePrivateState = createRoulettePrivateState(aliceSk);

    logger.info('Deploying chips contract...');
    const deployed: DeployedContract<ChipsContract> =
      await (deployContract<ChipsContract>)(aliceChipsProv, {
        compiledContract: CompiledChipsContract,
        privateStateId: ALICE_CHIPS_PRIVATE_ID,
        initialPrivateState: alicePrivateState,
        args: [CHIP_NAME, CHIP_SYMBOL, CHIP_DECIMALS, CHIP_DOMAIN],
      });

    chipsAddress = deployed.deployTxData.public.contractAddress;
    logger.info(`Chips contract deployed at ${chipsAddress}`);

    // MIP-0011 metadata is readable straight off the public ledger.
    const state = await aliceChipsProv.publicDataProvider.queryContractState(chipsAddress);
    const ledger = chipsLedger(state!.data);
    expect(ledger._name).toEqual(CHIP_NAME);
    expect(ledger._symbol).toEqual(CHIP_SYMBOL);
    expect(ledger._decimals).toEqual(CHIP_DECIMALS);
    expect(ledger._totalMinted).toEqual(0n);
    expect(ledger._totalBurned).toEqual(0n);

    // The color is tokenType(domain, contractAddress). MIP-0011 forbids
    // precomputing it in the constructor because kernel.self() resolves
    // differently there, so there is no stored color field to read —
    // derive it off chain instead of paying for a `tokenColor()` call.
    chipColorHex = rawTokenType(CHIP_DOMAIN, chipsAddress);
    chipColorBytes = encodeRawTokenType(chipColorHex);
    logger.info(`Chip token color: ${chipColorHex}`);
  });

  it('Alice mints chips to herself (2 for matches), Bob, and Charlie', async () => {
    const bobPS = createRoulettePrivateState(bobSk);
    const charliePS = createRoulettePrivateState(charlieSk);
    bobChipsProv.privateStateProvider.setContractAddress(chipsAddress);
    await bobChipsProv.privateStateProvider.set(BOB_CHIPS_PRIVATE_ID, bobPS);
    charlieChipsProv.privateStateProvider.setContractAddress(chipsAddress);
    await charlieChipsProv.privateStateProvider.set(CHARLIE_CHIPS_PRIVATE_ID, charliePS);

    const aliceCoinPk = aliceWallet.getCoinPublicKey();
    const bobCoinPk = bobWallet.getCoinPublicKey();
    const charlieCoinPk = charlieWallet.getCoinPublicKey();
    const aliceCoinPkBytes = { bytes: encodeCoinPublicKey(aliceCoinPk) };
    const bobCoinPkBytes = { bytes: encodeCoinPublicKey(bobCoinPk) };
    const charlieCoinPkBytes = { bytes: encodeCoinPublicKey(charlieCoinPk) };

    const encMap = new Map<string, string>([
      [aliceCoinPk, aliceWallet.getEncryptionPublicKey()],
      [bobCoinPk, bobWallet.getEncryptionPublicKey()],
      [charlieCoinPk, charlieWallet.getEncryptionPublicKey()],
    ]);

    // Each mint takes a fresh random nonce. MIP-0011 puts uniqueness on the
    // caller, and secrecy is what keeps the recipient unlinkable.
    const mintTo = async (
      who: string,
      recipient: { bytes: Uint8Array },
    ): Promise<void> => {
      logger.info(`Alice minting ${BET_SIZE} chips to ${who}...`);
      await (submitCallTx<ChipsContract, 'mint'>)(aliceChipsProv, {
        compiledContract: CompiledChipsContract,
        contractAddress: chipsAddress,
        privateStateId: ALICE_CHIPS_PRIVATE_ID,
        circuitId: 'mint',
        args: [recipient, BET_SIZE, mintNonce()],
        additionalCoinEncPublicKeyMappings: encMap,
      });
    };

    // Two 100-chip coins to Alice (she'll deposit them as house matches).
    await mintTo('herself (coin #1)', aliceCoinPkBytes);
    await mintTo('herself (coin #2)', aliceCoinPkBytes);
    // 100 chips each to Bob and Charlie.
    await mintTo('Bob', bobCoinPkBytes);
    await mintTo('Charlie', charlieCoinPkBytes);

    // MIP-0011 supply accounting: totalMinted is exact.
    const chipsState =
      await aliceChipsProv.publicDataProvider.queryContractState(chipsAddress);
    const ledger = chipsLedger(chipsState!.data);
    expect(ledger._totalMinted).toEqual(4n * BET_SIZE);
    expect(ledger._totalBurned).toEqual(0n);

    await syncWallet(logger, aliceWallet.wallet, 600_000);
    await syncWallet(logger, bobWallet.wallet, 600_000);
    await syncWallet(logger, charlieWallet.wallet, 600_000);
    expect(await chipBalance(aliceWallet)).toEqual(2n * BET_SIZE);
    expect(await chipBalance(bobWallet)).toEqual(BET_SIZE);
    expect(await chipBalance(charlieWallet)).toEqual(BET_SIZE);
  });

  it('Alice deploys the roulette contract bound to the chip color', async () => {
    const alicePrivateState = createRoulettePrivateState(aliceSk);

    logger.info(`Deploying roulette contract bound to chip color ${chipColorHex}...`);
    const deployed: DeployedContract<RouletteContract> =
      await (deployContract<RouletteContract>)(aliceRouletteProv, {
        compiledContract: CompiledRouletteContract,
        privateStateId: ALICE_ROULETTE_PRIVATE_ID,
        initialPrivateState: alicePrivateState,
        args: [WINNING_NUMBER, chipColorBytes],
      });

    rouletteAddress = deployed.deployTxData.public.contractAddress;
    logger.info(`Roulette deployed at ${rouletteAddress}`);

    const state = await queryRoulette();
    expect(state.betState).toEqual(BetState.OPEN);
  });

  it('Alice deposits two match coins so the house can cover both bets', async () => {
    const match1 = await takeChipCoin(aliceWallet);
    expect(match1.value).toEqual(BET_SIZE);
    logger.info(`Alice depositing match coin #1 (value=${match1.value})...`);
    await (submitCallTx<RouletteContract, 'houseDeposit'>)(aliceRouletteProv, {
      compiledContract: CompiledRouletteContract,
      contractAddress: rouletteAddress,
      privateStateId: ALICE_ROULETTE_PRIVATE_ID,
      circuitId: 'houseDeposit',
      args: [match1],
    });

    await syncWallet(logger, aliceWallet.wallet, 600_000);
    const match2 = await takeChipCoin(aliceWallet);
    expect(match2.value).toEqual(BET_SIZE);
    logger.info(`Alice depositing match coin #2 (value=${match2.value})...`);
    await (submitCallTx<RouletteContract, 'houseDeposit'>)(aliceRouletteProv, {
      compiledContract: CompiledRouletteContract,
      contractAddress: rouletteAddress,
      privateStateId: ALICE_ROULETTE_PRIVATE_ID,
      circuitId: 'houseDeposit',
      args: [match2],
    });

    const state = await queryRoulette();
    expect(state.houseCoins.size()).toEqual(2n);

    await syncWallet(logger, aliceWallet.wallet, 600_000);
    expect(await chipBalance(aliceWallet)).toEqual(0n);
  });

  it('Bob re-nonces his chips in his own wallet before betting', async () => {
    // The chip issuer (Alice) knows the exact coin she minted to Bob: same
    // nonce, same value. The contract never publishes Bob's coin, but Alice
    // could still recognise it if Bob bet it untouched — every coin derived
    // from it, including his payout, follows deterministically from that
    // nonce. A self-transfer replaces it with a coin whose nonce Alice has
    // never seen, which closes that last thread.
    const before = await takeChipCoin(bobWallet);
    await bobWallet.splitShieldedCoin(chipColorHex, BET_SIZE);
    await syncWallet(logger, bobWallet.wallet, 600_000);
    const after = await takeChipCoin(bobWallet);

    logger.info(`Bob's chip nonce before split: ${Buffer.from(before.nonce).toString('hex')}`);
    logger.info(`Bob's chip nonce after split:  ${Buffer.from(after.nonce).toString('hex')}`);

    // Same value, different coin identity.
    expect(after.value).toEqual(BET_SIZE);
    expect(Buffer.from(after.nonce).toString('hex')).not.toEqual(
      Buffer.from(before.nonce).toString('hex'),
    );
    expect(await chipBalance(bobWallet)).toEqual(BET_SIZE);
  });

  it('Bob bets RED with a 100-chip coin', async () => {
    const bobPS = createRoulettePrivateState(bobSk, bobSalt);
    bobRouletteProv.privateStateProvider.setContractAddress(rouletteAddress);
    await bobRouletteProv.privateStateProvider.set(BOB_ROULETTE_PRIVATE_ID, bobPS);

    const chip = await takeChipCoin(bobWallet);
    logger.info(`Bob is betting a chip coin (value=${chip.value}) on RED`);

    const tx = await (submitCallTx<RouletteContract, 'betColor'>)(bobRouletteProv, {
      compiledContract: CompiledRouletteContract,
      contractAddress: rouletteAddress,
      privateStateId: BOB_ROULETTE_PRIVATE_ID,
      circuitId: 'betColor',
      args: [chip, Color.RED],
    });

    await recordEscrow(
      bobRouletteProv,
      BOB_ROULETTE_PRIVATE_ID,
      bobPS,
      chip,
      tx.public.blockHeight,
    );

    const state = await queryRoulette();
    expect(state.betCommits.size()).toEqual(1n);
    // The bet size is public by design; the coin behind it is not.
    expect(state.betValues.lookup(state.betCommits[Symbol.iterator]().next().value![0]))
      .toEqual(BET_SIZE);
  });

  it('Charlie bets BLACK with a 100-chip coin', async () => {
    const charliePS = createRoulettePrivateState(charlieSk, charlieSalt);
    charlieRouletteProv.privateStateProvider.setContractAddress(rouletteAddress);
    await charlieRouletteProv.privateStateProvider.set(CHARLIE_ROULETTE_PRIVATE_ID, charliePS);

    const chip = await takeChipCoin(charlieWallet);
    logger.info(`Charlie is betting a chip coin (value=${chip.value}) on BLACK`);

    const tx = await (submitCallTx<RouletteContract, 'betColor'>)(charlieRouletteProv, {
      compiledContract: CompiledRouletteContract,
      contractAddress: rouletteAddress,
      privateStateId: CHARLIE_ROULETTE_PRIVATE_ID,
      circuitId: 'betColor',
      args: [chip, Color.BLACK],
    });

    await recordEscrow(
      charlieRouletteProv,
      CHARLIE_ROULETTE_PRIVATE_ID,
      charliePS,
      chip,
      tx.public.blockHeight,
    );

    const state = await queryRoulette();
    expect(state.betCommits.size()).toEqual(2n);
  });

  it('Alice reveals the winning number (RED)', async () => {
    logger.info('Alice revealing the winning number...');
    await (submitCallTx<RouletteContract, 'revealWinningNumber'>)(aliceRouletteProv, {
      compiledContract: CompiledRouletteContract,
      contractAddress: rouletteAddress,
      privateStateId: ALICE_ROULETTE_PRIVATE_ID,
      circuitId: 'revealWinningNumber',
      args: [WINNING_NUMBER],
    });

    const state = await queryRoulette();
    expect(state.betState).toEqual(BetState.CLOSED);
    expect(state.winningColor).toEqual(Color.RED);
  });

  it('Bob claims his 2x in a single call (escrow coin merged with a match coin)', async () => {
    expect(await chipBalance(bobWallet)).toEqual(0n);

    const matchKey = await pickMatchKeyOfValue(BET_SIZE);
    logger.info(`Bob claiming with match key=${Buffer.from(matchKey).toString('hex')}`);

    await (submitCallTx<RouletteContract, 'claimWinnings'>)(bobRouletteProv, {
      compiledContract: CompiledRouletteContract,
      contractAddress: rouletteAddress,
      privateStateId: BOB_ROULETTE_PRIVATE_ID,
      circuitId: 'claimWinnings',
      args: [matchKey],
    });

    await syncWallet(logger, bobWallet.wallet, 600_000);
    const bobAfter = await chipBalance(bobWallet);
    logger.info(`Bob chip balance after claimWinnings: ${bobAfter}`);
    expect(bobAfter).toEqual(2n * BET_SIZE);

    const state = await queryRoulette();
    expect(state.paidWinners.size()).toEqual(1n);
    expect(state.houseCoins.size()).toEqual(1n); // one match coin left
    expect(state.betCommits.size()).toEqual(1n); // only Charlie's escrow left
  });

  it('Charlie forfeits her losing bet into the house pool', async () => {
    // Only Charlie can do this: the contract never stored her coin, so only
    // she can reopen the escrow commitment. That is the deliberate cost of
    // keeping her coin out of public state.
    await (submitCallTx<RouletteContract, 'forfeit'>)(charlieRouletteProv, {
      compiledContract: CompiledRouletteContract,
      contractAddress: rouletteAddress,
      privateStateId: CHARLIE_ROULETTE_PRIVATE_ID,
      circuitId: 'forfeit',
    });

    const state = await queryRoulette();
    expect(state.betCommits.size()).toEqual(0n);
    // Her chip is now a contract-owned coin in the sweepable pool.
    expect(state.houseCoins.size()).toEqual(2n);
    expect(await chipBalance(charlieWallet)).toEqual(0n);
  });

  it('Alice sweeps both pool coins (unused match + forfeited bet)', async () => {
    expect(await chipBalance(aliceWallet)).toEqual(0n);

    for (const label of ['first', 'second']) {
      const matchKey = await pickMatchKeyOfValue(BET_SIZE);
      logger.info(`Alice sweeping ${label} pool coin=${Buffer.from(matchKey).toString('hex')}`);
      await (submitCallTx<RouletteContract, 'houseClaimMatch'>)(aliceRouletteProv, {
        compiledContract: CompiledRouletteContract,
        contractAddress: rouletteAddress,
        privateStateId: ALICE_ROULETTE_PRIVATE_ID,
        circuitId: 'houseClaimMatch',
        args: [matchKey],
      });
    }

    await syncWallet(logger, aliceWallet.wallet, 600_000);
    const aliceAfter = await chipBalance(aliceWallet);
    logger.info(`Alice chip balance after sweeping the pool: ${aliceAfter}`);
    expect(aliceAfter).toEqual(2n * BET_SIZE);

    const state = await queryRoulette();
    expect(state.houseCoins.size()).toEqual(0n);
  });

  it('Charlie cannot claim winnings — she bet BLACK but the winning color was RED', async () => {
    await expect(async () => {
      await (submitCallTx<RouletteContract, 'claimWinnings'>)(charlieRouletteProv, {
        compiledContract: CompiledRouletteContract,
        circuitId: 'claimWinnings',
        contractAddress: rouletteAddress,
        privateStateId: CHARLIE_ROULETTE_PRIVATE_ID,
        args: [new Uint8Array(32)],
      });
    }).rejects.toThrow();

    expect(await chipBalance(charlieWallet)).toEqual(0n);
  });

  // --- MIP-0011 burn paths -------------------------------------------------

  async function chipsLedgerState() {
    const state = await aliceChipsProv.publicDataProvider.queryContractState(chipsAddress);
    return chipsLedger(state!.data);
  }

  it('Alice burns half of her swept chips — the same-tx transient burn path', async () => {
    const before = await chipBalance(aliceWallet);
    expect(before).toEqual(2n * BET_SIZE);
    const supplyBefore = await chipsLedgerState();

    // Partial burn: half the coin goes to the burn address, the change comes
    // back to the caller's own key.
    const coin = await takeChipCoin(aliceWallet);
    const half = coin.value / 2n;

    logger.info(`Alice burning ${half} of a ${coin.value}-chip coin...`);
    await (submitCallTx<ChipsContract, 'burn'>)(aliceChipsProv, {
      compiledContract: CompiledChipsContract,
      circuitId: 'burn',
      contractAddress: chipsAddress,
      privateStateId: ALICE_CHIPS_PRIVATE_ID,
      args: [coin, half],
      additionalCoinEncPublicKeyMappings: new Map([
        [aliceWallet.getCoinPublicKey(), aliceWallet.getEncryptionPublicKey()],
      ]),
    });

    await syncWallet(logger, aliceWallet.wallet, 600_000);
    const after = await chipBalance(aliceWallet);
    logger.info(`Alice chip balance after burning ${half}: ${after}`);
    expect(after).toEqual(before - half);

    // Supply accounting: totalMinted is unchanged and exact, totalBurned
    // grew, totalSupply is the difference.
    const supply = await chipsLedgerState();
    expect(supply._totalMinted).toEqual(supplyBefore._totalMinted);
    expect(supply._totalBurned).toEqual(supplyBefore._totalBurned + half);
    // totalSupply is a circuit, not a field: the invariant is minted - burned.
    expect(supply._totalMinted - supply._totalBurned)
      .toEqual(supplyBefore._totalMinted - supplyBefore._totalBurned - half);
  });

  it('Bob cannot burn, even chips he owns — burn is house-only', async () => {
    const bobBefore = await chipBalance(bobWallet);
    expect(bobBefore).toEqual(2n * BET_SIZE);
    const supplyBefore = await chipsLedgerState();

    const coin = await takeChipCoin(bobWallet);
    bobChipsProv.privateStateProvider.setContractAddress(chipsAddress);

    await expect(async () => {
      await (submitCallTx<ChipsContract, 'burn'>)(bobChipsProv, {
        compiledContract: CompiledChipsContract,
        circuitId: 'burn',
        contractAddress: chipsAddress,
        privateStateId: BOB_CHIPS_PRIVATE_ID,
        args: [coin, BET_SIZE],
      });
    }).rejects.toThrow(/Only the house/);

    // Nothing moved and nothing was accounted.
    await syncWallet(logger, bobWallet.wallet, 600_000);
    expect(await chipBalance(bobWallet)).toEqual(bobBefore);
    const supply = await chipsLedgerState();
    expect(supply._totalBurned).toEqual(supplyBefore._totalBurned);
  });

  it('Alice mints into the treasury and burns it — the Merkle-spend burn path', async () => {
    const supplyBefore = await chipsLedgerState();

    logger.info('Alice minting 60 chips into the treasury...');
    await (submitCallTx<ChipsContract, 'mintToTreasury'>)(aliceChipsProv, {
      compiledContract: CompiledChipsContract,
      circuitId: 'mintToTreasury',
      contractAddress: chipsAddress,
      privateStateId: ALICE_CHIPS_PRIVATE_ID,
      args: [60n, mintNonce()],
    });

    const minted = await chipsLedgerState();
    expect(minted._totalMinted).toEqual(supplyBefore._totalMinted + 60n);
    expect(minted._treasury.size()).toEqual(1n);
    const [key, treasuryCoin] = [...minted._treasury][0]!;
    expect(treasuryCoin.value).toEqual(60n);

    // Partial burn: 25 destroyed, 35 must come back as persisted change.
    logger.info('Alice burning 25 of the 60 treasury chips...');
    await (submitCallTx<ChipsContract, 'burnFromTreasury'>)(aliceChipsProv, {
      compiledContract: CompiledChipsContract,
      circuitId: 'burnFromTreasury',
      contractAddress: chipsAddress,
      privateStateId: ALICE_CHIPS_PRIVATE_ID,
      args: [key, 25n],
    });

    const burned = await chipsLedgerState();
    expect(burned._totalBurned).toEqual(minted._totalBurned + 25n);
    // The change was persisted under a new key, not stranded.
    expect(burned._treasury.size()).toEqual(1n);
    const [, changeCoin] = [...burned._treasury][0]!;
    expect(changeCoin.value).toEqual(35n);
    logger.info(`Treasury change persisted: ${changeCoin.value} chips`);
  });

  it('Every supply-changing circuit rejects a non-house caller', async () => {
    const supplyBefore = await chipsLedgerState();
    const treasuryKey = [...supplyBefore._treasury][0]![0];
    const bobPk = { bytes: encodeCoinPublicKey(bobWallet.getCoinPublicKey()) };

    // The full privileged surface, called by someone who is not the house.
    // Each must revert; none may move the supply counters. (`burn` is
    // covered by its own test above.)
    logger.info('Bob attempting mint...');
    await expect(async () => {
      await (submitCallTx<ChipsContract, 'mint'>)(bobChipsProv, {
        compiledContract: CompiledChipsContract,
        circuitId: 'mint',
        contractAddress: chipsAddress,
        privateStateId: BOB_CHIPS_PRIVATE_ID,
        args: [bobPk, 1n, mintNonce()],
      });
    }).rejects.toThrow(/Only the house/);

    logger.info('Bob attempting mintToTreasury...');
    await expect(async () => {
      await (submitCallTx<ChipsContract, 'mintToTreasury'>)(bobChipsProv, {
        compiledContract: CompiledChipsContract,
        circuitId: 'mintToTreasury',
        contractAddress: chipsAddress,
        privateStateId: BOB_CHIPS_PRIVATE_ID,
        args: [1n, mintNonce()],
      });
    }).rejects.toThrow(/Only the house/);

    logger.info('Bob attempting burnFromTreasury...');
    await expect(async () => {
      await (submitCallTx<ChipsContract, 'burnFromTreasury'>)(bobChipsProv, {
        compiledContract: CompiledChipsContract,
        circuitId: 'burnFromTreasury',
        contractAddress: chipsAddress,
        privateStateId: BOB_CHIPS_PRIVATE_ID,
        args: [treasuryKey, 1n],
      });
    }).rejects.toThrow(/Only the house/);

    const supply = await chipsLedgerState();
    expect(supply._totalMinted).toEqual(supplyBefore._totalMinted);
    expect(supply._totalBurned).toEqual(supplyBefore._totalBurned);
    expect(supply._treasury.size()).toEqual(supplyBefore._treasury.size());
  });

  it('The house cannot burn more than a coin holds', async () => {
    const coin = await takeChipCoin(aliceWallet);
    await expect(async () => {
      await (submitCallTx<ChipsContract, 'burn'>)(aliceChipsProv, {
        compiledContract: CompiledChipsContract,
        circuitId: 'burn',
        contractAddress: chipsAddress,
        privateStateId: ALICE_CHIPS_PRIVATE_ID,
        args: [coin, coin.value + 1n],
      });
    }).rejects.toThrow(/burn amount exceeds coin value/);
  });
});
