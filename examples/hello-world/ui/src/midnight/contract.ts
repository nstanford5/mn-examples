// Browser-side handle on the compiled hello-world contract.
//
// examples/hello-world/contract/index.ts can't be reused here: it imports
// `node:path` to build an absolute zkConfigPath for NodeZkConfigProvider. The
// compiler's generated JS (contract/managed/hello-world/contract/index.js) is
// plain ESM with no Node dependencies, so we import it directly. Run
// `yarn compile` in examples/hello-world first; the managed/ output is
// gitignored.
import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/compact-js";
import {
  Contract,
  ledger,
  type Ledger,
} from "../../../contract/managed/hello-world/contract/index.js";

export { Contract, ledger, type Ledger };

/** The contract's only provable circuit, i.e. the only ZK key set we serve. */
export type HelloWorldCircuits = "storeMessage";

/**
 * hello-world has no witnesses, so there's no private state. deployContract
 * still wants a private-state id and an initial value, as in the Node test
 * (src/test/hw.test.ts), so we store an empty object.
 */
export type HelloWorldPrivateState = Record<string, never>;
export const PRIVATE_STATE_ID = "helloWorldPrivateState";

/** Where copy-zk.mjs puts the keys and zkir, relative to the page origin. */
export const ZK_ASSETS_PATH = "managed/hello-world";

/**
 * Same construction as CompiledHelloWorldContract in contract/index.ts:
 *  - withVacantWitnesses: the contract declares no witnesses.
 *  - withCompiledFileAssets: required by the type, so the result is a fully
 *    configured CompiledContract. In the browser, midnight-js-contracts gets
 *    verifier/prover keys and ZKIR from `providers.zkConfigProvider`
 *    (a FetchZkConfigProvider pointed at ZK_ASSETS_PATH), not from this path.
 */
export const CompiledHelloWorldContract = CompiledContract.make(
  "HelloWorldContract",
  Contract,
).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(ZK_ASSETS_PATH),
);
