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

// Wire types for the attestation API. JSON has no bigint, so every field-sized
// value travels as a decimal string; clients convert with BigInt(...).

export interface AttestationRequest {
  creditScore: number;
  monthlyIncome: number;
  monthsAsCustomer: number;
  // transientHash(deriveUserPublicKey(secret, pin)) as a decimal string. The
  // borrower computes it locally, so the API never learns the secret or PIN.
  userPubKeyHash: string;
}

export interface AttestationResponse {
  signature: {
    announcement: { x: string; y: string };
    response: string;
  };
  message: {
    creditScore: string;
    monthlyIncome: string;
    monthsAsCustomer: string;
    userPubKeyHash: string;
  };
}

export interface ProviderInfoResponse {
  providerId: number;
  publicKey: { x: string; y: string };
}

export interface HealthResponse {
  status: string;
  providerId: number;
}
