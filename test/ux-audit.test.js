// Regression tests for the usability findings of the 2026-10-04 audit
// (docs/AUDIT.md, UX-001 ...). Pure logic only; the UI side is checked in the
// running app.
// Run: node test/ux-audit.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 1e-9); }

(function () {
  // ---- UX-001: CSV in the quick Import dialog -------------------------------
  console.log('UX-001 quick import CSV');
  const M = require('../import-mapping.js');
  const has = typeof M.quickCSV === 'function';
  ok('quickCSV exists', has);
  const run = (text, opts) => (has ? M.quickCSV(text, opts) : { transactions: [], errors: [] });

  // The example the dialog itself shows.
  const ex = run('type,category,symbol,quantity,price,date,fees\nbuy,crypto,bitcoin,0.5,45000,2024-01-15,10');
  const t0 = ex.transactions[0] || {};
  ok('the dialog\'s own CSV example imports one transaction', ex.transactions.length === 1 && ex.errors.length === 0);
  ok('... with its fields', t0.type === 'buy' && t0.category === 'crypto' && t0.symbol === 'BITCOIN' && approx(t0.quantity, 0.5) && approx(t0.price, 45000) && t0.date === '2024-01-15' && approx(t0.fees, 10));

  const cat = run('type,category,symbol,quantity,price,date\nbuy,stocks,SAP.DE,2,180,2025-03-05\nsell,crypto,ETH,1,2400,2025-03-06');
  ok('the category column is used per row', cat.transactions.length === 2 && cat.transactions[0].category === 'stocks' && cat.transactions[1].category === 'crypto' && cat.transactions[1].type === 'sell');

  const noCat = run('Date,Type,Symbol,Quantity,Price\n2025-03-05,buy,SAP.DE,2,180', { category: 'stocks' });
  ok('without a category column the default category applies', noCat.transactions[0].category === 'stocks');
  const badCat = run('type,category,symbol,quantity,price,date\nbuy,whatever,SAP.DE,2,180,2025-03-05', { category: 'crypto' });
  ok('an unknown category falls back to the default', badCat.transactions[0].category === 'crypto');

  const de = run('Datum;Typ;Symbol;Anzahl;Kurs;Gebühr\n05.03.2025;Kauf;SAP.DE;2;180,50;1,00');
  ok('German semicolon CSV with comma decimals', de.transactions.length === 1 && de.transactions[0].date === '2025-03-05' && approx(de.transactions[0].price, 180.5) && approx(de.transactions[0].fees, 1));

  const mixed = run('type,symbol,quantity,price,date\nbuy,BTC,1,100,2025-01-01\nbuy,,1,100,2025-01-02\nTransfer,ETH,1,100,2025-01-03');
  ok('bad rows are reported with their row number, good rows kept', mixed.transactions.length === 1 && mixed.errors.length === 2 && mixed.errors[0].row === 2 && /symbol/.test(mixed.errors[0].reason) && mixed.errors[1].row === 3 && /Transfer/.test(mixed.errors[1].reason));

  const notes = run('type,symbol,quantity,price,date,notes\nbuy,BTC,1,100,2025-01-01,from Kraken');
  ok('a notes column is kept', notes.transactions[0].notes === 'from Kraken');

  const empty = run('type,symbol,quantity,price,date');
  ok('header without rows → one explanatory error', empty.transactions.length === 0 && empty.errors.length === 1);

  // ---- UX-002: confirm before a pasted full backup is restored --------------
  console.log('UX-002 backup restore confirmation');
  const B = require('../backup-engine.js');
  const bk = { format: 'maermin-full', version: '10.0.0', timestamp: '2026-06-20T08:00:00.000Z',
    store: { transactions: JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]), theme: '"dark"', apiKeys: 'x', unknown_key: 'y' } };
  const sum = typeof B.summary === 'function' ? B.summary(bk) : null;
  ok('summary reports date, transaction count and restorable keys', !!sum && sum.timestamp === '2026-06-20T08:00:00.000Z' && sum.transactionCount === 3 && sum.keyCount === 2);
  const sumBad = typeof B.summary === 'function' ? B.summary({ store: { transactions: 'not json' } }) : null;
  ok('unreadable transactions → count null, no throw', !!sumBad && sumBad.transactionCount === null && sumBad.timestamp === null);

  // ---- UX-005: name the missing required fields ------------------------------
  console.log('UX-005 missing transaction fields');
  const U = require('../utils.js');
  const miss = (tx, sym) => (typeof U.missingTxFields === 'function' ? U.missingTxFields(tx, sym) : null);
  ok('missingTxFields exists', typeof U.missingTxFields === 'function');
  ok('empty form → symbol, quantity, price (in form order)', JSON.stringify(miss({ symbol: '', quantity: '', price: '' })) === '["symbol","quantity","price"]');
  ok('only the price missing', JSON.stringify(miss({ symbol: 'BTC', quantity: '1', price: '' })) === '["price"]');
  ok('whitespace-only symbol counts as missing', JSON.stringify(miss({ symbol: '  ', quantity: '1', price: '5' })) === '["symbol"]');
  ok('a derived symbol (options) is used instead of tx.symbol', JSON.stringify(miss({ symbol: '', quantity: '1', price: '5' }, 'AAPL 2026-12-18 C 150')) === '[]');
  ok('complete form → nothing missing', JSON.stringify(miss({ symbol: 'BTC', quantity: '0.5', price: '45000' })) === '[]');

  // ---- UX-006: is the transaction form dirty? --------------------------------
  console.log('UX-006 dirty form');
  const fc = (a, b) => (typeof U.formChanged === 'function' ? U.formChanged(a, b) : null);
  const blank = { type: 'buy', symbol: '', quantity: '', price: '', notes: '' };
  ok('formChanged exists', typeof U.formChanged === 'function');
  ok('unchanged form → false', fc(blank, Object.assign({}, blank)) === false);
  ok('a typed quantity → true', fc(blank, Object.assign({}, blank, { quantity: '5' })) === true);
  ok('switching buy → sell → true', fc(blank, Object.assign({}, blank, { type: 'sell' })) === true);
  ok('key order does not matter', fc({ a: '1', b: '2' }, { b: '2', a: '1' }) === false);
  ok('a field added empty (undefined vs "") is not a change', fc(blank, Object.assign({}, blank, { underlying: '' })) === false);
  ok('numbers vs the same text are not a change', fc({ quantity: '2' }, { quantity: 2 }) === false);

  const UI = require('../ui-store.js');
  const hasConfirm = typeof UI.confirm === 'function' && typeof UI.answerConfirm === 'function';
  ok('MaerminUI.confirm / answerConfirm exist', hasConfirm);
  if (hasConfirm) {
    return (async () => {
      const p1 = UI.confirm({ title: 'Restore backup?', message: 'Replaces data', confirmLabel: 'Restore', danger: true });
      const st = UI.confirmState.getState();
      ok('opening sets the dialog state', st.open === true && st.title === 'Restore backup?' && st.confirmLabel === 'Restore' && st.danger === true);
      UI.answerConfirm(true);
      ok('confirming resolves true and closes', (await p1) === true && UI.confirmState.getState().open === false);
      const p2 = UI.confirm({ title: 'Again?' });
      UI.answerConfirm(false);
      ok('cancelling resolves false', (await p2) === false);
      const p3 = UI.confirm({ title: 'First' });
      const p4 = UI.confirm({ title: 'Second' });
      ok('a second confirm cancels the first', (await p3) === false && UI.confirmState.getState().title === 'Second');
      UI.answerConfirm(true);
      ok('... and the second still works', (await p4) === true);
      finish();
    })();
  }
  finish();

  function finish() {
    console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
  }
})();
