// Regression tests for the full-project review (REVIEW.md, 2026-09):
// tax screen/export consistency, German broker parsing, year-less price
// timestamps, TWR/XIRR, Monte Carlo inputs, fee-inclusive cost basis, sync
// three-way merge, Vorabpauschale timing/lots/credit, withholding credit,
// quote-currency conversion, read-only broker relay, plaintext adoption.
// Run: node test/review-regressions.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-6);

// ---- minimal browser stubs ---------------------------------------------------
class StorageMock {
  constructor() { this._d = new Map(); }
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; }
  setItem(k, v) { this._d.set(k, String(v)); }
  removeItem(k) { this._d.delete(k); }
  get length() { return this._d.size; }
  key(i) { return Array.from(this._d.keys())[i] || null; }
}
globalThis.Storage = StorageMock;
const localStorage = new StorageMock();
globalThis.localStorage = localStorage;
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = require('node:crypto').webcrypto;

const silence = console.log; console.log = () => {};
const TE = require('../tax-calculation-engine.js');
console.log = silence;
const GT = TE.GermanTax;
const TR = require('../tax-report-builder.js');
const M = require('../metrics.js');
const R = require('../returns-engine.js');
const MC = require('../monte-carlo-engine.js');
const IE = require('../import-export-engine.js');
const MIG = require('../migrations.js');
const U = require('../utils.js');
const FXH = require('../fx-history.js');
const GTV = require('../german-tax-view.js');
const S = require('../sync-engine.js');
const TA = require('../tax-advisor.js');

const SETTINGS = { abgeltungRate: 0.25, soli: true, kirchensteuer: 0, freistellungsauftrag: 1000, cryptoExemption: true };
const buildDE = (txs, extra) => TR.build(txs, Object.assign({
  year: 2025, jurisdiction: 'de', baseCurrency: 'EUR', exchangeRate: 0.9,
  germanTax: GT, taxSettings: SETTINGS, fundTypes: {}, vapRecords: {}, dividendEvents: [], taxOverrides: {}
}, extra || {}));

(async function run() {
  // ---- app mount: no temporal-dead-zone reads in the main component ------------
  console.log('renderer mount:');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'renderer.js'), 'utf8');
  // Every `const [x, setX] = useState(...)` of InvestmentTracker must be declared
  // before any hook dependency array (`, [ ... x ... ]`) that reads it - the
  // shipped main crashed on mount with "Cannot access 'corpActionsRev' before
  // initialization".
  const decls = [...src.matchAll(/const \[(\w+), set\w+\] = useState/g)].map(m => ({ name: m[1], at: m.index }));
  const late = decls.filter(d => {
    const re = new RegExp('\\[[^\\]\\n]*\\b' + d.name + '\\b[^\\]\\n]*\\]\\s*\\)', 'g');
    let m; while ((m = re.exec(src))) { if (m.index < d.at) return true; }
    return false;
  }).map(d => d.name);
  ok('no hook dependency reads a state variable before its declaration' + (late.length ? ' (' + late.join(', ') + ')' : ''), late.length === 0);

  // ---- B1: Tax view KPIs == export --------------------------------------------
  console.log('tax view vs export (B1):');
  const txsB1 = [
    { type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 10, price: 100, fees: 10, currency: 'USD', date: '2025-02-01' },
    { type: 'sell', category: 'stocks', symbol: 'AAPL', quantity: 10, price: 150, currency: 'USD', date: '2025-06-01' },
    { type: 'buy', category: 'crypto', symbol: 'BTC', quantity: 1, price: 500, currency: 'EUR', date: '2025-01-10' },
    { type: 'sell', category: 'crypto', symbol: 'BTC', quantity: 1, price: 1200, currency: 'EUR', date: '2025-03-10' }
  ];
  const repB1 = buildDE(txsB1);
  const k = TR.kpis(repB1);
  ok('KPIs are derived from the export report (same tax)', near(k.taxLiability, repB1.summary.estimatedTaxLiability));
  ok('USD legs converted: net realized = 441 EUR stocks + 700 EUR crypto', near(k.realizedGains, 441 + 700, 1e-6));
  ok('crypto under the Freigrenze + stocks under the allowance -> 0 tax', near(k.taxLiability, 0));
  const repUS = TR.build(txsB1, { year: 2025, jurisdiction: 'us', exchangeRate: 0.9 });
  ok('US estimate uses FX-correct disposals (no legacy engine)', near(repUS.summary.estimatedTaxLiability, (441 + 700) * 0.24));

  // ---- B7: income detection is type-only; manual calendar entries deduped ------
  console.log('income detection (B7):');
  const repNote = buildDE([{ type: 'buy', category: 'stocks', symbol: 'VWRL', quantity: 2, price: 100, currency: 'EUR', date: '2025-05-01', notes: 'Dividend reinvestment, interest-bearing' }]);
  ok('a BUY with "dividend" in its note is not dividend income', repNote.summary.dividendIncome === 0);
  ok('...and not interest income', repNote.summary.interestIncome === 0);
  const repDup = buildDE([{ type: 'dividend', category: 'stocks', symbol: 'KO', quantity: 10, price: 0.5, currency: 'EUR', date: '2025-04-01' }],
    { dividendEvents: [{ symbol: 'KO', date: '2025-04-01', amount: 5, currency: 'EUR' }, { symbol: 'PG', date: '2025-04-02', amount: 3, currency: 'EUR' }] });
  ok('manual entry for an already-booked payout is not double counted', near(repDup.summary.dividendIncome, 5 + 3));

  // ---- withholding tax credit (sec. 32d (5)) -------------------------------------
  console.log('withholding credit:');
  const repWHT = buildDE([{ type: 'dividend', category: 'stocks', symbol: 'MSFT', quantity: 1, price: 3000, withholdingTax: 450, currency: 'EUR', date: '2025-03-01' }]);
  const g = repWHT.summary.germanDetail;
  // 3000 - 1000 allowance = 2000 taxable -> 500 tax; credit min(450, 15% of 3000 = 450, 25% of 2000 = 500) = 450
  ok('foreign withholding is credited against Abgeltungsteuer', near(g.withholdingCredit, 450) && near(g.abgeltungsteuer, 50));
  ok('Soli follows the reduced tax', near(g.soli, 50 * 0.055));
  const repSwiss = buildDE([{ type: 'dividend', category: 'stocks', symbol: 'NESN.SW', quantity: 1, price: 3000, withholdingTax: 1050, currency: 'EUR', date: '2025-03-01' }]);
  ok('credit capped at the 15% DTA rate (Swiss 35% withheld)', near(repSwiss.summary.germanDetail.withholdingCredit, 450));

  // ---- B10/B11: Vorabpauschale ---------------------------------------------------
  console.log('Vorabpauschale (B10/B11):');
  ok('Basiszins 2026 = 3.20% (BMF 13.01.2026)', near(GT.basiszinsFor(2026), 0.032));
  const fundTx = [{ type: 'buy', category: 'stocks', symbol: 'WORLD', quantity: 10, price: 100, currency: 'EUR', date: '2023-01-10' }];
  const recs = { WORLD: { 2024: 20, 2025: 30 } };
  const r2025 = buildDE(fundTx, { year: 2025, vapRecords: recs, fundTypes: { WORLD: 'aktienfonds' } });
  ok('report 2025 taxes the VAP of value year 2024 (deemed received Jan 2025)', near(r2025.summary.germanDetail.vorabpauschaleGross, 20));
  const r2026 = buildDE(fundTx, { year: 2026, vapRecords: recs, fundTypes: { WORLD: 'aktienfonds' } });
  ok('report 2026 taxes the VAP of value year 2025', near(r2026.summary.germanDetail.vorabpauschaleGross, 30));
  // Per-lot month factor: 10 units held since 2023 + 10 units bought in July 2025 (6/12).
  const lotTxs = fundTx.concat([{ type: 'buy', category: 'stocks', symbol: 'WORLD', quantity: 10, price: 110, currency: 'EUR', date: '2025-07-15' }]);
  const pre = GTV.prefillRow(lotTxs, {}, 'WORLD', 2025, 1);
  ok('Sparplan units bought in-year get their own month factor', near(pre.monthsFactor, (10 * 1 + 10 * 6 / 12) / 20));
  // Legacy year-less points must never be matched as a year-start price.
  ok('priceAt ignores year-less legacy timestamps', GTV.priceAt([{ timestamp: '09/30, 08:14 PM', price: 99 }], '2025-01-01T23:59:59Z') === null);
  // Per-unit credit on a partial sale.
  const credTxs = [
    { type: 'buy', category: 'stocks', symbol: 'WORLD', quantity: 100, price: 100, currency: 'EUR', date: '2023-01-10' },
    { type: 'sell', category: 'stocks', symbol: 'WORLD', quantity: 25, price: 120, currency: 'EUR', date: '2025-06-01' }
  ];
  const rCred = buildDE(credTxs, { vapRecords: { WORLD: { 2023: 40, 2024: 60 } } });
  ok('VAP credit pro-rated to the 25 of 100 units sold', near(rCred.summary.germanDetail.vapCreditTotal, 25));
  const lateBuy = [
    { type: 'buy', category: 'stocks', symbol: 'WORLD', quantity: 50, price: 100, currency: 'EUR', date: '2023-01-10' },
    { type: 'buy', category: 'stocks', symbol: 'WORLD', quantity: 50, price: 100, currency: 'EUR', date: '2024-06-10' },
    { type: 'sell', category: 'stocks', symbol: 'WORLD', quantity: 100, price: 120, currency: 'EUR', date: '2025-06-01' }
  ];
  const rLate = buildDE(lateBuy, { vapRecords: { WORLD: { 2023: 50, 2024: 100 } } });
  // 2023: 50 units held -> both are credited 1.0 each for lot 1 (50/50 x 50); 2024: 100 units -> 100 x (50+50)/100
  ok('a lot is only credited for years it was held at year end', near(rLate.summary.germanDetail.vapCreditTotal, 50 + 100));

  // ---- B12: loss pots -------------------------------------------------------------
  console.log('loss pots (B12):');
  const adv = TA.analyze({ today: '2025-11-01',
    positions: [{ symbol: 'VWCE', category: 'stocks', isFund: true, costBasisEUR: 5000, currentValueEUR: 4000 }],
    realizedStockGainsYTD: 2000, realizedOtherGainsYTD: 0 });
  ok('ETF loss is never offered against share gains', !adv.findings.some(f => f.kind === 'lossHarvest'));

  // ---- B2: broker parsers ---------------------------------------------------------
  console.log('broker parsers (B2):');
  const tr = IE.BrokerParsers.tradeRepublic.parse([
    { Typ: 'Verkauf', Wertpapier: 'Apple', ISIN: 'US0378331005', 'Stück': '2', Kurs: '180,55', Datum: '2025-03-01' },
    { Typ: 'Kauf', Wertpapier: 'Apple', ISIN: 'US0378331005', 'Stück': '1,5', Kurs: '1.234,56', Datum: '2025-03-02' },
    { Typ: 'Dividende', Wertpapier: 'Apple', ISIN: 'US0378331005', 'Stück': '2', Kurs: '0,25', Datum: '2025-03-03' },
    { Typ: 'Sparplan', Wertpapier: 'ETF', ISIN: 'IE00BK5BQT80', 'Stück': '0,5', Kurs: '100', Datum: '2025-03-04' }
  ], []);
  ok('TR "Verkauf" is a sell (not a buy)', tr[0].type === 'sell');
  ok('TR German decimals parsed (180,55 / 1.234,56 / 1,5)', near(tr[0].price, 180.55) && near(tr[1].price, 1234.56) && near(tr[1].quantity, 1.5));
  ok('TR dividend row is not booked as a trade', tr.length === 3 && tr[2].type === 'buy');
  const dg = IE.BrokerParsers.degiro.parse([{ Produkt: 'VANGUARD FTSE AW', ISIN: 'IE00BK5BQT80', Anzahl: '-3', Kurs: '1.234,56', Datum: '01-03-2025', 'Währung': 'EUR' }], []);
  ok('DEGIRO German decimals parsed', dg[0].type === 'sell' && near(dg[0].price, 1234.56));
  const bn = IE.BrokerParsers.binance.parse([{ Pair: 'BTCEUR', Side: 'BUY', Executed: '0.01BTC', Price: '60000', Fee: '0.0001', 'Fee Coin': 'BNB', 'Date(UTC)': '2025-03-01 10:00:00' }], []);
  ok('Binance: symbol = base asset, currency = quote, foreign fee coin dropped', bn[0].symbol === 'BTC' && bn[0].currency === 'EUR' && bn[0].fees === 0);
  ok('stablecoin quote maps to USD', IE.quoteCurrency('USDT') === 'USD');
  const chosen = IE.importData('ClientAccountID,TradeID,Typ,Wertpapier,Stück,Kurs,Datum\n1,2,Verkauf,X,1,"2,5",2025-01-01', 'csv', { broker: 'tradeRepublic' });
  ok('the broker chosen in the wizard wins over header sniffing', chosen.broker === 'Trade Republic');

  // ---- B3: timestamps --------------------------------------------------------------
  console.log('price timestamps (B3):');
  ok('parseTimestamp rejects year-less legacy strings', isNaN(U.parseTimestamp('09/30, 08:14 PM')));
  ok('parseTimestamp accepts ISO + epoch', U.parseTimestamp('2025-01-01T00:00:00Z') === Date.UTC(2025, 0, 1) && U.parseTimestamp(5) === 5);
  const repaired = MIG.repairPriceTimestamps({ btc: [
    { timestamp: '12/30, 10:00 AM', price: 1 }, { timestamp: '01/02, 09:00 PM', price: 2 },
    { timestamp: '2026-03-01T00:00:00.000Z', price: 3 }, { timestamp: 'garbage', price: 4 }
  ] }, new Date(2026, 8, 30, 12, 0));
  const bt = repaired.history.btc;
  ok('legacy points get their year back across New Year', bt.length === 3 &&
    new Date(bt[0].timestamp).getFullYear() === 2025 && new Date(bt[0].timestamp).getMonth() === 11 &&
    new Date(bt[1].timestamp).getFullYear() === 2026 && new Date(bt[1].timestamp).getHours() === 21);
  ok('ISO points are kept, undatable points dropped', bt[2].price === 3 && repaired.changed);
  ok('the migration is registered', MIG.MIGRATIONS.some(m => /year-less/.test(m.name)));

  // ---- B4/B5: TWR + XIRR --------------------------------------------------------------
  console.log('returns (B4/B5):');
  const flat = { btc: [{ timestamp: '2025-01-01T00:00:00Z', price: 100 }, { timestamp: '2025-06-01T00:00:00Z', price: 100 }],
    aapl: [{ timestamp: '2025-01-01T14:30:00Z', price: 50 }, { timestamp: '2025-06-01T14:30:00Z', price: 50 }] };
  ok('TWR is 0 for flat prices with misaligned timestamps (was -50%)', near(R.twr(flat, { crypto: [{ symbol: 'BTC', amount: 1 }], stocks: [{ symbol: 'AAPL', amount: 1 }] }), 0));
  const yearEnd = { btc: [{ timestamp: '2025-12-30T10:00:00Z', price: 100 }, { timestamp: '2026-01-02T10:00:00Z', price: 120 }] };
  ok('TWR sorts chronologically across New Year', near(R.twr(yearEnd, { crypto: [{ symbol: 'BTC', amount: 1 }] }), 0.2));
  const flowHist = { btc: [{ timestamp: '2025-01-01T00:00:00Z', price: 100 }, { timestamp: '2025-02-01T00:00:00Z', price: 110 }, { timestamp: '2025-03-01T00:00:00Z', price: 121 }] };
  const flowTx = [{ type: 'buy', symbol: 'BTC', quantity: 1, date: '2024-12-31' }, { type: 'buy', symbol: 'BTC', quantity: 9, date: '2025-02-01' }];
  ok('TWR ignores the size of a mid-period deposit (+10% then +10%)', near(R.twr(flowHist, { crypto: [{ symbol: 'BTC', amount: 10 }] }, flowTx), 0.21));
  const cfs = R.buildCashflows([{ type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 10, price: 100, currency: 'USD', date: '2024-09-30' },
    { type: 'buy', category: 'options', symbol: 'AAPL C', quantity: 1, price: 5, currency: 'USD', date: '2024-09-30' }],
    { rate: 0.9, fxAt: () => 0.9, currentValueEUR: 900, today: '2025-09-30' });
  ok('XIRR cash flows are in EUR and skip option legs', cfs.length === 2 && near(cfs[0].amount, -900));
  ok('unchanged USD position -> XIRR 0 (was about -10%)', near(R.xirr(cfs), 0, 1e-6));

  // ---- B6: Monte Carlo ------------------------------------------------------------------
  console.log('monte carlo (B6):');
  const mc = MC.runMonteCarloSimulation({ crypto: [{ symbol: 'BTC', amount: 1, purchasePrice: 10000, currentPrice: 60000 }] }, { iterations: 50, years: 1 });
  ok('start value is the market value, not cost basis', near(mc.initialValue, 60000));
  ok('crypto-only book uses crypto assumptions (not 8%/18%)', near(mc.expectedReturn, 0.25) && near(mc.volatility, 0.80));
  ok('commodities / custom classes count towards value', near(MC.runMonteCarloSimulation({ commodities: [{ amount: 2, currentPrice: 50 }], real_estate: [{ amount: 1, currentValue: 100 }] }, { iterations: 5, years: 1 }).initialValue, 200));
  ok('explicit 0% return is honoured', MC.runMonteCarloSimulation({ stocks: [{ amount: 1, currentPrice: 100 }] }, { iterations: 5, years: 1, expectedReturn: 0 }).expectedReturn === 0);

  // ---- B8: fees in the position cost basis ------------------------------------------------
  console.log('cost basis (B8):');
  const pos = M.buildPositions([{ type: 'buy', category: 'stocks', symbol: 'X', quantity: 10, price: 100, fees: 20, currency: 'EUR', date: '2025-01-01' }], { exchangeRate: 1 });
  ok('average cost includes purchase fees (matches the tax lot)', near(pos.stocks[0].purchasePrice, 102));
  const tlh = M.computeTaxLossHarvest({ stocks: [{ symbol: 'Y', amount: 1, purchasePrice: 100 }] }, { Y: 50 },
    [{ type: 'buy', category: 'stocks', symbol: 'Y', date: new Date().toISOString().slice(0, 10) }]);
  ok('no US wash-sale rule for German users', tlh.rows[0].washSale === false && tlh.rows[0].taxSavings > 0);

  // ---- quote currencies --------------------------------------------------------------------
  console.log('quote currencies:');
  const rates = { EUR: 0.9, GBP: 0.75, CHF: 0.8 };
  ok('GBp pence -> EUR (was x100 too high)', near(FXH.quoteToEUR(7500, 'GBp', 0.9, rates), 90));
  ok('CHF -> EUR via the USD table', near(FXH.quoteToEUR(80, 'CHF', 0.9, rates), 90));
  ok('unknown currency without a rate -> null (never mis-scaled)', FXH.quoteToEUR(1, 'XYZ', 0.9, rates) === null);

  // ---- B9: sync three-way merge ------------------------------------------------------------
  console.log('sync merge (B9):');
  const base = S.keyHashes({ data: { maermin_watchlist: '["NVDA"]', maermin_notes: 'a' } });
  const m1 = S.mergeSnapshots(
    { updatedAt: Date.now(), data: { maermin_watchlist: '["NVDA"]', maermin_notes: 'b' } },
    { updatedAt: 1000, data: { maermin_watchlist: '["NVDA","MSFT"]', maermin_notes: 'a' } }, base);
  ok('an edit made only on the other device is kept', m1.merged.data.maermin_watchlist === '["NVDA","MSFT"]');
  ok('an edit made only here is kept', m1.merged.data.maermin_notes === 'b');

  // ---- worker relay policy ------------------------------------------------------------------
  console.log('broker relay:');
  const W = await import('../cf-worker/worker.js');
  const allow = (u, m) => W.brokerRelayAllowed(new URL(u), m).ok;
  ok('read endpoints allowed', allow('https://api.binance.com/api/v3/myTrades?x=1', 'GET') && allow('https://api.bitpanda.com/v1/trades', 'GET'));
  ok('order / withdraw endpoints refused', !allow('https://api.binance.com/api/v3/order', 'POST') && !allow('https://api.binance.com/sapi/v1/capital/withdraw/apply', 'POST'));
  ok('write method on a read path refused', !allow('https://api.binance.com/api/v3/account', 'DELETE'));
  ok('unknown host refused', !allow('https://evil.example/api/v3/account', 'GET'));

  // ---- storage: plaintext adoption ----------------------------------------------------------
  console.log('storage adoption:');
  globalThis.window = { localStorage, addEventListener() {} };
  delete require.cache[require.resolve('../crypto-vault.js')];
  delete require.cache[require.resolve('../storage.js')];
  const Vault = require('../crypto-vault.js');
  globalThis.window.MaerminVault = Vault;
  const Storage = require('../storage.js');
  await Vault.create('correct horse battery', { params: { iterations: 1000, hash: 'SHA-256' } });
  localStorage.setItem('transactions', '[]');
  await Storage.enableAtRest();
  // Simulate data written by an older build while this key was NOT sensitive.
  localStorage._d.set('maermin_real_assets', '{"assets":[{"id":"flat"}]}');
  await Storage.flush();
  Vault.lock();
  await Vault.unlock('correct horse battery');
  await Storage.resume();
  ok('legacy plaintext of a newly-sensitive key is still readable', localStorage.getItem('maermin_real_assets') === '{"assets":[{"id":"flat"}]}');
  await new Promise(r => setTimeout(r, 50));
  ok('...and the plaintext original is removed once encrypted', !localStorage._d.has('maermin_real_assets'));
  Vault.lock();
  await Vault.unlock('correct horse battery');
  await Storage.resume();
  ok('...and survives the next lock/unlock from ciphertext', localStorage.getItem('maermin_real_assets') === '{"assets":[{"id":"flat"}]}');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
