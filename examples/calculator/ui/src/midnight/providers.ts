// Builds the MidnightProviders bundle for the browser.
//
// This mirrors examples/calculator/src/providers.ts (the Node harness), with
// each Node-only piece swapped for a browser one:
//
//   provider              Node harness                  Browser (here)
//   --------------------  ----------------------------  ---------------------------------------
//   publicDataProvider    indexer from src/config.ts    indexer URIs from the wallet's config
//   zkConfigProvider      NodeZkConfigProvider (disk)   FetchZkConfigProvider (HTTP, /managed/…)
//   proofProvider         local proof server            wallet-delegated OR local proof server
//   privateStateProvider  LevelDB                       in-memory, session-only (./private-state.ts)
//   walletProvider        wallet-sdk WalletFacade       Lace via the DApp Connector API
//   midnightProvider      wallet-sdk WalletFacade       Lace via the DApp Connector API
import type { ConnectedAPI } from "@midnight-ntwrk/dapp-connector-api";
import { dappConnectorProofProvider } from "@midnight-ntwrk/midnight-js-dapp-connector-proof-provider";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import {
  CostModel,
  Transaction,
  type FinalizedTransaction,
} from "@midnight-ntwrk/midnight-js-protocol/ledger";
import type {
  MidnightProvider,
  MidnightProviders,
  ProofProvider,
  WalletProvider,
} from "@midnight-ntwrk/midnight-js-types";
import {
  fromHex,
  parseCoinPublicKeyToHex,
  parseEncPublicKeyToHex,
  toHex,
} from "@midnight-ntwrk/midnight-js-utils";
import {
  PRIVATE_STATE_ID,
  ZK_ASSETS_PATH,
  type CalculatorCircuits,
  type CalculatorPrivateState,
} from "./contract";
import { inMemoryPrivateStateProvider } from "./private-state";

export type CalculatorProviders = MidnightProviders<
  CalculatorCircuits,
  typeof PRIVATE_STATE_ID,
  CalculatorPrivateState
>;

/**
 * Where ZK proofs get generated.
 *  - "wallet": the connected wallet proves (ConnectedAPI.getProvingProvider).
 *    There's nothing else to run, and witness data never leaves the wallet.
 *  - "local": a proof server you run yourself (`yarn proof:up` in
 *    examples/calculator), same as the Node test harness.
 * Avoid public/hosted proof servers: whoever runs them sees your proof inputs.
 */
export type ProvingMode = "wallet" | "local";

export interface ProvingOptions {
  mode: ProvingMode;
  /** Used only when mode === "local". */
  proofServerUrl: string;
}

export const DEFAULT_PROOF_SERVER_URL = "http://127.0.0.1:6300";

export async function createProviders(
  api: ConnectedAPI,
  proving: ProvingOptions,
): Promise<CalculatorProviders> {
  // The wallet decides which network we're on. Everything below (indexer
  // endpoints, network id for address encoding) follows from its config, so
  // the same build works on local `undeployed`, preview, and preprod.
  const config = await api.getConfiguration();
  setNetworkId(config.networkId);

  // Pass the browser's WebSocket explicitly. The provider's default comes from
  // `import * as ws from 'isomorphic-ws'` and reads `ws.WebSocket`, but the
  // browser build of isomorphic-ws only has a default export, so that default
  // is `undefined` once bundled (Vite warns about this at build time). The
  // Node harness gets around it with `globalThis.WebSocket = WebSocket`.
  const publicDataProvider = indexerPublicDataProvider(
    config.indexerUri,
    config.indexerWsUri,
    window.WebSocket as unknown as Parameters<typeof indexerPublicDataProvider>[2],
  );

  // Fetches keys/<circuit>.{prover,verifier} and zkir/<circuit>.bzkir for
  // each circuit from the page's own origin. scripts/copy-zk.mjs puts them there.
  const zkConfigProvider = new FetchZkConfigProvider<CalculatorCircuits>(
    new URL(ZK_ASSETS_PATH, window.location.origin).toString(),
    fetch.bind(window),
  );

  const proofProvider = await createProofProvider(api, zkConfigProvider, proving);

  // The connector returns Bech32m-encoded keys. The ledger works with hex, so
  // normalize both here. parse*ToHex passes hex through unchanged.
  const { shieldedCoinPublicKey, shieldedEncryptionPublicKey } =
    await api.getShieldedAddresses();
  const coinPublicKey = parseCoinPublicKeyToHex(shieldedCoinPublicKey, config.networkId);
  const encryptionPublicKey = parseEncPublicKeyToHex(
    shieldedEncryptionPublicKey,
    config.networkId,
  );

  const walletProvider: WalletProvider = {
    getCoinPublicKey: () => coinPublicKey,
    getEncryptionPublicKey: () => encryptionPublicKey,
    // midnight-js hands us a proven but *unbound* transaction
    // (Transaction<SignatureEnabled, Proof, PreBinding>). The Node harness
    // balances it with WalletFacade.balanceUnboundTransaction. In the browser
    // Lace does the same job: it adds DUST fee inputs, signs, and binds. The
    // connector speaks hex strings, so we serialize, hand it over, and
    // deserialize the result as a FinalizedTransaction
    // (Transaction<SignatureEnabled, Proof, Binding>). The TTL is up to the
    // wallet; the connector has no ttl parameter.
    balanceTx: async (tx, _ttl) => {
      const { tx: balancedHex } = await api.balanceUnsealedTransaction(
        toHex(tx.serialize()),
      );
      return Transaction.deserialize(
        "signature",
        "proof",
        "binding",
        fromHex(balancedHex),
      ) satisfies FinalizedTransaction;
    },
  };

  const midnightProvider: MidnightProvider = {
    // submitTransaction resolves to void, so read the tx id off the
    // transaction itself (the same id the indexer reports).
    submitTx: async (tx) => {
      await api.submitTransaction(toHex(tx.serialize()));
      const [txId] = tx.identifiers();
      if (!txId) throw new Error("Submitted transaction has no identifier");
      return txId;
    },
  };

  return {
    privateStateProvider: inMemoryPrivateStateProvider<
      typeof PRIVATE_STATE_ID,
      CalculatorPrivateState
    >(),
    publicDataProvider,
    zkConfigProvider,
    proofProvider,
    walletProvider,
    midnightProvider,
  };
}

async function createProofProvider(
  api: ConnectedAPI,
  zkConfigProvider: FetchZkConfigProvider<CalculatorCircuits>,
  proving: ProvingOptions,
): Promise<ProofProvider> {
  if (proving.mode === "local") {
    return httpClientProofProvider(proving.proofServerUrl, zkConfigProvider);
  }
  // The wallet gets the key material from zkConfigProvider and proves itself.
  // httpClientProofProvider uses CostModel.initialCostModel() internally, so we
  // pass the same one here.
  return dappConnectorProofProvider(
    api,
    zkConfigProvider,
    CostModel.initialCostModel(),
  );
}
