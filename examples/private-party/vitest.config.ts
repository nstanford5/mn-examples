import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
const isRemote = network !== 'local';

// Remote runs read their wallet seeds from a single repo-root .env.<network>,
// so one set of funded wallets serves every example. Shell env still wins over
// file values. Generate the file with `yarn wallets:new`.
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const envFromFile = isRemote ? loadEnv(network, repoRoot, '') : {};

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 15 * 60_000,
    hookTimeout: isRemote ? 90 * 60_000 : 15 * 60_000,
    env: envFromFile,
    include: ['src/**/*.test.ts'],
    // Two suites share one devnet and one Alice wallet. Vitest runs test files in
    // parallel by default, and concurrent spends of the same UTXOs produce
    // nondeterministic balancing failures. Keep the whole run sequential.
    fileParallelism: false,
    reporters: ['default'],
  },
});
