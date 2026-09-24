import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

const network = process.env['MIDNIGHT_NETWORK'] ?? 'local';
const isRemote = network !== 'local';

// Remote runs read their wallet seeds from a single repo-root .env.<network>,
// so one set of funded wallets serves every example. Shell env still wins over
// file values. Generate the file with `yarn wallets:new` from the repo root.
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const envFromFile = isRemote ? loadEnv(network, repoRoot, '') : {};

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    env: envFromFile,
    // Several tests mint, sync three wallets, and prove multiple circuits.
    testTimeout: 15 * 60_000,
    // A remote wallet build plus the faucet funding gate needs far longer than
    // a local devnet's beforeAll.
    hookTimeout: isRemote ? 90 * 60_000 : 15 * 60_000,
    include: ['src/**/*.test.ts'],
    // roulette.test.ts and privacy.test.ts share the same Alice/Bob wallets.
    // Vitest runs test files in parallel by default, and concurrent spends of
    // the same UTXOs produce nondeterministic balancing failures.
    fileParallelism: false,
    reporters: ['default'],
    sequence: { concurrent: false },
    disableConsoleIntercept: true,
  },
});
