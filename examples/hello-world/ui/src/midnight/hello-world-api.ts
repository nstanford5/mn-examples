// Contract operations the UI calls. Each one is the browser counterpart of a
// step in the Node test (examples/hello-world/src/test/hw.test.ts). The only
// difference is where `providers` came from.
import {
  deployContract,
  findDeployedContract,
  type FoundContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import type { ContractAddress } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import { map, type Observable } from "rxjs";
import {
  CompiledHelloWorldContract,
  ledger,
  createInitialPrivateState,
  PRIVATE_STATE_ID,
  type Contract,
} from "./contract";
import type { HelloWorldProviders } from "./providers";

export type HelloWorldContract = FoundContract<Contract>;

/**
 * Deploy a fresh hello-world contract. The wallet is asked to balance and sign
 * the deploy tx. `message` starts as "" because the contract has no
 * constructor.
 */
export async function deployHelloWorld(
  providers: HelloWorldProviders,
): Promise<{ contract: HelloWorldContract; address: ContractAddress }> {
  const deployed = await deployContract(providers, {
    compiledContract: CompiledHelloWorldContract,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: createInitialPrivateState(),
  });
  return {
    contract: deployed,
    address: deployed.deployTxData.public.contractAddress,
  };
}

/**
 * Attach to an existing deployment by address. findDeployedContract fetches
 * the on-chain state and checks that its verifier keys match the ones we serve
 * (a wrong address or a different contract fails here, before any tx).
 */
export async function joinHelloWorld(
  providers: HelloWorldProviders,
  address: ContractAddress,
): Promise<HelloWorldContract> {
  return findDeployedContract(providers, {
    compiledContract: CompiledHelloWorldContract,
    contractAddress: address,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: createInitialPrivateState(),
  });
}

/**
 * Call the `storeMessage` circuit. midnight-js runs the circuit locally,
 * proves it (wallet or proof server), then gets the wallet to balance and
 * submit it. Resolves once the tx is final on chain.
 */
export async function storeMessage(
  contract: HelloWorldContract,
  message: string,
): Promise<void> {
  await contract.callTx.storeMessage(message);
}

/**
 * Live view of the public `message` ledger field. The indexer pushes each new
 * contract state over its websocket, and the compiler-generated `ledger()`
 * decodes it.
 */
export function message$(
  providers: HelloWorldProviders,
  address: ContractAddress,
): Observable<string> {
  return providers.publicDataProvider
    .contractStateObservable(address, { type: "latest" })
    .pipe(map((state) => ledger(state.data).message));
}
