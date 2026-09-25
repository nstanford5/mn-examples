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

// Shared helpers for the scaffolding generators (new-example.mjs, new-ui.mjs).
// Zero dependencies — Node built-ins only.
//
// Template convention: tokens are double-underscored (`__name__`, `__Name__`,
// `__Title__`, plus generator-specific ones). `__name__` is also replaced in
// file and directory names.

import fs from 'node:fs';
import path from 'node:path';

export const NAME_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function fail(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

/** kebab-case `name` → { name, Name (PascalCase), Title (Space Joined) }. */
export function deriveNames(name) {
  const words = name.split('-');
  const cap = (w) => w[0].toUpperCase() + w.slice(1);
  return { name, Name: words.map(cap).join(''), Title: words.map(cap).join(' ') };
}

/** Replace the three name tokens. Order matters only in that all are distinct. */
export function substituteNames(content, { name, Name, Title }) {
  return content.replaceAll('__Title__', Title).replaceAll('__Name__', Name).replaceAll('__name__', name);
}

export function assertNoLeftoverTokens(rel, content, knownTokens) {
  const leftovers = knownTokens.filter((t) => content.includes(t));
  if (leftovers.length > 0) {
    fail(`unresolved template token(s) ${leftovers.join(', ')} in ${rel} — this is a generator bug.`);
  }
}

/**
 * Walk `templateDir` and return the rendered files in memory as
 * `[{ templateRel, rel, content }]` in directory-walk order. `rel` is the output path
 * (with `__name__` replaced in each segment). Nothing is written, so callers
 * can either write the result or diff it against disk.
 *
 *   skip(templateRel)          → true to leave a file out
 *   render(content, templateRel) → rendered content
 */
export function renderTree(templateDir, { name, skip = () => false, render }) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const srcPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(srcPath);
        continue;
      }
      const templateRel = path.relative(templateDir, srcPath);
      if (skip(templateRel)) continue;
      const rel = templateRel.split(path.sep).map((s) => s.replaceAll('__name__', name)).join(path.sep);
      out.push({ templateRel, rel, content: render(fs.readFileSync(srcPath, 'utf8'), templateRel) });
    }
  };
  walk(templateDir);
  return out;
}

/** Write rendered files under `destDir`; returns the absolute paths written. */
export function writeFiles(destDir, files) {
  return files.map(({ rel, content }) => {
    const destPath = path.join(destDir, rel);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, content);
    return destPath;
  });
}
