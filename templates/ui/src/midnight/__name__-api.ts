// Contract operations the UI calls. Each one is the browser counterpart of a
// step in the Node test (examples/__name__/src/test/); the only difference is
// where `providers` came from.
//
// Seed file: generated once by `yarn new:ui` from contract-info.json, then
// yours to edit. The drift check ignores it.
import {
  deployContract,
  findDeployedContract,
  type FoundContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import type { ContractAddress } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import { map, type Observable } from "rxjs";
import {
  Compiled__Name__Contract,
  __PS_CONTRACT_IMPORT__ledger,
  PRIVATE_STATE_ID,
  type Contract,
  type Ledger,
} from "./contract";
import type { __Name__Providers } from "./providers";

export type __Name__Contract = FoundContract<Contract>;
__CTOR_ARGS_TYPE__
/**
 * Deploy a fresh __name__ contract. The wallet is asked to balance and sign
 * the deploy tx.
 */
export async function deploy__Name__(
  providers: __Name__Providers,__DEPLOY_PARAMS__
): Promise<{ contract: __Name__Contract; address: ContractAddress }> {
  const deployed = await deployContract(providers, {
    compiledContract: Compiled__Name__Contract,
    privateStateId: PRIVATE_STATE_ID,
    __INITIAL_PS__,__DEPLOY_ARGS__
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
export async function join__Name__(
  providers: __Name__Providers,
  address: ContractAddress,__JOIN_PARAMS__
): Promise<__Name__Contract> {
  return findDeployedContract(providers, {
    compiledContract: Compiled__Name__Contract,
    contractAddress: address,
    privateStateId: PRIVATE_STATE_ID,
    __INITIAL_PS__,
  });
}

// One wrapper per provable circuit. midnight-js runs the circuit locally,
// proves it (wallet or proof server), then gets the wallet to balance and
// submit it. Each resolves once the tx is final on chain.
__CIRCUIT_WRAPPERS__
/**
 * Live view of the public ledger. The indexer pushes each new contract state
 * over its websocket, and the compiler-generated `ledger()` decodes it.
 */
export function ledger$(
  providers: __Name__Providers,
  address: ContractAddress,
): Observable<Ledger> {
  return providers.publicDataProvider
    .contractStateObservable(address, { type: "latest" })
    .pipe(map((state) => ledger(state.data)));
}
