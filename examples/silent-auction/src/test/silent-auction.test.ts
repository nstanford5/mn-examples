// This file is part of example-silent-auction.
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
 * End-to-end suite for the silent auction, driven through midnight-js against a
 * running network. It walks a single auction from deployment to settlement and
 * asserts the on-chain ledger and each participant's wallet balances at every
 * step.
 *
 * Three participants, three wallets. The organizer and two competing bidders
 * each have their own funded wallet, their own providers, and their own private
 * state (see contract/witnesses.ts): a distinct `localSk` gives each a distinct
 * on-chain identity, and the organizer additionally holds the `localSalt` used
 * to commit to (and later reveal) the reserve price. The local devnet pre-funds
 * exactly three seeds (…01, …02, …03), which is the maximum available.
 *
 * Because every participant is a real counterparty, the token movements are
 * real too: the organizer deposits NIGHT and mints the NFT, the winning bidder
 * pays their bid and receives the NFT, and the organizer is paid out. Each
 * assertion checks the relevant wallet's own synced balance.
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
import {
  type ContractAddress,
  encodeUserAddress,
} from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { SucceedEntirely } from '@midnight-ntwrk/midnight-js-types';
import {
  type EnvironmentConfiguration,
} from '@midnight-ntwrk/testkit-js';
import { firstValueFrom } from 'rxjs';
import pino from 'pino';

import { getConfig } from '../config.js';
import {
  MidnightWalletProvider,
  syncWallet,
  type WalletSecret,
} from '../wallet.js';
import { resolveWallet, waitForNightThenDust } from '@midnight-ntwrk/example-fast-sync';
import { buildProviders, type SilentAuctionProviders } from '../providers.js';
import {
  CompiledSilentAuctionContract,
  Contract,
  ledger,
  zkConfigPath,
} from '../../contract/index.js';
import { AuctionState } from '../../contract/managed/silent-auction/contract/index.js';
import {
  createSilentAuctionPrivateState,
  type SilentAuctionPrivateState,
} from '../../contract/witnesses.js';

// Required for GraphQL subscriptions in Node.js
// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

type Role = 'ORGANIZER' | 'BIDDER_ONE' | 'BIDDER_TWO';

// Each wallet keeps its private state under its own id.
const PRIVATE_STATE_IDS: Record<Role, string> = {
  ORGANIZER: 'organizerPrivateState',
  BIDDER_ONE: 'bidderOnePrivateState',
  BIDDER_TWO: 'bidderTwoPrivateState',
};

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';

// Auction parameters. Bids and the reserve are Uint<16>; the deposit the
// contract requires from the organizer is fixed at 50 NIGHT in the constructor.
const RESERVE_PRICE = 5n; // the hidden minimum, revealed only at the end
const MAX_BIDS = 2n; // auction auto-closes once this many bidders have bid
const BID_ONE = 10n; // bidder one's bid
const BID_TWO = 20n; // bidder two's bid — the winning (highest) bid
const DEPOSIT = 50n; // organizer's NIGHT deposit (constant in the contract)

// The NIGHT / native token color is the all-zero 32-byte token type.
const NIGHT = '0'.repeat(64);

const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

describe(`Silent Auction Contract (${network})`, () => {
  let organizerWallet: MidnightWalletProvider;
  let bidderOneWallet: MidnightWalletProvider;
  let bidderTwoWallet: MidnightWalletProvider;
  let organizerProviders: SilentAuctionProviders;
  let bidderOneProviders: SilentAuctionProviders;
  let bidderTwoProviders: SilentAuctionProviders;
  let contractAddress: ContractAddress;

  const config = getConfig();
  const isRemote = network !== 'local';
  const syncTimeoutMs = Number(
    process.env['MIDNIGHT_SYNC_TIMEOUT_MS'] ?? (isRemote ? 60 * 60_000 : 10 * 60_000),
  );

  // Each participant's private state. Every one has a distinct localSk (its
  // on-chain identity); only the organizer's salt matters, for the commitment.
  const organizerState: SilentAuctionPrivateState = createSilentAuctionPrivateState(
    randomBytes(32),
    randomBytes(32),
  );
  const bidderOneState: SilentAuctionPrivateState = createSilentAuctionPrivateState(
    randomBytes(32),
    randomBytes(32),
  );
  const bidderTwoState: SilentAuctionPrivateState = createSilentAuctionPrivateState(
    randomBytes(32),
    randomBytes(32),
  );

  // Reads the contract's public ledger state (via any participant's indexer).
  async function queryLedger() {
    const state = await organizerProviders.publicDataProvider.queryContractState(contractAddress);
    expect(state).not.toBeNull();
    return ledger(state!.data);
  }

  // A wallet's own unshielded address, as the { bytes } struct a UserAddress
  // argument expects.
  const userAddress = (w: MidnightWalletProvider) => ({
    bytes: encodeUserAddress(w.unshieldedKeystore.getAddress()),
  });

  // A wallet's current unshielded balance for a token color (hex).
  async function unshielded(
    w: MidnightWalletProvider,
    tokenTypeHex: string,
  ): Promise<bigint> {
    const state = await firstValueFrom(w.wallet.state());
    const balances = (state.unshielded.balances ?? {}) as Record<string, bigint>;
    return BigInt(balances[tokenTypeHex.toLowerCase()] ?? 0n);
  }

  // A wallet syncs from the indexer a moment after a call finalizes, so poll its
  // balance until it reaches the expected value (or time out and return the last
  // value seen, letting the caller's assertion produce a clear diff).
  async function waitForUnshielded(
    w: MidnightWalletProvider,
    tokenTypeHex: string,
    expected: bigint,
    timeoutMs = 60_000,
  ): Promise<bigint> {
    const start = Date.now();
    let last = await unshielded(w, tokenTypeHex);
    while (last !== expected && Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      last = await unshielded(w, tokenTypeHex);
    }
    return last;
  }

  // Point a participant's providers at the deployed contract and load the
  // private state its witnesses should present.
  async function usePrivateState(
    providers: SilentAuctionProviders,
    role: Role,
    state: SilentAuctionPrivateState,
  ): Promise<void> {
    providers.privateStateProvider.setContractAddress(contractAddress);
    await providers.privateStateProvider.set(PRIVATE_STATE_IDS[role], state);
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

    // Build, start and sync each wallet in turn (sequential setup also spaces
    // out the private-state store names), then wire up its providers.
    async function bringUp(role: Role): Promise<MidnightWalletProvider> {
      // ORGANIZER/BIDDER_ONE/BIDDER_TWO alias onto the shared Alice/Bob/Charlie
      // wallets, so one funded set in the repo-root .env serves every example.
      const setup = resolveWallet(network, role);
      const w = await MidnightWalletProvider.build(logger, envConfig, setup.secret, {
        fastSync: setup.fastSync,
      });
      await w.start();
      await syncWallet(logger, w.wallet, syncTimeoutMs);
      if (isRemote) {
        await waitForNightThenDust(
          logger,
          w.wallet,
          w.unshieldedKeystore,
          envConfig,
          config.faucet,
          { label: `${role} (${setup.role})` },
        );
      }
      return w;
    }

    organizerWallet = await bringUp('ORGANIZER');
    organizerProviders = buildProviders(organizerWallet, zkConfigPath, config);

    bidderOneWallet = await bringUp('BIDDER_ONE');
    bidderOneProviders = buildProviders(bidderOneWallet, zkConfigPath, config);

    bidderTwoWallet = await bringUp('BIDDER_TWO');
    bidderTwoProviders = buildProviders(bidderTwoWallet, zkConfigPath, config);

    logger.info(`Providers initialized on '${network}'. Ready to test!`);
  });

  afterAll(async () => {
    for (const [name, w] of [
      ['organizer', organizerWallet],
      ['bidderOne', bidderOneWallet],
      ['bidderTwo', bidderTwoWallet],
    ] as const) {
      if (w) {
        logger.info(`Stopping ${name} wallet...`);
        await w.stop();
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Deployment — the organizer runs the constructor, committing to the reserve
  // price with its salt, and the auction opens in the RECEIVE state.
  // ---------------------------------------------------------------------------

  it('deploys the contract in the RECEIVE state (organizer)', async () => {
    const deployed: DeployedContract<Contract> = await (deployContract<Contract>)(organizerProviders, {
      compiledContract: CompiledSilentAuctionContract,
      privateStateId: PRIVATE_STATE_IDS.ORGANIZER,
      // The constructor invokes localSk()/localSalt(): deploy as the organizer.
      initialPrivateState: organizerState,
      // constructor(_minPrice, maxBidCount, address). `address` is the payout
      // address stored as organizerAddress.
      args: [RESERVE_PRICE, MAX_BIDS, userAddress(organizerWallet)],
    });

    contractAddress = deployed.deployTxData.public.contractAddress;
    await usePrivateState(organizerProviders, 'ORGANIZER', organizerState);
    logger.info(`Contract deployed at: ${contractAddress}`);

    expect(contractAddress).toBeDefined();
    expect(contractAddress.length).toBeGreaterThan(0);

    const state = await queryLedger();
    expect(state.auctionState).toEqual(AuctionState.RECEIVE);
    expect(state.maxBids).toEqual(MAX_BIDS);
    expect(state.depositAmount).toEqual(DEPOSIT);
    expect(state.highestBid).toEqual(0n);
    // The reserve price is committed, not stored in the clear.
    expect(state.publicPrice).toEqual(0n);
    expect(state.hiddenPrice).toBeInstanceOf(Uint8Array);
  });

  // ---------------------------------------------------------------------------
  // receiveTokens — organizer-only. Takes the deposit and mints the NFT, moving
  // the auction to OPEN.
  // ---------------------------------------------------------------------------

  it('rejects receiveTokens from a bidder (not the organizer)', async () => {
    await usePrivateState(bidderOneProviders, 'BIDDER_ONE', bidderOneState);
    await expect(
      (submitCallTx<Contract, 'receiveTokens'>)(bidderOneProviders, {
        compiledContract: CompiledSilentAuctionContract,
        contractAddress,
        privateStateId: PRIVATE_STATE_IDS.BIDDER_ONE,
        circuitId: 'receiveTokens',
      }),
    ).rejects.toThrow();

    // State is unchanged — still awaiting the organizer's deposit.
    const state = await queryLedger();
    expect(state.auctionState).toEqual(AuctionState.RECEIVE);
  });

  it('lets the organizer deposit NIGHT and mint the NFT (RECEIVE -> OPEN)', async () => {
    const nightBefore = await unshielded(organizerWallet, NIGHT);

    const res = await (submitCallTx<Contract, 'receiveTokens'>)(organizerProviders, {
      compiledContract: CompiledSilentAuctionContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_IDS.ORGANIZER,
      circuitId: 'receiveTokens',
    });
    expect(res.public.status).toEqual(SucceedEntirely);

    const state = await queryLedger();
    expect(state.auctionState).toEqual(AuctionState.OPEN);
    // The auctioned NFT's token type is now set (non-zero 32 bytes).
    expect(state.nftType).toBeInstanceOf(Uint8Array);
    expect(toHex(state.nftType)).not.toEqual(NIGHT);
    logger.info(`Auction NFT token type: ${toHex(state.nftType)}`);

    // The deposit left the organizer's wallet for the contract.
    const expected = nightBefore - DEPOSIT;
    expect(await waitForUnshielded(organizerWallet, NIGHT, expected)).toEqual(expected);
  });

  // ---------------------------------------------------------------------------
  // bid — anyone but the organizer, while OPEN, until maxBids is reached.
  // ---------------------------------------------------------------------------

  it('rejects a bid from the organizer', async () => {
    await expect(
      (submitCallTx<Contract, 'bid'>)(organizerProviders, {
        compiledContract: CompiledSilentAuctionContract,
        contractAddress,
        privateStateId: PRIVATE_STATE_IDS.ORGANIZER,
        circuitId: 'bid',
        args: [BID_ONE],
      }),
    ).rejects.toThrow();

    const state = await queryLedger();
    expect(state.bidders.size()).toEqual(0n);
    expect(state.highestBid).toEqual(0n);
  });

  it('accepts the first bid (bidder one)', async () => {
    await usePrivateState(bidderOneProviders, 'BIDDER_ONE', bidderOneState);
    const res = await (submitCallTx<Contract, 'bid'>)(bidderOneProviders, {
      compiledContract: CompiledSilentAuctionContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_IDS.BIDDER_ONE,
      circuitId: 'bid',
      args: [BID_ONE],
    });
    expect(res.public.status).toEqual(SucceedEntirely);

    const state = await queryLedger();
    expect(state.bidders.size()).toEqual(1n);
    expect(state.highestBid).toEqual(BID_ONE);
    expect(state.auctionState).toEqual(AuctionState.OPEN); // not yet full
  });

  it('accepts the second, higher bid and auto-closes at maxBids (OPEN -> CLOSED)', async () => {
    await usePrivateState(bidderTwoProviders, 'BIDDER_TWO', bidderTwoState);
    const res = await (submitCallTx<Contract, 'bid'>)(bidderTwoProviders, {
      compiledContract: CompiledSilentAuctionContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_IDS.BIDDER_TWO,
      circuitId: 'bid',
      args: [BID_TWO],
    });
    expect(res.public.status).toEqual(SucceedEntirely);

    const state = await queryLedger();
    expect(state.bidders.size()).toEqual(MAX_BIDS);
    expect(state.highestBid).toEqual(BID_TWO);
    // Reaching maxBids flips the auction closed automatically.
    expect(state.auctionState).toEqual(AuctionState.CLOSED);
  });

  it('rejects a bid once the auction is closed', async () => {
    await expect(
      (submitCallTx<Contract, 'bid'>)(bidderOneProviders, {
        compiledContract: CompiledSilentAuctionContract,
        contractAddress,
        privateStateId: PRIVATE_STATE_IDS.BIDDER_ONE,
        circuitId: 'bid',
        args: [BID_TWO + 1n],
      }),
    ).rejects.toThrow();

    const state = await queryLedger();
    expect(state.bidders.size()).toEqual(MAX_BIDS);
    expect(state.highestBid).toEqual(BID_TWO);
  });

  // ---------------------------------------------------------------------------
  // revealWin — organizer opens the reserve-price commitment. A wrong price
  // fails the commitment check; the correct price publishes it.
  // ---------------------------------------------------------------------------

  it('rejects revealWin when the organizer changes the reserve price', async () => {
    await expect(
      (submitCallTx<Contract, 'revealWin'>)(organizerProviders, {
        compiledContract: CompiledSilentAuctionContract,
        contractAddress,
        privateStateId: PRIVATE_STATE_IDS.ORGANIZER,
        circuitId: 'revealWin',
        args: [RESERVE_PRICE + 1n], // does not match the committed reserve
      }),
    ).rejects.toThrow();

    const state = await queryLedger();
    expect(state.publicPrice).toEqual(0n); // still unrevealed
  });

  it('reveals the true reserve price (highest bid clears the reserve)', async () => {
    const res = await (submitCallTx<Contract, 'revealWin'>)(organizerProviders, {
      compiledContract: CompiledSilentAuctionContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_IDS.ORGANIZER,
      circuitId: 'revealWin',
      args: [RESERVE_PRICE],
    });
    expect(res.public.status).toEqual(SucceedEntirely);

    const state = await queryLedger();
    expect(state.publicPrice).toEqual(RESERVE_PRICE);
    // Highest bid (20) clears the reserve (5), so the sale proceeds and the
    // deposit is NOT refunded here — it is returned to the organizer on claim.
    expect(state.highestBid).toBeGreaterThanOrEqual(state.publicPrice);
    expect(state.auctionState).toEqual(AuctionState.CLOSED);
  });

  // ---------------------------------------------------------------------------
  // claimWin — only the highest bidder can settle: they pay their bid, receive
  // the NFT, and the organizer gets bid + deposit back.
  // ---------------------------------------------------------------------------

  it('rejects claimWin from a non-winning bidder', async () => {
    await expect(
      (submitCallTx<Contract, 'claimWin'>)(bidderOneProviders, {
        compiledContract: CompiledSilentAuctionContract,
        contractAddress,
        privateStateId: PRIVATE_STATE_IDS.BIDDER_ONE,
        circuitId: 'claimWin',
        args: [userAddress(bidderOneWallet)],
      }),
    ).rejects.toThrow();

    const state = await queryLedger();
    expect(state.auctionState).toEqual(AuctionState.CLOSED); // not yet settled
  });

  it('lets the winner settle: pays the bid, receives the NFT, refunds the organizer (CLOSED -> PAID)', async () => {
    const nftColor = toHex((await queryLedger()).nftType);
    const winnerNightBefore = await unshielded(bidderTwoWallet, NIGHT);
    const winnerNftBefore = await unshielded(bidderTwoWallet, nftColor);
    const organizerNightBefore = await unshielded(organizerWallet, NIGHT);

    const res = await (submitCallTx<Contract, 'claimWin'>)(bidderTwoProviders, {
      compiledContract: CompiledSilentAuctionContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_IDS.BIDDER_TWO,
      circuitId: 'claimWin',
      // The NFT is delivered to the winner's own address.
      args: [userAddress(bidderTwoWallet)],
    });
    expect(res.public.status).toEqual(SucceedEntirely);

    const state = await queryLedger();
    expect(state.auctionState).toEqual(AuctionState.PAID);

    // The winner receives the auctioned NFT (1 unit).
    const nftExpected = winnerNftBefore + 1n;
    expect(await waitForUnshielded(bidderTwoWallet, nftColor, nftExpected)).toEqual(nftExpected);

    // The winner pays exactly their bid in NIGHT (fees are paid in DUST).
    const winnerNightExpected = winnerNightBefore - BID_TWO;
    expect(await waitForUnshielded(bidderTwoWallet, NIGHT, winnerNightExpected)).toEqual(
      winnerNightExpected,
    );

    // The organizer is paid the winning bid plus their returned deposit.
    const organizerNightExpected = organizerNightBefore + BID_TWO + DEPOSIT;
    expect(await waitForUnshielded(organizerWallet, NIGHT, organizerNightExpected)).toEqual(
      organizerNightExpected,
    );
  });
});
