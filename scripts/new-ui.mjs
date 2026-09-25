#!/usr/bin/env node
// This file is part of mn-examples.
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

// Phase 2 of scaffolding: adds a browser UI (examples/<name>/ui) to an example
// whose contract already compiles and whose tests pass (phase 1 is
// `yarn new:example`). Zero dependencies — Node built-ins only.
//
//   yarn new:ui <name> [--contract <managed-dir>] [--private-state memory|persistent]
//                                                   scaffold examples/<name>/ui
//   yarn new:ui <name> --check                      diff template-owned files (CI)
//   yarn new:ui <name> --sync                       rewrite template-owned files
//   yarn new:ui --check-all                         --check every generated UI, and the lockfile
//   yarn new:ui --sync-all                          --sync every generated UI, then yarn install
//                                                   if a package.json changed
//
// The create-time choices (--contract, --private-state) are recorded in
// ui/new-ui.json, so --check and --sync re-render exactly what was created.
//
// Everything is derived from the compiled contract, never from memory:
//   contract/managed/<c>/compiler/contract-info.json  circuits, witnesses, ledger
//   contract/managed/<c>/contract/index.d.ts          constructor arity only
//   contract/witnesses.ts                             private-state factory (read even
//                                                     without witnesses)
//
// Files come in two kinds (see SEED_FILES):
//   template-owned  identical for every example up to name substitution. Change
//                   them in templates/ui/, never in an example; --check fails
//                   when an example's copy diverges, --sync rewrites it.
//   seed            generated once as a working starting point (typed circuit
//                   wrappers, a ledger readout, an in-memory circuit test), then
//                   owned by the example author. --check and --sync skip them.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NAME_RE,
  assertNodeVersion,
  assertNoLeftoverTokens,
  deriveNames,
  fail,
  renderTree,
  substituteNames,
  writeFiles,
} from './lib/template.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const TEMPLATE_DIR = path.join(REPO_ROOT, 'templates', 'ui');
const EXAMPLES_DIR = path.join(REPO_ROOT, 'examples');
assertNodeVersion(REPO_ROOT);

/** Template paths (pre-rename) generated once and then owned by the author. */
const SEED_FILES = new Set(
  [
    'README.md',
    'src/midnight/__name__-api.ts',
    'src/components/__name__-panel.tsx',
    'src/__tests__/__name__-circuits.test.ts',
  ].map((p) => p.split('/').join(path.sep)),
);

const KNOWN_TOKENS = [
  '__name__',
  '__Name__',
  '__Title__',
  '__camelName__',
  '__MANAGED__',
  '__WITNESS_IMPORT__',
  '__WITNESS_METHOD__',
  '__WITNESS_METHOD_DOC__',
  '__CIRCUIT_UNION__',
  '__PRIVATE_STATE_BLOCK__',
  '__PS_CONTRACT_IMPORT__',
  '__CTOR_ARGS_TYPE__',
  '__DEPLOY_PARAMS__',
  '__DEPLOY_ARGS__',
  '__JOIN_PARAMS__',
  '__INITIAL_PS__',
  '__JOIN_INITIAL_PS__',
  '__PRIVATE_STATE_STORAGE__',
  '__PRIVATE_STATE_STORAGE_DOC__',
  '__CIRCUIT_WRAPPERS__',
  '__PANEL_API_IMPORTS__',
  '__LEDGER_FIELDS__',
  '__CIRCUIT_LIST__',
  '__CIRCUIT_CALLS__',
  '__DEPLOYMENT_OPS__',
  '__TEST_BODY__',
];

function usage() {
  console.log(
    [
      'Usage: yarn new:ui <name> [--contract <managed-dir>] [--private-state memory|persistent]',
      '       yarn new:ui <name> --check | --sync',
      '       yarn new:ui --check-all | --sync-all',
      '',
      '  <name>           existing example under examples/ (compile it first)',
      '  --contract       which contract/managed/<dir> to use when there are several',
      '  --private-state  where the browser keeps private state:',
      '                     memory      in memory, lost on reload',
      '                     persistent  encrypted IndexedDB, unlocked by a passphrase',
      '                   default: persistent when the create<X>PrivateState factory',
      '                   in contract/witnesses.ts takes arguments (per-user secrets),',
      '                   with or without witnesses; else memory',
      '  --check       compare template-owned files in examples/<name>/ui with the',
      '                template; exit 1 on any difference (seed files are ignored)',
      '  --sync        rewrite template-owned files in examples/<name>/ui (seeds untouched)',
      '  --check-all   --check every generated UI (examples/*/ui/new-ui.json), then',
      '                `yarn install --immutable` to catch a stale yarn.lock',
      '  --sync-all    --sync every generated UI; runs `yarn install` when a UI\'s',
      '                package.json changed (commit the yarn.lock it writes)',
    ].join('\n'),
  );
}

/**
 * Every generated UI, i.e. every examples/<name>/ui with a new-ui.json. A
 * hand-built UI (zk-loan) has none, so it's never touched.
 */
function generatedUis() {
  return fs
    .readdirSync(EXAMPLES_DIR)
    .filter((n) => fs.existsSync(path.join(EXAMPLES_DIR, n, 'ui', 'new-ui.json')))
    .sort();
}

/**
 * --check-all / --sync-all: run this script once per generated UI, as a child
 * process, so the single-UI flow below stays as it is. Returns the exit code.
 *
 * A template change is only done once *every* UI is synced, including one
 * created earlier in the same change, and yarn.lock matches the synced
 * package.json files. Both were easy to miss by hand.
 */
function runAll(each) {
  const names = generatedUis();
  if (names.length === 0) fail('no generated UIs found (examples/*/ui/new-ui.json)');
  const script = fileURLToPath(import.meta.url);
  const pkgJson = (n) => fs.readFileSync(path.join(EXAMPLES_DIR, n, 'ui', 'package.json'), 'utf8');
  const before = Object.fromEntries(names.map((n) => [n, pkgJson(n)]));
  const failed = names.filter(
    (n) => spawnSync(process.execPath, [script, n, `--${each}`], { stdio: 'inherit' }).status !== 0,
  );
  const yarn = (args) => spawnSync('yarn', args, { cwd: REPO_ROOT, stdio: 'inherit', shell: true }).status === 0;
  if (each === 'check') {
    console.log('\n  yarn install --immutable (does yarn.lock match every package.json?)');
    const lockOk = yarn(['install', '--immutable', '--mode=skip-build']);
    if (!lockOk) console.error('✖ yarn.lock is stale: run `yarn install` and commit it.');
    if (failed.length) console.error(`✖ drifted: ${failed.join(', ')}`);
    return failed.length || !lockOk ? 1 : 0;
  }
  if (failed.length) {
    console.error(`✖ --sync failed for: ${failed.join(', ')}`);
    return 1;
  }
  const changed = names.filter((n) => pkgJson(n) !== before[n]);
  if (changed.length) {
    console.log(`\n  package.json changed in ${changed.join(', ')}: running yarn install`);
    if (!yarn(['install'])) return 1;
    console.log('  Commit the updated yarn.lock; CI installs with --immutable.');
  }
  console.log(`\n✔ Synced ${names.length} generated UI(s): ${names.join(', ')}. Review with \`git diff\`.`);
  return 0;
}

// --- arg parsing ------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) {
  usage();
  process.exit(0);
}
const positionals = [];
const flags = new Set();
let contractFlag = null;
let privateStateFlag = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--contract') contractFlag = argv[++i] ?? fail('--contract needs a value');
  else if (a.startsWith('--contract=')) contractFlag = a.slice('--contract='.length);
  else if (a === '--private-state') privateStateFlag = argv[++i] ?? fail('--private-state needs a value');
  else if (a.startsWith('--private-state=')) privateStateFlag = a.slice('--private-state='.length);
  else if (['--check', '--sync', '--check-all', '--sync-all'].includes(a)) flags.add(a);
  else if (a.startsWith('-')) fail(`unknown flag ${a}`);
  else positionals.push(a);
}
if (flags.size > 1) fail('--check, --sync, --check-all and --sync-all are mutually exclusive');
if (flags.has('--check-all') || flags.has('--sync-all')) {
  if (positionals.length || contractFlag !== null || privateStateFlag !== null) {
    fail('--check-all / --sync-all take no <name>, --contract or --private-state (each UI keeps its new-ui.json)');
  }
  process.exit(runAll(flags.has('--check-all') ? 'check' : 'sync'));
}
if (positionals.length !== 1) {
  usage();
  fail('exactly one <name> argument is required');
}
const mode = flags.has('--check') ? 'check' : flags.has('--sync') ? 'sync' : 'create';
const name = positionals[0];
if (!NAME_RE.test(name)) fail(`invalid name '${name}' (kebab-case, e.g. hello-world)`);
if (privateStateFlag !== null && !['memory', 'persistent'].includes(privateStateFlag)) {
  fail(`--private-state must be memory or persistent, not '${privateStateFlag}'`);
}

// --- phase-1 gate ------------------------------------------------------------
const exampleDir = path.join(EXAMPLES_DIR, name);
const uiDir = path.join(exampleDir, 'ui');
const pkg = `@midnight-ntwrk/example-${name}`;
if (!fs.existsSync(path.join(exampleDir, 'package.json'))) {
  fail(`examples/${name} does not exist. Scaffold it first:  yarn new:example ${name}`);
}
if (mode === 'create' && fs.existsSync(uiDir)) {
  fail(`examples/${name}/ui already exists. Use --check or --sync to compare/update template-owned files.`);
}
if (mode !== 'create' && !fs.existsSync(uiDir)) {
  fail(`examples/${name}/ui does not exist — nothing to ${mode}.`);
}

// Create-time choices, recorded so --check/--sync render the same thing. A UI
// created before new-ui.json existed has none; --sync writes it.
const CONFIG = 'new-ui.json';
const configPath = path.join(uiDir, CONFIG);
const savedConfig =
  mode !== 'create' && fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : null;
if (savedConfig && mode !== 'create') {
  for (const [flag, value, saved] of [
    ['--contract', contractFlag, savedConfig.contract],
    ['--private-state', privateStateFlag, savedConfig.privateState],
  ]) {
    if (value !== null && value !== saved) {
      fail(`${flag} ${value} conflicts with ui/${CONFIG} (${saved}). Edit ${CONFIG} to change it, then --sync.`);
    }
  }
  contractFlag = savedConfig.contract;
  privateStateFlag = savedConfig.privateState;
}

const managedRoot = path.join(exampleDir, 'contract', 'managed');
const compiled = fs.existsSync(managedRoot)
  ? fs
      .readdirSync(managedRoot)
      .filter((d) => fs.existsSync(path.join(managedRoot, d, 'compiler', 'contract-info.json')))
      .sort()
  : [];
if (compiled.length === 0) {
  fail(
    `no compiled contract under examples/${name}/contract/managed/. Compile it first (and get ` +
      `test:local green):  yarn workspace ${pkg} run compile`,
  );
}
let managed = contractFlag;
if (managed === null) {
  if (compiled.length > 1) {
    fail(
      `examples/${name} compiles ${compiled.length} contracts (${compiled.join(', ')}). ` +
        'Pick one with --contract <dir>; multi-contract UIs are not scaffolded.',
    );
  }
  managed = compiled[0];
} else if (!compiled.includes(managed)) {
  fail(`--contract ${managed}: not found (compiled: ${compiled.join(', ')})`);
}

// --- read the compiled contract ---------------------------------------------
// `maxval` can exceed 2^53 (Uint<64>, Uint<128>, ...). Keep its exact source
// text instead of letting JSON.parse round it to a float.
const info = JSON.parse(
  fs.readFileSync(path.join(managedRoot, managed, 'compiler', 'contract-info.json'), 'utf8'),
  (key, value, ctx) => (key === 'maxval' ? ctx.source : value),
);

/**
 * contract-info.json argument type → an ArgType literal for
 * src/lib/circuit-args.ts, or null when it has no generic form. The TypeScript
 * counterparts (bigint, boolean, string, Uint8Array, numeric enum) are the ones
 * the compiler emits in contract/index.d.ts; see the table in circuit-args.ts.
 */
function argTypeLiteral(t) {
  switch (t['type-name']) {
    case 'Uint':
      return `{ kind: "uint", max: ${t.maxval}n }`;
    case 'Field':
      return '{ kind: "field" }';
    case 'Boolean':
      return '{ kind: "boolean" }';
    case 'Opaque':
      return t.tsType === 'string' ? '{ kind: "string" }' : null;
    case 'Bytes':
      return `{ kind: "bytes", length: ${t.length} }`;
    case 'Enum':
      return `{ kind: "enum", values: [${t.elements.map((e) => JSON.stringify(e)).join(', ')}] }`;
    case 'Alias':
      return argTypeLiteral(t.type);
    case 'Struct':
      // The stdlib UserAddress, { bytes: Uint8Array } in TypeScript. The form
      // fills it from the wallet (lib/addresses.ts). Other structs: no form.
      return t.name === 'UserAddress' &&
        t.elements?.length === 1 &&
        t.elements[0].name === 'bytes' &&
        t.elements[0].type['type-name'] === 'Bytes' &&
        t.elements[0].type.length === 32
        ? '{ kind: "userAddress" }'
        : null;
    default:
      return null;
  }
}

/**
 * A Bytes argument named like a secret (private-party's `_secret`, an `sk`) or
 * a one-time value (a mint `nonce`, a `salt`). A generic form would ask the
 * user to paste or invent it; the UI should generate it, and keep a secret in
 * private state as the Node test does. Such circuits get a TODO, not a form.
 */
const SECRET_NAME_RE = /secret|^_?sk$|priv|seed|nonce|salt/i;
const isSecretArg = (a) => SECRET_NAME_RE.test(a.name) && a.type['type-name'] === 'Bytes';
const typeLabel = (t) => [t['type-name'], t.name, t.tsType].filter(Boolean).join(' ');

const circuits = info.circuits
  .filter((c) => c.proof)
  .map((c) => {
    const secrets = c.arguments.filter(isSecretArg);
    const unsupported = c.arguments.filter((a) => argTypeLiteral(a.type) === null);
    const reasons = [
      ...secrets.map(
        (a) =>
          `${a.name} looks like a secret or one-time value: generate it in code, and keep a secret in private state`,
      ),
      ...unsupported.map((a) => `${a.name} is a ${typeLabel(a.type)}`),
    ];
    return {
      name: c.name,
      args: c.arguments.map((a) => a.name),
      secretArgs: secrets.map((a) => a.name),
      specs: reasons.length ? null : c.arguments.map((a) => ({ name: a.name, type: argTypeLiteral(a.type) })),
      todo: reasons.join('; '),
    };
  });
const formCircuits = circuits.filter((c) => c.specs);
/** Enum member names of a ledger cell or Set/List element type, through aliases. */
const enumValuesOf = (t) => (!t ? null : t['type-name'] === 'Alias' ? enumValuesOf(t.type) : t['type-name'] === 'Enum' ? t.elements : null);
const ledgerFields = info.ledger
  .filter((l) => l.exported)
  .map((l) => ({ name: l.name, storage: l.storage ?? 'Cell', enumValues: enumValuesOf(l.type) }));
const hasWitnesses = info.witnesses.length > 0;

// contract-info.json doesn't list stdlib calls, so read the source: the
// .compact whose basename is the managed dir, else every contract/*.compact.
const contractDir = path.join(exampleDir, 'contract');
const compactSources = fs.readdirSync(contractDir).filter((f) => f.endsWith('.compact'));
const ownSource = compactSources.find((f) => f === `${managed}.compact`);
const compactSrc = (ownSource ? [ownSource] : compactSources)
  .map((f) => fs.readFileSync(path.join(contractDir, f), 'utf8'))
  .join('\n');
/** An unshieldedBalance* check fails in memory unless the test sets a balance. */
const usesUnshielded = /\b(receiveUnshielded|sendUnshielded|unshieldedBalance\w*)\s*\(/.test(compactSrc);

// contract-info.json does not describe the constructor. The generated
// declaration does: a constructor without parameters is exactly this line.
const dts = fs.readFileSync(path.join(managedRoot, managed, 'contract', 'index.d.ts'), 'utf8');
if (!dts.includes('initialState(context: __compactRuntime.ConstructorContext<PS>')) {
  fail(`could not find initialState(...) in ${managed}/contract/index.d.ts — generator needs updating.`);
}
const hasCtorArgs = !dts.includes(
  'initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;',
);
// Only for TODO comments: e.g. "_x1_0: bigint, _x2_0: bigint".
const ctorParams = hasCtorArgs
  ? (dts.match(/initialState\(context: __compactRuntime\.ConstructorContext<PS>,\s*([^)]*)\)/)?.[1] ?? '...')
      .replace(/\s+/g, ' ')
      .trim()
  : '';

// The browser imports contract/witnesses.ts as is: it must be Node-free and
// export a create<X>PrivateState factory (the phase-1 template convention).
// It is read even when the contract declares no witnesses: a contract can
// take its secrets as circuit arguments instead (private-party passes
// `_secret` to every circuit), and the UI still has to keep them somewhere.
let factory = null;
let factoryTakesArgs = false;
let factoryParams = '';
let witnessesExport = null;
const witnessesPath = path.join(exampleDir, 'contract', 'witnesses.ts');
if (hasWitnesses && !fs.existsSync(witnessesPath)) {
  fail(`the contract declares witnesses but examples/${name}/contract/witnesses.ts is missing.`);
}
const witnessesSrc = fs.existsSync(witnessesPath) ? fs.readFileSync(witnessesPath, 'utf8') : null;
const factoryMatch = witnessesSrc?.match(/export const (create\w*PrivateState)\s*=\s*\(([^)]*)\)/);
if (hasWitnesses && !factoryMatch) {
  fail(`examples/${name}/contract/witnesses.ts has no \`export const create<X>PrivateState = (...) =>\` factory.`);
}
if (factoryMatch) {
  if (/from\s+['"]node:/.test(witnessesSrc)) {
    fail(`examples/${name}/contract/witnesses.ts imports node:* modules; the browser can't load it. Move those out first.`);
  }
  factory = factoryMatch[1];
  factoryParams = factoryMatch[2].replace(/\s+/g, ' ').replace(/,\s*$/, '').trim();
  factoryTakesArgs = factoryParams !== '';
}
if (hasWitnesses) {
  // `witnesses`, or `<contract>Witnesses` when one file serves several
  // contracts (shielded-chips: rouletteWitnesses, chipsWitnesses).
  const perContract = `${managed.replace(/[-_](\w)/g, (_, c) => c.toUpperCase())}Witnesses`;
  witnessesExport = [`witnesses`, perContract].find((n) => new RegExp(`export const ${n}\\b`).test(witnessesSrc));
  if (!witnessesExport) {
    fail(`examples/${name}/contract/witnesses.ts exports neither \`witnesses\` nor \`${perContract}\`.`);
  }
}
// Import specifier that binds the contract's witnesses to `witnesses`.
const witnessesSpecifier = witnessesExport === 'witnesses' ? 'witnesses' : `${witnessesExport} as witnesses`;
// Can the UI build the initial private state on its own?
const psAuto = !factoryTakesArgs;
// A factory with parameters builds per-user private state (secret keys,
// hidden values): losing it on reload usually locks the user out.
const privateState = privateStateFlag ?? (factoryTakesArgs ? 'persistent' : 'memory');
const configContent = `${JSON.stringify({ contract: managed, privateState }, null, 2)}\n`;

const names = deriveNames(name);
const { Name } = names;
const camelName = Name[0].toLowerCase() + Name.slice(1);

// Wrapper names share a module with these identifiers.
const taken = new Set([
  'deployContract', 'findDeployedContract', 'map', 'ledger', 'ledger$', 'PRIVATE_STATE_ID', 'CircuitArgs',
  'createInitialPrivateState', 'ConstructorArgs', `Compiled${Name}Contract`, `deploy${Name}`,
  `join${Name}`, `${Name}Contract`,
  // the panel imports the wrappers next to these
  'pureCircuits', 'PRIVATE_STATE_STORAGE',
  'CIRCUITS', 'CALLS', 'CircuitForm', 'LEDGER_FIELDS', 'formatLedgerValue', 'LedgerField', 'useMemo',
  'useContractState',
  'useDeployment', 'DeploymentCard', 'Card', 'CardContent', 'CardDescription', 'CardHeader',
  'CardTitle', 'ArgSpec', 'CircuitSpec',
]);
for (const c of circuits) {
  if (taken.has(c.name)) fail(`circuit '${c.name}' collides with an identifier in the generated ${name}-api.ts or ${name}-panel.tsx.`);
}

// --- generated blocks ------------------------------------------------------

/** The seed in-memory circuits test (src/__tests__/__name__-circuits.test.ts). */
function testBody() {
  const constructs = !hasCtorArgs && psAuto;
  const wrappers = circuits.map((c) => c.name);
  const lines = [
    `import { describe, ${constructs ? 'expect, ' : ''}${wrappers.length ? 'expectTypeOf, ' : ''}it } from "vitest";`,
    ...(wrappers.length
      ? ['import type { FinalizedCallTxData } from "@midnight-ntwrk/midnight-js-contracts";']
      : []),
    ...(constructs
      ? [
          'import { createConstructorContext } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";',
          'import { Contract, createInitialPrivateState, ledger } from "../midnight/contract";',
        ]
      : wrappers.length
        ? ['import type { Contract } from "../midnight/contract";']
        : []),
    ...(wrappers.length ? [`import { ${wrappers.join(', ')} } from "../midnight/__name__-api";`] : []),
    ...(constructs && hasWitnesses
      ? [
          `import { ${witnessesSpecifier} } from "../../../contract/witnesses.js";`,
        ]
      : []),
    ...(usesUnshielded ? ['// import { withUnshieldedBalance } from "./contract-balance";'] : []),
    '',
    ...(constructs ? ['const COIN_PK = "00".repeat(32);', ''] : []),
    'describe("__name__ contract (in memory)", () => {',
    ...(constructs
      ? [
          '  it("constructs and decodes the initial ledger", () => {',
          `    const contract = new Contract(${hasWitnesses ? 'witnesses' : '{}'});`,
          '    const { currentContractState } = contract.initialState(',
          '      createConstructorContext(createInitialPrivateState(), COIN_PK),',
          '    );',
          '    expect(ledger(currentContractState.data)).toBeDefined();',
          '  });',
        ]
      : [
          `  // TODO: constructing the contract needs ${needs}:`,
          ...(hasCtorArgs ? [`  //   constructor:   contract.initialState(context, ${ctorParams})`] : []),
          ...(!psAuto ? [`  //   private state: ${factory}(${factoryParams})`] : []),
          '  // Take the values from the Node test in examples/__name__/src/test/.',
          '  it.todo("constructs and decodes the initial ledger");',
        ]),
    ...(circuits.length
      ? [
          '',
          '  // TODO: one test per circuit, asserting on the ledger the UI will show:',
          '  //   const ctx = createCircuitContext(dummyContractAddress(), COIN_PK,',
          '  //     currentContractState, createInitialPrivateState());',
          ...(usesUnshielded
            ? [
                '  // The contract moves unshielded tokens, and an in-memory context starts',
                "  // with an empty contract balance (receiveUnshielded doesn't credit the",
                '  // next call). Give it what the chain would hold, or unshieldedBalance*',
                '  // asserts always fail:',
                '  //   withUnshieldedBalance(ctx, amount);',
              ]
            : []),
          '  //   const { context } = contract.impureCircuits.<circuit>(ctx, ...args);',
          '  //   expect(ledger(context.currentQueryContext.state)).toEqual(...);',
          ...circuits.map((c) => `  it.todo(${JSON.stringify(`${c.name}(${c.args.join(', ')})`)});`),
        ]
      : []),
    '});',
  ];
  if (wrappers.length) {
    lines.push(
      '',
      '// Checked by `tsc -b` (the typecheck script); expectTypeOf does nothing at',
      '// runtime. Each wrapper must hit the callTx overload that proves, submits and',
      '// waits for finalization, and take exactly the circuit\'s arguments (counted',
      '// from contract-info.json) after the contract handle.',
      'describe("__name__ circuit wrappers (types)", () => {',
      '  it("submit through callTx with exactly the circuit\'s arguments", () => {',
      ...circuits.flatMap((c) => [
        `    expectTypeOf<Awaited<ReturnType<typeof ${c.name}>>>().toEqualTypeOf<`,
        `      FinalizedCallTxData<Contract, ${JSON.stringify(c.name)}>`,
        '    >();',
        `    expectTypeOf<Parameters<typeof ${c.name}>["length"]>().toEqualTypeOf<${c.args.length + 1}>();`,
      ]),
      '  });',
      '});',
    );
  }
  return lines.join('\n') + '\n';
}

const needs = [hasCtorArgs && 'constructor args', !psAuto && 'an initial private state']
  .filter(Boolean)
  .join(' and ');

const blocks = {
  __CIRCUIT_UNION__: circuits.length ? circuits.map((c) => JSON.stringify(c.name)).join(' | ') : 'never',
  __WITNESS_METHOD__: hasWitnesses ? 'withWitnesses(witnesses)' : 'withVacantWitnesses',
  __WITNESS_METHOD_DOC__: hasWitnesses
    ? 'withWitnesses: the TypeScript witnesses from contract/witnesses.ts.'
    : 'withVacantWitnesses: the contract declares no witnesses.',
  __PRIVATE_STATE_BLOCK__: factory
    ? [
        '/**',
        ' * Private state is whatever examples/__name__/contract/witnesses.ts builds.',
        ...(hasWitnesses
          ? []
          : [
              ' * The contract declares no witnesses: the UI reads this state itself and',
              ' * passes what the circuits need as arguments, as the Node test does.',
            ]),
        ' * PRIVATE_STATE_STORAGE below says where it is kept (./private-state.ts).',
        ' */',
        `export type __Name__PrivateState = ReturnType<typeof ${factory}>;`,
        `export const createInitialPrivateState = ${factory};`,
      ].join('\n')
    : [
        '/**',
        ' * The contract declares no witnesses, so there is no private state.',
        ' * deployContract still wants a private-state id and an initial value, as',
        ' * in the Node test, so we store an empty object.',
        ' */',
        'export type __Name__PrivateState = Record<string, never>;',
        'export const createInitialPrivateState = (): __Name__PrivateState => ({});',
      ].join('\n'),
  __PS_CONTRACT_IMPORT__: psAuto ? 'createInitialPrivateState,\n  ' : 'type __Name__PrivateState,\n  ',
  __CTOR_ARGS_TYPE__: hasCtorArgs
    ? [
        '',
        "/** The contract constructor's arguments (everything after the context). */",
        'export type ConstructorArgs =',
        '  Parameters<Contract["initialState"]> extends [unknown, ...infer A] ? A : never;',
        '',
      ].join('\n')
    : '',
  __DEPLOY_PARAMS__:
    (psAuto ? '' : '\n  initialPrivateState: __Name__PrivateState,') +
    (hasCtorArgs ? '\n  args: ConstructorArgs,' : ''),
  __DEPLOY_ARGS__: hasCtorArgs ? '\n    args,' : '',
  // join only builds a fresh private state when none is stored, so it takes a
  // factory rather than a value (a fresh one may mean a fresh secret key).
  __JOIN_PARAMS__: psAuto ? '' : '\n  initialPrivateState: () => __Name__PrivateState,',
  __INITIAL_PS__: psAuto ? 'initialPrivateState: createInitialPrivateState()' : 'initialPrivateState',
  __JOIN_INITIAL_PS__: psAuto ? 'createInitialPrivateState()' : 'initialPrivateState()',
  __PRIVATE_STATE_STORAGE__: privateState,
  __PRIVATE_STATE_STORAGE_DOC__:
    privateState === 'persistent'
      ? 'encrypted in IndexedDB,\n * unlocked by a passphrase each session, so it survives reloads.'
      : 'in memory, so a reload\n * loses it.',
  __CIRCUIT_WRAPPERS__: circuits.length === 0 ? '' : [
    '',
    '/**',
    " * A circuit's arguments without its leading CircuitContext, i.e. what",
    ' * `contract.callTx.<circuit>(...)` takes. Not `Parameters<callTx[c]>`: callTx',
    ' * members are overloaded, and `Parameters` picks the last overload, whose',
    ' * first parameter is a TransactionContext.',
    ' */',
    'export type CircuitArgs<K extends keyof Contract["provableCircuits"]> =',
    '  Parameters<Contract["provableCircuits"][K]> extends [unknown, ...infer A] ? A : never;',
    '',
  ].join('\n') + circuits
    .map((c) =>
      [
        '',
        `/** Circuit \`${c.name}(${c.args.join(', ')})\`. */`,
        `export async function ${c.name}(`,
        '  contract: __Name__Contract,',
        `  ...args: CircuitArgs<${JSON.stringify(c.name)}>`,
        ') {',
        `  return contract.callTx.${c.name}(...args);`,
        '}',
        '',
      ].join('\n'),
    )
    .join(''),
  __PANEL_API_IMPORTS__: [
    !hasCtorArgs && psAuto && `deploy${Name}`,
    psAuto && `join${Name}`,
    'ledger$',
    ...formCircuits.map((c) => c.name),
    formCircuits.length > 0 && 'type CircuitArgs',
    `type ${Name}Contract`,
  ]
    .filter(Boolean)
    .map((i) => `\n  ${i},`)
    .join('') + '\n',
  __LEDGER_FIELDS__: ledgerFields.length
    ? `[\n${ledgerFields
        .map(
          (l) =>
            `  { name: ${JSON.stringify(l.name)}, storage: ${JSON.stringify(l.storage)}` +
            (l.enumValues ? `, enumValues: [${l.enumValues.map((e) => JSON.stringify(e)).join(', ')}]` : '') +
            ' },',
        )
        .join('\n')}\n]`
    : '[]',
  __CIRCUIT_LIST__: circuits.length
    ? `[\n${circuits
        .map((c) =>
          c.specs?.length === 0
            ? `  { name: ${JSON.stringify(c.name)}, args: [] },`
            : c.specs
            ? [
                `  {`,
                `    name: ${JSON.stringify(c.name)},`,
                `    args: [`,
                ...c.specs.map((a) => `      { name: ${JSON.stringify(a.name)}, type: ${a.type} },`),
                `    ],`,
                `  },`,
              ].join('\n')
            : `  { name: ${JSON.stringify(c.name)}, args: null, todo: ${JSON.stringify(c.todo)} },`,
        )
        .join('\n')}\n]`
    : '[]',
  __CIRCUIT_CALLS__: formCircuits.length
    ? `{\n${formCircuits
        .map((c) => `  ${c.name}: (contract, args) => ${c.name}(contract, ...(args as CircuitArgs<${JSON.stringify(c.name)}>)),`)
        .join('\n')}\n}`
    : '{}',
  __DEPLOYMENT_OPS__: [
    ...(!hasCtorArgs && psAuto
      ? ['    deploy: deploy__Name__,']
      : [
          `    // TODO: deploy__Name__ needs ${needs}`,
          '    // (see __name__-api.ts, and the Node test for values). Collect them in a form passed as',
          '    // <DeploymentCard deployForm={...}> that calls deployment.deploy(input), and',
          '    // type the hook as useDeployment<__Name__Contract, YourInput>({ ... }).',
          `    deploy: () => Promise.reject(new Error("TODO: supply ${needs} to deploy__Name__")),`,
        ]),
    ...(psAuto
      ? ['    join: join__Name__,']
      : [
          "    // TODO: join__Name__ needs a factory for this browser's initial private state",
          '    // (only called when none is stored yet), e.g. (p, a) => join__Name__(p, a, () => ...).',
          '    join: () => Promise.reject(new Error("TODO: supply the initial private state to join__Name__")),',
        ]),
  ].join('\n'),
  __TEST_BODY__: testBody(),
};

function render(raw, rel) {
  let out = raw;
  // Import line for witnesses: drop the whole line when there are none.
  const witnessImports = [factory, hasWitnesses && witnessesSpecifier].filter(Boolean);
  out = witnessImports.length
    ? out.replaceAll(
        '__WITNESS_IMPORT__',
        `import { ${witnessImports.join(', ')} } from "../../../contract/witnesses.js";`,
      )
    : out.replaceAll('__WITNESS_IMPORT__\n', '');
  // Blocks first (they contain name tokens), then names.
  for (const [token, value] of Object.entries(blocks)) out = out.replaceAll(token, value);
  out = out.replaceAll('__camelName__', camelName).replaceAll('__MANAGED__', managed);
  out = substituteNames(out, names);
  assertNoLeftoverTokens(rel, out, KNOWN_TOKENS);
  return out;
}

const files = renderTree(TEMPLATE_DIR, {
  name,
  skip: (rel) => mode !== 'create' && SEED_FILES.has(rel),
  render,
});

// --- manifest ----------------------------------------------------------------
// ui/.template-files lists the template-owned files as of the last create or
// sync. Without it, a file removed from templates/ui would linger in every
// generated UI and --check couldn't tell it from a file the author added.
const MANIFEST = '.template-files';
const posix = (p) => p.split(path.sep).join('/');
const templateOwned = files.filter((f) => !SEED_FILES.has(f.templateRel)).map((f) => posix(f.rel)).sort();
const manifestContent =
  '# Template-owned files, written by `yarn new:ui`. Do not edit; --sync rewrites it.\n' +
  templateOwned.map((f) => `${f}\n`).join('');
function readManifest() {
  const p = path.join(uiDir, MANIFEST);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
}
/** Files the template used to own that still exist on disk. */
const stale = (readManifest() ?? []).filter(
  (f) => !templateOwned.includes(f) && fs.existsSync(path.join(uiDir, ...f.split('/'))),
);

// --- check / sync ------------------------------------------------------------
if (mode === 'check') {
  const drift = [];
  for (const f of files) {
    const onDisk = path.join(uiDir, f.rel);
    const actual = fs.existsSync(onDisk) ? fs.readFileSync(onDisk, 'utf8') : null;
    if (actual !== f.content) drift.push({ ...f, actual });
  }
  const manifestOnDisk = fs.existsSync(path.join(uiDir, MANIFEST))
    ? fs.readFileSync(path.join(uiDir, MANIFEST), 'utf8')
    : null;
  const problems = [];
  if (manifestOnDisk === null) problems.push(`  ${MANIFEST}  (missing)`);
  else if (manifestOnDisk !== manifestContent) problems.push(`  ${MANIFEST}  (out of date)`);
  if (savedConfig === null) problems.push(`  ${CONFIG}  (missing)`);
  else if (fs.readFileSync(configPath, 'utf8') !== configContent) problems.push(`  ${CONFIG}  (not canonical)`);
  for (const f of stale) problems.push(`  ${f}  (no longer in templates/ui)`);
  if (drift.length === 0 && problems.length === 0) {
    console.log(`✔ examples/${name}/ui matches templates/ui (${files.length} template-owned files)`);
    process.exit(0);
  }
  console.error(`✖ examples/${name}/ui has drifted from templates/ui in ${drift.length + problems.length} file(s):\n`);
  for (const p of problems) console.error(p);
  for (const d of drift) {
    console.error(`  ${d.rel}${d.actual === null ? '  (missing)' : ''}  ← templates/ui/${d.templateRel}`);
    if (d.actual !== null) console.error(firstDifference(d.content, d.actual));
  }
  console.error(
    '\n  Template-owned files must stay identical across examples. Either move the change into\n' +
      `  templates/ui/ (then \`yarn new:ui ${name} --sync\` here and in any other UI), or, if it is\n` +
      '  example-specific, move it into a seed file (the api, panel, or circuits test).',
  );
  if (problems.length) {
    console.error(
      `  A missing/out-of-date ${MANIFEST} or ${CONFIG}, or a stale file, is fixed by \`yarn new:ui ${name} --sync\`.`,
    );
  }
  process.exit(1);
}

/** A few lines of context around the first differing line. */
function firstDifference(expected, actual) {
  const e = expected.split('\n');
  const a = actual.split('\n');
  let i = 0;
  while (i < e.length && i < a.length && e[i] === a[i]) i++;
  const lines = [`    first difference at line ${i + 1}:`];
  for (let j = Math.max(0, i - 1); j < Math.min(e.length, i + 3); j++) lines.push(`    - template: ${e[j]}`);
  for (let j = Math.max(0, i - 1); j < Math.min(a.length, i + 3); j++) lines.push(`    + on disk:  ${a[j]}`);
  return lines.join('\n');
}

const written = writeFiles(uiDir, files).map((p) => path.relative(REPO_ROOT, p));
fs.writeFileSync(path.join(uiDir, MANIFEST), manifestContent);
fs.writeFileSync(configPath, configContent);

if (mode === 'sync') {
  for (const f of stale) fs.rmSync(path.join(uiDir, ...f.split('/')));
  console.log(`✔ Rewrote ${written.length} template-owned files in examples/${name}/ui (seed files untouched).`);
  if (stale.length) console.log(`  Removed ${stale.length} file(s) no longer in templates/ui: ${stale.join(', ')}`);
  console.log('  Review with `git diff`, then typecheck and test:unit.');
  process.exit(0);
}

// --- summary ----------------------------------------------------------------
const rel = (p) => p.split(path.sep).join('/');
console.log(`\n✔ Scaffolded examples/${name}/ui from contract/managed/${managed}`);
console.log(
  `  circuits: ${circuits.map((c) => c.name).join(', ') || '(none)'}` +
    `\n  witnesses: ${hasWitnesses ? 'yes' : 'none'}` +
    `\n  private state: ${factory ? `${factory}(${factoryParams})${factoryTakesArgs ? ', needs args' : ''}` : 'none'}` +
    `\n  constructor args: ${hasCtorArgs ? `yes (${ctorParams})` : 'none'}` +
    `\n  private state storage: ${privateState}${privateStateFlag === null ? ' (default)' : ''}`,
);
console.log(`\n  ${written.length} files created. Seed files (yours to edit):`);
for (const f of files.filter((f) => SEED_FILES.has(f.templateRel))) {
  console.log(`    examples/${name}/ui/${rel(f.rel)}`);
}
if (needs) {
  console.log(`\n  ⚠ Deploy needs ${needs}: the panel has a TODO that rejects until you supply them.`);
}
/** Secret-like argument name → the circuits that take it. */
const secretUses = new Map();
for (const c of circuits) for (const a of c.secretArgs) secretUses.set(a, [...(secretUses.get(a) ?? []), c.name]);
for (const [arg, uses] of secretUses) {
  console.log(
    `  ⚠ ${arg} looks like a secret or one-time value, so ${uses.join(', ')} get${uses.length === 1 ? 's' : ''} ` +
      'no form field. Generate it in code, and keep a secret in private state.',
  );
}
if (usesUnshielded) {
  console.log(
    '  ⚠ The contract moves unshielded tokens. In-memory tests start with an empty contract ' +
      'balance: see withUnshieldedBalance in the circuits test.',
  );
}
console.log('\n  Next steps:');
console.log('    1. yarn install   (the new workspace changes yarn.lock; commit it — CI uses --immutable)');
console.log(`    2. yarn workspace ${pkg}-ui typecheck && yarn workspace ${pkg}-ui test:unit && yarn workspace ${pkg}-ui build`);
console.log('    3. Build the use case into the seed files above');
console.log(`    4. Work through the verification checklist in examples/${name}/ui/AGENTS.md`);
console.log('');
