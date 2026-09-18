// This file is part of example-secret-message.
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

// TypeScript implementations of the contract's witnesses — the off-chain logic
// Compact cannot express. Each witness receives a WitnessContext and returns a
// tuple [nextPrivateState, returnValue].
import { type Witnesses } from './managed/secret-message/contract/index.js';

// The private state carried between witness calls: the plaintext secret message.
// It lives only on the local prover and is never sent on-chain.
export type SecretMessagePrivateState = { message: string };

export const createSecretMessagePrivateState = (
  message: string,
): SecretMessagePrivateState => ({ message });

// Encode a UTF-8 string into exactly 32 bytes: the encoded text right-padded
// with zeros, or truncated to 32 bytes. This is the off-chain step that turns a
// human-readable message into the `Bytes<32>` value the circuit hashes. Because
// the compiler infers the witness return type as `Uint8Array`, the length is not
// enforced here — returning a differently sized array would fail at proving time,
// so we always produce 32 bytes.
export const encodeMessage = (message: string): Uint8Array => {
  const bytes = new TextEncoder().encode(message);
  const out = new Uint8Array(32);
  out.set(bytes.subarray(0, 32));
  return out;
};

// The `Witnesses<SecretMessagePrivateState>` annotation is load-bearing: leaving
// it to inference collapses the private-state type parameter to `never` and
// breaks the deploy/call overloads.
export const witnesses: Witnesses<SecretMessagePrivateState> = {
  secretMessage: ({ privateState }) => [
    privateState,
    encodeMessage(privateState.message),
  ],
};
