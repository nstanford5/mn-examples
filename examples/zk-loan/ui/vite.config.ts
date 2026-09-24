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

// Ported from midnightntwrk/example-zkloan (zkloan-credit-scorer-ui/vite.config.ts).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => ({
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
    'process.env': {},
    global: 'globalThis',
  },
  // Serve the compiler output as static assets. FetchZkConfigProvider requests
  // `<origin>/keys/<circuit>.{prover,verifier}` and `<origin>/zkir/<circuit>.bzkir`,
  // which is exactly the layout of contract/managed/zk-loan — so pointing
  // publicDir at it replaces upstream's copy-contract-keys step, and the UI can
  // never serve keys from a stale compile. `yarn compile` in examples/zk-loan
  // must have run first.
  publicDir: path.resolve(here, '../contract/managed/zk-loan'),
  plugins: [
    nodePolyfills({
      include: ['buffer', 'process'],
      globals: {
        Buffer: true,
        process: true,
      },
    }),
    wasm(),
    react(),
    viteCommonjs(),
    topLevelAwait(),
  ],
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
    exclude: [
      // The onchain-runtime ships as a WASM package and must not be esbuild
      // pre-bundled. As of Midnight JS 4.1.x it resolves to `onchain-runtime-v3`.
      '@midnight-ntwrk/onchain-runtime-v3',
    ],
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  server: {
    fs: {
      // The contract module and witnesses live one level up, in examples/zk-loan,
      // and dependencies are hoisted to the repo-root node_modules.
      allow: [path.resolve(here, '../../..')],
    },
  },
}));
