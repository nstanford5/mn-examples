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

import {
  type CoinPublicKey,
  DustSecretKey,
  type EncPublicKey,
  type FinalizedTransaction,
  LedgerParameters,
  ZswapSecretKeys,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type {
  MidnightProvider,
  UnboundTransaction,
  WalletProvider,
} from '@midnight-ntwrk/midnight-js-types';
import { ttlOneHour } from '@midnight-ntwrk/midnight-js-utils';
import {
  type WalletFacade,
  type FacadeState,
  type UnshieldedKeystore,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnight-ntwrk/wallet-sdk';
import {
  type DustWalletOptions,
  type EnvironmentConfiguration,
  FluentWalletBuilder,
} from '@midnight-ntwrk/testkit-js';
import * as Rx from 'rxjs';
import type { Logger } from 'pino';

// The secret and the fast-sync plumbing live in the shared harness package so
// every example resolves wallets the same way. Re-exported here so the local
// `from './wallet.js'` imports keep working.
import { assembleWallet, type FastSyncOptions, type WalletSecret } from '@midnight-ntwrk/example-fast-sync';

export type { WalletSecret };

export class MidnightWalletProvider implements MidnightProvider, WalletProvider {
  readonly wallet: WalletFacade;
  readonly unshieldedKeystore: UnshieldedKeystore;

  private constructor(
    private readonly logger: Logger,
    wallet: WalletFacade,
    private readonly zswapSecretKeys: ZswapSecretKeys,
    private readonly dustSecretKey: DustSecretKey,
    unshieldedKeystore: UnshieldedKeystore,
  ) {
    this.wallet = wallet;
    this.unshieldedKeystore = unshieldedKeystore;
  }

  getCoinPublicKey(): CoinPublicKey {
    return this.zswapSecretKeys.coinPublicKey;
  }

  getEncryptionPublicKey(): EncPublicKey {
    return this.zswapSecretKeys.encryptionPublicKey;
  }

  async balanceTx(
    tx: UnboundTransaction,
    ttl: Date = ttlOneHour(),
  ): Promise<FinalizedTransaction> {
    const recipe = await this.wallet.balanceUnboundTransaction(
      tx,
      {
        shieldedSecretKeys: this.zswapSecretKeys,
        dustSecretKey: this.dustSecretKey,
      },
      { ttl },
    );
    // Balancing may add unshielded inputs (e.g. NIGHT spent to fund a
    // contract's receiveUnshielded). Those inputs need signatures from the
    // unshielded keystore; without this step the node rejects the transaction
    // with InputsSignaturesLengthMismatch (Custom error 192).
    const signed = await this.wallet.signRecipe(
      recipe,
      (payload) => this.unshieldedKeystore.signData(payload),
    );
    return await this.wallet.finalizeRecipe(signed);
  }

  submitTx(tx: FinalizedTransaction): Promise<string> {
    return this.wallet.submitTransaction(tx);
  }

  /** This wallet's own shielded address, for self-transfers. */
  getShieldedAddress(): ShieldedAddress {
    return new ShieldedAddress(
      ShieldedCoinPublicKey.fromHexString(this.getCoinPublicKey()),
      ShieldedEncryptionPublicKey.fromHexString(this.getEncryptionPublicKey()),
    );
  }

  /**
   * Send `amount` of `tokenType` from this wallet back to itself.
   *
   * PRIVACY: this is the player-side half of the identity story. The token
   * issuer knows the exact coin it minted for you — same nonce, same value —
   * so if you spend that coin directly into a contract, the issuer can
   * recognise it even though the contract only ever records a re-nonced,
   * contract-owned coin. A self-transfer replaces it with a coin carrying a
   * wallet-chosen nonce the issuer has never seen, which cuts that last
   * thread. Cheap, and worth doing before any action you want unlinkable.
   */
  async splitShieldedCoin(
    tokenType: string,
    amount: bigint,
    ttl: Date = ttlOneHour(),
  ): Promise<void> {
    const balanceOf = async (): Promise<bigint> => {
      const state = await this.wallet.waitForSyncedState();
      return state.shielded.balances[tokenType] ?? 0n;
    };
    // A self-transfer is value preserving for this token (fees are paid in
    // DUST), so the pre-transfer balance is what we wait to see come back.
    const expected = await balanceOf();

    this.logger.info(`Self-transferring ${amount} of ${tokenType.slice(0, 16)}… to re-nonce`);
    const recipe = await this.wallet.transferTransaction(
      [
        {
          type: 'shielded',
          outputs: [{ type: tokenType, receiverAddress: this.getShieldedAddress(), amount }],
        },
      ],
      {
        shieldedSecretKeys: this.zswapSecretKeys,
        dustSecretKey: this.dustSecretKey,
      },
      { ttl, payFees: true },
    );
    const signed = await this.wallet.signRecipe(recipe, (payload) =>
      this.unshieldedKeystore.signData(payload),
    );
    const finalized = await this.wallet.finalizeRecipe(signed);
    await this.wallet.submitTransaction(finalized);

    // submitTransaction returns once the transaction is accepted, not once it
    // is on chain and indexed. Until then the input coin is spent and the
    // replacement is not visible yet, so wait for the balance to reappear
    // before anyone tries to use the new coin.
    const deadline = Date.now() + 300_000;
    for (;;) {
      if ((await balanceOf()) === expected) {
        this.logger.info('Re-nonced coin is visible; split complete');
        return;
      }
      if (Date.now() > deadline) {
        throw new Error(`Split of ${tokenType} did not settle within 300s`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }

  async start(): Promise<void> {
    this.logger.info('Starting wallet...');
    await this.wallet.start(this.zswapSecretKeys, this.dustSecretKey);
  }

  async stop(): Promise<void> {
    return this.wallet.stop();
  }

  /**
   * Build an un-started wallet provider.
   *
   * Pass `opts.fastSync` to pre-seed the wallet from the shipped reference
   * bundle so it starts near chain tip instead of walking the chain from
   * genesis (~75s instead of ~78min on preprod). The safety guard inside only
   * seeds a wallet whose birthday is at or after the reference height, so
   * enabling it on a wallet with earlier history falls back to a full sync
   * rather than hiding that wallet's funds. See FAST-SYNC.md.
   *
   * Omit it and this is exactly the normal `FluentWalletBuilder` path.
   */
  static async build(
    logger: Logger,
    env: EnvironmentConfiguration,
    secret: WalletSecret,
    opts?: { fastSync?: FastSyncOptions },
  ): Promise<MidnightWalletProvider> {
    if (opts?.fastSync) {
      const { facade, zswapSecretKeys, dustSecretKey, keystore } = await assembleWallet(
        logger,
        env,
        secret,
        opts.fastSync,
      );
      logger.info(`Wallet built from ${secret.kind} (fast-sync enabled).`);
      return new MidnightWalletProvider(
        logger,
        facade,
        zswapSecretKeys,
        dustSecretKey,
        keystore,
      );
    }

    const dustOptions: DustWalletOptions = {
      ledgerParams: LedgerParameters.initialParameters(),
      additionalFeeOverhead: 1_000n,
      feeBlocksMargin: 5,
    };

    const base = FluentWalletBuilder.forEnvironment(env)
      .withDustOptions(dustOptions);
    const builder =
      secret.kind === 'mnemonic'
        ? base.withMnemonic(secret.value)
        : base.withSeed(secret.value);

    const buildResult = await builder.buildWithoutStarting();
    const { wallet, seeds, keystore } = buildResult as {
      wallet: WalletFacade;
      seeds: {
        masterSeed: string;
        shielded: Uint8Array;
        dust: Uint8Array;
      };
      keystore: UnshieldedKeystore;
    };

    logger.info(
      `Wallet built from ${secret.kind}; master seed: ${seeds.masterSeed.slice(0, 8)}...`,
    );

    return new MidnightWalletProvider(
      logger,
      wallet,
      ZswapSecretKeys.fromSeed(seeds.shielded),
      DustSecretKey.fromSeed(seeds.dust),
      keystore,
    );
  }
}

function isProgressStrictlyComplete(progress: unknown): boolean {
  if (!progress || typeof progress !== 'object') {
    return false;
  }
  const candidate = progress as { isStrictlyComplete?: unknown };
  if (typeof candidate.isStrictlyComplete !== 'function') {
    return false;
  }
  return (candidate.isStrictlyComplete as () => boolean)();
}

export async function syncWallet(
  logger: Logger,
  wallet: WalletFacade,
  timeout = 300_000,
): Promise<FacadeState> {
  logger.info('Syncing wallet...');
  let emissionCount = 0;
  return Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.tap((state: FacadeState) => {
        emissionCount++;
        const shielded = isProgressStrictlyComplete(state.shielded.state.progress);
        const unshielded = isProgressStrictlyComplete(state.unshielded.progress);
        const dust = isProgressStrictlyComplete(state.dust.state.progress);
        logger.info(
          `Wallet sync [${emissionCount}]: shielded=${shielded}, unshielded=${unshielded}, dust=${dust}`,
        );
        if (!shielded) {
          logger.debug(`  shielded.progress: ${JSON.stringify(state.shielded.state.progress)}`);
        }
        if (!unshielded) {
          logger.debug(`  unshielded.progress: ${JSON.stringify(state.unshielded.progress)}`);
        }
        if (!dust) {
          logger.debug(`  dust.progress: ${JSON.stringify(state.dust.state.progress)}`);
        }
      }),
      Rx.filter(
        (state: FacadeState) =>
          isProgressStrictlyComplete(state.shielded.state.progress) &&
          isProgressStrictlyComplete(state.dust.state.progress) &&
          isProgressStrictlyComplete(state.unshielded.progress),
      ),
      Rx.tap(() => logger.info(`Wallet sync complete after ${emissionCount} emissions`)),
      Rx.timeout({
        each: timeout,
        with: () =>
          Rx.throwError(
            () => new Error(`Wallet sync timeout after ${timeout}ms (${emissionCount} emissions received)`),
          ),
      }),
      Rx.catchError((err) => {
        logger.error(`Wallet sync error: ${err}`);
        return Rx.throwError(() => err);
      }),
    ),
  );
}
