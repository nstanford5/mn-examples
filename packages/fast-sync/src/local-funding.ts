// NIGHT transfers and DUST registration for an assembled wallet. They are
// used by scripts/fund-wallet.ts to fund a browser wallet (Lace) on the local
// devnet, which has no faucet.
//
// Moved here from examples/hello-world/src/wallet.ts (they were
// MidnightWalletProvider methods), so every generated UI shares one
// `yarn fund:wallet` instead of each example copying it.

import { nativeToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { DustAddress, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk';
import type { AssembledWallet } from './fast-wallet.js';

const ttlOneHour = () => new Date(Date.now() + 60 * 60_000);

/**
 * Sends unshielded NIGHT (`amount` in STAR, 1 NIGHT = 1_000_000 STAR) to
 * another wallet. `w` pays the fee in DUST. The recipient only earns DUST from
 * this NIGHT once it registers it for DUST generation itself. Returns the tx id.
 */
export async function transferNight(
  w: AssembledWallet,
  to: UnshieldedAddress,
  amount: bigint,
  ttl: Date = ttlOneHour(),
): Promise<string> {
  const recipe = await w.facade.transferTransaction(
    [{ type: 'unshielded', outputs: [{ type: nativeToken().raw, receiverAddress: to, amount }] }],
    { shieldedSecretKeys: w.zswapSecretKeys, dustSecretKey: w.dustSecretKey },
    { ttl },
  );
  const signed = await w.facade.signRecipe(recipe, (payload) => w.keystore.signData(payload));
  return await w.facade.submitTransaction(await w.facade.finalizeRecipe(signed));
}

/**
 * Registers `w`'s not-yet-registered NIGHT UTXOs for DUST generation, sending
 * the DUST they generate to `dustReceiver` instead of to `w`. DUST can't be
 * transferred, but a NIGHT holder can point its generation at any DUST
 * address, so a browser wallet gets DUST without signing anything. Returns the
 * tx id, or null if there was nothing to register.
 */
export async function registerNightForDust(w: AssembledWallet, dustReceiver: DustAddress): Promise<string | null> {
  const state = await w.facade.waitForSyncedState();
  const night = nativeToken().raw;
  const unregistered = state.unshielded.availableCoins.filter(
    (coin) => coin.utxo.type === night && coin.meta.registeredForDustGeneration === false,
  );
  if (unregistered.length === 0) return null;
  const recipe = await w.facade.registerNightUtxosForDustGeneration(
    unregistered,
    w.keystore.getPublicKey(),
    (payload) => w.keystore.signData(payload),
    dustReceiver,
  );
  return await w.facade.submitTransaction(await w.facade.finalizeRecipe(recipe));
}
