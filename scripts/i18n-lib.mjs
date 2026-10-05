// Shared helpers for the i18n guard (scripts/i18n-check.mjs) and the dev tool
// that moves literals into translation keys (scripts/i18n-apply.mjs).
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const jsTokens = require('js-tokens');

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DICT_FILE = 'translations-complete.js';

// Files that hold no UI text of their own: data tables, dev/boot shims,
// workers and the dictionary itself.
export const NOT_UI = new Set([
  DICT_FILE, 'i18n.js', 'equity-metadata.js', 'demo-data.js', 'dev-boot.js', 'icons.js',
  'service-worker.js', 'compute.worker.js', 'compute.worker.harness.js', 'loader-status.js'
]);

export function appFiles() {
  return readdirSync(root).filter((f) => f.endsWith('.js') && !NOT_UI.has(f)).sort();
}

export function loadDicts() {
  const p = join(root, DICT_FILE);
  delete require.cache[p];
  return require(p);
}

export function tokenize(src) {
  const re = jsTokens.default;
  re.lastIndex = 0;
  const out = [];
  let m;
  while ((m = re.exec(src))) {
    const tk = jsTokens.matchToToken(m);
    tk.index = m.index;
    if (tk.type !== 'whitespace' && tk.type !== 'comment') out.push(tk);
  }
  return out;
}

// Decode a quoted JS string token ('…' or "…").
export function unquote(tok) {
  const q = tok[0];
  const body = tok.slice(1, -1);
  if (q === '`') return body;
  try { return JSON.parse('"' + body.replace(/\\'/g, "'").replace(/"/g, '\\"').replace(/\\\\"/g, '\\"') + '"'); }
  catch (e) { return body; }
}

const CALLS_NOT_UI = new Set(['log', 'dbg', 'warn', 'error', 'info', 'debug', 'Error', 'TypeError', 'RangeError',
  'querySelector', 'querySelectorAll', 'getElementById', 'getItem', 'setItem', 'removeItem',
  'addEventListener', 'removeEventListener', 'require', 'record', 'fetch', 'postMessage',
  'setAttribute', 'getAttribute', 'createElementNS', 'matchMedia', 'emit', 'on', 'off', 'test', 'match', 'replace', 'split', 'startsWith', 'endsWith', 'includes', 'indexOf']);

// Names that read the same in every language (products, services, codes).
const SAME_IN_ALL = new Set(['MAERMIN', 'CoinGecko', 'ExchangeRate-API', 'Cloudflare Worker', 'Yahoo Finance',
  'Argon2id', 'PBKDF2-600k', 'English', 'Deutsch', '1 USD', '€ EUR', '$ USD', 'Steam Market', 'Binance', 'Kraken',
  'Coinbase', 'Bitpanda', 'Trade Republic', 'Scalable Capital', 'Interactive Brokers', 'XIRR', 'TWR', 'FIFO', 'FIRE',
  'Monte Carlo', 'Coast-FIRE', 'Sharpe', 'Sortino', 'Beta', 'Alpha', 'ETF', 'ETFs', 'Watchlist', 'Dashboard', 'Live', 'Demo', 'Nebula', 'OK']);

// Does this literal read like text a person sees?
function looksLikeText(s) {
  s = s.trim();
  if (SAME_IN_ALL.has(s)) return false;
  if (/^[^\s]*[?=&][^\s]*$/.test(s)) return false;               // query strings
  if (s === 'use strict') return false;
  if (/^((top|bottom|left|right|center|auto|[\d.]+(px|rem|em|%)?)\s*){1,4}$/.test(s)) return false; // CSS positions
  if (/^→ /.test(s) && SAME_IN_ALL.has(s.slice(2))) return false;
  if (!/[A-Za-z]{2}/.test(s)) return false;
  if (/^(https?:|data:|mailto:|\.\/|\/|#)/.test(s)) return false;
  if (/^[a-z0-9_.:\/@-]+$/.test(s)) return false;                // ids, classes, keys, mime
  if (/^[a-z][a-zA-Z0-9]*$/.test(s)) return false;               // camelCase ids
  if (/^[A-Z0-9_.$^=:-]+$/.test(s)) return false;                // CONSTANTS, tickers
  if (/^[a-z-]+( [a-z0-9-]+)+$/.test(s) && /-/.test(s)) return false; // class lists
  if (/\b(rgba?|hsla?|var|calc|url|translate[XY3d]*|scale|rotate|cubic-bezier|linear-gradient|radial-gradient|blur|drop-shadow)\(/.test(s)) return false;
  if (/\b\d+(\.\d+)?(px|rem|em|vh|vw|ms|s|deg|fr)\b/.test(s) && !/[a-z]{3,} [a-z]{3,} [a-z]{3,}/.test(s)) return false;
  if (/^(solid|dashed|bold|normal|italic|inherit|none|auto|center|flex|grid|block|absolute|relative|fixed|sticky|pointer|hidden|nowrap|uppercase)\b/.test(s)) return false;
  if (/(monospace|sans-serif|serif)$/.test(s)) return false;
  if (/^\[[A-Za-z -]+\]/.test(s)) return false;                   // "[PRICES] …" log prefixes
  if (/^[\w.-]+\.(js|css|json|csv|pdf|png|svg|html|xlsx?)$/i.test(s)) return false;
  if (!/[A-Z]/.test(s) && !/ /.test(s)) return false;
  return true;
}

// Hardcoded UI text candidates in one source file: [{ line, text }].
// Skips English fallbacks after `||` (the `t.key || 'Text'` idiom), the
// fallback argument of __('key', 'Text'), object keys, and console/Error/DOM
// lookups.
export function scanText(src) {
  const toks = tokenize(src);
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i];
    if (tk.type !== 'string') continue;
    const prev = toks[i - 1] || {}, next = toks[i + 1] || {};
    if (prev.value === '||') continue;
    if (next.value === ':' && (prev.value === '{' || prev.value === ',')) continue;
    if (/^(===|!==|==|!=|case|in)$/.test(prev.value) || /^(===|!==|==|!=|in)$/.test(next.value)) continue;
    if (prev.value === ',' && toks[i - 2] && toks[i - 2].type === 'string' && toks[i - 3] && toks[i - 3].value === '(' && toks[i - 4] && /^(__|tr|t)$/.test(toks[i - 4].value)) continue;
    if (prev.value === '(' && toks[i - 1] && toks[i - 2] && /^(__|tr)$/.test(toks[i - 2].value)) continue;
    const text = tk.value[0] === '`'
      ? tk.value.slice(1, -1).replace(/\$\{(?:[^{}]|\{[^}]*\})*\}/g, '\u2026')
      : unquote(tk.value);
    if (!looksLikeText(text)) continue;
    // Inside console.x( / Error( / querySelector( … within a few tokens.
    let depth = 0, skip = false;
    for (let j = i - 1; j >= 0 && j > i - 14; j--) {
      const v = toks[j].value;
      if (v === ')' || v === ']' || v === '}') depth++;
      else if (v === '(' || v === '[' || v === '{') {
        if (depth === 0) {
          if (v === '(' && toks[j - 1] && CALLS_NOT_UI.has(toks[j - 1].value)) skip = true;
          break;
        }
        depth--;
      }
    }
    if (skip) continue;
    out.push({ line: src.slice(0, tk.index).split('\n').length, text });
  }
  return out;
}

export function readSrc(f) { return readFileSync(join(root, f), 'utf8'); }
