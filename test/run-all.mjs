#!/usr/bin/env node
// MAERMIN test runner — runs every test/*.test.js in a child process and fails
// the whole run (non-zero exit) if any suite fails. Used by `npm test` and CI.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter((f) => f.endsWith('.test.js')).sort();

let failed = 0;
for (const f of files) {
  console.log('\n──────── ' + f + ' ────────');
  const r = spawnSync(process.execPath, [join(here, f)], { stdio: 'inherit' });
  if (r.status !== 0) { failed++; console.error('  ✗ SUITE FAILED: ' + f); }
}

console.log('\n════════════════════════════');
if (failed) { console.error(failed + ' of ' + files.length + ' suites FAILED'); process.exit(1); }
console.log('All ' + files.length + ' suites passed.');
