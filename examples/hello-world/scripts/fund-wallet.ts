// This file is part of example-hello-world.
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

// Fund a browser wallet (e.g. Lace) on the LOCAL devnet so it can pay fees.
//
//   yarn fund:wallet <mn_dust_undeployed1...> [mn_addr_undeployed1...]
//
// The ui/ frontend needs this before it can deploy. Every tx pays its fee in
// DUST, a new wallet has none, and the local devnet has no faucet.
//
// DUST can't be transferred. It accrues from NIGHT that is registered for DUST
// generation, and registration can name any DUST address as the receiver. So:
//   1. The genesis wallet (Alice, seed 0…01; the only funded wallet on the
//      devnet) sends NIGHT to a throwaway "sponsor" wallet.
//   2. The sponsor registers that NIGHT for DUST generation with the browser
//      wallet's DUST address as receiver. From then on, DUST accrues to the
//      browser wallet without it signing anything.
// Alice's own NIGHT stays registered to Alice, so the test suites are unaffected.
//
// If an unshielded mn_addr_… address is also given, Alice sends it some NIGHT
// too (handy for exploring the wallet; not needed for fees).

import { createHash } from 'node:crypto';
import pino from 'pino';
import * as Rx from 'rxjs';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { nativeToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { DustAddress, MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk';
import { getConfig } from '../src/config.js';
import { MidnightWalletProvider, syncWallet, waitForDust } from '../src/wallet.js';

// Must match src/test/hw.test.ts.
const ALICE_SEED = '0000000000000000000000000000000000000000000000000000000000000001';
// Deterministic throwaway seed, used only on the local devnet. Distinct from
// the Alice/Bob/Charlie/Dave seeds (0…01–0…04) the test suites use.
const SPONSOR_SEED = createHash('sha256').update('mn-examples/hello-world/ui dust sponsor').digest('hex');
// NIGHT has 6 decimals: amounts on chain are in STAR (1 NIGHT = 1_000_000 STAR).
const STAR_PER_NIGHT = 1_000_000n;
// More registered NIGHT means DUST accrues faster and to a higher cap.
const SPONSOR_NIGHT = 100_000n * STAR_PER_NIGHT;
const WALLET_NIGHT = 1_000n * STAR_PER_NIGHT;

const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info', transport: { target: 'pino-pretty' } });

const args = process.argv.slice(2);
const dustArg = args.find((a) => a.startsWith('mn_dust_'));
const addrArg = args.find((a) => a.startsWith('mn_addr_'));
if (!dustArg) {
  logger.error('usage: yarn fund:wallet <mn_dust_undeployed1...> [mn_addr_undeployed1...]');
  logger.error('The ui/ page shows your wallet\'s DUST address in its "no DUST" warning.');
  process.exit(1);
}

const config = getConfig();
if (config.networkId !== 'undeployed') {
  logger.error(`fund:wallet only targets the local devnet (MIDNIGHT_NETWORK=local), not ${config.networkId}`);
  process.exit(1);
}
setNetworkId(config.networkId);
const envConfig: EnvironmentConfiguration = { walletNetworkId: config.networkId, ...config };

const dustReceiver = MidnightBech32m.parse(dustArg).decode(DustAddress, config.networkId);
const nightRecipient = addrArg
  ? MidnightBech32m.parse(addrArg).decode(UnshieldedAddress, config.networkId)
  : null;

const alice = await MidnightWalletProvider.build(logger, envConfig, { kind: 'seed', value: ALICE_SEED });
const sponsor = await MidnightWalletProvider.build(logger, envConfig, { kind: 'seed', value: SPONSOR_SEED });
await alice.start();
await sponsor.start();
try {
  await syncWallet(logger, alice.wallet, 180_000);
  await syncWallet(logger, sponsor.wallet, 180_000);
  await waitForDust(logger, alice.wallet, 1, 180_000);

  // 1. Fund the sponsor with NIGHT, and wait until it sees the new UTXO.
  const sponsorAddress = await sponsor.wallet.unshielded.getAddress();
  logger.info(`Sending ${SPONSOR_NIGHT / STAR_PER_NIGHT} NIGHT from genesis to the sponsor wallet...`);
  logger.info(`  tx: ${await alice.transferNight(sponsorAddress, SPONSOR_NIGHT)}`);
  await Rx.firstValueFrom(
    sponsor.wallet.state().pipe(
      Rx.filter((s) =>
        s.unshielded.availableCoins.some(
          (c) => c.utxo.type === nativeToken().raw && c.meta.registeredForDustGeneration === false,
        ),
      ),
      Rx.take(1),
      Rx.timeout(180_000),
    ),
  );

  // 2. Register the sponsor's NIGHT, pointing its DUST at the browser wallet.
  logger.info(`Registering the sponsor's NIGHT for DUST generation -> ${dustArg}`);
  const regTx = await sponsor.registerNightForDust(dustReceiver);
  logger.info(regTx ? `  tx: ${regTx}` : '  nothing new to register');

  if (nightRecipient) {
    await alice.wallet.waitForSyncedState();
    logger.info(`Sending ${WALLET_NIGHT / STAR_PER_NIGHT} NIGHT from genesis to ${addrArg}...`);
    logger.info(`  tx: ${await alice.transferNight(nightRecipient, WALLET_NIGHT)}`);
  }

  logger.info('Done. DUST now accrues to the browser wallet; give it a few blocks, then deploy.');
} catch (err) {
  logger.error(`fund-wallet failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await sponsor.stop().catch((err: unknown) => logger.warn(`sponsor stop() failed: ${String(err)}`));
  await alice.stop().catch((err: unknown) => logger.warn(`alice stop() failed: ${String(err)}`));
}
