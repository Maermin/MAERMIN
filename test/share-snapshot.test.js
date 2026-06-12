// Node harness for the share-snapshot redaction layer. The CENTERPIECE is the
// leak proof: a portfolio built from distinctive absolute numbers must produce
// a snapshot whose serialisation contains none of them, only allowlisted keys,
// and only bounded percentages/scores. Plus: the allowlist validator (strips
// injections, rejects out-of-range), comparison math and share-id parsing.
// Run: node test/share-snapshot.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 1e-9); }

const S = require('../share-snapshot.js');

(function run() {
  console.log('share-snapshot:');

  // ---- THE LEAK PROOF ---------------------------------------------------------
  // Distinctive absolute numbers that must never appear in a snapshot.
  const SECRET_VALUES = [123456.78, 9876.54, 55555, 31337.42, 777777.77];
  const inputs = {
    classValues: { crypto: 123456.78, stocks: 9876.54, skins: 55555, commodities: 31337.42 },
    sectorWeights: [{ name: 'Technology', pct: 60 }, { name: 'Healthcare', pct: 40 }],
    regionWeights: [{ name: 'USA', pct: 80 }, { name: 'Germany', pct: 20 }],
    currencyRows: [{ currency: 'USD', pct: 70 }, { currency: 'EUR', pct: 30 }],
    healthScore: 82.4,
    effectiveN: 7.31
  };
  const snap = S.buildSnapshot(inputs);
  const wire = JSON.stringify(snap);

  ok('snapshot builds', !!snap && snap.v === 1);
  SECRET_VALUES.forEach((v) => {
    const needle = String(v).replace(/\.\d+$/, ''); // integer part is distinctive enough
    ok('no absolute value leaks (' + v + ')', wire.indexOf(needle) === -1);
  });
  // Keys only ("EUR" as a currency LABEL is allowed by design, an "amount" KEY
  // is not). The allowlist walk below is the strictly stronger check.
  const allKeys = [];
  (function collect(node) {
    if (Array.isArray(node)) return node.forEach(collect);
    if (node && typeof node === 'object') Object.keys(node).forEach((k) => { allKeys.push(k); collect(node[k]); });
  })(snap);
  ok('no quantity-like or symbol-like keys leak', !allKeys.some((k) => /amount|quantity|value|symbol|price|invested|purchas/i.test(k)));

  // Deep allowlist walk: every key known, every number bounded.
  const ALLOWED_KEYS = new Set(['v', 'assetClasses', 'crypto', 'stocks', 'skins', 'commodities',
    'sectors', 'regions', 'currencies', 'name', 'pct', 'metrics', 'healthScore', 'effectiveN']);
  let unknownKey = null, outOfRange = null;
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') {
      Object.keys(node).forEach((k) => {
        if (!ALLOWED_KEYS.has(k)) unknownKey = unknownKey || k;
        walk(node[k]);
      });
      return;
    }
    if (typeof node === 'number' && (node < 0 || node > 1000)) outOfRange = node;
  })(snap);
  ok('every key in the snapshot is allowlisted', unknownKey === null);
  ok('every number is a bounded percentage/score', outOfRange === null);

  // Weights are relative and sum to ~100 regardless of the absolute scale.
  const total = Object.values(snap.assetClasses).reduce((s, x) => s + x, 0);
  ok('asset-class weights sum to ~100', Math.abs(total - 100) < 0.5);
  const scaled = S.buildSnapshot({ ...inputs, classValues: { crypto: 1.2345678, stocks: 0.0987654, skins: 0.55555, commodities: 0.3133742 } });
  ok('a 100000x smaller portfolio yields the same weights', JSON.stringify(scaled.assetClasses) === JSON.stringify(snap.assetClasses));

  ok('metrics carry only rounded scores', snap.metrics.healthScore === 82 && approx(snap.metrics.effectiveN, 7.3));
  ok('empty portfolio yields no snapshot', S.buildSnapshot({ classValues: {} }) === null);

  // ---- validateSnapshot (allowlist enforcement) ----------------------------------
  const v1 = S.validateSnapshot(snap);
  ok('a clean snapshot validates and round-trips', v1.ok && JSON.stringify(v1.snapshot) === wire);

  // Injection: extra fields are STRIPPED by the rebuild, not passed through.
  const injected = JSON.parse(wire);
  injected.totalValueEUR = 123456.78;
  injected.assetClasses.crypto2 = 50;
  injected.metrics.notes = 'I own 123456 EUR';
  const v2 = S.validateSnapshot(injected);
  ok('injected fields never survive validation', v2.ok && JSON.stringify(v2.snapshot).indexOf('123456') === -1 && !('totalValueEUR' in v2.snapshot) && !('crypto2' in v2.snapshot.assetClasses) && !('notes' in (v2.snapshot.metrics || {})));

  ok('weight above 100 is rejected', S.validateSnapshot({ v: 1, assetClasses: { crypto: 250 } }).ok === false);
  ok('implausible weight sum is rejected', S.validateSnapshot({ v: 1, assetClasses: { crypto: 90, stocks: 90 } }).ok === false);
  ok('oversize label is rejected', S.validateSnapshot({ v: 1, assetClasses: { crypto: 100 }, sectors: [{ name: 'x'.repeat(60), pct: 10 }] }).ok === false);
  ok('oversize list is rejected', S.validateSnapshot({ v: 1, assetClasses: { crypto: 100 }, sectors: Array.from({ length: 9 }, (_, i) => ({ name: 's' + i, pct: 1 })) }).ok === false);
  ok('unknown version is rejected', S.validateSnapshot({ v: 2, assetClasses: { crypto: 100 } }).ok === false);
  ok('non-object is rejected', S.validateSnapshot(null).ok === false && S.validateSnapshot([1]).ok === false);

  // Client and Worker validator agree (same rules, independent code paths).
  const fs = require('fs');
  const workerSrc = fs.readFileSync(__dirname + '/../cf-worker/worker.js', 'utf8');
  ok('worker has the server-side validator (defense in depth)', /function validateShareSnapshot/.test(workerSrc) && /weights implausible/.test(workerSrc));

  // ---- compare --------------------------------------------------------------------
  const rows = S.compare(snap, { assetClasses: { crypto: 30, stocks: 30, skins: 20, commodities: 20 } });
  ok('compare covers every present class', rows.length === 4);
  const cryptoRow = rows.find((r) => r.cls === 'crypto');
  ok('compare diff math', approx(cryptoRow.diff, Math.round((cryptoRow.mine - 30) * 10) / 10));
  const aggRows = S.compare(snap, { crypto: 50, stocks: 50 }); // aggregate avg map shape
  ok('compare accepts the aggregate map shape', aggRows.find((r) => r.cls === 'crypto').theirs === 50);

  // ---- parseShareId ------------------------------------------------------------------
  ok('parses a full link', S.parseShareId('https://app.example/#share=a1b2c3d4e5f6a1b2c3') === 'a1b2c3d4e5f6a1b2c3');
  ok('parses a bare id', S.parseShareId('A1B2C3D4E5F6') === 'a1b2c3d4e5f6');
  ok('rejects junk', S.parseShareId('not-a-share-link') === null && S.parseShareId('') === null);

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
