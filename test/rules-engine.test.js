// Node harness for the Automation Rules engine. Pure, no browser.
// Run: node test/rules-engine.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

const R = require('../rules-engine.js');

(function run() {
  console.log('rules-engine:');

  // ---- normalize drops invalid, normalizes casing ----
  let st = R.normalize({ rules: [
    { metric: 'symbol_weight', op: 'gt', threshold: 30, target: 'btc' },
    { metric: 'bogus', op: 'gt', threshold: 1, target: 'x' },         // bad metric -> dropped
    { metric: 'symbol_weight', op: 'gt', target: 'eth' },             // no threshold -> dropped
    { metric: 'category_weight', op: 'lt', threshold: 5, target: 'CRYPTO' },
    { metric: 'total_value', op: 'lt', threshold: 1000 }              // no target needed
  ]});
  ok('normalize keeps only valid rules', st.rules.length === 3);
  ok('symbol target uppercased', st.rules[0].target === 'BTC');
  ok('category target lowercased', st.rules[1].target === 'crypto');
  ok('total_value needs no target', st.rules[2].target === '');
  ok('each rule gets an id', st.rules.every(r => !!r.id));

  // ---- addRule / toggle / remove / update ----
  let s2 = R.addRule({ version: 1, rules: [] }, { metric: 'symbol_weight', op: 'gt', threshold: 25, target: 'nvda' });
  ok('addRule adds one (uppercased target)', s2.rules.length === 1 && s2.rules[0].target === 'NVDA');
  const id = s2.rules[0].id;
  s2 = R.toggleRule(s2, id);
  ok('toggleRule flips enabled', s2.rules[0].enabled === false);
  s2 = R.updateRule(s2, id, { threshold: 40, enabled: true });
  ok('updateRule patches fields', s2.rules[0].threshold === 40 && s2.rules[0].enabled === true);
  s2 = R.removeRule(s2, id);
  ok('removeRule deletes', s2.rules.length === 0);

  // a structurally invalid addRule is a no-op
  const before = R.addRule({ version: 1, rules: [] }, { metric: 'symbol_weight', op: 'gt', threshold: 10 }); // missing target
  ok('addRule ignores invalid rule', before.rules.length === 0);

  // ---- buildContext from positions ----
  const positions = [
    { symbol: 'BTC', category: 'crypto', valueEUR: 600 },
    { symbol: 'ETH', category: 'crypto', valueEUR: 200 },
    { symbol: 'AAPL', category: 'stocks', valueEUR: 200 }
  ];
  const ctx = R.buildContext(positions, { byTag: { Speculative: 150 }, dropFromPeakPct: 12 });
  ok('buildContext totals', ctx.total === 1000);
  ok('buildContext bySymbol', ctx.bySymbol.BTC === 600);
  ok('buildContext byCategory', ctx.byCategory.crypto === 800 && ctx.byCategory.stocks === 200);

  // ---- evaluate ----
  const rules = R.normalize({ rules: [
    { metric: 'symbol_weight',   op: 'gt', threshold: 50, target: 'BTC' },     // 60% -> trigger
    { metric: 'category_weight', op: 'gt', threshold: 70, target: 'crypto' },  // 80% -> trigger
    { metric: 'symbol_weight',   op: 'gt', threshold: 90, target: 'ETH' },     // 20% -> no
    { metric: 'total_value',     op: 'lt', threshold: 5000 },                  // 1000 -> trigger
    { metric: 'tag_weight',      op: 'gt', threshold: 10, target: 'Speculative' }, // 15% -> trigger
    { metric: 'drop_from_peak_pct', op: 'gt', threshold: 10 }                  // 12 -> trigger
  ]});
  const res = R.evaluate(rules, ctx);
  const byDesc = {}; res.forEach(r => byDesc[r.rule.metric + ':' + r.rule.target] = r);
  ok('symbol over-weight triggers', byDesc['symbol_weight:BTC'].triggered === true);
  ok('category over-weight triggers', byDesc['category_weight:crypto'].triggered === true);
  ok('under-threshold does not trigger', byDesc['symbol_weight:ETH'].triggered === false);
  ok('total_value below triggers', byDesc['total_value:'].triggered === true);
  ok('tag weight triggers', byDesc['tag_weight:Speculative'].triggered === true);
  ok('drop from peak triggers', byDesc['drop_from_peak_pct:'].triggered === true);
  ok('activeCount counts triggers', R.activeCount(rules, ctx) === 5);
  ok('triggered rules sort first', res[0].triggered === true);

  // ---- disabled rule never triggers ----
  const disabled = R.toggleRule(R.normalize({ rules: [
    { metric: 'symbol_weight', op: 'gt', threshold: 1, target: 'BTC' }
  ]}), null); // toggle with wrong id = no-op, so explicitly disable below
  const off = R.updateRule(R.normalize({ rules: [{ id: 'x', metric: 'symbol_weight', op: 'gt', threshold: 1, target: 'BTC', enabled: false }] }), 'x', {});
  ok('disabled rule never triggers', R.evaluate(off, ctx)[0].triggered === false);

  // ---- describe text ----
  ok('describe symbol weight', R.describe({ metric: 'symbol_weight', op: 'gt', threshold: 30, target: 'BTC' }) === 'BTC weight > 30%');
  ok('describe tag weight', R.describe({ metric: 'tag_weight', op: 'lt', threshold: 5, target: 'Income' }) === 'tag:Income weight < 5%');

  // ---- empty context is safe (weights null, no crash) ----
  const emptyRes = R.evaluate(rules, R.buildContext([], {}));
  ok('empty context -> nothing triggers on weights', emptyRes.filter(r => r.rule.metric === 'symbol_weight').every(r => !r.triggered));

  // ---- price alerts (symbol_price) — replaced the standalone Price Alerts view ----
  const pst = R.normalize({ rules: [
    { id: 'p1', metric: 'symbol_price', op: 'gte', threshold: 100, target: 'bitcoin' },
    { id: 'p2', metric: 'symbol_price', op: 'lte', threshold: 50, target: 'AAPL' },
    { id: 'p3', metric: 'symbol_price', op: 'gte', threshold: 1, target: 'MISSING' }
  ]});
  ok('price target keeps its casing', pst.rules[0].target === 'bitcoin');
  const pctx = R.buildContext([], { prices: { bitcoin: 120, aapl: 40 } });
  const pres = {}; R.evaluate(pst, pctx).forEach(r => { pres[r.rule.id] = r; });
  ok('price ≥ threshold triggers', pres.p1.triggered === true && pres.p1.actual === 120);
  ok('price lookup is case-insensitive', pres.p2.actual === 40 && pres.p2.triggered === true);
  ok('missing quote never triggers', pres.p3.actual === null && pres.p3.triggered === false);
  ok('zero price treated as missing', R.priceFor({ X: 0 }, 'X') === null);
  ok('describe price rule', R.describe({ metric: 'symbol_price', op: 'gte', threshold: 100, target: 'BTC' }) === 'BTC price ≥ 100');

  // ---- legacy Price Alerts migration ----
  const legacy = [
    { id: '1', symbol: 'BTC', condition: 'above', targetPrice: 70000, triggered: false },
    { id: '2', symbol: 'ETH', condition: 'below', targetPrice: 2000, triggered: true },
    { id: '3', symbol: '', condition: 'above', targetPrice: 5 },               // invalid -> skipped
    null
  ];
  const mig = R.migrateLegacyAlerts({ rules: [] }, JSON.stringify(legacy));
  ok('migrates valid legacy alerts only', mig.rules.length === 2);
  ok('above -> gte, below -> lte', mig.rules[0].op === 'gte' && mig.rules[1].op === 'lte');
  ok('already-fired alert arrives disabled', mig.rules[0].enabled === true && mig.rules[1].enabled === false);
  ok('migration is idempotent', R.migrateLegacyAlerts(mig, legacy).rules.length === 2);
  ok('garbage legacy payload is ignored', R.migrateLegacyAlerts({ rules: [] }, 'not json').rules.length === 0);

  // ---- load() folds the legacy store in once, then drops the legacy key ----
  const mem = { maermin_alerts: JSON.stringify([{ id: '9', symbol: 'SOL', condition: 'above', targetPrice: 300 }]) };
  global.localStorage = {
    getItem: k => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; }
  };
  const loaded = R.load();
  ok('load migrates legacy alerts', loaded.rules.length === 1 && loaded.rules[0].metric === 'symbol_price');
  ok('legacy key removed after save', !('maermin_alerts' in mem) && JSON.parse(mem.maermin_rules).rules.length === 1);
  ok('second load is stable', R.load().rules.length === 1);
  delete global.localStorage;

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
