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

// Test fixtures: sample profiles and signed private states. Ported from
// midnightntwrk/example-zkloan (contract/src/test/utils/test-data.ts). Signs
// in-process with the attestation API's signer, for the simulator tests that
// don't need HTTP; the on-chain suite goes through the API server itself.

import { type ZkLoanPrivateState } from '../../../contract/witnesses.js';
import { generateKeyPair, sign as schnorrSign } from '../../../attestation-api/signing.js';
import * as crypto from 'crypto';

export const userProfiles = [
  {
    applicantId: 'user-001',
    creditScore: 720,
    monthlyIncome: 2500,
    monthsAsCustomer: 24,
  },
  {
    applicantId: 'user-002',
    creditScore: 650,
    monthlyIncome: 1800,
    monthsAsCustomer: 11,
  },
  {
    applicantId: 'user-003',
    creditScore: 580,
    monthlyIncome: 2200,
    monthsAsCustomer: 36,
  },
  {
    applicantId: 'user-004',
    creditScore: 710,
    monthlyIncome: 1900,
    monthsAsCustomer: 5,
  },
  {
    applicantId: 'user-005',
    creditScore: 520,
    monthlyIncome: 3000,
    monthsAsCustomer: 48,
  },
  {
    applicantId: 'user-006',
    creditScore: 810,
    monthlyIncome: 4500,
    monthsAsCustomer: 60,
  },
  {
    applicantId: 'user-007',
    creditScore: 639,
    monthlyIncome: 2100,
    monthsAsCustomer: 18,
  },
  {
    applicantId: 'user-008',
    creditScore: 680,
    monthlyIncome: 1450,
    monthsAsCustomer: 30,
  },
  {
    applicantId: 'user-009',
    creditScore: 750,
    monthlyIncome: 2100,
    monthsAsCustomer: 23,
  },
  {
    applicantId: 'user-010',
    creditScore: 579,
    monthlyIncome: 1900,
    monthsAsCustomer: 12,
  },
];

// Key generation and Schnorr signing are the attestation API's own code
// (attestation-api/signing.ts), so these tests exercise the real signer.
export { schnorrSign };
export const generateProviderKeyPair = generateKeyPair;

export function generateUserSecret(): Uint8Array {
  return new Uint8Array(crypto.randomBytes(32));
}

export function createSignedUserProfile(
  index: number,
  providerSk: bigint,
  userPubKeyHash: bigint,
  providerId: bigint = 1n,
  userSecretKey: Uint8Array = generateUserSecret(),
): ZkLoanPrivateState {
  const profile = userProfiles[index];
  if (!profile) {
    throw new Error(`Index ${index} is out of bounds. Must be between 0 and ${userProfiles.length - 1}.`);
  }

  const msg: bigint[] = [
    BigInt(profile.creditScore),
    BigInt(profile.monthlyIncome),
    BigInt(profile.monthsAsCustomer),
    userPubKeyHash,
  ];

  const signature = schnorrSign(providerSk, msg);

  return {
    creditScore: BigInt(profile.creditScore),
    monthlyIncome: BigInt(profile.monthlyIncome),
    monthsAsCustomer: BigInt(profile.monthsAsCustomer),
    attestationSignature: signature,
    attestationProviderId: providerId,
    userSecretKey,
  };
}

export function createCustomSignedProfile(
  creditScore: bigint,
  monthlyIncome: bigint,
  monthsAsCustomer: bigint,
  providerSk: bigint,
  userPubKeyHash: bigint,
  providerId: bigint = 1n,
  userSecretKey: Uint8Array = generateUserSecret(),
): ZkLoanPrivateState {
  const msg: bigint[] = [creditScore, monthlyIncome, monthsAsCustomer, userPubKeyHash];
  const signature = schnorrSign(providerSk, msg);

  return {
    creditScore,
    monthlyIncome,
    monthsAsCustomer,
    attestationSignature: signature,
    attestationProviderId: providerId,
    userSecretKey,
  };
}

export function getUserProfile(
  index?: number,
  userSecretKey: Uint8Array = generateUserSecret(),
): ZkLoanPrivateState {
  let profile;
  if (index !== undefined) {
    if (index < 0 || index >= userProfiles.length) {
      throw new Error(`Index ${index} is out of bounds. Must be between 0 and ${userProfiles.length - 1}.`);
    }
    profile = userProfiles[index];
  } else {
    const randomIndex = Math.floor(Math.random() * userProfiles.length);
    profile = userProfiles[randomIndex];
  }
  return {
    creditScore: BigInt(profile.creditScore),
    monthlyIncome: BigInt(profile.monthlyIncome),
    monthsAsCustomer: BigInt(profile.monthsAsCustomer),
    attestationSignature: { announcement: { x: 0n, y: 0n }, response: 0n },
    attestationProviderId: 0n,
    userSecretKey,
  };
}
