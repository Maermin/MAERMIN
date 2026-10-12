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

  console.log('broker auto-detection — added DACH brokers:');
  ok('Trading 212 by no. of shares', (M.detectBroker(['Action', 'Time', 'ISIN', 'Ticker', 'Name', 'No. of shares', 'Price / share', 'Currency (Price / share)']) || {}).id === 'trading212');
  ok('Revolut by ticker+price per share', (M.detectBroker(['Date', 'Ticker', 'Type', 'Quantity', 'Price per share', 'Currency', 'Fee']) || {}).id === 'revolut');
  ok('flatex by isin+buchtag', (M.detectBroker(['Buchtag', 'Valuta', 'Stück', 'ISIN', 'Kurs', 'Provision', 'Währung']) || {}).id === 'flatex');
  ok('Consorsbank by isin+wertpapierbezeichnung', (M.detectBroker(['Buchungstag', 'Wertpapierbezeichnung', 'ISIN', 'Nominal', 'Ausführungskurs', 'Provision']) || {}).id === 'consorsbank');
  ok('Bitpanda by asset+fee asset', (M.detectBroker(['Transaction ID', 'Timestamp', 'Transaction Type', 'Asset', 'Amount Asset', 'Fiat', 'Fee', 'Fee asset']) || {}).id === 'bitpanda');
  // regression: the new ISIN-based brokers must NOT steal a plain Trade Republic file
  ok('Trade Republic still wins its own file', (M.detectBroker(['Date', 'Type', 'ISIN', 'Shares', 'Price', 'Fee', 'Currency']) || {}).id === 'traderepublic');
  // a Trading 212 mapping resolves its quirky columns
  const t212map = M.suggestMapping(['Action', 'Time', 'ISIN', 'Ticker', 'No. of shares', 'Price / share', 'Currency (Price / share)'], 'trading212');
  ok('Trading 212 maps No. of shares → quantity', t212map.quantity === 'No. of shares' && t212map.price === 'Price / share');

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

  // P5-1.3: cash words book cash rows only when the row names no security.
  {
    const csv = ['Date,Type,Symbol,Amount,Price,Currency',
      '2026-01-02,Deposit,,1000,,EUR',
      '2026-01-03,Einzahlung,BTC,0.5,40000,EUR',
      '2026-01-04,Gebühr,,4.5,,EUR',
      '2026-01-05,Steuer,,-12,,EUR',
      '2026-01-06,Auszahlung,,200,,USD',
      '2026-01-07,Withdrawal,ETH,1,3000,EUR',
      '2026-01-08,Deposit,,0,,EUR'].join('\n');
    const q = M.quickCSV(csv, { category: 'crypto' });
    const on = (d) => q.transactions.find((x) => x.date === d) || {};
    ok('P5-1.3: a deposit without a security is a cash deposit', on('2026-01-02').type === 'deposit' && on('2026-01-02').amount === 1000 && on('2026-01-02').category === 'cashflow' && !on('2026-01-02').symbol);
    ok('P5-1.3: a deposit WITH a coin stays a buy (coin transfer-in, as before)', on('2026-01-03').type === 'buy' && on('2026-01-03').symbol);
    ok('P5-1.3: fee and tax rows (German words, negative sign) become cash rows', on('2026-01-04').type === 'fee' && on('2026-01-04').amount === 4.5 && on('2026-01-05').type === 'tax' && on('2026-01-05').amount === 12);
    ok('P5-1.3: withdrawal without a security keeps its currency', on('2026-01-06').type === 'withdrawal' && on('2026-01-06').currency === 'USD');
    ok('P5-1.3: a withdrawal WITH a coin stays a sell', on('2026-01-07').type === 'sell');
    ok('P5-1.3: a zero cash amount is an error, not a row', !q.transactions.some((x) => x.date === '2026-01-08') && q.errors.length === 1);
    ok('P5-1.3: an unknown type without a symbol is still "symbol missing"', M.quickCSV('Date,Type,Symbol,Amount,Price\n2026-01-09,Split,,1,1').errors.length === 1);

    // Round trip through MAERMIN's own CSV export (spreadsheet, not the full backup)
    const IE = require('../import-export-engine.js');
    const own = [
      { id: 'a', type: 'fee_refund', category: 'cashflow', amount: 2.5, currency: 'EUR', date: '2026-02-01' },
      { id: 'b', type: 'interest_charge', category: 'cashflow', amount: 1.2, currency: 'USD', date: '2026-02-02' },
      { id: 'c', type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 2, price: 100, fees: 1, currency: 'EUR', date: '2026-02-03' }];
    const out = IE.exportToCSV(own);
    ok('P5-1.3: the export writes the cash amount as the total', /"fee_refund".*"2\.50"/.test(out) && /"interest_charge".*"-1\.20"/.test(out), out);
    const back = M.quickCSV(out, { category: 'stocks' });
    const bt = (d) => back.transactions.find((x) => x.date === d) || {};
    ok('P5-1.3: cash rows come back with type and amount', bt('2026-02-01').type === 'fee_refund' && bt('2026-02-01').amount === 2.5 && bt('2026-02-02').type === 'interest_charge' && bt('2026-02-02').amount === 1.2 && bt('2026-02-02').currency === 'USD', JSON.stringify(back));
    ok('P5-1.3: the trade comes back unchanged', bt('2026-02-03').type === 'buy' && bt('2026-02-03').quantity === 2 && bt('2026-02-03').price === 100);
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
