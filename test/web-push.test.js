// Node harness for P5-5.1: the app side of Web Push - which reminders are
// scheduled, what a lock screen shows (generic unless details are on), the
// opt-in price rules handed to the Worker, and where the settings live.
// Run: node test/web-push.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); }
}
const _store = {};
globalThis.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: (k) => { delete _store[k]; }
};
const WP = require('../web-push.js');
const money = (v) => v.toFixed(2) + ' €';
const at9 = (d) => new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), 9).toISOString();

(function main() {
  console.log('web-push:');
  const input = {
    today: '2026-10-14',
    dividends: [
      { symbol: 'AAPL', date: '2026-11-13', amount: 12.3 }, { symbol: 'KO', date: '2026-11-13', amount: 8 },
      { symbol: 'MSFT', date: '2026-10-01', amount: 9 },   // past
      { symbol: 'O', date: '2027-03-20', amount: 4 }        // beyond 120 days
    ],
    vap: { year: 2026, tax: 41.5 },
    crypto: [{ symbol: 'BTC', date: '2026-12-02', quantity: 0.1 }],
    ira: { year: 2026, remaining: 1500 }
  };
  let msgs = WP.plan(input, { money });
  const kinds = msgs.map((m) => m.kind).join();
  ok('dividends of one day in one message; past and far-off dates left out', msgs.filter((m) => m.kind === 'dividend').length === 1 && msgs.find((m) => m.kind === 'dividend').at === at9('2026-11-13'), msgs);
  ok('Vorabpauschale on 1 December, 09:00 local', msgs.find((m) => m.kind === 'vap').at === at9('2026-12-01'));
  ok('crypto on the day it turns tax-free', msgs.find((m) => m.kind === 'crypto').at === at9('2026-12-02'));
  ok('IRA reminder on 1 April of the next year (outside 120 days in October: left out)', !msgs.some((m) => m.kind === 'ira'), kinds);
  ok('sorted by time', msgs.every((m, i) => i === 0 || msgs[i - 1].at <= m.at));
  const div = msgs.find((m) => m.kind === 'dividend');
  ok('generic by default: no symbol, no amount on the lock screen', !/AAPL|KO|12\.30|8\.00|€/.test(JSON.stringify(msgs)) && /2 dividends/.test(div.body), div);
  msgs = WP.plan(input, { money, details: true });
  const d2 = msgs.find((m) => m.kind === 'dividend');
  ok('with details: symbols and amounts', /AAPL/.test(d2.body) && /12\.30 €/.test(d2.body) && /41\.50 €/.test(msgs.find((m) => m.kind === 'vap').body) && /0\.1 BTC/.test(msgs.find((m) => m.kind === 'crypto').body), msgs);
  msgs = WP.plan(Object.assign({}, input, { today: '2027-01-10' }), { money });
  ok('in January the IRA reminder for the past year is planned (1 April)', msgs.some((m) => m.kind === 'ira' && m.at === at9('2027-04-01')));
  ok('no IRA reminder when no room is left', !WP.plan(Object.assign({}, input, { today: '2027-01-10', ira: { year: 2026, remaining: 0 } }), { money }).some((m) => m.kind === 'ira'));
  ok('no Vorabpauschale reminder without tax', !WP.plan(Object.assign({}, input, { vap: { year: 2026, tax: 0 } }), { money }).some((m) => m.kind === 'vap'));
  msgs = WP.plan(input, { money, kinds: { dividends: false, vap: true, crypto: false, ira: true } });
  ok('kinds can be switched off', msgs.length === 1 && msgs[0].kind === 'vap', msgs);
  const many = { today: '2026-10-14', dividends: Array.from({ length: 150 }, (_, i) => ({ symbol: 'S' + i, date: new Date(Date.UTC(2026, 9, 15) + (i % 110) * 86400000).toISOString().slice(0, 10), amount: 1 })) };
  ok('at most the Worker\'s 100 messages', WP.plan(many, { money }).length <= 100);
  ok('every message is small JSON with title, body and tag', WP.plan(input, { money, details: true }).every((m) => m.title && m.body && m.tag && JSON.stringify(WP.payload(m)).length < 600));

  // ---- opt-in price rules ---------------------------------------------------------
  const rules = { version: 1, rules: [
    { id: 'r1', metric: 'symbol_price', op: 'lte', threshold: 150, target: 'AAPL', enabled: true },
    { id: 'r2', metric: 'symbol_price', op: 'gt', threshold: 100000, target: 'BTC', enabled: true },
    { id: 'r3', metric: 'symbol_weight', op: 'gt', threshold: 30, target: 'BTC', enabled: true },
    { id: 'r4', metric: 'symbol_price', op: 'lt', threshold: 10, target: 'XYZ', enabled: false }
  ] };
  const pr = WP.priceRules(rules, { isCrypto: (s) => s === 'BTC', coinId: (s) => (s === 'BTC' ? 'bitcoin' : null) });
  ok('only enabled price rules go to the Worker: stocks via Yahoo, crypto via its CoinGecko id', pr.length === 2 && pr[0].kind === 'yahoo' && pr[0].symbol === 'AAPL' && pr[0].op === 'lte' && pr[1].kind === 'coingecko' && pr[1].symbol === 'bitcoin', pr);
  ok('weight and value rules stay in the app (they need the whole portfolio)', !pr.some((r) => r.ruleId === 'r3'));

  // ---- settings and storage ------------------------------------------------------------
  const s = WP.normalize({ enabled: true, details: 1, closedPrices: true, kinds: { dividends: false }, box: 'abc', token: 't', sub: { endpoint: 'https://fcm.googleapis.com/x', p256dh: 'k', auth: 'a' } });
  ok('settings: defaults on, details and closed-app price rules off unless set', s.enabled === true && s.details === false && s.closedPrices === true && s.kinds.dividends === false && s.kinds.vap === true);
  const fs = require('fs'), path = require('path');
  const storage = fs.readFileSync(path.join(__dirname, '..', 'storage.js'), 'utf8');
  const backup = fs.readFileSync(path.join(__dirname, '..', 'backup-engine.js'), 'utf8');
  const sync = fs.readFileSync(path.join(__dirname, '..', 'sync-engine.js'), 'utf8');
  ok('maermin_push is encrypted, device-local (not synced) and not in the backup', /'maermin_push'/.test(storage) && /LOCAL_ONLY_KEYS[^;]*'maermin_push'/.test(sync) && !/'maermin_push'/.test(backup));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
