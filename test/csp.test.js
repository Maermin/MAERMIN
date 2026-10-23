// Content-Security-Policy (docs/AUDIT.md SEC-020, H-4): index.html and the
// production build carry the same explicit policy, and no script injects an
// inline <style> (style-src has no 'unsafe-inline').
// Run: node test/csp.test.js
'use strict';
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? '  — ' + detail : ''))); }
const root = path.join(__dirname, '..');
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const m = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
const policy = m ? m[1] : '';
const dirs = {};
policy.split(';').map((s) => s.trim()).filter(Boolean).forEach((d) => { const [k, ...v] = d.split(/\s+/); dirs[k] = v; });

console.log('content security policy:');
ok('default-src is self only', (dirs['default-src'] || []).join(' ') === "'self'");
ok("style-src has no 'unsafe-inline'", dirs['style-src'] && dirs['style-src'].indexOf("'unsafe-inline'") === -1);
ok('img-src names its hosts (no bare https:)', dirs['img-src'] && dirs['img-src'].indexOf('https:') === -1);
ok("form-action and frame-src are 'none'", (dirs['form-action'] || [])[0] === "'none'" && (dirs['frame-src'] || [])[0] === "'none'");
ok("object-src 'none', base-uri 'self'", (dirs['object-src'] || [])[0] === "'none'" && (dirs['base-uri'] || [])[0] === "'self'");
// SEC-021: the only CDN entry in connect-src is the pinned pdf.js folder (its
// worker file is fetched with an SRI check and run from a blob: URL).
ok('connect-src names no CDN host except the pinned pdf.js folder', (dirs['connect-src'] || []).every((h) => h.indexOf('cdnjs') === -1 || /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\/\d+\.\d+\.\d+\/$/.test(h)));
ok("worker-src is 'self' blob: only", (dirs['worker-src'] || []).join(' ') === "'self' blob:");

// every pinned CDN library is covered by script-src, and its SRI hash is sha384
const pinned = ['pdf-import.js', 'tax-report-builder.js', 'charts.js'].map((f) => readFileSync(path.join(root, f), 'utf8')).join('\n');
const pdfDir = (pinned.match(/PDFJS_DIR = '([^']+)'/) || [])[1];
const srcs = (pinned.match(/src: '(https:[^']+)'/g) || []).map((s) => s.slice(6, -1)).concat(pdfDir ? [pdfDir + 'pdf.min.mjs', pdfDir + 'pdf.worker.min.mjs'] : []);
ok('pinned CDN libraries found', srcs.length === 5 && !!pdfDir, srcs.join(' '));
ok('every pinned library is allowed by script-src', srcs.every((u) => (dirs['script-src'] || []).some((d) => d.endsWith('/') && u.startsWith(d))));
ok('the pdf.js folder is the one connect-src allows', !!pdfDir && (dirs['connect-src'] || []).indexOf(pdfDir) !== -1);
ok('every pinned library has a sha384 SRI hash', (pinned.match(/integrity: 'sha384-[A-Za-z0-9+/=]{64}'/g) || []).length === 5);

// build.mjs builds the same policy
const build = readFileSync(path.join(root, 'build.mjs'), 'utf8');
const b = build.match(/const CSP = \[([\s\S]*?)\]\.join\('; '\);/);
const buildPolicy = b ? JSON.parse('[' + b[1].replace(/,\s*$/, '') + ']').join('; ') : '';
ok('build.mjs writes the same policy as index.html', buildPolicy === policy, buildPolicy.slice(0, 80));

// no inline <style> injected anywhere in the app scripts
const files = readdirSync(root).filter((f) => f.endsWith('.js'));
const offenders = files.filter((f) => /['"`]<style[\s>]/.test(readFileSync(path.join(root, f), 'utf8')));
ok('no script injects an inline <style>', offenders.length === 0, offenders.join(', '));

console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
