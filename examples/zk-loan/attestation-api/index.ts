// This file is part of example-zk-loan.
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

// Standalone entry point: `yarn attestation:start` (from examples/zk-loan).
// Ported from midnightntwrk/example-zkloan
// (zkloan-credit-scorer-attestation-api/src/index.ts).
//
// Env:
//   PORT                 listen port (default 4000)
//   PROVIDER_ID          on-chain provider id this key is registered under (default 1)
//   PROVIDER_SECRET_KEY  hex Jubjub secret; omit for a fresh ephemeral key each start
//                        (which then has to be re-registered on-chain)
//   NETWORK_ID           default 'undeployed'
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { createServer } from './server.js';
import { generateKeyPair, getPublicKey, JUBJUB_ORDER } from './signing.js';

setNetworkId(process.env['NETWORK_ID'] || 'undeployed');

const PORT = parseInt(process.env['PORT'] || '4000', 10);
const PROVIDER_ID = parseInt(process.env['PROVIDER_ID'] || '1', 10);

let providerSk: bigint;
const secretHex = process.env['PROVIDER_SECRET_KEY'];
if (secretHex) {
  // Reduce so any 32-byte hex value is a valid Jubjub scalar.
  providerSk = BigInt('0x' + secretHex) % JUBJUB_ORDER;
  console.log('Loaded provider secret key from environment');
} else {
  providerSk = generateKeyPair().sk;
  console.log('Generated ephemeral provider key pair');
}

const pk = getPublicKey(providerSk);
console.log(`Provider ID: ${PROVIDER_ID}`);
console.log('Provider public key:');
console.log(`  x: ${pk.x}`);
console.log(`  y: ${pk.y}`);
console.log(`Register this provider on-chain with: registerProvider(${PROVIDER_ID}, {x: ${pk.x}n, y: ${pk.y}n})`);

createServer(providerSk, PROVIDER_ID).listen(PORT, () => {
  console.log(`Attestation API listening on port ${PORT}`);
});
