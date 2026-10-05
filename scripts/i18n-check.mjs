#!/usr/bin/env node
// i18n guard (PLAN P2-2), run by `npm run check`:
//   1. `en` and `de` have the same keys, and no value is empty.
//   2. Every key the code asks for exists: __('key', …), tr('key', …),
//      t.key || …, and the nav-model labels.
//   3. __('key', 'Text') carries the same English text as the dictionary, so
//      the fallback in the code never drifts from what users see.
//   4. No dead keys: every dictionary key is referenced somewhere.
//   5. Hardcoded UI text does not grow: per-file counts may only go down
//      (scripts/i18n-baseline.json). `--update` rewrites the baseline.
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, appFiles, loadDicts, readSrc, scanText, tokenize, unquote } from './i18n-lib.mjs';

const BASELINE = join(root, 'scripts', 'i18n-baseline.json');

export function collectUses(files) {
  const uses = [];      // { key, file, fallback? }
  for (const f of files) {
    const src = readSrc(f);
    const toks = tokenize(src);
    for (let i = 0; i < toks.length; i++) {
      const v = toks[i].value;
      // __('key', 'Fallback'?) and tr('key', 'Fallback'?)
      if ((v === '__' || v === 'tr') && toks[i + 1] && toks[i + 1].value === '(' && toks[i + 2] && toks[i + 2].type === 'string') {
        const key = unquote(toks[i + 2].value);
        let fallback;
        if (toks[i + 3] && toks[i + 3].value === ',' && toks[i + 4] && toks[i + 4].type === 'string' && toks[i + 4].value[0] !== '`') fallback = unquote(toks[i + 4].value);
        uses.push({ key, file: f, fallback: v === '__' ? fallback : undefined });
      }
      // Uses inside template literals: `${t.key || '…'}`, `${__('key', …)}`.
      if (toks[i].type === 'string' && v[0] === '`') {
        for (const m of v.matchAll(/(?<![.\w])t\.(\w+)\s*\|\|/g)) uses.push({ key: m[1], file: f });
        for (const m of v.matchAll(/\b(?:__|tr)\('(\w+)'/g)) uses.push({ key: m[1], file: f });
      }
      // t.key || …
      if (v === 't' && toks[i + 1] && toks[i + 1].value === '.' && toks[i + 2] && toks[i + 2].type === 'name' && toks[i + 3] && toks[i + 3].value === '||' && (!toks[i - 1] || toks[i - 1].value !== '.')) {
        uses.push({ key: toks[i + 2].value, file: f });
      }
    }
    if (f === 'nav-model.js') {
      for (const m of src.matchAll(/\bv\('[a-z-]+', '(\w+)'/g)) uses.push({ key: m[1], file: f });
      for (const m of src.matchAll(/\b(?:key|shortKey): '(\w+)'/g)) uses.push({ key: m[1], file: f });
    }
  }
  return uses;
}

export function run({ update = false, quiet = false } = {}) {
  const errors = [];
  const T = loadDicts();
  const en = T.en || {}, de = T.de || {};
  const enKeys = Object.keys(en), deKeys = Object.keys(de);

  // 1. parity
  const missingDe = enKeys.filter((k) => !(k in de));
  const extraDe = deKeys.filter((k) => !(k in en));
  if (missingDe.length) errors.push(`${missingDe.length} key(s) missing in de: ${missingDe.slice(0, 20).join(', ')}${missingDe.length > 20 ? ' …' : ''}`);
  if (extraDe.length) errors.push(`${extraDe.length} key(s) only in de: ${extraDe.join(', ')}`);
  for (const [name, d] of [['en', en], ['de', de]]) {
    const empty = Object.keys(d).filter((k) => typeof d[k] !== 'string' || !d[k].trim());
    if (empty.length) errors.push(`empty ${name} value(s): ${empty.join(', ')}`);
  }

  // 2 + 3. uses
  const files = appFiles();
  const uses = collectUses(files);
  const undef = [...new Set(uses.filter((u) => !(u.key in en)).map((u) => `${u.key} (${u.file})`))];
  if (undef.length) errors.push(`${undef.length} key(s) used but not defined: ${undef.join(', ')}`);
  const drift = uses.filter((u) => u.fallback !== undefined && u.key in en && en[u.key] !== u.fallback);
  if (drift.length) errors.push(`__() fallback differs from en: ${drift.map((u) => `${u.key} (${u.file}): '${u.fallback}' vs '${en[u.key]}'`).join('; ')}`);

  // 4. dead keys: referenced nowhere in app code (any word match counts, so
  // keys built at run time from a known name still count when the name appears).
  const corpus = files.map(readSrc).join('\n');
  const words = new Set(corpus.match(/[A-Za-z_][A-Za-z0-9_]*/g));
  const dead = enKeys.filter((k) => !words.has(k));
  if (dead.length) errors.push(`${dead.length} dead key(s): ${dead.join(', ')}`);

  // 5. hardcoded text ratchet
  const counts = {};
  const found = {};
  for (const f of files) {
    const hits = scanText(readSrc(f));
    if (hits.length) { counts[f] = hits.length; found[f] = hits; }
  }
  const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
  if (update) {
    writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + '\n');
  } else {
    for (const f of Object.keys(counts)) {
      const allowed = base[f] || 0;
      if (counts[f] > allowed) {
        errors.push(`${f}: ${counts[f]} hardcoded UI string(s), baseline ${allowed}. Use __('key', 'Text') with en + de entries. Candidates:\n` +
          found[f].slice(0, 12).map((h) => `      ${f}:${h.line}  ${JSON.stringify(h.text)}`).join('\n'));
      }
    }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!quiet) {
    if (errors.length) {
      console.error('✗ i18n check failed:');
      errors.forEach((e) => console.error('  - ' + e));
    } else {
      console.log(`✓ i18n: ${enKeys.length} keys in en and de, ${uses.length} uses resolve, ${total} hardcoded UI string(s) left (baseline)`);
    }
  }
  return { errors, counts, total, missingDe, extraDe, undef, dead };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = run({ update: process.argv.includes('--update') });
  if (process.argv.includes('--list')) {
    for (const f of appFiles()) for (const h of scanText(readSrc(f))) console.log(`${f}:${h.line}  ${JSON.stringify(h.text)}`);
  }
  process.exit(res.errors.length ? 1 : 0);
}
