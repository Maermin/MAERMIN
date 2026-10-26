// Node harness for P5-5.2: the local MCP server (mcp/). It opens an encrypted
// vault backup with the app's own crypto-vault.js, answers read-only tools over
// JSON-RPC (stdio framing tested through the pure handler), hides amounts
// unless --amounts, honours the scopes, and opens no network connection unless
// the user's own sync blob is asked for.
// Run: node test/mcp.test.js
'use strict';
const nodeCrypto = require('node:crypto');
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = nodeCrypto.webcrypto;

let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info).slice(0, 400) : '')); }
}

const MCP = require('../mcp/lib/index.js');

// Build a real encrypted backup the way the app does (storage.exportEncryptedBackup).
async function makeBackup(password, data) {
  const mem = {};
  const ls = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  const prev = globalThis.localStorage;
  globalThis.localStorage = ls;
  delete require.cache[require.resolve('../crypto-vault.js')];
  const V = require('../crypto-vault.js');
  await V.create(password);
  const blob = await V.encryptJSON(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])), 'blob');
  const syncBlob = await V.encryptJSON({ v: 1, updatedAt: Date.now(), device: 'd', data: { transactions: JSON.stringify(data.transactions.concat([{ id: 's1', type: 'buy', category: 'stocks', symbol: 'KO', quantity: 10, price: 60, currency: 'USD', date: '2026-09-01', portfolioId: 'default' }])) } });
  const account = Buffer.from(await V.deriveSubKey('sync-account')).toString('hex').slice(0, 32);
  const meta = JSON.parse(mem.maermin_vault_meta);
  V.lock();
  globalThis.localStorage = prev;
  return { backup: { format: 'maermin-vault-backup', v: 1, exportedAt: Date.now(), meta, blob }, syncBlob, account };
}

const T = (o) => Object.assign({ currency: 'EUR', portfolioId: 'default', category: 'stocks' }, o);
const DATA = {
  transactions: [
    T({ id: 't1', type: 'buy', symbol: 'SAP.DE', symbolName: 'SAP SE', quantity: 10, price: 100, date: '2024-01-10' }),
    T({ id: 't2', type: 'buy', symbol: 'AAPL', quantity: 5, price: 150, currency: 'USD', date: '2024-03-01' }),
    T({ id: 't3', type: 'sell', symbol: 'SAP.DE', quantity: 4, price: 150, date: '2025-06-01' }),
    T({ id: 't4', type: 'dividend', symbol: 'SAP.DE', quantity: 6, price: 2.2, date: '2025-05-20' }),
    T({ id: 't5', type: 'dividend', symbol: 'AAPL', quantity: 5, price: 1, currency: 'USD', withholdingTax: 0.75, date: '2025-08-15' }),
    { id: 't6', type: 'buy', category: 'crypto', symbol: 'BTC', quantity: 0.1, price: 40000, currency: 'EUR', date: '2024-05-01', portfolioId: 'w' }
  ],
  maermin_portfolios: [{ id: 'default', name: 'Main' }, { id: 'w', name: 'Wallet' }],
  priceHistory: {
    'SAP.DE': [{ timestamp: '2026-10-13T16:00:00Z', price: 200 }],
    AAPL: [{ timestamp: '2026-10-13T16:00:00Z', price: 250 }],
    BTC: [{ timestamp: '2026-10-13T16:00:00Z', price: 90000 }]
  },
  apiKeys: { cs2Worker: 'https://mine.example.workers.dev', binanceSecret: 'top-secret' }
};

(async function main() {
  console.log('mcp:');
  const PW = 'Correct-Horse-9!';
  const { backup, syncBlob, account } = await makeBackup(PW, DATA);

  // ---- opening the vault ---------------------------------------------------------
  let threw = '';
  try { await MCP.openBackup(backup, 'wrong password'); } catch (e) { threw = e.message; }
  ok('a wrong password is refused', threw === 'bad-password', threw);
  threw = '';
  try { await MCP.openBackup({ format: 'other' }, PW); } catch (e) { threw = e.message; }
  ok('a file that is not a MAERMIN vault backup is refused', threw === 'bad-backup', threw);
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = async () => { fetched++; throw new Error('no network expected'); };
  const vault = await MCP.openBackup(backup, PW);
  ok('the backup opens with the app\'s crypto-vault.js', Array.isArray(vault.data.transactions) && vault.data.transactions.length === 6);
  ok('credentials are dropped from the opened data (apiKeys never reach a tool)', !('apiKeys' in vault.data) && !JSON.stringify(vault.data).includes('top-secret'));

  // ---- JSON-RPC ----------------------------------------------------------------------
  const srv = MCP.createServer(vault, { usdEur: 0.9, today: '2026-10-14' });
  let r = await srv.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  ok('initialize: protocol version, tools capability, server info', r.result.protocolVersion === '2025-06-18' && r.result.capabilities.tools && r.result.serverInfo.name === 'maermin-mcp', r);
  ok('a notification gets no answer', (await srv.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })) === null);
  r = await srv.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names = r.result.tools.map((t) => t.name);
  ok('tools/list: the read-only tools, each marked readOnly with an input schema', ['overview', 'positions', 'transactions', 'performance', 'dividends', 'tax_summary', 'allocation'].every((n) => names.includes(n))
    && r.result.tools.every((t) => t.annotations && t.annotations.readOnlyHint === true && t.inputSchema && t.inputSchema.type === 'object'), names);
  ok('ping', (await srv.handle({ jsonrpc: '2.0', id: 3, method: 'ping' })).result !== undefined);
  ok('an unknown method: -32601', (await srv.handle({ jsonrpc: '2.0', id: 4, method: 'resources/write' })).error.code === -32601);
  const call = async (s, name, args) => {
    const res = await s.handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args || {} } });
    return res.result;
  };
  ok('an unknown tool is an error result', (await call(srv, 'delete_everything')).isError === true);

  // ---- without amounts (default) ----------------------------------------------------
  let out = await call(srv, 'positions');
  let rows = out.structuredContent.positions;
  const sap = rows.find((p) => p.symbol === 'SAP.DE');
  ok('positions: weights and returns, no quantities or values by default', sap && sap.weightPct > 0 && !('quantity' in sap) && !('valueEUR' in sap) && !/"valueEUR"/.test(out.content[0].text), sap);
  ok('the weights add up to 100 %', Math.abs(rows.reduce((s, p) => s + p.weightPct, 0) - 100) < 0.01);
  ok('unrealised return per position: SAP 100 → 200 = +100 %', Math.abs(sap.unrealizedPct - 100) < 1e-6, sap);
  out = await call(srv, 'transactions', { symbol: 'SAP.DE' });
  ok('transactions without amounts: date, type, symbol only', out.structuredContent.transactions.length === 3 && out.structuredContent.transactions.every((t) => !('price' in t) && !('quantity' in t)), out.structuredContent);
  out = await call(srv, 'tax_summary', { year: 2025 });
  ok('the tax summary needs --amounts', out.isError === true && /--amounts/.test(out.content[0].text));
  out = await call(srv, 'allocation', { by: 'category' });
  ok('allocation by category in %', out.structuredContent.rows.some((x) => x.key === 'crypto' && x.pct > 0) && !out.structuredContent.rows.some((x) => 'valueEUR' in x), out.structuredContent);

  // ---- with amounts ---------------------------------------------------------------------
  const srvA = MCP.createServer(vault, { usdEur: 0.9, today: '2026-10-14', amounts: true });
  rows = (await call(srvA, 'positions')).structuredContent.positions;
  const aapl = rows.find((p) => p.symbol === 'AAPL'), btc = rows.find((p) => p.symbol === 'BTC');
  ok('with --amounts: SAP 6 x 200 = 1,200 EUR', rows.find((p) => p.symbol === 'SAP.DE').valueEUR === 1200 && rows.find((p) => p.symbol === 'SAP.DE').quantity === 6);
  ok('USD price converted at --usd-eur: 5 x 250 x 0.9 = 1,125 EUR; crypto prices are EUR: 9,000', Math.abs(aapl.valueEUR - 1125) < 1e-6 && Math.abs(btc.valueEUR - 9000) < 1e-6, { aapl, btc });
  out = await call(srvA, 'overview');
  ok('overview: total value, price date, portfolios', Math.abs(out.structuredContent.totalValueEUR - 11325) < 1e-6 && out.structuredContent.priceDate === '2026-10-13' && out.structuredContent.portfolios.length === 2, out.structuredContent);
  out = await call(srvA, 'positions', { portfolio: 'w' });
  ok('positions of one portfolio', out.structuredContent.positions.length === 1 && out.structuredContent.positions[0].symbol === 'BTC');
  out = await call(srvA, 'dividends', { year: 2025 });
  ok('dividends 2025: SAP 13.20 + AAPL 4.50 = 17.70 EUR gross', Math.abs(out.structuredContent.totalGrossEUR - 17.7) < 1e-6 && out.structuredContent.count === 2, out.structuredContent);
  out = await call(srvA, 'tax_summary', { year: 2025, jurisdiction: 'de' });
  ok('tax summary 2025 from the app\'s tax report: realised gain of SAP 4 x 50 = 200', Math.abs(out.structuredContent.realizedGains - 200) < 1e-6 && out.structuredContent.jurisdiction === 'de', out.structuredContent);
  out = await call(srvA, 'performance');
  ok('performance from the app\'s return figures (XIRR and net return)', out.structuredContent.xirr != null && out.structuredContent.netReturnEUR != null, out.structuredContent);
  ok('no network connection for any of it', fetched === 0);

  // ---- scopes -------------------------------------------------------------------------
  const srvS = MCP.createServer(vault, { usdEur: 0.9, scopes: ['positions', 'allocation'] });
  const listed = (await srvS.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools.map((t) => t.name);
  ok('--scopes limits the tools offered and callable', listed.join() === 'positions,allocation' && (await call(srvS, 'transactions')).isError === true, listed);
  ok('parseArgs: scopes, amounts, usd-eur; the password never comes from the command line', (() => {
    const a = MCP.parseArgs(['--backup', 'b.json', '--scopes', 'positions,dividends', '--amounts', '--usd-eur', '0.91', '--password', 'x']);
    return a.backup === 'b.json' && a.scopes.join() === 'positions,dividends' && a.amounts === true && a.usdEur === 0.91 && a.error && /password/.test(a.error);
  })());

  // ---- the user's own sync blob (only when asked) ----------------------------------------
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(JSON.stringify({ rev: 7, blob: syncBlob }), { status: 200 }); };
  const synced = await MCP.openBackup(backup, PW, { syncUrl: 'https://mine.example.workers.dev' });
  ok('--sync reads the newer blob from the user\'s own Worker, by the vault\'s account id', synced.data.transactions.length === 7 && seen.length === 1 && seen[0].url === 'https://mine.example.workers.dev/?action=sync' && seen[0].body.op === 'get' && seen[0].body.account === account, seen);
  globalThis.fetch = realFetch;

  // ---- the real command over stdio --------------------------------------------------------
  const os = require('node:os'), fs = require('node:fs'), path = require('node:path'), { spawn } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maermin-mcp-'));
  const file = path.join(dir, 'backup.json');
  fs.writeFileSync(file, JSON.stringify(backup));
  const bin = path.join(__dirname, '..', 'mcp', 'bin', 'maermin-mcp.js');
  const answers = await new Promise((resolve) => {
    const p = spawn(process.execPath, [bin, '--backup', file, '--scopes', 'positions,overview', '--usd-eur', '0.9'], { env: Object.assign({}, process.env, { MAERMIN_PASSWORD: PW }) });
    let out = '', err = '';
    const got = [];
    p.stdout.on('data', (c) => { out += c; let i; while ((i = out.indexOf('\n')) >= 0) { got.push(JSON.parse(out.slice(0, i))); out = out.slice(i + 1); if (got.length === 3) { p.kill(); } } });
    p.stderr.on('data', (c) => { err += c; });
    p.on('exit', () => resolve({ got, err }));
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n');
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
    p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'overview', arguments: {} } }) + '\n');
    setTimeout(() => p.kill(), 20000);
  });
  const byId = Object.fromEntries(answers.got.map((m) => [m.id, m]));
  ok('maermin-mcp over stdio: initialize, tools/list (scoped), a tool call; stdout carries only MCP messages', byId[1] && byId[1].result.serverInfo.name === 'maermin-mcp'
    && byId[2] && byId[2].result.tools.map((t) => t.name).join() === 'overview,positions' && byId[3] && byId[3].result.structuredContent.positions === 3 && /ready/.test(answers.err), { got: answers.got.map((m) => m.id), err: answers.err });
  const wrong = await new Promise((resolve) => {
    const p = spawn(process.execPath, [bin, '--backup', file], { env: Object.assign({}, process.env, { MAERMIN_PASSWORD: 'nope' }) });
    let err = ''; p.stderr.on('data', (c) => { err += c; });
    p.on('exit', (code) => resolve({ code, err }));
  });
  ok('a wrong password ends the command with an error on stderr', wrong.code === 1 && /wrong password/.test(wrong.err), wrong);
  fs.rmSync(dir, { recursive: true, force: true });

  // ---- the npm package bundles every app module it needs ------------------------------------
  const vendor = await import('../mcp/scripts/vendor.mjs');
  const files = vendor.collect();
  ok('vendor: the app modules and everything they require', ['crypto-vault.js', 'ledger.js', 'tax-report-builder.js', 'i18n.js'].every((f) => files.includes(f)) && files.every((f) => fs.existsSync(path.join(__dirname, '..', f))), files);
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'mcp', 'package.json'), 'utf8'));
  ok('package: bin maermin-mcp, no runtime dependencies, vendored app/ in the files', pkg.name === 'maermin-mcp' && pkg.bin['maermin-mcp'] === 'bin/maermin-mcp.js' && !pkg.dependencies && pkg.files.includes('app/') && /vendor/.test(pkg.scripts.prepack));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
