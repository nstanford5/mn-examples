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

// Scaffolds a new example under examples/<name> from templates/example.
// Zero dependencies — Node built-ins only. Run with no AI assistance:
//
//   yarn new:example <name> [--witnesses] [--no-register]
//   node scripts/new-example.mjs <name> [--witnesses] [--no-register]
//
// After scaffolding, the author only has to write contract/<name>.compact and
// fill in the test bodies. Everything else (harness, config, docker, docs stubs,
// and a test skeleton up to the first deployContract call) is generated.

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
const TEMPLATE_DIR = path.join(REPO_ROOT, 'templates', 'example');
const EXAMPLES_DIR = path.join(REPO_ROOT, 'examples');
assertNodeVersion(REPO_ROOT);

function usage() {
  console.log(
    [
      'Usage: yarn new:example <name> [--witnesses] [--no-register]',
      '',
      '  <name>          kebab-case example name (e.g. voting, hello-world)',
      '  --witnesses     generate a witnesses.ts stub and wire withWitnesses()',
      '  --no-register   do not edit ci.yaml / README.md / AGENTS.md',
    ].join('\n'),
  );
}

// --- arg parsing ------------------------------------------------------------
const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  usage();
  process.exit(0);
}
const withWitnesses = args.includes('--witnesses');
const noRegister = args.includes('--no-register');
const positionals = args.filter((a) => !a.startsWith('-'));
if (positionals.length !== 1) {
  usage();
  fail('exactly one <name> argument is required');
}
const name = positionals[0];
if (!NAME_RE.test(name)) {
  fail(`invalid name '${name}'. Use kebab-case: lowercase letters/digits, hyphen-separated (e.g. hello-world).`);
}

const targetDir = path.join(EXAMPLES_DIR, name);
if (fs.existsSync(targetDir)) {
  fail(`examples/${name} already exists — choose a different name or remove it first.`);
}
if (!fs.existsSync(TEMPLATE_DIR)) {
  fail(`template directory not found at ${path.relative(REPO_ROOT, TEMPLATE_DIR)}`);
}

// --- name derivations -------------------------------------------------------
const names = deriveNames(name);
const { Name } = names;

// --- token/marker substitution ----------------------------------------------
const KNOWN_TOKENS = [
  '__name__',
  '__Name__',
  '__Title__',
  '__WITNESS_IMPORT__',
  '__WITNESS_METHOD__',
  '__PRIVATE_STATE_IMPORT__',
  '__INITIAL_PRIVATE_STATE__',
];

function substitute(content) {
  // 1) Plain name tokens (case-sensitive, non-overlapping).
  let out = substituteNames(content, names);

  // 2) Witness markers. Values are pre-resolved so ordering is irrelevant.
  if (withWitnesses) {
    out = out
      .replaceAll('__WITNESS_IMPORT__', "import { witnesses } from './witnesses.js';")
      .replaceAll('__WITNESS_METHOD__', 'withWitnesses(witnesses)')
      .replaceAll(
        '__PRIVATE_STATE_IMPORT__',
        `import { create${Name}PrivateState } from '../../contract/witnesses.js';`,
      )
      .replaceAll('__INITIAL_PRIVATE_STATE__', `create${Name}PrivateState()`);
  } else {
    // Drop the whole marker line for the two import markers.
    out = out
      .replaceAll('__WITNESS_IMPORT__\n', '')
      .replaceAll('__PRIVATE_STATE_IMPORT__\n', '')
      .replaceAll('__WITNESS_METHOD__', 'withVacantWitnesses')
      .replaceAll('__INITIAL_PRIVATE_STATE__', '{}');
  }
  return out;
}

// --- render + write ----------------------------------------------------------
const files = renderTree(TEMPLATE_DIR, {
  name,
  // Only copy the witnesses stub when --witnesses is set.
  skip: (rel) => !withWitnesses && rel === path.join('contract', 'witnesses.ts'),
  render: (raw, rel) => {
    const content = substitute(raw);
    assertNoLeftoverTokens(rel, content, KNOWN_TOKENS);
    return content;
  },
});
const created = writeFiles(targetDir, files).map((p) => path.relative(REPO_ROOT, p));

// --- registration (best-effort, idempotent) ---------------------------------
function registerCi() {
  const file = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yaml');
  const content = fs.readFileSync(file, 'utf8');
  const re = /example:\s*\[([^\]]*)\]/;
  const m = content.match(re);
  if (!m) return { ok: false, msg: 'ci.yaml: could not find the `example: [...]` matrix — add it manually.' };
  const items = m[1].split(',').map((s) => s.trim()).filter(Boolean);
  if (items.includes(name)) return { ok: true, msg: 'ci.yaml: already listed' };
  items.push(name);
  fs.writeFileSync(file, content.replace(re, `example: [${items.join(', ')}]`));
  return { ok: true, msg: 'ci.yaml: added to CI matrix' };
}

function registerAgents() {
  const file = path.join(REPO_ROOT, 'AGENTS.md');
  const content = fs.readFileSync(file, 'utf8');
  if (content.includes(`| \`${name}\` |`)) return { ok: true, msg: 'AGENTS.md: already listed' };
  const lines = content.split('\n');
  const headerIdx = lines.findIndex((l) => /^\|\s*Example\s*\|/.test(l));
  if (headerIdx === -1) return { ok: false, msg: 'AGENTS.md: could not find the Examples table — add a row manually.' };
  let i = headerIdx + 2; // skip header + separator
  while (i < lines.length && lines[i].trimStart().startsWith('|')) i++;
  lines.splice(i, 0, `| \`${name}\` | TODO: what it teaches |`);
  fs.writeFileSync(file, lines.join('\n'));
  return { ok: true, msg: 'AGENTS.md: appended Examples table row' };
}

function registerReadme() {
  const file = path.join(REPO_ROOT, 'README.md');
  const content = fs.readFileSync(file, 'utf8');
  if (content.includes(`── ${name}/`)) return { ok: true, msg: 'README.md: already listed' };
  const lines = content.split('\n');
  const lastIdx = lines.findIndex((l) => /^│\s*└──\s+[a-z0-9-]+\/.*#/.test(l));
  if (lastIdx === -1) return { ok: false, msg: 'README.md: could not find the examples tree — add a line manually.' };
  lines.splice(lastIdx, 0, `│   ├── ${name}/   # TODO: one-line description`);
  fs.writeFileSync(file, lines.join('\n'));
  return { ok: true, msg: 'README.md: inserted into Layout tree' };
}

const registration = [];
if (!noRegister) {
  for (const fn of [registerCi, registerAgents, registerReadme]) {
    try {
      registration.push(fn());
    } catch (err) {
      registration.push({ ok: false, msg: `${fn.name}: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
}

// --- summary ----------------------------------------------------------------
console.log(`\n✔ Scaffolded examples/${name} (${withWitnesses ? 'with witnesses' : 'witness-free'})\n`);
console.log(`  ${created.length} files created:`);
for (const f of created) console.log(`    ${f}`);
if (!noRegister) {
  console.log('\n  Registration:');
  for (const r of registration) console.log(`    ${r.ok ? '•' : '⚠'} ${r.msg}`);
} else {
  console.log('\n  Registration skipped (--no-register). Remember to add the example to:');
  console.log('    • .github/workflows/ci.yaml matrix');
  console.log('    • README.md Layout tree');
  console.log('    • AGENTS.md Examples table');
}
console.log('\n  Next steps:');
console.log(`    1. Write your contract in examples/${name}/contract/${name}.compact`);
if (withWitnesses) {
  console.log(`    2. Implement the declared witnesses in examples/${name}/contract/witnesses.ts`);
  console.log(`    3. Fill in tests in examples/${name}/src/test/${name}.test.ts`);
} else {
  console.log(`    2. Fill in tests in examples/${name}/src/test/${name}.test.ts`);
}
console.log('    Then, from the repo root:');
console.log('      yarn install');
console.log(`      yarn workspace @midnight-ntwrk/example-${name} run compile`);
console.log(`    And from examples/${name}:  yarn env:up && yarn wait:dust && yarn test:local && yarn env:down`);
console.log(`    Optional, once the tests pass: yarn new:ui ${name}   (browser frontend)`);
console.log('');
