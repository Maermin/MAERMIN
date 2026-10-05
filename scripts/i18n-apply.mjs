#!/usr/bin/env node
// Dev tool (not part of the gate): move English literals into translation
// keys. Usage: node scripts/i18n-apply.mjs <batch.mjs> [...more]
//
// A batch module exports { file?, section, items } where each item is
//   ['key', 'English text', 'Deutscher Text']            replace the literal in `file`
//   ['key', 'English text', 'Deutscher Text', { dict: true }]   dictionary only
//   ['key', 'English text', 'Deutscher Text', { line: 123 }]    only that line
// Every literal token in `file` whose value is exactly 'English text' becomes
// __('key', 'English text') — except object keys, `|| 'fallback'` positions
// and arguments of __()/tr(). The key goes into `en` and `de`. Files get the
// __ helper on first use.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, DICT_FILE, tokenize, unquote, loadDicts } from './i18n-lib.mjs';

const HELPER = "// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).\n" +
  "function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }\n";

function q(s) { return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'"; }

export function addKeys(entries, section) {
  const p = join(root, DICT_FILE);
  let src = readFileSync(p, 'utf8');
  const T = loadDicts();
  const enAdd = [], deAdd = [];
  for (const [key, en, de] of entries) {
    if (!/^[A-Za-z_]\w*$/.test(key)) throw new Error('bad key ' + key);
    if (key in T.en) {
      if (T.en[key] !== en) throw new Error(`key ${key} exists with a different en value: '${T.en[key]}' vs '${en}'`);
    } else if (!enAdd.some((l) => l.startsWith('    ' + key + ':'))) enAdd.push(`    ${key}: ${q(en)},`);
    if (!(key in T.de) && !deAdd.some((l) => l.startsWith('    ' + key + ':'))) deAdd.push(`    ${key}: ${q(de)},`);
  }
  const head = `\n\n    // ${section}\n`;
  if (enAdd.length) {
    const deStart = src.indexOf('\n  de: {');
    const enEnd = src.lastIndexOf('\n  },', deStart);
    const before = src.slice(0, enEnd).replace(/,?\s*$/, ',');
    src = before + head + enAdd.join('\n').replace(/,$/, '') + src.slice(enEnd);
  }
  if (deAdd.length) {
    const deEnd = src.lastIndexOf('\n  }\n};');
    const before = src.slice(0, deEnd).replace(/,?\s*$/, ',');
    src = before + head + deAdd.join('\n').replace(/,$/, '') + src.slice(deEnd);
  }
  writeFileSync(p, src);
  return { en: enAdd.length, de: deAdd.length };
}

// Drop keys from both dictionaries (one `key: '…'` entry per block).
export function removeKeys(keys) {
  const p = join(root, DICT_FILE);
  let src = readFileSync(p, 'utf8');
  for (const k of keys) {
    const entry = new RegExp(`(\\n[ \\t]*)?\\b${k}: '(?:[^'\\\\]|\\\\.)*',?[ \\t]*`, 'g');
    src = src.replace(entry, (m, nl) => (nl && /,\s*$/.test(m) ? nl.replace(/[ \t]+$/, '') : '') || '');
  }
  writeFileSync(p, src);
}

export function replaceLiterals(file, items) {
  const p = join(root, file);
  let src = readFileSync(p, 'utf8');
  const toks = tokenize(src);
  const edits = [];
  const hits = {};
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i];
    if (tk.type !== 'string' || tk.value[0] === '`') continue;
    const prev = toks[i - 1] || {}, next = toks[i + 1] || {};
    if (prev.value === '||') continue;
    if (next.value === ':' && (prev.value === '{' || prev.value === ',')) continue;
    if (prev.value === '(' && toks[i - 2] && /^(__|tr)$/.test(toks[i - 2].value)) continue;
    if (prev.value === ',' && toks[i - 3] && toks[i - 3].value === '(' && toks[i - 4] && /^(__|tr)$/.test(toks[i - 4].value)) continue;
    const val = unquote(tk.value);
    const line = src.slice(0, tk.index).split('\n').length;
    const item = items.find((it) => !(it[3] && it[3].dict) && it[1] === val && (!(it[3] && it[3].line) || it[3].line === line));
    if (!item) continue;
    edits.push({ at: tk.index, len: tk.value.length, text: `__('${item[0]}', ${tk.value})` });
    hits[item[0]] = (hits[item[0]] || 0) + 1;
  }
  for (const e of edits.sort((a, b) => b.at - a.at)) src = src.slice(0, e.at) + e.text + src.slice(e.at + e.len);
  if (edits.length && !/\nfunction __\(k, f, v\)|\n\s+function __\(k, f, v\)/.test(src)) {
    // After the first 'use strict' (inside the IIFE) or at the top.
    const m = src.match(/(['"])use strict\1;?\n/);
    if (m) src = src.slice(0, m.index + m[0].length) + HELPER + src.slice(m.index + m[0].length);
    else src = HELPER + src;
  }
  writeFileSync(p, src);
  const missed = items.filter((it) => !(it[3] && it[3].dict) && !hits[it[0]]).map((it) => it[0]);
  return { replaced: edits.length, missed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rm = process.argv.indexOf('--remove');
  if (rm > -1) { removeKeys(process.argv[rm + 1].split(',')); process.argv.splice(rm, 2); }
  for (const arg of process.argv.slice(2)) {
    const batch = (await import(pathToFileURL(resolve(arg)).href)).default;
    const r = batch.file ? replaceLiterals(batch.file, batch.items) : { replaced: 0, missed: [] };
    const d = addKeys(batch.items, batch.section || batch.file);
    console.log(`${arg}: ${r.replaced} literal(s) replaced in ${batch.file || '-'}, +${d.en} en / +${d.de} de` + (r.missed.length ? `; NOT FOUND: ${r.missed.join(', ')}` : ''));
  }
}
