import { fileURLToPath } from 'node:url';
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
import { MidnightWalletProvider, syncWallet } from '../wallet.js';
import {
  getChainTipHeight,
  getOrCreateTestWallet,
  resolveWallet,
  waitForNightThenDust,
  REFERENCE_ROOT,
  type FastSyncOptions,
  type WalletSecret,
} from '@midnight-ntwrk/example-fast-sync';
import { buildProviders, type HelloWorldProviders } from '../providers.js';

// Where an auto-generated throwaway wallet is cached (gitignored). Only used
// when the root .env.<network> has no wallet for this network.
const WALLETS_DIR = fileURLToPath(new URL('../../.fast-sync-wallets', import.meta.url));
import {
  CompiledHelloWorldContract,
  Contract,
  ledger,
  zkConfigPath,
} from '../../contract/index.js';

// Required for GraphQL subscriptions in Node.js
// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
  console.error('Promise:', promise);
});

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

const ALICE_LOCAL_SEED =
  '0000000000000000000000000000000000000000000000000000000000000001';
const PRIVATE_STATE_ID = 'AlicePrivateHWState';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport: { target: 'pino-pretty' },
});

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';

interface WalletSetup {
  secret: WalletSecret;
  fastSync?: FastSyncOptions;
  /** True when a fresh wallet was just generated and still needs funding. */
  isNew: boolean;
}

// Resolve the wallet for a run.
//
// Preferred: one of the four shared wallets from the repo-root .env.<network>,
// which carry a recorded birthday and therefore fast-sync. Failing that, this
// example keeps its original standalone behaviour — generate a throwaway wallet
// at the current tip, fast-sync it, and ask the developer to fund it — so
// hello-world still works as a zero-setup smoke test.
async function resolveHelloWorldWallet(
  net: string,
  config: ReturnType<typeof getConfig>,
): Promise<WalletSetup> {
  if (net === 'local') {
    return { secret: { kind: 'seed', value: ALICE_LOCAL_SEED }, isNew: false };
  }

  try {
    const shared = resolveWallet(net);
    logger.info(
      shared.fastSync
        ? `Using ${shared.role} from the root .env.${net} (birthday ${shared.fastSync.birthday}); fast-sync enabled.`
        : `Using ${shared.role} from the root .env.${net} — no birthday recorded, so this is a full sync.`,
    );
    return { secret: shared.secret, fastSync: shared.fastSync, isNew: false };
  } catch {
    // Nothing in .env — fall through to the self-service path below.
  }

  const tip = await getChainTipHeight(config.indexer);
  if (tip === undefined) {
    throw new Error(`Could not read the ${net} chain tip to set the new wallet's birthday.`);
  }
  const { wallet, isNew } = getOrCreateTestWallet(WALLETS_DIR, config.networkId, tip);
  logger.info(
    isNew
      ? `Generated a new ${net} wallet (birthday ${wallet.birthday}); it will fast-sync, then you will be asked to fund it.`
      : `Reusing the saved ${net} wallet (birthday ${wallet.birthday}).`,
  );
  return {
    secret: { kind: 'seed', value: wallet.seed },
    fastSync: { referenceRoot: REFERENCE_ROOT, birthday: wallet.birthday },
    isNew,
  };
}

describe(`Hello World Contract (${network})`, () => {
  let wallet: MidnightWalletProvider;
  let providers: HelloWorldProviders;
  let contractAddress: ContractAddress;

  const config = getConfig();
  const isRemote = network !== 'local';
  const syncTimeoutMs = Number(
    process.env['MIDNIGHT_SYNC_TIMEOUT_MS'] ??
      (isRemote ? 60 * 60_000 : 10 * 60_000),
  );

  async function queryLedger(p: HelloWorldProviders) {
    const state = await p.publicDataProvider.queryContractState(contractAddress);
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

    const setup = await resolveHelloWorldWallet(network, config);
    wallet = await MidnightWalletProvider.build(logger, envConfig, setup.secret, {
      fastSync: setup.fastSync,
    });
    await wallet.start();
    await syncWallet(logger, wallet.wallet, syncTimeoutMs);

    if (isRemote) {
      // A freshly generated wallet holds no NIGHT. Block until the developer
      // funds it at the faucet, then until it has spendable DUST for fees.
      await waitForNightThenDust(
        logger,
        wallet.wallet,
        wallet.unshieldedKeystore,
        envConfig,
        config.faucet,
        { label: 'hello-world wallet' },
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

  it('Deploys the contract', async () => {
    logger.info(`Creating private state...`);

    const deployed: DeployedContract<Contract> =
      await (deployContract<Contract>)(providers, {
        compiledContract: CompiledHelloWorldContract,
        privateStateId: PRIVATE_STATE_ID,
        initialPrivateState: {},
      });

    logger.info(`Setting the contract address...`);
    contractAddress = deployed.deployTxData.public.contractAddress;
    logger.info(`Contract deployed at: ${contractAddress}`);
    expect(contractAddress).toBeDefined();
    expect(contractAddress.length).toBeGreaterThan(0);

    const state = await queryLedger(providers);
    expect(state.message).toEqual('');
  });

  it('Stores Hello World!', async () => {
    const message = 'Hello World!';

    await (submitCallTx<Contract, 'storeMessage'>)(providers, {
      compiledContract: CompiledHelloWorldContract,
      contractAddress,
      privateStateId: PRIVATE_STATE_ID,
      circuitId: 'storeMessage',
      args: [message],
    });

    const state = await queryLedger(providers);
    expect(state.message).toEqual(message);
  });
});
