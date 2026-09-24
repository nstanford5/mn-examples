// This file is part of example-shielded-chips.
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

import type { WitnessContext } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type { Ledger as RouletteLedger } from './managed/roulette/contract/index.js';
import type { Ledger as ChipsLedger } from './managed/chips/contract/index.js';

/** A coin the contract holds, as the ledger needs it in order to spend it. */
export type QualifiedCoin = {
  nonce: Uint8Array;
  color: Uint8Array;
  value: bigint;
  mt_index: bigint;
};

// Both the roulette and chips contracts declare the same
// `witness localSecretKey(): Bytes<32>` function and share an identity
// derivation, so a single private-state shape and witness object backs
// them both.
//
// `escrowSalt` and `escrowedCoin` exist because roulette deliberately does not
// store the player's escrowed coin on chain — only a commitment to it. The
// player is therefore the only party who can reopen that commitment, so the
// coin has to be replayed out of private state at claim time. `mt_index` is
// assigned when the bet transaction lands, so it is filled in after the fact
// (see rememberEscrow).
export type RoulettePrivateState = {
  sk: Uint8Array;
  escrowSalt: Uint8Array;
  escrowedCoin: QualifiedCoin;
};

const ZERO_32 = new Uint8Array(32);

/** A coin shaped placeholder, used before a bet has been placed. */
export const NO_COIN: QualifiedCoin = {
  nonce: ZERO_32,
  color: ZERO_32,
  value: 0n,
  mt_index: 0n,
};

export const createRoulettePrivateState = (
  sk: Uint8Array,
  escrowSalt: Uint8Array = ZERO_32,
): RoulettePrivateState => ({
  sk,
  escrowSalt,
  escrowedCoin: NO_COIN,
});

/**
 * Record the coin a player just escrowed, so `claimWinnings`/`forfeit` can
 * reopen the on-chain commitment.
 *
 * The commitment covers (nonce, color, value) only — `mt_index` is assigned by
 * the ledger when the bet transaction is included, so it is not known at bet
 * time and is supplied here once it can be read back off the chain.
 */
export const rememberEscrow = (
  state: RoulettePrivateState,
  coin: QualifiedCoin,
): RoulettePrivateState => ({ ...state, escrowedCoin: coin });

export const rouletteWitnesses = {
  localSecretKey: ({
    privateState,
  }: WitnessContext<RouletteLedger, RoulettePrivateState>): [
    RoulettePrivateState,
    Uint8Array,
  ] => {
    return [privateState, privateState.sk];
  },

  escrowSalt: ({
    privateState,
  }: WitnessContext<RouletteLedger, RoulettePrivateState>): [
    RoulettePrivateState,
    Uint8Array,
  ] => {
    return [privateState, privateState.escrowSalt];
  },

  escrowedCoin: ({
    privateState,
  }: WitnessContext<RouletteLedger, RoulettePrivateState>): [
    RoulettePrivateState,
    QualifiedCoin,
  ] => {
    return [privateState, privateState.escrowedCoin];
  },
};

export const chipsWitnesses = {
  localSecretKey: ({
    privateState,
  }: WitnessContext<ChipsLedger, RoulettePrivateState>): [
    RoulettePrivateState,
    Uint8Array,
  ] => {
    return [privateState, privateState.sk];
  },
};
