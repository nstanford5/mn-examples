import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// Vite is pinned to 6.4.3 in package.json on purpose: it matches the Vite that
// Yarn hoists to the repo root (see the root AGENTS.md). Asking for a different
// major here could change what gets hoisted and break other examples' vitest
// configs.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // The ledger / onchain-runtime packages ship WebAssembly and load it with
    // top-level await, so both plugins are required in the browser.
    wasm(),
    topLevelAwait(),
    // Parts of the Midnight SDK still reach for Node globals (Buffer, process)
    // and core modules. Polyfill them and expose the globals, otherwise the
    // page dies with "Buffer is not defined" the first time a tx is built.
    nodePolyfills({
      include: ["buffer", "process", "util", "crypto", "stream"],
      globals: { Buffer: true, process: true },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Dev-server pre-bundling (esbuild) breaks the WASM loading in ledger-v8 and
  // onchain-runtime-v3, so those are served as-is. midnight-js-protocol has to
  // be excluded too: it does `export * from '@midnight-ntwrk/ledger-v8'`, and
  // esbuild can't list the names re-exported from an excluded package.
  // Keep this list minimal. Excluding a package also skips CommonJS->ESM
  // conversion of its dependencies (excluding compact-runtime, for example,
  // breaks its `object-inspect` import).
  optimizeDeps: {
    exclude: [
      "@midnight-ntwrk/ledger-v8",
      "@midnight-ntwrk/onchain-runtime-v3",
      "@midnight-ntwrk/midnight-js-protocol",
    ],
  },
  server: {
    fs: {
      // The compiled contract JS lives in ../contract/managed (outside this
      // package's root), so let the dev server read the whole example.
      allow: [path.resolve(__dirname, "..")],
    },
  },
  build: {
    target: "esnext",
  },
});
