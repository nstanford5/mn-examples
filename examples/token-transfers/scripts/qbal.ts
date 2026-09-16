import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { getUnshieldedBalances } from '@midnight-ntwrk/midnight-js-contracts';
const addr = '26deeade15018ae0bb858e6a514a23d5df8dd6739f4437529e70da2f25f9e501';
const pdp = indexerPublicDataProvider('http://127.0.0.1:8088/api/v4/graphql', 'ws://127.0.0.1:8088/api/v4/graphql/ws');
const b = await getUnshieldedBalances(pdp, addr);
console.log('BALANCES:', JSON.stringify(b, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
process.exit(0);
