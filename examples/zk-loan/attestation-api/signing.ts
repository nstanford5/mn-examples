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

// Schnorr-on-Jubjub signing — the off-chain half of contract/schnorr.compact.
// Ported from midnightntwrk/example-zkloan
// (zkloan-credit-scorer-attestation-api/src/signing.ts).
//
// Scheme (G = Jubjub generator, pk = sk*G):
//   R = k*G                                  (fresh random nonce k)
//   c = schnorrChallenge(R, pk, msg) mod 2^248
//   s = k + c*sk  (mod Jubjub order)
// The circuit checks s*G == R + c*pk. Both sides MUST compute the challenge
// identically, so this uses the contract's own exported pure circuit
// `schnorrChallenge` rather than re-implementing the hash.
import * as crypto from 'node:crypto';
import { ecMulGenerator, type JubjubPoint } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import { pureCircuits, type Schnorr_SchnorrSignature } from '../contract/index.js';

// Order of the Jubjub prime-order subgroup. Scalars passed to ecMulGenerator
// must be below this or it throws "out of bounds for prime field".
export const JUBJUB_ORDER = 6554484396890773809930967563523245729705921265872317281365359162392183254199n;
// The circuit truncates the BLS12-381 challenge hash to 248 bits so it is a
// valid Jubjub scalar; the signer must truncate the same way.
export const TWO_248 = 452312848583266388373324160190187140051835877600158453279131187530910662656n;

const reduce = (x: bigint): bigint => ((x % JUBJUB_ORDER) + JUBJUB_ORDER) % JUBJUB_ORDER;

// A uniformly-ish random scalar. 256 random bits reduced mod the ~2^252 order
// has negligible bias for a demo; a production signer would use rejection
// sampling and HSM-held keys.
function randomScalar(): bigint {
  return BigInt('0x' + crypto.randomBytes(32).toString('hex')) % JUBJUB_ORDER;
}

export function generateKeyPair(): { sk: bigint; pk: JubjubPoint } {
  const sk = randomScalar();
  return { sk, pk: ecMulGenerator(sk) };
}

export function getPublicKey(sk: bigint): JubjubPoint {
  return ecMulGenerator(reduce(sk));
}

// Sign a 4-element message. The nonce k is fresh per signature — reusing a
// nonce across two messages leaks the secret key.
export function sign(sk: bigint, msg: bigint[]): Schnorr_SchnorrSignature {
  sk = reduce(sk);
  const pk = ecMulGenerator(sk);
  const k = randomScalar();
  const R = ecMulGenerator(k);
  // pureCircuits.schnorrChallenge returns the full transientHash output; the
  // circuit reduces it mod 2^248 before the EC ops, so do the same here.
  const c = pureCircuits.schnorrChallenge(R.x, R.y, pk.x, pk.y, msg) % TWO_248;
  // s must be reduced mod the Jubjub order (not the BLS12-381 field), because
  // the circuit feeds it to ecMulGenerator.
  const s = reduce(k + c * sk);
  return { announcement: R, response: s };
}

// The exact message layout `evaluateApplicant` rebuilds in-circuit:
// [creditScore, monthlyIncome, monthsAsCustomer, userPubKeyHash]. The last
// element binds the attestation to one borrower identity, so it cannot be
// replayed by anyone else.
export function signCreditData(
  sk: bigint,
  creditScore: number | bigint,
  monthlyIncome: number | bigint,
  monthsAsCustomer: number | bigint,
  userPubKeyHash: bigint,
): Schnorr_SchnorrSignature {
  return sign(sk, [BigInt(creditScore), BigInt(monthlyIncome), BigInt(monthsAsCustomer), userPubKeyHash]);
}
