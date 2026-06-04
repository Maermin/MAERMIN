#!/usr/bin/env node
// Fast syntax gate: run `node --check` on every project JS file. Catches parse
// errors before they reach the browser bundle or CI test run. No deps.
import { readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', 'dist', '.git']);

function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...jsFiles(p));
    else if (name.endsWith('.js') || name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

const files = jsFiles(root).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.status !== 0) { failed++; console.error('  ✗ ' + f.replace(root + '/', '')); }
}

if (failed) { console.error(`\n${failed} of ${files.length} files failed syntax check`); process.exit(1); }
console.log(`✓ ${files.length} JS files pass syntax check`);
