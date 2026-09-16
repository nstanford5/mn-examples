// This file is part of example-calculator.
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

// This file holds the TypeScript implementations of the contract's witnesses —
// the off-chain logic Compact cannot express. Here that is `divMod`: integer
// division computed off-chain, whose result the on-chain `divide` circuit
// re-checks with `assert(rem < num2 && quo * num2 + rem == num1)`. That is the
// core pattern — do the work off-chain, verify it cheaply on-chain.
import { type Ledger } from './managed/calculator/contract/index.js';
import { type WitnessContext } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';

// The calculator keeps no private state — every input and the running `result`
// are public — so the private-state type is empty.
export type CalculatorPrivateState = Record<string, never>;

export const createCalculatorPrivateState = (): CalculatorPrivateState => ({});

// Signature matches the generated `Witnesses` type:
//   divMod(ctx, num1, num2): [PS, [bigint, bigint]]
// Uint<16> maps to bigint; the Compact tuple [Uint<16>, Uint<16>] maps to
// [bigint, bigint]. Witnesses return [nextPrivateState, returnValue].
export const witnesses = {
  divMod: (
    { privateState }: WitnessContext<Ledger, CalculatorPrivateState>,
    num1: bigint,
    num2: bigint,
  ): [CalculatorPrivateState, [bigint, bigint]] => {
    const quotient = num1 / num2;
    const remainder = num1 % num2;
    return [privateState, [quotient, remainder]];
  },
};
