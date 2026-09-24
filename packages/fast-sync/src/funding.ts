// The faucet funding gate for remote (preview/preprod) runs.
//
// "Synced" is not "funded". syncWallet's isStrictlyComplete() means the wallet
// has caught up to chain tip; a wallet that has never been funded is at tip
// with zero coins and fails its first submit with Wallet.InsufficientFunds.
//
// This blocks instead: it prints the address, waits for NIGHT to land from the
// faucet, registers that NIGHT for DUST generation, then waits again for
// spendable DUST to accrue (the registration self-funds from the DUST its own
// NIGHT generates, so that second wait is real).
//
// Lifted from examples/hello-world's test suite, which was the only place in
// the repo that did this, and generalized with `registerDust` for Dave.

import { waitForFunds, type EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import type { FacadeState, UnshieldedKeystore, WalletFacade } from '@midnight-ntwrk/wallet-sdk';
import * as Rx from 'rxjs';
import type { Logger } from 'pino';

/** How long to wait for a human to visit the faucet, and for DUST to accrue. */
export const FUND_TIMEOUT_MS = Number(process.env['MIDNIGHT_FUND_TIMEOUT_MS'] ?? 30 * 60_000);

function hasNight(s: FacadeState): boolean {
  return Object.values(s.unshielded.balances).some((v) => v > 0n);
}

/**
 * Block until the wallet holds at least `minCoins` spendable DUST coin(s).
 *
 * Shared by the funding gate and each example's scripts/wait-for-dust.ts.
 */
export async function waitForDust(
  logger: Logger,
  wallet: WalletFacade,
  minCoins = 1,
  timeoutMs = 180_000,
): Promise<void> {
  logger.info(`Waiting for >=${minCoins} spendable DUST coin(s) (timeout ${timeoutMs}ms)...`);
  await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.tap((s: FacadeState) =>
        logger.info(`dust: ${s.dust.availableCoins.length} coin(s), balance ${s.dust.balance(new Date())} STAR`),
      ),
      Rx.filter((s: FacadeState) => s.dust.availableCoins.length >= minCoins),
      Rx.take(1),
      Rx.timeout({
        each: timeoutMs,
        with: () => Rx.throwError(() => new Error(`No spendable DUST coin within ${timeoutMs}ms`)),
      }),
    ),
  );
  logger.info('DUST ready.');
}

export interface FundingGateOptions {
  /**
   * Register the wallet's NIGHT for DUST generation and wait for DUST.
   *
   * Pass false for Dave: the sponsorship suite needs a wallet that holds
   * tNIGHT but deliberately has NO DUST, because the whole point is that
   * Alice pays his fees. Registering him would break the suite's premise.
   */
  registerDust?: boolean;
  /** Label used in the log line, e.g. the role name. */
  label?: string;
}

/**
 * Hold until the wallet is usable on a remote network.
 *
 * Returns immediately once the wallet already has what it needs, so this is
 * cheap on every run after the first — the funding prompt only appears when
 * the wallet genuinely has no NIGHT.
 */
export async function waitForNightThenDust(
  logger: Logger,
  wallet: WalletFacade,
  keystore: UnshieldedKeystore,
  envConfig: EnvironmentConfiguration,
  faucet: string,
  opts: FundingGateOptions = {},
): Promise<void> {
  const { registerDust = true, label = 'wallet' } = opts;
  const address = String(keystore.getBech32Address());

  // Peek at the current state to decide whether to prompt at all. Bounded:
  // if state() has not emitted yet we simply assume "not funded" and fall into
  // the wait below, which has its own timeout. An unbounded firstValueFrom here
  // would hang the whole beforeAll hook instead.
  const current = await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.timeout({ each: 30_000, with: () => Rx.of(null) }),
      Rx.catchError(() => Rx.of(null)),
    ),
  );
  if (current === null || !hasNight(current)) {
    logger.info('────────────────────────────────────────────────────────────');
    logger.info(`Fund ${label} with NIGHT at the faucet — the suite resumes automatically once it arrives:`);
    logger.info(`  address: ${address}`);
    logger.info(`  faucet:  ${faucet}`);
    if (!registerDust) {
      logger.info('  NOTE: this wallet must NOT have DUST delegated — send tNIGHT only.');
    }
    logger.info('────────────────────────────────────────────────────────────');

    await Rx.firstValueFrom(
      wallet.state().pipe(
        Rx.filter(hasNight),
        Rx.take(1),
        Rx.timeout({
          each: FUND_TIMEOUT_MS,
          with: () =>
            Rx.throwError(
              () => new Error(`No NIGHT at ${address} within ${FUND_TIMEOUT_MS}ms — fund it at ${faucet}`),
            ),
        }),
      ),
    );
  }

  if (!registerDust) {
    logger.info(`${label}: NIGHT present; skipping DUST registration by design.`);
    return;
  }

  logger.info(`${label}: NIGHT present; registering NIGHT->DUST generation...`);
  await waitForFunds(wallet, envConfig, false, keystore);
  await waitForDust(logger, wallet, 1, FUND_TIMEOUT_MS);
  logger.info(`${label}: funded and ready.`);
}
