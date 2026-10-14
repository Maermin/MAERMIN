// maermin-mcp — a local, read-only MCP server over a MAERMIN vault (P5-5.2).
//
// It runs on the user's machine only. It opens the app's encrypted vault
// backup with the app's own crypto-vault.js and the user's password, keeps the
// decrypted data in memory, and answers read-only tools over stdio (MCP,
// JSON-RPC 2.0, one message per line). It opens no network connection, except
// to read the user's own sync blob from their own Worker when started with
// --sync. Credentials in the vault (API keys, bank and exchange connections,
// the push subscription, the taxpayer's name and tax id) are dropped on open
// and never reach a tool. Amounts (quantities, prices, values) are left out
// unless the server is started with --amounts.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const VERSION = '0.1.0';
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const TOOLS = ['overview', 'positions', 'transactions', 'performance', 'dividends', 'tax_summary', 'allocation'];
// Never handed to a tool: credentials, connection metadata, device state, PII.
const DROP = new Set(['apiKeys', 'maermin_webdav', 'maermin_fmp_api_key', 'maermin_push', 'maermin_sync_base', 'maermin_exchange_sync',
  'maermin_bank_sync', 'maermin_aggregators', 'maermin_wallets', 'maermin_tax_owner', 'maermin_trash', 'maermin_tax_certs']);

// The app's modules: vendored into mcp/app/ for the npm package, else the
// repository root (running from a checkout).
function appDir() {
  if (process.env.MAERMIN_APP_DIR) return process.env.MAERMIN_APP_DIR;
  const vendored = path.join(__dirname, '..', 'app');
  return fs.existsSync(path.join(vendored, 'crypto-vault.js')) ? vendored : path.join(__dirname, '..', '..');
}
function app(name) { return require(path.join(appDir(), name)); }

function memoryStorage(map) {
  const m = map || {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
    key: (i) => Object.keys(m)[i] || null,
    get length() { return Object.keys(m).length; }
  };
}
function parseValue(v) {
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (e) { return v; }
}

// Open an encrypted vault backup ({ format: 'maermin-vault-backup', meta, blob }).
// opts.syncUrl: also read the newer sync blob from the user's own Worker.
async function openBackup(backup, password, opts) {
  opts = opts || {};
  if (!backup || backup.format !== 'maermin-vault-backup' || !backup.meta || typeof backup.blob !== 'string') throw new Error('bad-backup');
  if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = require('node:crypto').webcrypto;
  const prev = globalThis.localStorage;
  globalThis.localStorage = memoryStorage({ maermin_vault_meta: JSON.stringify(backup.meta) });
  const V = app('crypto-vault.js');
  try {
    try { await V.unlock(password); } catch (e) { throw new Error('bad-password'); }
    const raw = await V.decryptJSON(backup.blob, 'blob');
    const strings = {};
    Object.keys(raw || {}).forEach((k) => { strings[k] = typeof raw[k] === 'string' ? raw[k] : JSON.stringify(raw[k]); });
    let syncedAt = null;
    if (opts.syncUrl) {
      const account = Buffer.from(await V.deriveSubKey('sync-account')).toString('hex').slice(0, 32);
      const base = String(opts.syncUrl).replace(/\/+$/, '');
      const r = await fetch(base + '/?action=sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'get', account }) });
      if (r.status !== 200) throw new Error('sync-http-' + r.status);
      const j = await r.json();
      if (j && j.blob) {
        const snap = await V.decryptJSON(j.blob);
        if (snap && snap.rotated) throw new Error('sync-rotated');
        Object.keys((snap && snap.data) || {}).forEach((k) => { const v = snap.data[k]; strings[k] = typeof v === 'string' ? v : JSON.stringify(v); });
        syncedAt = snap.updatedAt || null;
      }
    }
    DROP.forEach((k) => { delete strings[k]; });
    const data = {};
    Object.keys(strings).forEach((k) => { data[k] = parseValue(strings[k]); });
    return { strings, data, exportedAt: backup.exportedAt || null, syncedAt };
  } finally {
    try { V.lock(); } catch (e) { /* nothing to lock */ }
    globalThis.localStorage = prev;
  }
}

// ---- figures ---------------------------------------------------------------------
function ymd(d) { return String(d || '').slice(0, 10); }
function num(v) { const n = parseFloat(v); return isFinite(n) ? n : 0; }
function r2(v) { return Math.round(v * 100) / 100; }
function r4(v) { return Math.round(v * 10000) / 10000; }

function lastPrice(history, sym) {
  const s = (history || {})[sym] || (history || {})[String(sym).toLowerCase()] || (history || {})[String(sym).toUpperCase()];
  if (!Array.isArray(s) || !s.length) return null;
  let best = null;
  s.forEach((p) => {
    const d = typeof p.timestamp === 'number' ? new Date(p.timestamp).toISOString() : String(p.timestamp || p.date || '');
    const v = num(p.price != null ? p.price : p.close);
    if (v > 0 && (!best || d > best.d)) best = { d: d.slice(0, 10), p: v };
  });
  return best;
}

function holdings(vault, o) {
  const L = app('ledger.js'), F = app('fx-history.js');
  const txs = (vault.data.transactions || []).filter((t) => !o.portfolio || String(t.portfolioId || 'default') === o.portfolio);
  const built = L.build(txs, { exchangeRate: o.usdEur });
  const hist = vault.data.priceHistory || {};
  let priceDate = null;
  const rows = [];
  built.list.forEach((g) => {
    if (!(g.openQty > 1e-9)) return;
    if (o.category && g.category !== o.category) return;
    const lp = lastPrice(hist, g.symbol);
    let priceEUR = null;
    if (lp) {
      const lastTx = txs.filter((t) => String(t.symbol || '').toUpperCase() === g.symbol && t.type === 'buy').pop();
      const cur = g.category === 'crypto' ? 'EUR' : String((lastTx && lastTx.currency) || 'EUR');
      priceEUR = cur.toUpperCase() === 'EUR' ? lp.p : F.quoteToEUR(lp.p, cur, o.usdEur);
      if (!priceDate || lp.d > priceDate) priceDate = lp.d;
    }
    const valueEUR = priceEUR != null ? g.openQty * priceEUR : null;
    rows.push({ symbol: g.symbol, name: g.symbolName || g.symbol, category: g.category, quantity: g.openQty, avgCostEUR: g.openCostEUR / g.openQty,
      costEUR: g.openCostEUR, priceEUR, valueEUR, since: g.openLots.length ? ymd(g.openLots[0].date) : null,
      unrealizedEUR: valueEUR != null ? valueEUR - g.openCostEUR : null });
  });
  const total = rows.reduce((s, x) => s + (x.valueEUR || 0), 0);
  rows.forEach((x) => {
    x.weightPct = total > 0 && x.valueEUR != null ? r4(x.valueEUR / total * 100) : null;
    x.unrealizedPct = x.costEUR > 0 && x.unrealizedEUR != null ? r4(x.unrealizedEUR / x.costEUR * 100) : null;
  });
  rows.sort((a, b) => (b.valueEUR || 0) - (a.valueEUR || 0));
  return { rows, total, priceDate, txs };
}

function dividendsOf(vault, o) {
  const F = app('fx-history.js');
  const out = { byYear: {}, rows: [] };
  (vault.data.transactions || []).forEach((t) => {
    if (t.type !== 'dividend') return;
    const y = ymd(t.date).slice(0, 4);
    if (o.year && y !== String(o.year)) return;
    const gross = F.txToEUR(num(t.quantity) * num(t.price) || num(t.amount), t.currency, ymd(t.date), o.usdEur).value;
    const wht = F.txToEUR(Math.max(0, num(t.withholdingTax)), t.currency, ymd(t.date), o.usdEur).value;
    out.rows.push({ date: ymd(t.date), symbol: String(t.symbol || '').toUpperCase(), grossEUR: gross, withheldEUR: wht });
    const b = out.byYear[y] || (out.byYear[y] = { count: 0, grossEUR: 0 });
    b.count++; b.grossEUR += gross;
  });
  return out;
}

// ---- tools -----------------------------------------------------------------------------
const OBJ = (props, extra) => Object.assign({ type: 'object', properties: props || {}, additionalProperties: false }, extra || {});
const DEFS = {
  overview: { title: 'Portfolio overview', description: 'Portfolios, number of positions and transactions, allocation by asset class, the date of the latest price, and (with --amounts) the total value in EUR.', inputSchema: OBJ() },
  positions: { title: 'Positions', description: 'Open positions with weight and unrealised return in %, holding since; with --amounts also quantity, average cost, price and value in EUR. Optional filters: portfolio id, category.',
    inputSchema: OBJ({ portfolio: { type: 'string' }, category: { type: 'string' } }) },
  transactions: { title: 'Transactions', description: 'Transactions, newest first: date, type, symbol, category, portfolio; with --amounts also quantity, price, currency, fees and amount. Filters: symbol, type, from, to (YYYY-MM-DD), portfolio; limit (default 100, max 500).',
    inputSchema: OBJ({ symbol: { type: 'string' }, type: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, portfolio: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 500 } }) },
  performance: { title: 'Performance', description: 'Money-weighted return (XIRR) and net return in %, from the app\'s own return figures; with --amounts also invested, realised gains, dividends, fees, taxes and net return in EUR.', inputSchema: OBJ() },
  dividends: { title: 'Dividends', description: 'Dividends received per year (count); with --amounts gross amounts and withholding in EUR, per payment. Optional year.', inputSchema: OBJ({ year: { type: 'integer' } }) },
  tax_summary: { title: 'Tax summary', description: 'The app\'s tax report for a year: realised gains and losses, dividends, interest, withholding, estimated tax. Needs --amounts. jurisdiction: de (default), at, ch or us.',
    inputSchema: OBJ({ year: { type: 'integer' }, jurisdiction: { type: 'string', enum: ['de', 'at', 'ch', 'us'] } }, { required: ['year'] }) },
  allocation: { title: 'Allocation', description: 'Allocation in % by category, symbol, portfolio or currency; with --amounts also EUR.', inputSchema: OBJ({ by: { type: 'string', enum: ['category', 'symbol', 'portfolio', 'currency'] } }) }
};

function createServer(vault, opts) {
  opts = opts || {};
  const amounts = opts.amounts === true;
  const usdEur = opts.usdEur > 0 ? opts.usdEur : 0.92;
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const scopes = Array.isArray(opts.scopes) && opts.scopes.length ? TOOLS.filter((t) => opts.scopes.includes(t)) : TOOLS.slice();
  // The app's modules read their stores (fund types, tax settings, corporate
  // actions...) from localStorage: give them the decrypted data, in memory.
  globalThis.localStorage = memoryStorage(Object.assign({}, vault.strings));
  const note = 'USD and other non-EUR prices converted at ' + usdEur + ' EUR per USD (--usd-eur); prices as of the latest one in the vault.';

  const handlers = {
    overview() {
      const h = holdings(vault, { usdEur });
      const byCat = {};
      h.rows.forEach((x) => { byCat[x.category] = (byCat[x.category] || 0) + (x.valueEUR || 0); });
      const out = { portfolios: (vault.data.maermin_portfolios || [{ id: 'default', name: 'Main Portfolio' }]).map((p) => ({ id: p.id, name: p.name })),
        positions: h.rows.length, transactions: (vault.data.transactions || []).length, priceDate: h.priceDate,
        allocationPct: Object.keys(byCat).map((k) => ({ category: k, pct: h.total > 0 ? r4(byCat[k] / h.total * 100) : null })),
        unrealizedPct: (() => { const c = h.rows.reduce((s, x) => s + x.costEUR, 0); return c > 0 ? r4((h.total - c) / c * 100) : null; })(),
        backupExportedAt: vault.exportedAt ? new Date(vault.exportedAt).toISOString() : null, syncedAt: vault.syncedAt ? new Date(vault.syncedAt).toISOString() : null, note };
      if (amounts) out.totalValueEUR = r2(h.total);
      return out;
    },
    positions(a) {
      const h = holdings(vault, { usdEur, portfolio: a.portfolio, category: a.category });
      return { priceDate: h.priceDate, note, positions: h.rows.map((x) => {
        const o = { symbol: x.symbol, name: x.name, category: x.category, weightPct: x.weightPct, unrealizedPct: x.unrealizedPct, since: x.since };
        if (amounts) Object.assign(o, { quantity: x.quantity, avgCostEUR: r4(x.avgCostEUR), priceEUR: x.priceEUR != null ? r4(x.priceEUR) : null, valueEUR: x.valueEUR != null ? r2(x.valueEUR) : null, unrealizedEUR: x.unrealizedEUR != null ? r2(x.unrealizedEUR) : null });
        return o;
      }) };
    },
    transactions(a) {
      const lim = Math.min(Math.max(parseInt(a.limit, 10) || 100, 1), 500);
      const sym = a.symbol ? String(a.symbol).toUpperCase() : null;
      const list = (vault.data.transactions || []).filter((t) => (!sym || String(t.symbol || '').toUpperCase() === sym) && (!a.type || t.type === a.type)
        && (!a.from || ymd(t.date) >= a.from) && (!a.to || ymd(t.date) <= a.to) && (!a.portfolio || String(t.portfolioId || 'default') === a.portfolio))
        .sort((x, y) => (ymd(x.date) < ymd(y.date) ? 1 : ymd(x.date) > ymd(y.date) ? -1 : 0));
      return { total: list.length, transactions: list.slice(0, lim).map((t) => {
        const o = { date: ymd(t.date), type: t.type, symbol: t.symbol ? String(t.symbol).toUpperCase() : null, category: t.category, portfolio: t.portfolioId || 'default' };
        if (amounts) Object.assign(o, { quantity: t.quantity != null ? num(t.quantity) : null, price: t.price != null ? num(t.price) : null, amount: t.amount != null ? num(t.amount) : null,
          currency: t.currency || 'EUR', fees: t.fees != null ? num(t.fees) : null, withholdingTax: t.withholdingTax != null ? num(t.withholdingTax) : null });
        return o;
      }) };
    },
    performance() {
      const h = holdings(vault, { usdEur });
      const RF = app('return-figures.js');
      const f = RF.compute(vault.data.transactions || [], { securitiesValueEUR: h.total, exchangeRate: usdEur, today });
      const out = { xirrPct: f.xirr != null ? r4(f.xirr * 100) : null, xirr: f.xirr, netReturnPct: f.netReturnPct != null ? r4(f.netReturnPct * 100) : null, note };
      if (amounts) Object.assign(out, { valueEUR: r2(h.total), investedEUR: f.invested, realizedEUR: f.realized, dividendsNetEUR: f.dividendsNet, feesEUR: f.fees, taxesEUR: f.taxes, netReturnEUR: f.netReturn });
      return out;
    },
    dividends(a) {
      const d = dividendsOf(vault, { usdEur, year: a.year });
      const out = { year: a.year || null, count: d.rows.length, byYear: Object.keys(d.byYear).sort().map((y) => Object.assign({ year: +y, count: d.byYear[y].count }, amounts ? { grossEUR: r2(d.byYear[y].grossEUR) } : {})) };
      if (amounts) { out.totalGrossEUR = r2(d.rows.reduce((s, x) => s + x.grossEUR, 0)); out.payments = d.rows.map((x) => ({ date: x.date, symbol: x.symbol, grossEUR: r2(x.grossEUR), withheldEUR: r2(x.withheldEUR) })); }
      else out.payments = d.rows.map((x) => ({ date: x.date, symbol: x.symbol }));
      return out;
    },
    tax_summary(a) {
      if (!amounts) { const e = new Error('The tax summary consists of amounts: start maermin-mcp with --amounts to allow it.'); e.user = true; throw e; }
      const REPORT = app('tax-report-builder.js');
      let germanTax;
      try { germanTax = app('tax-calculation-engine.js').GermanTax; } catch (e) { germanTax = undefined; }
      const j = a.jurisdiction || 'de';
      const rep = REPORT.build(vault.data.transactions || [], { year: parseInt(a.year, 10), jurisdiction: j, baseCurrency: 'EUR', exchangeRate: usdEur, germanTax, priceHistory: vault.data.priceHistory || {}, today });
      const s = rep.summary;
      return { year: rep.meta.year, jurisdiction: j, method: rep.meta.method, realizedGains: r2(s.realizedGains), realizedLosses: r2(s.realizedLosses), netRealized: r2(s.netRealized),
        dividendIncome: r2(s.dividendIncome), interestIncome: r2(s.interestIncome), withholdingTax: r2(s.withholdingTax), estimatedTax: r2(s.estimatedTaxLiability || 0),
        disposals: rep.realizedGains.length + rep.realizedLosses.length, note: 'Estimate from the app\'s tax report; tax settings that are not in the vault backup use their defaults. Not tax advice.' };
    },
    allocation(a) {
      const by = ['category', 'symbol', 'portfolio', 'currency'].includes(a.by) ? a.by : 'category';
      const sums = {};
      let total = 0;
      if (by === 'portfolio') {
        (vault.data.maermin_portfolios || [{ id: 'default' }]).forEach((p) => { const h = holdings(vault, { usdEur, portfolio: p.id }); sums[p.id] = h.total; total += h.total; });
      } else {
        const h = holdings(vault, { usdEur });
        h.rows.forEach((x) => {
          let k = x[by];
          if (by === 'currency') { const t = h.txs.filter((tx) => String(tx.symbol || '').toUpperCase() === x.symbol).pop(); k = x.category === 'crypto' ? 'crypto' : String((t && t.currency) || 'EUR').toUpperCase(); }
          sums[k] = (sums[k] || 0) + (x.valueEUR || 0);
        });
        total = h.total;
      }
      return { by, rows: Object.keys(sums).sort((x, y) => sums[y] - sums[x]).map((k) => Object.assign({ key: k, pct: total > 0 ? r4(sums[k] / total * 100) : null }, amounts ? { valueEUR: r2(sums[k]) } : {})) };
    }
  };

  function result(id, r) { return { jsonrpc: '2.0', id, result: r }; }
  function error(id, code, message) { return { jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } }; }

  async function handle(msg) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return error(msg && msg.id, -32600, 'Invalid Request');
    const isNote = msg.id === undefined || msg.id === null;
    if (isNote) return null; // notifications/initialized, cancelled, ...
    const p = msg.params || {};
    switch (msg.method) {
      case 'initialize':
        return result(msg.id, { protocolVersion: PROTOCOLS.includes(p.protocolVersion) ? p.protocolVersion : PROTOCOLS[0], capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'maermin-mcp', title: 'MAERMIN (local, read-only)', version: VERSION },
          instructions: 'Read-only access to the user\'s MAERMIN portfolio, decrypted on this machine. ' + (amounts ? 'Amounts are included.' : 'Amounts are hidden (percentages only).') + ' Not financial or tax advice.' });
      case 'ping': return result(msg.id, {});
      case 'tools/list':
        return result(msg.id, { tools: scopes.map((n) => ({ name: n, title: DEFS[n].title, description: DEFS[n].description, inputSchema: DEFS[n].inputSchema, annotations: { readOnlyHint: true, openWorldHint: false } })) });
      case 'tools/call': {
        const name = p.name;
        if (!scopes.includes(name) || !handlers[name]) return result(msg.id, { content: [{ type: 'text', text: 'Unknown or not enabled tool: ' + name + '. Enabled: ' + scopes.join(', ') }], isError: true });
        try {
          const out = await handlers[name](p.arguments || {});
          return result(msg.id, { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], structuredContent: out });
        } catch (e) {
          return result(msg.id, { content: [{ type: 'text', text: e.user ? e.message : 'Failed: ' + (e && e.message) }], isError: true });
        }
      }
      default: return error(msg.id, -32601, 'Method not found');
    }
  }

  // stdio: one JSON message per line; logs go to stderr only.
  function serve(input, output) {
    let buf = '';
    input.setEncoding('utf8');
    input.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch (e) { output.write(JSON.stringify(error(null, -32700, 'Parse error')) + '\n'); continue; }
        Promise.resolve(handle(msg)).then((res) => { if (res) output.write(JSON.stringify(res) + '\n'); });
      }
    });
  }
  return { handle, serve, scopes };
}

function parseArgs(argv) {
  const a = { backup: null, scopes: null, amounts: false, usdEur: null, sync: null, passwordFile: null, error: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--backup') { a.backup = v; i++; }
    else if (k === '--scopes') { a.scopes = String(v || '').split(',').map((s) => s.trim()).filter(Boolean); i++; }
    else if (k === '--amounts') a.amounts = true;
    else if (k === '--usd-eur') { a.usdEur = parseFloat(v); i++; }
    else if (k === '--sync') { a.sync = v; i++; }
    else if (k === '--password-file') { a.passwordFile = v; i++; }
    else if (k === '--password') { a.error = 'The password is never taken from the command line (other processes can read it): use MAERMIN_PASSWORD or --password-file.'; i++; }
    else if (k === '--help' || k === '-h') a.help = true;
    else a.error = a.error || 'Unknown option: ' + k;
  }
  if (a.scopes) { const bad = a.scopes.filter((s) => !TOOLS.includes(s)); if (bad.length) a.error = a.error || 'Unknown scope(s): ' + bad.join(', ') + '. Known: ' + TOOLS.join(', '); }
  return a;
}

module.exports = { VERSION, TOOLS, openBackup, createServer, parseArgs };
