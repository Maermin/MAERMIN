// Node harness for P5-1.1 (F2): no app-wide default rebalancing targets.
// Older builds gave every user crypto 35 / stocks 45 / skins 10 / commodities 10
// and saved that the first time Rebalancing opened. Without targets there is no
// drift; a stored copy of exactly that old default reads as "no targets".
// Run: node test/rebalancing-defaults.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }

globalThis.window = {};
globalThis.localStorage = {
  _d: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; }
};
const M = require('../metrics.js');

const portfolio = {
  crypto: [{ symbol: 'BTC', amount: 1, purchasePrice: 600 }],
  stocks: [{ symbol: 'AAPL', amount: 2, purchasePrice: 200 }],
  skins: [], commodities: []
};
const prices = { BTC: 600, AAPL: 200 };

(function run() {
  console.log('rebalancing defaults:');
  ok('no app-wide default targets', Object.keys(M.DEFAULT_TARGETS).length === 0);

  localStorage.removeItem('maermin_targets');
  ok('nothing saved → no targets', Object.keys(M.loadTargets()).length === 0);
  ok('hasTargets is false for {}', M.hasTargets({}) === false);

  const none = M.computeRebalancingDrift(portfolio, prices);
  ok('no targets → drift not available', none.available === false && none.reason === 'no-targets');
  ok('no targets → no drift rows', none.rows.length === 0 && none.maxDrift === 0);

  localStorage.setItem('maermin_targets', JSON.stringify({ crypto: 35, stocks: 45, skins: 10, commodities: 10 }));
  ok('stored legacy default reads as no targets', Object.keys(M.loadTargets()).length === 0);
  ok('stored legacy default is left in storage (no data change)', JSON.parse(localStorage.getItem('maermin_targets')).skins === 10);
  ok('legacy default in another key order also reads as none',
    Object.keys(M.normalizeTargets({ skins: 10, commodities: 10, stocks: 45, crypto: 35 })).length === 0);

  localStorage.setItem('maermin_targets', JSON.stringify({ crypto: 50, stocks: 50, skins: 0, commodities: 0 }));
  const own = M.loadTargets();
  ok('own targets are used unchanged', own.crypto === 50 && own.stocks === 50 && own.skins === 0);
  ok('own targets are not padded with old defaults', M.normalizeTargets({ crypto: 50 }).stocks === undefined);
  const d = M.computeRebalancingDrift(portfolio, prices);
  ok('own targets → drift available', d.available === true);
  ok('drift vs own targets (crypto 60 % vs 50 %)', Math.abs(d.rows.find(r => r.cls === 'crypto').drift - 10) < 1e-9);
  ok('a zero target on an unheld class shows no row', !d.rows.some(r => r.cls === 'skins'));
  ok('hasTargets ignores zero-only targets', M.hasTargets({ crypto: 0, stocks: 0 }) === false);

  localStorage.setItem('maermin_targets', 'not json');
  ok('unreadable storage → no targets', Object.keys(M.loadTargets()).length === 0);
  ok('junk values are dropped', Object.keys(M.normalizeTargets({ crypto: 'x', stocks: -5, skins: 20 })).join() === 'skins');

  console.log('targets from the current allocation:');
  const cur = M.targetsFromAllocation({ crypto: 600, stocks: 400, skins: 0, commodities: 0 });
  ok('weights of held classes', cur.crypto === 60 && cur.stocks === 40);
  ok('classes not held get no target', cur.skins === undefined && cur.commodities === undefined);
  const thirds = M.targetsFromAllocation({ crypto: 1, stocks: 1, commodities: 1 });
  ok('rounded targets add up to 100', thirds.crypto + thirds.stocks + thirds.commodities === 100);
  ok('rounding stays within 1 point', [thirds.crypto, thirds.stocks, thirds.commodities].every(v => v === 33 || v === 34));
  ok('nothing held → no targets', Object.keys(M.targetsFromAllocation({ crypto: 0 })).length === 0);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
