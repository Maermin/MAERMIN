// Copies the app modules maermin-mcp uses (and everything they require) into
// mcp/app/, so the npm package runs without the repository. Run by `npm pack`
// / `npm publish` (prepack). Usage: node scripts/vendor.mjs [--check]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const out = path.join(here, '..', 'app');
export const ENTRY = ['crypto-vault.js', 'ledger.js', 'fx-history.js', 'return-figures.js', 'returns-engine.js', 'tax-report-builder.js', 'tax-calculation-engine.js'];

// The entry modules and every './x.js' they require, transitively.
export function collect() {
  const seen = new Set(), todo = ENTRY.slice();
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f)) continue;
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    seen.add(f);
    for (const m of src.matchAll(/require\(\s*'\.\/([\w.-]+\.js)'\s*\)/g)) if (!seen.has(m[1])) todo.push(m[1]);
  }
  return [...seen].sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = collect();
  if (process.argv.includes('--check')) { console.log(files.join('\n')); process.exit(0); }
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const f of files) fs.copyFileSync(path.join(root, f), path.join(out, f));
  console.log('vendored ' + files.length + ' app modules into mcp/app/');
}
