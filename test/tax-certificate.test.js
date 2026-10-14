// Node harness for P5-4.7, the Jahressteuerbescheinigung reconciliation:
// parse the bank's annual tax certificate (BMF template labels), compute
// MAERMIN's figures for the bank's portfolios with the same report, and diff
// them line by line. Storage of saved certificates included.
// Run: node test/tax-certificate.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info) : '')); }
}
function approx(a, b) { return Math.abs(a - b) < 1e-6; }

const _store = {};
globalThis.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: (k) => { delete _store[k]; }
};

const GT = require('../tax-calculation-engine.js').GermanTax;
const REPORT = require('../tax-report-builder.js');
const TC = require('../tax-certificate.js');

// A made-up certificate in the layout of the official template (text as
// pdf.js extracts it: label and amount on one line or on the next).
const CERT = [
  'Musterbank AG · Postfach 1 · 10000 Berlin',
  'Jahressteuerbescheinigung 2025',
  'Steuerbescheinigung für Privatkunden für das Kalenderjahr 2025',
  'Höhe der Kapitalerträge EUR 1.400,00',
  'Zeile 7 Anlage KAP',
  'Gewinn aus Aktienveräußerungen im Sinne des § 20 Abs. 2 Satz 1 Nr. 1 Satz 1 EStG',
  'EUR 300,00',
  'Ersatzbemessungsgrundlage im Sinne des § 43a Abs. 2 Satz 7, 10, 13 und 14 EStG EUR 0,00',
  'Nicht ausgeglichener Verlust ohne Verlust aus der Veräußerung von Aktien EUR 0,00',
  'Nicht ausgeglichener Verlust aus der Veräußerung von Aktien EUR 0,00',
  'In Anspruch genommener Sparer-Pauschbetrag EUR 1.000,00',
  'Kapitalertragsteuer EUR 100,00',
  'Solidaritätszuschlag EUR 5,50',
  'Kirchensteuer zur Kapitalertragsteuer EUR 0,00',
  'Summe der angerechneten ausländischen Steuer EUR 0,00',
  'Summe der anrechenbaren noch nicht angerechneten ausländischen Steuer EUR 12,34'
].join('\n');

(function main() {
  console.log('tax-certificate:');

  // ---- parse -----------------------------------------------------------------
  let p = TC.parse(CERT);
  ok('year from the certificate', p.year === 2025, p.year);
  ok('Höhe der Kapitalerträge 1,400.00', approx(p.values.capitalIncome, 1400), p.values);
  ok('share gains on the next line (300.00)', approx(p.values.shareGains, 300));
  ok('loss lines kept apart (without shares / from shares)', approx(p.values.lossOther, 0) && approx(p.values.lossShares, 0));
  ok('Sparer-Pauschbetrag used 1,000.00', approx(p.values.spb, 1000));
  ok('Kapitalertragsteuer 100.00, not the church-tax line', approx(p.values.kest, 100) && approx(p.values.kist, 0));
  ok('Soli 5.50', approx(p.values.soli, 5.5));
  ok('credited foreign tax 0.00, not the "not yet credited" line (12.34)', approx(p.values.foreignTax, 0), p.values.foreignTax);
  ok('Ersatzbemessungsgrundlage read', approx(p.values.ersatz, 0));
  p = TC.parse('Jahressteuerbescheinigung 2024\nNicht ausgeglichener Verlust aus der Veräußerung von Aktien\n1.234,56 EUR\nKapitalertragsteuer 0,00 EUR');
  ok('amount after the label with EUR behind it; a missing line stays undefined', approx(p.values.lossShares, 1234.56) && p.values.capitalIncome === undefined && p.year === 2024, p);
  ok('found lists the lines read', TC.parse(CERT).found.length === 10, TC.parse(CERT).found);
  ok('not a certificate: nothing found', TC.parse('Kontoauszug 3/2025\nSaldo 100,00').found.length === 0);

  // ---- MAERMIN's figures for the bank's portfolios ---------------------------
  // Portfolio A (the bank): share gain 500, share loss 200, equity fund gain
  // 1,000 (700 after 30 %), dividend 300, interest 100. Portfolio B (another
  // bank): a big gain that must stay out.
  const T = (o) => Object.assign({ category: 'stocks', currency: 'EUR', portfolioId: 'A' }, o);
  const txs = [
    T({ type: 'buy', symbol: 'AAA', quantity: 10, price: 100, date: '2024-01-10' }),
    T({ type: 'sell', symbol: 'AAA', quantity: 10, price: 150, date: '2025-03-10' }),
    T({ type: 'buy', symbol: 'BBB', quantity: 10, price: 100, date: '2024-01-10' }),
    T({ type: 'sell', symbol: 'BBB', quantity: 10, price: 80, date: '2025-04-10' }),
    T({ type: 'buy', symbol: 'FUND', quantity: 10, price: 100, date: '2024-01-10' }),
    T({ type: 'sell', symbol: 'FUND', quantity: 10, price: 200, date: '2025-05-10' }),
    T({ type: 'dividend', symbol: 'AAA', quantity: 1, price: 300, date: '2025-06-10' }),
    { type: 'interest', category: 'cash', symbol: 'Bank', amount: 100, currency: 'EUR', date: '2025-07-01', portfolioId: 'A' },
    T({ type: 'buy', symbol: 'ZZZ', quantity: 10, price: 100, date: '2024-01-10', portfolioId: 'B' }),
    T({ type: 'sell', symbol: 'ZZZ', quantity: 10, price: 900, date: '2025-05-10', portfolioId: 'B' })
  ];
  const opts = { jurisdiction: 'de', baseCurrency: 'EUR', exchangeRate: 1, germanTax: GT, dividendEvents: [],
    taxSettings: { abgeltungRate: 0.25, soli: true, kirchensteuer: 0, freistellungsauftrag: 1000, cryptoExemption: true },
    taxOverrides: {}, vapRecords: {}, fundTypes: { FUND: 'aktienfonds' }, isFund: (s) => s === 'FUND' };
  const cert = { year: 2025, bank: 'Musterbank', portfolioIds: ['A'], allowance: 1000, values: TC.parse(CERT).values };
  const fig = TC.maerminFigures(txs, cert, opts, { build: REPORT.build });
  ok('MAERMIN: capital income 1,400 (300 shares net + 700 fund + 300 dividend + 100 interest), portfolio B left out', approx(fig.capitalIncome, 1400), fig);
  ok('MAERMIN: share gains net 300, no losses left', approx(fig.shareGains, 300) && approx(fig.lossShares, 0) && approx(fig.lossOther, 0), fig);
  ok('MAERMIN: allowance 1,000 used, KapESt 100, Soli 5.50', approx(fig.spb, 1000) && approx(fig.kest, 100) && approx(fig.soli, 5.5), fig);
  ok('MAERMIN has no Ersatzbemessungsgrundlage', fig.ersatz === null);

  // A share loss larger than the share gains stays in the share pot.
  const lossy = txs.concat([T({ type: 'buy', symbol: 'CCC', quantity: 10, price: 100, date: '2024-01-10' }), T({ type: 'sell', symbol: 'CCC', quantity: 10, price: 40, date: '2025-08-10' })]);
  const fig2 = TC.maerminFigures(lossy, cert, opts, { build: REPORT.build });
  ok('share losses 800 against gains 500: no share gain, 300 share loss not offset', approx(fig2.shareGains, 0) && approx(fig2.lossShares, 300), fig2);
  ok('the allowance follows the bank\'s order (500)', approx(TC.maerminFigures(txs, Object.assign({}, cert, { allowance: 500 }), opts, { build: REPORT.build }).spb, 500));

  // ---- reconcile ---------------------------------------------------------------
  let rec = TC.reconcile(cert.values, fig);
  ok('every line matches', rec.rows.every((r) => r.status === 'match' || r.status === 'info') && rec.differences === 0, rec.rows.filter((r) => r.status !== 'match'));
  ok('Ersatzbemessungsgrundlage is an info line (no MAERMIN value)', rec.rows.find((r) => r.key === 'ersatz').status === 'info');
  rec = TC.reconcile(Object.assign({}, cert.values, { kest: 112.4 }), fig);
  const k = rec.rows.find((r) => r.key === 'kest');
  ok('a different KapESt: diff 12.40, status differs', k.status === 'differs' && approx(k.diff, 12.4) && rec.differences === 1, k);
  rec = TC.reconcile(Object.assign({}, cert.values, { soli: 6.2 }), fig);
  ok('within 1 EUR counts as a match (rounding)', rec.rows.find((r) => r.key === 'soli').status === 'match');
  rec = TC.reconcile({ kest: 100 }, fig);
  ok('lines not on the certificate: status missing', rec.rows.find((r) => r.key === 'capitalIncome').status === 'missing');

  // ---- storage -------------------------------------------------------------------
  let st = TC.normalize(null);
  ok('empty state', st.version === 1 && st.certs.length === 0);
  st = TC.upsert(st, { year: 2025, bank: 'Musterbank', portfolioIds: ['A'], allowance: 1000, values: { kest: 100, bogus: 5, soli: 'x' }, source: 'pdf' });
  const saved = st.certs[0];
  ok('upsert gives an id and keeps only known numeric values', !!saved.id && saved.values.kest === 100 && !('bogus' in saved.values) && !('soli' in saved.values), saved);
  st = TC.upsert(st, Object.assign({}, saved, { bank: 'Musterbank AG' }));
  ok('upsert with the id replaces', st.certs.length === 1 && st.certs[0].bank === 'Musterbank AG');
  TC.save(st);
  ok('saved under maermin_tax_certs', JSON.parse(_store.maermin_tax_certs).certs.length === 1 && TC.load().certs[0].bank === 'Musterbank AG');
  ok('forYear lists the year\'s certificates', TC.forYear(TC.load(), 2025).length === 1 && TC.forYear(TC.load(), 2024).length === 0);
  st = TC.remove(TC.load(), saved.id);
  ok('remove', st.certs.length === 0);

  // ---- wiring -----------------------------------------------------------------------
  const storage = require('fs').readFileSync(require('path').join(__dirname, '..', 'storage.js'), 'utf8');
  const backup = require('fs').readFileSync(require('path').join(__dirname, '..', 'backup-engine.js'), 'utf8');
  ok('maermin_tax_certs is encrypted (SENSITIVE_KEYS) and in the backup', /'maermin_tax_certs'/.test(storage) && /'maermin_tax_certs'/.test(backup));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
