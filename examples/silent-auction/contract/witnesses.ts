// This file is part of example-silent-auction.
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

// This file holds everything relating to the contract's private state. The
// silent-auction contract declares two witnesses:
//
//   witness localSk(): Bytes<32>;    // the caller's secret key
//   witness localSalt(): Bytes<32>;  // the organizer's commitment salt
//
// A participant's on-chain identity is derived *inside the circuit* from `sk`
// (getDappPubKey hashes it), never from the wallet. That means one wallet can
// act as several distinct auction identities simply by swapping which private
// state it presents — the pattern the test suite uses for the organizer and the
// competing bidders. `salt` is only meaningful for the organizer: the
// constructor commits to the reserve price with it and `revealWin` must present
// the same salt to re-open that commitment.
import { type Witnesses } from './managed/silent-auction/contract/index.js';

export type SilentAuctionPrivateState = {
  sk: Uint8Array;
  salt: Uint8Array;
};

export const createSilentAuctionPrivateState = (
  sk: Uint8Array,
  salt: Uint8Array,
): SilentAuctionPrivateState => ({ sk, salt });

// Typed against the compiler-generated `Witnesses<PS>` so the private-state
// type flows into `withWitnesses` (leaving it to inference collapses PS to
// `never`, which trips the deploy/call overloads).
export const witnesses: Witnesses<SilentAuctionPrivateState> = {
  localSk: ({ privateState }) => [privateState, privateState.sk],
  localSalt: ({ privateState }) => [privateState, privateState.salt],
};
