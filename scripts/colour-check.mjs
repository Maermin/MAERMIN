#!/usr/bin/env node
// Colour-literal guard (PLAN Phase 6, R1.1). Views take colours from the design
// tokens (styles.css, via the theme objects or MaerminTokens), not from hex /
// rgb() literals. Each file may hold at most the count in
// scripts/colour-baseline.json; the count only goes down as views move onto
// tokens. `node scripts/colour-check.mjs --update` rewrites the baseline after a
// reduction (never to raise it).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(root, 'scripts', 'colour-baseline.json');
// Files that define colours on purpose: the token bridge, demo data, tests' fixtures.
const EXEMPT = new Set(['theme-tokens.js', 'demo-fixtures.js', 'translations-complete.js']);
const LITERAL = /#[0-9a-fA-F]{3,8}\b(?=['"`\s,;)])|\brgba?\(\s*\d/g;

export function counts() {
  const out = {};
  for (const f of readdirSync(root).filter((n) => n.endsWith('.js') && !EXEMPT.has(n)).sort()) {
    const n = (readFileSync(join(root, f), 'utf8').match(LITERAL) || []).length;
    if (n) out[f] = n;
  }
  return out;
}

export function run({ update = false, quiet = false } = {}) {
  const now = counts();
  let base = {};
  try { base = JSON.parse(readFileSync(BASELINE, 'utf8')); } catch (e) { base = {}; }
  const errors = [];
  for (const [f, n] of Object.entries(now)) {
    const b = base[f] || 0;
    if (n > b) errors.push(`${f}: ${n} colour literal(s), baseline ${b}. Use a token (var(--…) / theme.*) instead of a hex or rgb() value.`);
  }
  const total = Object.values(now).reduce((a, b) => a + b, 0);
  if (update) {
    const next = {};
    for (const [f, n] of Object.entries(now)) next[f] = Math.min(n, base[f] == null ? n : base[f]);
    writeFileSync(BASELINE, JSON.stringify(next, null, 2) + '\n');
  }
  if (!quiet) {
    if (errors.length) errors.forEach((e) => console.error('  ✗ ' + e));
    else console.log(`✓ colours: ${total} hex / rgb() literal(s) left in ${Object.keys(now).length} file(s), none new`);
  }
  return { errors, total, counts: now };
}

if (process.argv[1] && /colour-check.mjs$/.test(process.argv[1])) {
  const r = run({ update: process.argv.includes('--update') });
  if (r.errors.length) process.exit(1);
}
