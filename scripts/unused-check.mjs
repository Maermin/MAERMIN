#!/usr/bin/env node
// Dead-code guard: ESLint `no-unused-vars` over the app, scripts, the Worker and
// the MCP package (not tests, docs or the generated translations). A local that
// is assigned and never read, or a function nobody calls, fails the check.
// The 2026-10 cleanup (#272) removed ~110 of them, mostly theme shortcuts left
// behind when views moved onto the ui-* classes; this keeps them from coming back.
// Parameters are not checked (`args: 'none'`): handlers and React props often
// take arguments they do not use.
import { ESLint } from 'eslint';
import globals from 'globals';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const unused = ['error', { vars: 'all', args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }];
// Browser scripts are plain global IIFEs: top-level names are shared between
// files through the page, so only names inside a function scope are checked.
const scriptUnused = ['error', { vars: 'local', args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }];

export async function run({ quiet = false } = {}) {
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [
      { ignores: ['node_modules/**', 'dist/**', 'docs/**', 'test/**', 'mcp/app/**', 'translations-complete.js', 'cf-worker/worker.single.js', '.claude/**', 'x/**'] },
      {
        files: ['**/*.js'],
        languageOptions: { ecmaVersion: 2024, sourceType: 'script', parserOptions: { ecmaFeatures: { jsx: true } }, globals: { ...globals.browser, ...globals.node, ...globals.worker } },
        rules: { 'no-unused-vars': scriptUnused }
      },
      {
        files: ['**/*.mjs', 'cf-worker/**/*.js'],
        languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node, ...globals.worker } },
        rules: { 'no-unused-vars': unused }
      }
    ]
  });
  const results = await eslint.lintFiles(['*.js', '*.mjs', 'scripts/**/*.mjs', 'cf-worker/**/*.js', 'mcp/**/*.js', 'mcp/**/*.mjs']);
  const errors = [];
  let files = 0;
  for (const r of results) {
    files++;
    for (const m of r.messages) errors.push(`${relative(root, r.filePath).replace(/\\/g, '/')}:${m.line}:${m.column} ${m.message}`);
  }
  if (!quiet) {
    if (errors.length) errors.forEach((e) => console.error('  ✗ ' + e));
    else console.log(`✓ unused code: ${files} files, no unused variables or functions`);
  }
  return { errors, files };
}

if (process.argv[1] && /unused-check.mjs$/.test(process.argv[1])) {
  const r = await run();
  if (r.errors.length) process.exit(1);
}
