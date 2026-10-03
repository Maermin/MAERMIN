// Node harness for transaction currencies beyond EUR/USD (WP-11): daily rate
// history per currency, conversion at the rate of the trade date in the ledger,
// the tax report and XIRR. The fetch part runs the REAL cf-worker/worker.js
// in-process; only the upstream (Yahoo) answers are synthetic.
// Run: node test/fx-currencies.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }
function near(a, b, eps) { return a != null && Math.abs(a - b) <= (eps || 1e-6); }
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = require('node:crypto').webcrypto;

const FX = require('../fx-history.js');
const Ledger = require('../ledger.js');
const Returns = require('../returns-engine.js');
const TaxReport = require('../tax-report-builder.js');
const TE = require('../tax-calculation-engine.js');
const day = (iso) => Math.round(Date.parse(iso + 'T00:00:00Z') / 86400000);
const NOW = Date.parse('2025-06-10T12:00:00Z');
const USD_RATES = { EUR: 0.9, CHF: 0.9, GBP: 0.75 }; // today's cross: 1 CHF = 1.00 EUR, 1 GBP = 1.20 EUR
const json = (o, status) => ({ ok: (status || 200) < 400, status: status || 200, json: async () => o });

(async function run() {
  console.log('currency history:');
  ok('pence and major codes', FX.majorOf('GBp').cur === 'GBP' && FX.majorOf('GBp').div === 100 && FX.majorOf('GBX').div === 100 && FX.majorOf('chf').cur === 'CHF' && FX.majorOf('GBP').div === 1);
  ok('history source: fiat yes; EUR, USD, crypto quotes no', FX.hasHistory('CHF') && FX.hasHistory('GBp') && !FX.hasHistory('EUR') && !FX.hasHistory('USD') && !FX.hasHistory('BTC') && !FX.hasHistory(''));
  const cross = FX.ingestYahooCross({ prices: [{ date: '2024-03-01', price: 0.95 }, { date: '2024-03-04', price: 0.96 }, { date: '2024-03-05', price: 0 }, { date: 'x', price: 1 }] });
  ok('EURCHF=X (CHF per EUR) → EUR per CHF', cross.d.length === 2 && near(cross.r[0], 1 / 0.95) && near(cross.r[1], 1 / 0.96) && cross.d[0] === day('2024-03-01'), cross);
  ok('error / empty response → null', FX.ingestYahooCross({ error: 'x' }) === null && FX.ingestYahooCross({ prices: [] }) === null && FX.ingestYahooCross(null) === null);

  FX.saveCurrencies({ v: 1, cur: {
    CHF: { req: '2024-02-20', at: NOW, d: [day('2024-03-01'), day('2024-03-04'), day('2024-06-03')], r: [1.05, 1.06, 1.02] },
    GBP: { req: '2024-02-20', at: NOW, d: [day('2024-03-01')], r: [1.17] },
    BTC: { req: '2024-01-01', at: NOW, d: [1], r: [1] } }, miss: { JPY: NOW, CHF: NOW } });
  ok('store keeps fiat only; a miss for a stored currency is dropped', Object.keys(FX.loadCurrencies().cur).sort().join() === 'CHF,GBP' && Object.keys(FX.loadCurrencies().miss).join() === 'JPY');
  ok('rate on the day', near(FX.currencyRateAt('CHF', '2024-03-04'), 1.06));
  ok('weekend → last fixing before it', near(FX.currencyRateAt('CHF', '2024-03-03'), 1.05));
  ok('up to a week after the last fixing → that fixing', near(FX.currencyRateAt('CHF', '2024-06-10'), 1.02));
  ok('a history that was not topped up is not "the rate of the date" → null', FX.currencyRateAt('CHF', '2024-06-11') === null && FX.currencyRateAt('CHF', '2025-01-01') === null && FX.currencyRateAt('CHF', '2024-04-01') === null);
  ok('…and the trade falls back to today\'s rate, flagged approx', FX.txToEUR(1000, 'CHF', '2025-01-01', 0.9, null, USD_RATES).status === 'approx');
  ok('whitespace around the code is ignored', near(FX.currencyRateAt(' chf ', '2024-03-04'), 1.06) && FX.txToEUR(1, 'CHF ', '2024-03-04', 0.9, null, USD_RATES).status === 'exact');
  // Yahoo stamps daily FX bars at midnight London time: 23:00 UTC of the day
  // before in summer. The Worker's UTC `date` would file Monday under Sunday.
  const bst = FX.ingestYahooCross({ exchangeTz: 'Europe/London', prices: [
    { ts: Date.parse('2024-06-09T23:00:00Z') / 1000, date: '2024-06-09', price: 0.96 },   // Monday 10 June, 00:00 BST
    { ts: Date.parse('2024-12-09T00:00:00Z') / 1000, date: '2024-12-09', price: 0.93 }] }); // Monday 9 Dec, 00:00 GMT
  ok('summer-time bars are filed under their local day', bst.d.join() === [day('2024-06-10'), day('2024-12-09')].join(), bst.d.map((n) => new Date(n * 86400000).toISOString().slice(0, 10)));
  ok('impossible dates are ignored, sync does not throw', Object.keys(FX.currenciesNeeded([{ currency: 'CHF', date: '2024-13-01' }, { currency: 'CHF', date: '0000-00-00' }])).length === 0);
  ok('before the history → null (never a later rate)', FX.currencyRateAt('CHF', '2024-02-29') === null);
  ok('pence: 1 GBp = 1/100 of the GBP rate', near(FX.currencyRateAt('GBp', '2024-03-01'), 0.0117) && near(FX.currencyRateAt('GBX', '2024-03-01'), 0.0117));
  ok('no history for the currency → null', FX.currencyRateAt('SEK', '2024-03-04') === null && FX.currencyRateAt('EUR', '2024-03-04') === null);

  console.log('txToEUR:');
  let r = FX.txToEUR(1000, 'CHF', '2024-03-04', 0.9, null, USD_RATES);
  ok('CHF at the rate of the trade date → exact', r.status === 'exact' && near(r.value, 1060), r);
  r = FX.txToEUR(1000, 'CHF', '2024-01-10', 0.9, null, USD_RATES);
  ok('CHF before the history → today\'s cross rate, approx', r.status === 'approx' && near(r.value, 1000), r);
  r = FX.txToEUR(1000, 'SEK', '2024-03-04', 0.9, null, { EUR: 0.9, SEK: 10 });
  ok('fiat without stored history → approx (unchanged behaviour)', r.status === 'approx' && near(r.value, 90), r);
  ok('EUR / USD unchanged', FX.txToEUR(5, 'EUR', '2024-03-04', 0.9).value === 5 && near(FX.txToEUR(100, 'USD', '2024-03-04', 0.9, () => 0.8).value, 80));
  ok('unknown stays unknown', FX.txToEUR(1, 'BNB', '2024-03-04', 0.9, null, USD_RATES).status === 'unknown');
  const rep = FX.currencyReport([{ currency: 'CHF', date: '2024-03-04' }, { currency: 'CHF', date: '2024-01-01' }, { currency: 'JPY', date: '2024-03-04' }, { currency: 'BTC', date: '2024-03-04' }, { currency: 'USD', date: '2024-03-04' }], 0.9, Object.assign({ JPY: 150 }, USD_RATES));
  ok('import preview: dated rows silent, pending fiat = "history", crypto quote = "unknown"', JSON.stringify(rep.map((x) => [x.currency, x.status, x.count]).sort()) === JSON.stringify([['BTC', 'unknown', 1], ['CHF', 'history', 1], ['JPY', 'history', 1]]), rep);

  console.log('ledger, XIRR and tax report with CHF / GBP trades:');
  // Buy 10 @ 100 CHF + 20 CHF fee on 2024-03-04 (1 CHF = 1.06 EUR) → 1,081.20 EUR.
  // Sell 10 @ 130 CHF − 10 CHF fee on 2024-06-03 (1 CHF = 1.02 EUR) → 1,315.80 EUR. Gain 234.60 EUR.
  const txs = [
    { id: 1, type: 'buy', category: 'stocks', symbol: 'NESN.SW', quantity: 10, price: 100, fees: 20, currency: 'CHF', date: '2024-03-04' },
    { id: 2, type: 'sell', category: 'stocks', symbol: 'NESN.SW', quantity: 10, price: 130, fees: 10, currency: 'CHF', date: '2024-06-03' },
    // 5 @ 2,000 GBp on 2024-03-01 (1 GBP = 1.17 EUR) = 100 GBP = 117 EUR
    { id: 3, type: 'buy', category: 'stocks', symbol: 'SHEL.L', quantity: 5, price: 2000, currency: 'GBp', date: '2024-03-01' }
  ];
  const L = Ledger.build(txs, { exchangeRate: 0.9, usdRates: USD_RATES, applyCorporateActions: false });
  const g = L.groups['stocks|NESN.SW'];
  ok('CHF lot: cost 1,081.20, proceeds 1,315.80, gain 234.60 (rates of the two dates)', near(g.disposals[0].costBasis, 1081.2) && near(g.disposals[0].proceeds, 1315.8) && near(g.realizedGain, 234.6), g.disposals[0]);
  ok('GBp lot: 5 × 2,000p = 117.00 EUR', near(L.groups['stocks|SHEL.L'].openCostEUR, 117), L.groups['stocks|SHEL.L']);
  ok('no currency issue is reported for dated trades', L.issues.filter((i) => i.kind === 'currency').length === 0, L.issues);
  const flows = Returns.buildCashflows(txs, { rate: 0.9 });
  ok('XIRR cash flows in EUR at the trade-date rates', near(flows[0].amount, -1081.2) && near(flows[1].amount, 1315.8) && near(flows[2].amount, -117), flows);
  const report = TaxReport.build(txs, { year: 2024, exchangeRate: 0.9, germanTax: TE.GermanTax, taxSettings: { abgeltungRate: 0.25, soli: true, kirchensteuer: 0, freistellungsauftrag: 1000, cryptoExemption: true } });
  const sale = report.currencyConversions.filter((c) => c.symbol === 'NESN.SW' && near(c.originalAmount, 1300))[0];
  ok('tax report: net realised 234.60 EUR', near(report.summary.netRealized, 234.6), report.summary.netRealized);
  ok('tax report: conversion detail shows the CHF rate of the date (1.02), not the USD rate', !!sale && near(sale.rate, 1.02) && near(sale.baseAmount, 1326), sale);
  // Same trades without any history (no Worker): flagged, converted at today's cross rate.
  FX.saveCurrencies({ v: 1, cur: {} });
  const L0 = Ledger.build(txs, { exchangeRate: 0.9, usdRates: USD_RATES, applyCorporateActions: false });
  ok('without history: today\'s rate (1.00) and an "approx" data-check entry', near(L0.groups['stocks|NESN.SW'].disposals[0].costBasis, 1020) && L0.issues.some((i) => i.kind === 'currency' && i.currency === 'CHF' && i.status === 'approx'));

  console.log('plan + sync:');
  ok('needed: earliest date per fiat currency, pence folded into GBP', JSON.stringify(FX.currenciesNeeded(txs.concat([{ currency: 'USD', date: '2020-01-01' }, { currency: 'BTC', date: '2020-01-01' }, { currency: 'GBP', date: '2023-12-01' }]))) === JSON.stringify({ CHF: '2024-03-04', GBP: '2023-12-01' }));
  let jobs = FX.planCurrencies({ CHF: '2024-03-04' }, FX.normalizeCurrencies(null), NOW);
  ok('nothing stored → full, from 10 days before the first trade', jobs.length === 1 && jobs[0].mode === 'full' && jobs[0].from === '2024-02-23', jobs);
  const st = FX.normalizeCurrencies({ v: 1, cur: { CHF: { req: '2024-02-23', at: NOW - 3600e3, d: [day('2024-03-01'), day('2025-06-09')], r: [1.05, 1.07] } } });
  ok('fresh → nothing', FX.planCurrencies({ CHF: '2024-03-04' }, st, NOW).length === 0);
  st.cur.CHF.at = NOW - 13 * 3600e3;
  jobs = FX.planCurrencies({ CHF: '2024-03-04' }, st, NOW);
  ok('older than 12 h → tail from the last stored day', jobs.length === 1 && jobs[0].mode === 'tail' && jobs[0].from === '2025-06-09', jobs);
  jobs = FX.planCurrencies({ CHF: '2022-05-02' }, st, NOW);
  ok('earlier trade → full again', jobs[0].mode === 'full' && jobs[0].from === '2022-04-22', jobs);
  ok('a currency the source did not know is skipped for a day', FX.planCurrencies({ JPY: '2024-03-04' }, FX.normalizeCurrencies({ v: 1, cur: {}, miss: { JPY: NOW - 3600e3 } }), NOW).length === 0
    && FX.planCurrencies({ JPY: '2024-03-04' }, FX.normalizeCurrencies({ v: 1, cur: {}, miss: { JPY: NOW - 25 * 3600e3 } }), NOW).length === 1);
  {
    const calls = [];
    const none = await FX.syncCurrencies({ transactions: txs, workerBase: '', fetch: async (u) => { calls.push(u); return json({}); }, now: NOW });
    ok('no Worker → no request', calls.length === 0 && none.changed === false);
    const res = await FX.syncCurrencies({ transactions: txs, workerBase: 'https://w.example/', now: NOW, store: FX.normalizeCurrencies(null),
      fetch: async (u) => { calls.push(u); return /EURGBP/.test(u) ? json({ error: 'Yahoo Finance returned 404' }, 404) : json({ prices: [{ date: '2024-03-04', price: 0.95 }] }); } });
    ok('one request per currency via the Worker yf route', calls.sort().join(' ') === 'https://w.example?action=yf&symbol=EURCHF%3DX&interval=1d&range=2y https://w.example?action=yf&symbol=EURGBP%3DX&interval=1d&range=2y', calls);
    const srv = await FX.syncCurrencies({ transactions: txs.slice(0, 1), workerBase: 'https://w.example', now: NOW, store: FX.normalizeCurrencies(null), fetch: async () => json({ error: 'x' }, 502) });
    ok('a 502 / outage is not remembered as "no such currency"', Object.keys(srv.store.miss).length === 0 && srv.failed.length === 1 && srv.changed === false);
    ok('fetched stored, 404 remembered as a miss, nothing thrown', res.fetched.join() === 'CHF' && res.failed.length === 1 && !!res.store.cur.CHF && res.store.miss.GBP === NOW && res.changed === true, res);
    // tail merge keeps the old days
    const st2 = FX.normalizeCurrencies({ v: 1, cur: { CHF: { req: '2024-02-23', at: NOW - 13 * 3600e3, d: [day('2024-03-01'), day('2025-06-09')], r: [1.05, 1.07] } } });
    const t = await FX.syncCurrencies({ transactions: txs.slice(0, 1), workerBase: 'https://w.example', now: NOW, store: st2, fetch: async () => json({ prices: [{ date: '2025-06-09', price: 0.5 }, { date: '2025-06-10', price: 0.8 }] }) });
    ok('tail: old days kept, overlapping day replaced, new day added', t.store.cur.CHF.d.length === 3 && near(t.store.cur.CHF.r[0], 1.05) && near(t.store.cur.CHF.r[1], 2) && near(t.store.cur.CHF.r[2], 1.25) && t.store.cur.CHF.req === '2024-02-23', t.store.cur.CHF);
  }

  console.log('real Worker code, synthetic Yahoo upstream:');
  {
    const W = await import('../cf-worker/worker.js');
    const upstream = [], cacheMap = new Map();
    globalThis.caches = { default: { match: async (q) => { const b = cacheMap.get(q.url); return b === undefined ? undefined : new Response(b); }, put: async (q, resp) => { cacheMap.set(q.url, await resp.text()); } } };
    const realFetch = globalThis.fetch;
    const ts = (d) => Math.floor(Date.parse(d + 'T22:00:00Z') / 1000);
    globalThis.fetch = async (url) => {
      const u = String(url && url.url ? url.url : url); upstream.push(u);
      if (/chart\/EURCHF%3DX/.test(u)) return new Response(JSON.stringify({ chart: { result: [{ meta: { currency: 'CHF' }, timestamp: [ts('2024-03-01'), ts('2024-03-04'), ts('2024-06-03')], indicators: { quote: [{ close: [0.96, 0.9434, null] }] } }] } }), { status: 200 });
      return new Response('{}', { status: 404 });
    };
    try {
      const pend = [];
      const res = await FX.syncCurrencies({ transactions: txs, workerBase: 'https://maermin-test.workers.dev', now: NOW, store: FX.normalizeCurrencies(null),
        fetch: (u) => W.default.fetch(new Request(u, { headers: { Origin: 'https://maermin.github.io' } }), {}, { waitUntil(p) { pend.push(p); } }) });
      await Promise.all(pend);
      ok('Worker asked Yahoo for EURCHF=X and EURGBP=X (daily, 2y)', upstream.length === 2 && upstream.every((u) => /interval=1d&range=2y/.test(u)) && /EURCHF%3DX/.test(upstream.join()) && /EURGBP%3DX/.test(upstream.join()), upstream);
      FX.saveCurrencies(res.store);
      ok('rate through the Worker: 1 CHF = 1/0.9434 EUR on 2024-03-04; null close dropped', near(FX.currencyRateAt('CHF', '2024-03-04'), 1 / 0.9434, 1e-7) && res.store.cur.CHF.d.length === 2, res.store.cur.CHF);
      const cost = Ledger.build(txs.slice(0, 1), { exchangeRate: 0.9, usdRates: USD_RATES, applyCorporateActions: false }).groups['stocks|NESN.SW'].openCostEUR;
      ok('CHF buy costed with it: 1,020 CHF / 0.9434 = 1,081.20 EUR', near(cost, 1020 / 0.9434, 1e-4), cost);
    } finally { globalThis.fetch = realFetch; delete globalThis.caches; }
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
