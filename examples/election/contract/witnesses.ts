// This file is part of example-election.
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
// election contract declares two witnesses:
//
//   witness localSk(): Bytes<32>;        // the caller's secret key
//   witness localGetVote(): VoteChoice;  // the caller's chosen vote
//
// A participant's on-chain identity is derived *inside the circuit* from `sk`
// (getDappPubKey hashes it), never from the wallet. That means one wallet can
// act as many distinct election identities — the organizer and each voter —
// simply by swapping which private state it presents. This is the pattern the
// test suite uses to run a whole election from a single wallet.
//
// `vote` is only meaningful for a voter: `commitVote` commits to it, and
// `revealVote` must present the same value to re-open that commitment.
import { type Witnesses, VoteChoice } from './managed/election/contract/index.js';

export type ElectionPrivateState = {
  sk: Uint8Array;
  vote: VoteChoice;
};

export const createElectionPrivateState = (
  sk: Uint8Array,
  vote: VoteChoice,
): ElectionPrivateState => ({ sk, vote });

// Typed against the compiler-generated `Witnesses<PS>` so the private-state
// type flows into `withWitnesses` (leaving it to inference collapses PS to
// `never`, which trips the deploy/call overloads).
export const witnesses: Witnesses<ElectionPrivateState> = {
  localSk: ({ privateState }) => [privateState, privateState.sk],
  localGetVote: ({ privateState }) => [privateState, privateState.vote],
};
