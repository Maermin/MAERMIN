// Node harness for the import preprocessing layer (window.MaerminImportMapping):
// broker detection, locale-aware number/date parsing, column mapping, row-level
// errors and duplicate detection. Run: node test/import-mapping.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name)); }
function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }

const M = require('../import-mapping.js');

(function run() {
  console.log('locale-aware number parsing:');
  ok('DE "1.234,56" → 1234.56', near(M.parseNumber('1.234,56'), 1234.56));
  ok('US "1,234.56" → 1234.56', near(M.parseNumber('1,234.56'), 1234.56));
  ok('plain "0.25" → 0.25', near(M.parseNumber('0.25'), 0.25));
  ok('DE decimal "1,5" → 1.5', near(M.parseNumber('1,5'), 1.5));
  ok('currency noise "€ 1.200,00" → 1200', near(M.parseNumber('€ 1.200,00'), 1200));
  ok('accounting "(123,45)" → -123.45', near(M.parseNumber('(123,45)'), -123.45));
  ok('locale=de "1.234" → 1234 (thousands)', near(M.parseNumber('1.234', 'de'), 1234));
  ok('empty → NaN', Number.isNaN(M.parseNumber('')));

  console.log('date parsing → ISO:');
  ok('ISO passthrough', M.parseDate('2024-03-10') === '2024-03-10');
  ok('DE DD.MM.YYYY', M.parseDate('10.03.2024') === '2024-03-10');
  ok('EU D/M/Y default day-first', M.parseDate('10/03/2024') === '2024-03-10');
  ok('US M/D/Y with locale', M.parseDate('03/10/2024', 'us') === '2024-03-10');
  ok('unambiguous day>12', M.parseDate('13/02/2024') === '2024-02-13');
  ok('datetime with time part', M.parseDate('2024-03-10 14:30:00') === '2024-03-10');
  ok('garbage → null', M.parseDate('not a date') === null);

  console.log('broker auto-detection:');
  ok('Trade Republic by ISIN+type', (M.detectBroker(['Date', 'Type', 'ISIN', 'Shares', 'Price']) || {}).id === 'traderepublic');
  ok('Kraken by pair+vol', (M.detectBroker(['txid', 'ordertxid', 'pair', 'time', 'type', 'price', 'cost', 'fee', 'vol']) || {}).id === 'kraken');
  ok('Coinbase by asset', (M.detectBroker(['Timestamp', 'Transaction Type', 'Asset', 'Quantity Transacted', 'Spot Price at Transaction', 'Fees']) || {}).id === 'coinbase');
  ok('unknown headers → null', M.detectBroker(['foo', 'bar', 'baz']) === null);

  console.log('mapping suggestion + apply with row errors:');
  const headers = ['Date', 'Type', 'Symbol', 'Quantity', 'Price', 'Fee', 'Currency'];
  const mapping = M.suggestMapping(headers);
  ok('maps each logical field', mapping.date === 'Date' && mapping.symbol === 'Symbol' && mapping.quantity === 'Quantity' && mapping.fee === 'Fee');
  const rows = [
    { Date: '10.03.2024', Type: 'Kauf', Symbol: 'aapl', Quantity: '12', Price: '1.234,56', Fee: '1,00', Currency: 'usd' },
    { Date: '', Type: 'buy', Symbol: 'BTC', Quantity: '1', Price: '50000', Fee: '', Currency: 'EUR' },   // missing date
    { Date: '11.03.2024', Type: 'Verkauf', Symbol: '', Quantity: '2', Price: '10', Fee: '', Currency: 'EUR' } // missing symbol
  ];
  const applied = M.applyMapping(rows, mapping, { category: 'stocks', locale: 'de' });
  ok('one valid row produced', applied.transactions.length === 1);
  ok('two rows rejected', applied.errors.length === 2);
  ok('error row numbers are 1-based', applied.errors[0].row === 2 && applied.errors[1].row === 3);
  ok('error states the reason', /date/.test(applied.errors[0].reason) && /symbol/.test(applied.errors[1].reason));
  const tx = applied.transactions[0];
  ok('type normalised (Kauf→buy)', tx.type === 'buy');
  ok('symbol uppercased', tx.symbol === 'AAPL');
  ok('DE price parsed', near(tx.price, 1234.56));
  ok('currency normalised to 3-letter upper', tx.currency === 'USD');

  console.log('duplicate detection:');
  const existing = [{ date: '2024-03-10', type: 'buy', symbol: 'AAPL', quantity: 12, price: 1234.56 }];
  const cand = [
    { date: '2024-03-10', type: 'buy', symbol: 'AAPL', quantity: 12, price: 1234.56 }, // dup
    { date: '2024-03-11', type: 'buy', symbol: 'AAPL', quantity: 5, price: 100 }        // new
  ];
  const dd = M.findDuplicates(cand, existing);
  ok('flags the duplicate', dd.duplicates.length === 1 && dd.marked[0].duplicate === true);
  ok('keeps the unique one', dd.unique.length === 1 && dd.unique[0].duplicate === false);

  console.log('full preview → commit pipeline:');
  const csv = 'Date;Type;ISIN;Shares;Price;Fee;Currency\n10.03.2024;Kauf;US0378331005;12;1.234,56;1,00;USD\n10.03.2024;Kauf;US0378331005;12;1.234,56;1,00;USD';
  const prev = M.preview(csv, { locale: 'de', existing: [] });
  ok('detected Trade Republic from ISIN', prev.broker && prev.broker.id === 'traderepublic');
  ok('preview parsed 2 rows', prev.transactions.length === 2);
  ok('second identical row flagged as in-batch duplicate', prev.transactions[1].duplicate === true);
  const committed = M.commit(prev);
  ok('commit excludes duplicates by default', committed.transactions.length === 1 && committed.skipped === 1);
  ok('committed tx has no duplicate flag', !('duplicate' in committed.transactions[0]));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
