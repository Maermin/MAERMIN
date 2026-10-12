// Node harness for the Portfolio Performance and Parqet import (P4-8).
// Layouts: PP from its exporter source (CSVExporter.java), Parqet from a
// published export header. All figures below are made up.
// Run: node test/tracker-import.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail ? ' — ' + detail : ''))); }
const near = (a, b) => Math.abs(a - b) < 1e-6;

let TI = null;
try { TI = require('../tracker-import.js'); } catch (e) { /* missing before P4-8 */ }
const M = require('../import-mapping.js');
const L = require('../ledger.js');
const R = require('../tax-report-builder.js');

ok('tracker-import.js exists', !!TI);
if (!TI) { console.log('\n' + passed + ' passed, ' + (failed) + ' failed'); process.exit(1); }

// ── Portfolio Performance, German program language: ';' and "1.234,56" ──────
const PP_DE = [
  'Datum;Typ;Wert;Buchungswährung;Bruttobetrag;Währung Bruttobetrag;Wechselkurs;Gebühren;Steuern;Stück;ISIN;WKN;Ticker-Symbol;Wertpapiername;Notiz',
  '2024-01-15T00:00;Einlage;5.000,00;EUR;;;;;;;;;;;',
  '2024-01-16T09:30;Kauf;-1.004,99;EUR;;;;4,99;;10;IE00B4L5Y983;A0RPWH;EUNL.DE;iShares Core MSCI World;Sparplan',
  '2024-02-01T10:00;Kauf;-2.112,40;EUR;2.300,00;USD;1,0900;1,00;;12,5;US0378331005;865985;AAPL;Apple Inc.;',
  '2024-03-15T00:00;Dividende;8,50;EUR;11,55;USD;1,0870;;1,59;5;US0378331005;865985;AAPL;Apple Inc.;',
  '2024-04-10T00:00;Dividende;20,00;EUR;;;;;5,28;8;DE0007164600;716460;SAP.DE;SAP SE;',
  '2024-06-03T14:00;Verkauf;520,00;EUR;;;;5,00;15,00;5;IE00B4L5Y983;A0RPWH;EUNL.DE;iShares Core MSCI World;',
  '2024-06-30T00:00;Zinsen;3,21;EUR;;;;;;;;;;;',
  '2024-07-01T00:00;Einlieferung;1.500,00;EUR;;;;;;3;DE0007164600;716460;SAP.DE;SAP SE;Depotwechsel',
  '2024-07-02T00:00;Auslieferung;400,00;EUR;;;;;;1;DE0007164600;716460;SAP.DE;SAP SE;',
  '2024-07-03T00:00;Umbuchung (Ausgang);-100,00;EUR;;;;;;;;;;;'
].join('\r\n');

console.log('Portfolio Performance (German):');
const de = TI.parse(PP_DE);
const byDate = (r, d) => r.transactions.find(t => t.date === d);
ok('detected as PP in German', TI.detect(M.parseCSV(PP_DE).headers).id === 'pp' && de.format === 'pp');
const b1 = byDate(de, '2024-01-16');
ok('purchase: Value includes the fee → price (1,004.99 − 4.99) / 10 = 100, fee 4.99', b1 && b1.type === 'buy' && near(b1.price, 100) && near(b1.fees, 4.99) && b1.quantity === 10 && b1.symbol === 'IE00B4L5Y983' && b1.currency === 'EUR', JSON.stringify(b1));
const b2 = byDate(de, '2024-02-01');
ok('fractional shares "12,5" and thousands "2.112,40" read in the German locale', b2 && b2.quantity === 12.5 && near(b2.price, (2112.40 - 1) / 12.5) && b2.currency === 'EUR', JSON.stringify(b2));
const d1 = byDate(de, '2024-03-15');
ok('foreign dividend: gross = net 8.50 + taxes 1.59 = 10.09 (quantity × price), withholding 1.59', d1 && d1.type === 'dividend' && near(d1.quantity * d1.price, 10.09) && near(d1.withholdingTax, 1.59) && d1.quantity === 5, JSON.stringify(d1));
const d2 = byDate(de, '2024-04-10');
ok('German dividend: taxes are domestic tax, not foreign withholding (note only)', d2 && near(d2.quantity * d2.price, 25.28) && d2.withholdingTax === 0 && /5.28/.test(d2.notes), JSON.stringify(d2));
const s1 = byDate(de, '2024-06-03');
ok('sale: gross = 520 + 5 fee + 15 tax = 540 → price 108; tax not in the fees', s1 && s1.type === 'sell' && near(s1.price, 108) && near(s1.fees, 5) && /15/.test(s1.notes), JSON.stringify(s1));
const in1 = byDate(de, '2024-07-01');
ok('inbound delivery booked as a purchase at its value', in1 && in1.type === 'buy' && near(in1.price, 500) && in1.quantity === 3 && /Einlieferung/.test(in1.notes));
// P5-1.3: the deposit is booked as a cash row; interest on cash (until the
// clearing account, P5-1.4), outbound delivery and the transfer (the file does
// not say which portfolio it went to) stay listed.
const dep = byDate(de, '2024-01-15');
ok('P5-1.3: "Einlage" becomes a deposit of 5,000 EUR (cash row, no security)', dep && dep.type === 'deposit' && dep.category === 'cashflow' && dep.amount === 5000 && dep.currency === 'EUR' && !dep.symbol, JSON.stringify(dep));
ok('interest, outbound delivery and transfer are listed, not booked', de.errors.length === 3 && de.transactions.length === 7 && de.stats.total === 10, JSON.stringify(de.errors.map(e => e.reason)));
ok('every skipped row names its reason', de.errors.every(e => e.row > 0 && e.reason.length > 10));
ok('a warning explains the withholding assumption', de.warnings.length === 1);

// P5-1.3: every PP cash type
const PP_CASH = [
  'Date,Type,Value,Transaction Currency,Gross Amount,Currency Gross Amount,Exchange Rate,Fees,Taxes,Shares,ISIN,WKN,Ticker Symbol,Security Name,Note',
  '2024-02-01T00:00,Deposit,"1,000.00",EUR,,,,,,,,,,,',
  '2024-02-02T00:00,Removal,-200.00,EUR,,,,,,,,,,,',
  '2024-02-03T00:00,Fees,-4.90,EUR,,,,,,,,,,,Depot fee',
  '2024-02-04T00:00,Fees Refund,2.00,EUR,,,,,,,,,,,',
  '2024-02-05T00:00,Taxes,-12.30,EUR,,,,,,,IE00B4L5Y983,,,iShares Core MSCI World,Vorabpauschale',
  '2024-02-06T00:00,Tax Refund,7.10,USD,,,,,,,,,,,',
  '2024-02-07T00:00,Interest Charge,-1.15,EUR,,,,,,,,,,,',
  '2024-02-08T00:00,Interest,0.80,EUR,,,,,,,,,,,',
  '2024-02-09T00:00,Transfer (Outbound),-50.00,EUR,,,,,,,,,,,',
  '2024-02-10T00:00,Fees,0.00,EUR,,,,,,,,,,,'
].join('\n');
const pc5 = TI.parse(PP_CASH);
const typeOn = (d) => (byDate(pc5, d) || {}).type, amtOn = (d) => (byDate(pc5, d) || {}).amount;
ok('P5-1.3 PP: deposit, removal, fees, fee refund, taxes, tax refund, interest charge', typeOn('2024-02-01') === 'deposit' && typeOn('2024-02-02') === 'withdrawal' && typeOn('2024-02-03') === 'fee'
  && typeOn('2024-02-04') === 'fee_refund' && typeOn('2024-02-05') === 'tax' && typeOn('2024-02-06') === 'tax_refund' && typeOn('2024-02-07') === 'interest_charge', JSON.stringify(pc5.transactions.map(t => t.type)));
ok('P5-1.3 PP: amounts are positive, the sign is in the type', amtOn('2024-02-01') === 1000 && amtOn('2024-02-02') === 200 && amtOn('2024-02-03') === 4.9 && amtOn('2024-02-07') === 1.15);
ok('P5-1.3 PP: currency kept (USD tax refund)', byDate(pc5, '2024-02-06').currency === 'USD');
const taxRow = byDate(pc5, '2024-02-05');
ok('P5-1.3 PP: a tax on a security keeps the security in the note only (no symbol, no position)', !taxRow.symbol && /iShares Core MSCI World/.test(taxRow.notes) && /Vorabpauschale/.test(taxRow.notes));
ok('P5-1.3 PP: interest on cash and the transfer stay listed with a reason; a zero fee is invalid', pc5.errors.length === 3 && pc5.transactions.length === 7, JSON.stringify(pc5.errors.map(e => e.reason)));
ok('P5-1.3 PP: every cash row is a valid ledger cash row', pc5.transactions.every(t => require('../ledger.js').validateCash(t).length === 0));

// ── Portfolio Performance, English: ',' delimiter, "1,004.99" quoted ──────────
const PP_EN = [
  'Date,Type,Value,Transaction Currency,Gross Amount,Currency Gross Amount,Exchange Rate,Fees,Taxes,Shares,ISIN,WKN,Ticker Symbol,Security Name,Note',
  '2024-01-16T09:30,Buy,"-1,004.99",EUR,,,,4.99,,10,IE00B4L5Y983,A0RPWH,EUNL.DE,"iShares Core MSCI World, Acc",',
  '2024-03-15T00:00,Dividend,8.50,EUR,11.55,USD,1.0870,,1.59,5,US0378331005,865985,AAPL,Apple Inc.,',
  '2024-05-01T00:00,Buy,250.00,EUR,,,,,,,,,BTC-EUR,Bitcoin,'
].join('\n');
console.log('Portfolio Performance (English):');
const en = TI.parse(PP_EN);
const e1 = byDate(en, '2024-01-16');
ok('English layout: same purchase as in German', e1 && near(e1.price, 100) && near(e1.fees, 4.99) && e1.symbolName === 'iShares Core MSCI World, Acc', JSON.stringify(e1));
ok('a purchase without shares is rejected, not guessed', en.errors.length === 1 && /shares/.test(en.errors[0].reason));
ok('ticker used when there is no ISIN', TI.parse(PP_EN.replace('2024-05-01T00:00,Buy,250.00,EUR,,,,,,,,,BTC-EUR', '2024-05-01T00:00,Buy,250.00,EUR,,,,,,0.01,,,BTC-EUR')).transactions.some(t => t.symbol === 'BTC-EUR' && near(t.price, 25000)));

console.log('Portfolio Performance (other language):');
const fr = TI.parse('Date;Type;Valeur;Devise;Montant brut;Devise montant brut;Taux de change;Frais;Impôts;Parts;ISIN;WKN;Symbole;Nom;Note\n2024-01-16T09:30;Achat;-1 004,99;EUR;;;;4,99;;10;IE00B4L5Y983;;;;');
ok('recognised, nothing booked, the fix is named', fr.transactions.length === 0 && fr.errors.length === 1 && /English|German/.test(fr.errors[0].reason));

// ── Parqet ────────────────────────────────────────────────────────────────────
const PQ = [
  'datetime;date;time;price;shares;amount;tax;fee;realizedgains;type;broker;assettype;identifier;wkn;originalcurrency;currency;fxrate;holding;holdingname;holdingnickname;exchange;avgholdingperiod',
  '2024-01-04T23:30:00.000Z;05.01.2024;00:30:00;100.5;10;1005;0;1;;Buy;demo;Security;US0378331005;865985;;EUR;;;Apple Inc.;;;',
  '2024-02-15T10:00:00.000Z;15.02.2024;11:00:00;0.25;10;2.5;0.38;0;;Dividend;demo;Security;US0378331005;865985;;EUR;;;Apple Inc.;;;',
  '2024-03-01T09:00:00.000Z;01.03.2024;10:00:00;40000;0.05;2000;0;2;;Buy;demo;Crypto;BTC;;;EUR;;;Bitcoin;;;',
  '2024-04-01T09:00:00.000Z;01.04.2024;11:00:00;110;4;440;12;1;38;Sell;demo;Security;US0378331005;865985;;EUR;;;Apple Inc.;;;12000000',
  '2024-04-02T09:00:00.000Z;02.04.2024;11:00:00;1;500;500;0;0;;Deposit;demo;Cash;;;;EUR;;;;;;',
  '2024-04-05T09:00:00.000Z;05.04.2024;11:00:00;1;80;80;0;0;;Withdrawal;demo;Cash;;;;EUR;;;;;;',
  '2024-04-06T09:00:00.000Z;06.04.2024;11:00:00;;;0;0;3.5;;Fee;demo;Cash;;;;EUR;;;;;;',
  '2024-04-07T09:00:00.000Z;07.04.2024;11:00:00;;;0;6.2;0;;Tax;demo;Cash;;;;EUR;;;;;;',
  '2024-04-08T09:00:00.000Z;08.04.2024;11:00:00;1;1.5;1.5;0;0;;FeeRefund;demo;Cash;;;;EUR;;;;;;',
  '2024-04-09T09:00:00.000Z;09.04.2024;11:00:00;1;2.5;2.5;0;0;;TaxRefund;demo;Cash;;;;EUR;;;;;;',
  '2024-04-03T09:00:00.000Z;03.04.2024;11:00:00;1;1;1;0;0;;Split;demo;Security;US0378331005;;;EUR;;;;;;'
].join('\n');
console.log('Parqet:');
const pq = TI.parse(PQ);
ok('detected as Parqet', TI.detect(M.parseCSV(PQ).headers).id === 'parqet' && pq.format === 'parqet');
const p1 = byDate(pq, '2024-01-05');
ok('local "date" column used, not the UTC datetime (which is the day before)', !!p1 && !byDate(pq, '2024-01-04'));
ok('purchase: price 100.5 × 10, fee 1', p1 && p1.type === 'buy' && near(p1.price, 100.5) && p1.quantity === 10 && near(p1.fees, 1) && p1.symbol === 'US0378331005');
const pd = byDate(pq, '2024-02-15');
ok('dividend: amount is gross, tax → withholding', pd && pd.type === 'dividend' && near(pd.quantity * pd.price, 2.5) && near(pd.withholdingTax, 0.38));
const pc = byDate(pq, '2024-03-01');
ok('crypto: CoinGecko id, crypto category', pc && pc.category === 'crypto' && pc.symbol === 'bitcoin' && near(pc.price, 40000));
const ps = byDate(pq, '2024-04-01');
ok('sale: tax stays out of the fees; realised gains ignored (recomputed by FIFO)', ps && ps.type === 'sell' && near(ps.fees, 1) && near(ps.price, 110) && /12/.test(ps.notes));
const pqT = (d) => byDate(pq, d) || {};
ok('P5-1.3 Parqet: deposit and withdrawal from "amount"', pqT('2024-04-02').type === 'deposit' && pqT('2024-04-02').amount === 500 && pqT('2024-04-05').type === 'withdrawal' && pqT('2024-04-05').amount === 80);
ok('P5-1.3 Parqet: a fee or tax with no amount takes the fee / tax column', pqT('2024-04-06').type === 'fee' && pqT('2024-04-06').amount === 3.5 && pqT('2024-04-07').type === 'tax' && pqT('2024-04-07').amount === 6.2);
ok('P5-1.3 Parqet: refunds', pqT('2024-04-08').type === 'fee_refund' && pqT('2024-04-09').type === 'tax_refund' && pqT('2024-04-09').amount === 2.5);
ok('unknown type listed, not booked', pq.errors.length === 1 && /Split/.test(pq.errors[0].reason), JSON.stringify(pq.errors.map(e => e.reason)));

// ── Wizard pipeline (import-mapping preview) ─────────────────────────────────
console.log('wizard preview:');
const prev = M.preview(PP_DE, { broker: 'degiro', existing: [] });
ok('exact PP header wins over a picked broker; fixed format, no column mapping', prev.fixedFormat && prev.format === 'pp' && prev.broker.name === 'Portfolio Performance' && prev.transactions.length === 7);
const again = M.preview(PP_DE, { existing: M.commit(prev).transactions });
ok('re-importing the same file marks every row as a duplicate (cash rows too)', again.duplicates === 7, String(again.duplicates));
const cashA = { type: 'deposit', category: 'cashflow', amount: 100, currency: 'EUR', date: '2024-01-01' };
ok('P5-1.3: two deposits on one day with different amounts are not duplicates', M.findDuplicates([Object.assign({}, cashA, { amount: 200 })], [cashA]).duplicates.length === 0);
ok('P5-1.3: the same deposit again is a duplicate', M.findDuplicates([Object.assign({}, cashA)], [cashA]).duplicates.length === 1);
ok('ISINs go to the existing ISIN → ticker step', M.collectIsins(prev.transactions).length === 3);
const quick = M.quickCSV(PQ, {});
ok('quick import reads Parqet too (4 trades, 6 cash rows)', quick.transactions.length === 10, String(quick.transactions.length));

// ── Money: what the tax report and the ledger make of it ─────────────────────
console.log('money:');
{
  const txs = M.commit(M.preview(PP_DE, { existing: [] })).transactions.map((t, i) => Object.assign({ id: 't' + i }, t));
  const rep = R.build(txs, { year: 2024, exchangeRate: 1, baseCurrency: 'EUR', dividendEvents: [] });
  const dv = rep.dividends.find(d => d.date === '2024-03-15');
  ok('tax report: dividend gross 10.09, withholding 1.59', dv && near(dv.gross, 10.09) && near(dv.withholding, 1.59), JSON.stringify(dv));
  const led = L.build(txs, { exchangeRate: 1 });
  const sale = led.groups['stocks|IE00B4L5Y983'] ? { gain: led.groups['stocks|IE00B4L5Y983'].realizedGain } : null;
  ok('ledger: sale gain = 5 × 108 − 5 fee − cost 5 × 100.499 = 32.505', !!sale && near(sale.gain, 540 - 5 - 502.495), sale ? JSON.stringify(sale) : Object.keys(led).join(','));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
