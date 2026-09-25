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
//   yarn new:ui <name> [--contract <managed-dir>]   scaffold examples/<name>/ui
//   yarn new:ui <name> --check                      diff template-owned files (CI)
//   yarn new:ui <name> --sync                       rewrite template-owned files
//
// Everything is derived from the compiled contract, never from memory:
//   contract/managed/<c>/compiler/contract-info.json  circuits, witnesses, ledger
//   contract/managed/<c>/contract/index.d.ts          constructor arity only
//   contract/witnesses.ts                             private-state factory
//
// Files come in two kinds (see SEED_FILES):
//   template-owned  identical for every example up to name substitution. Change
//                   them in templates/ui/, never in an example; --check fails
//                   when an example's copy diverges, --sync rewrites it.
//   seed            generated once as a working starting point (typed circuit
//                   wrappers, a ledger readout, an in-memory circuit test), then
//                   owned by the example author. --check and --sync skip them.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NAME_RE,
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
  '__CIRCUIT_WRAPPERS__',
  '__PANEL_API_IMPORTS__',
  '__LEDGER_FIELDS__',
  '__CIRCUIT_LIST__',
  '__DEPLOYMENT_OPS__',
  '__TEST_BODY__',
];

function usage() {
  console.log(
    [
      'Usage: yarn new:ui <name> [--contract <managed-dir>] [--check | --sync]',
      '',
      '  <name>        existing example under examples/ (compile it first)',
      '  --contract    which contract/managed/<dir> to use when there are several',
      '  --check       compare template-owned files in examples/<name>/ui with the',
      '                template; exit 1 on any difference (seed files are ignored)',
      '  --sync        rewrite template-owned files in examples/<name>/ui (seeds untouched)',
    ].join('\n'),
  );
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
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--contract') contractFlag = argv[++i] ?? fail('--contract needs a value');
  else if (a.startsWith('--contract=')) contractFlag = a.slice('--contract='.length);
  else if (a === '--check' || a === '--sync') flags.add(a);
  else if (a.startsWith('-')) fail(`unknown flag ${a}`);
  else positionals.push(a);
}
if (positionals.length !== 1) {
  usage();
  fail('exactly one <name> argument is required');
}
if (flags.size > 1) fail('--check and --sync are mutually exclusive');
const mode = flags.has('--check') ? 'check' : flags.has('--sync') ? 'sync' : 'create';
const name = positionals[0];
if (!NAME_RE.test(name)) fail(`invalid name '${name}' (kebab-case, e.g. hello-world)`);

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
const info = JSON.parse(
  fs.readFileSync(path.join(managedRoot, managed, 'compiler', 'contract-info.json'), 'utf8'),
);
const circuits = info.circuits
  .filter((c) => c.proof)
  .map((c) => ({ name: c.name, args: c.arguments.map((a) => a.name) }));
const ledgerFields = info.ledger.filter((l) => l.exported).map((l) => l.name);
const hasWitnesses = info.witnesses.length > 0;

// contract-info.json does not describe the constructor. The generated
// declaration does: a constructor without parameters is exactly this line.
const dts = fs.readFileSync(path.join(managedRoot, managed, 'contract', 'index.d.ts'), 'utf8');
if (!dts.includes('initialState(context: __compactRuntime.ConstructorContext<PS>')) {
  fail(`could not find initialState(...) in ${managed}/contract/index.d.ts — generator needs updating.`);
}
const hasCtorArgs = !dts.includes(
  'initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;',
);

// With witnesses, the browser imports contract/witnesses.ts as is: it must
// be Node-free and export a create<X>PrivateState factory (the phase-1
// template convention).
let factory = null;
let factoryTakesArgs = false;
if (hasWitnesses) {
  const witnessesPath = path.join(exampleDir, 'contract', 'witnesses.ts');
  if (!fs.existsSync(witnessesPath)) {
    fail(`the contract declares witnesses but examples/${name}/contract/witnesses.ts is missing.`);
  }
  const src = fs.readFileSync(witnessesPath, 'utf8');
  if (/from\s+['"]node:/.test(src)) {
    fail(`examples/${name}/contract/witnesses.ts imports node:* modules; the browser can't load it. Move those out first.`);
  }
  const m = src.match(/export const (create\w*PrivateState)\s*=\s*\(([^)]*)\)/);
  if (!m) {
    fail(`examples/${name}/contract/witnesses.ts has no \`export const create<X>PrivateState = (...) =>\` factory.`);
  }
  factory = m[1];
  factoryTakesArgs = m[2].trim() !== '';
}
// Can the UI build the initial private state on its own?
const psAuto = !factoryTakesArgs;

const names = deriveNames(name);
const { Name } = names;
const camelName = Name[0].toLowerCase() + Name.slice(1);

// Wrapper names share a module with these identifiers.
const taken = new Set([
  'deployContract', 'findDeployedContract', 'map', 'ledger', 'ledger$', 'PRIVATE_STATE_ID',
  'createInitialPrivateState', 'ConstructorArgs', `Compiled${Name}Contract`, `deploy${Name}`,
  `join${Name}`, `${Name}Contract`,
]);
for (const c of circuits) {
  if (taken.has(c.name)) fail(`circuit '${c.name}' collides with an identifier in ${name}-api.ts — rename it there by hand.`);
}

// --- generated blocks ------------------------------------------------------
const needs = [hasCtorArgs && 'constructor args', !psAuto && 'an initial private state']
  .filter(Boolean)
  .join(' and ');

const blocks = {
  __CIRCUIT_UNION__: circuits.length ? circuits.map((c) => JSON.stringify(c.name)).join(' | ') : 'never',
  __WITNESS_METHOD__: hasWitnesses ? 'withWitnesses(witnesses)' : 'withVacantWitnesses',
  __WITNESS_METHOD_DOC__: hasWitnesses
    ? 'withWitnesses: the TypeScript witnesses from contract/witnesses.ts.'
    : 'withVacantWitnesses: the contract declares no witnesses.',
  __PRIVATE_STATE_BLOCK__: hasWitnesses
    ? [
        '/**',
        ' * Private state is whatever examples/__name__/contract/witnesses.ts builds.',
        ' * It lives in memory only (./private-state.ts), so a reload loses it.',
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
  __JOIN_PARAMS__: psAuto ? '' : '\n  initialPrivateState: __Name__PrivateState,',
  __INITIAL_PS__: psAuto ? 'initialPrivateState: createInitialPrivateState()' : 'initialPrivateState',
  __CIRCUIT_WRAPPERS__: circuits
    .map((c) =>
      [
        '',
        `/** Circuit \`${c.name}(${c.args.join(', ')})\`. */`,
        `export async function ${c.name}(`,
        '  contract: __Name__Contract,',
        `  ...args: Parameters<__Name__Contract["callTx"][${JSON.stringify(c.name)}]>`,
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
  ]
    .filter(Boolean)
    .join(', '),
  __LEDGER_FIELDS__: JSON.stringify(ledgerFields).replaceAll('","', '", "'),
  __CIRCUIT_LIST__: circuits.length
    ? `[\n${circuits.map((c) => `  { name: ${JSON.stringify(c.name)}, args: [${c.args.map((a) => JSON.stringify(a)).join(', ')}] },`).join('\n')}\n]`
    : '[]',
  __DEPLOYMENT_OPS__: [
    ...(!hasCtorArgs && psAuto
      ? ['    deploy: deploy__Name__,']
      : [
          `    // TODO: deploy__Name__ needs ${needs} (see __name__-api.ts and the`,
          '    // Node test for values). Collect them, e.g. from a form, and pass them here.',
          `    deploy: () => Promise.reject(new Error("TODO: supply ${needs} to deploy__Name__")),`,
        ]),
    ...(psAuto
      ? ['    join: join__Name__,']
      : [
          "    // TODO: join__Name__ needs this browser's initial private state.",
          '    join: () => Promise.reject(new Error("TODO: supply the initial private state to join__Name__")),',
        ]),
  ].join('\n'),
  __TEST_BODY__:
    !hasCtorArgs && psAuto
      ? [
          'import { describe, expect, it } from "vitest";',
          'import { createConstructorContext } from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";',
          'import { Contract, createInitialPrivateState, ledger } from "../midnight/contract";',
          ...(hasWitnesses ? ['import { witnesses } from "../../../contract/witnesses.js";'] : []),
          '',
          'const COIN_PK = "00".repeat(32);',
          '',
          'describe("__name__ contract (in memory)", () => {',
          '  it("constructs and decodes the initial ledger", () => {',
          `    const contract = new Contract(${hasWitnesses ? 'witnesses' : '{}'});`,
          '    const { currentContractState } = contract.initialState(',
          '      createConstructorContext(createInitialPrivateState(), COIN_PK),',
          '    );',
          '    expect(ledger(currentContractState.data)).toBeDefined();',
          '',
          '    // TODO: call each circuit and assert on the ledger the UI will show:',
          '    //   const ctx = createCircuitContext(dummyContractAddress(), COIN_PK,',
          '    //     currentContractState, createInitialPrivateState());',
          '    //   const { context } = contract.impureCircuits.<circuit>(ctx, ...args);',
          '    //   expect(ledger(context.currentQueryContext.state)).toEqual(...);',
          ...circuits.map((c) => `    //   ${c.name}(${c.args.join(', ')})`),
          '  });',
          '});',
          '',
        ].join('\n')
      : [
          'import { describe, it } from "vitest";',
          '',
          'describe("__name__ contract (in memory)", () => {',
          `  // TODO: constructing the contract needs ${needs}; take values from the`,
          '  // Node test in examples/__name__/src/test/, then run each circuit with',
          '  // createCircuitContext + contract.impureCircuits.<circuit>(ctx, ...args).',
          '  it.todo("constructs and decodes the initial ledger");',
          '});',
          '',
        ].join('\n'),
};

function render(raw, rel) {
  let out = raw;
  // Import line for witnesses: drop the whole line when there are none.
  out = hasWitnesses
    ? out.replaceAll(
        '__WITNESS_IMPORT__',
        `import { ${factory}, witnesses } from "../../../contract/witnesses.js";`,
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

// --- check / sync ------------------------------------------------------------
if (mode === 'check') {
  const drift = [];
  for (const f of files) {
    const onDisk = path.join(uiDir, f.rel);
    const actual = fs.existsSync(onDisk) ? fs.readFileSync(onDisk, 'utf8') : null;
    if (actual !== f.content) drift.push({ ...f, actual });
  }
  if (drift.length === 0) {
    console.log(`✔ examples/${name}/ui matches templates/ui (${files.length} template-owned files)`);
    process.exit(0);
  }
  console.error(`✖ examples/${name}/ui has drifted from templates/ui in ${drift.length} file(s):\n`);
  for (const d of drift) {
    console.error(`  ${d.rel}${d.actual === null ? '  (missing)' : ''}  ← templates/ui/${d.templateRel}`);
    if (d.actual !== null) console.error(firstDifference(d.content, d.actual));
  }
  console.error(
    '\n  Template-owned files must stay identical across examples. Either move the change into\n' +
      `  templates/ui/ (then \`yarn new:ui ${name} --sync\` here and in any other UI), or, if it is\n` +
      '  example-specific, move it into a seed file (the api, panel, or circuits test).',
  );
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

if (mode === 'sync') {
  console.log(`✔ Rewrote ${written.length} template-owned files in examples/${name}/ui (seed files untouched).`);
  console.log('  Review with `git diff`, then typecheck and test:unit.');
  process.exit(0);
}

// --- summary ----------------------------------------------------------------
const rel = (p) => p.split(path.sep).join('/');
console.log(`\n✔ Scaffolded examples/${name}/ui from contract/managed/${managed}`);
console.log(
  `  circuits: ${circuits.map((c) => c.name).join(', ') || '(none)'}` +
    `\n  witnesses: ${hasWitnesses ? `yes (private state from ${factory}${factoryTakesArgs ? ', needs args' : ''})` : 'none'}` +
    `\n  constructor args: ${hasCtorArgs ? 'yes' : 'none'}`,
);
console.log(`\n  ${written.length} files created. Seed files (yours to edit):`);
for (const f of files.filter((f) => SEED_FILES.has(f.templateRel))) {
  console.log(`    examples/${name}/ui/${rel(f.rel)}`);
}
if (needs) {
  console.log(`\n  ⚠ Deploy needs ${needs}: the panel has a TODO that rejects until you supply them.`);
}
console.log('\n  Next steps:');
console.log('    1. yarn install   (the new workspace changes yarn.lock; commit it — CI uses --immutable)');
console.log(`    2. yarn workspace ${pkg}-ui typecheck && yarn workspace ${pkg}-ui test:unit && yarn workspace ${pkg}-ui build`);
console.log('    3. Build the use case into the seed files above');
console.log('    4. Work through the verification checklist in examples/hello-world/ui/AGENTS.md');
console.log('');
