// Node harness for P5-5.3: budget and spending. Bank CSV exports (Sparkasse
// CSV-CAMT, ING, DKB, N26 / generic), FinTS / GoCardless rows, categories with
// rules, splits, monthly budgets, the cash-flow Sankey and recurring payments.
// A separate ledger: grocery bookings never touch the portfolio transactions.
// Run: node test/budget.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info).slice(0, 500) : '')); }
}
const approx = (a, b) => Math.abs(a - b) < 1e-6;
const _store = {};
globalThis.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null),
  setItem: (k, v) => { _store[k] = String(v); },
  removeItem: (k) => { delete _store[k]; }
};
const B = require('../budget.js');

const SPARKASSE = [
  '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Glaeubiger ID";"Mandatsreferenz";"Kundenreferenz (End-to-End)";"Sammlerreferenz";"Lastschrift Ursprungsbetrag";"Auslagenersatz Ruecklastschrift";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"',
  '"DE00123";"01.10.26";"01.10.26";"LOHN / GEHALT";"Gehalt Oktober";"";"";"";"";"";"";"Muster GmbH";"DE11";"XYZ";"3.250,00";"EUR";"Umsatz gebucht"',
  '"DE00123";"02.10.26";"02.10.26";"FOLGELASTSCHRIFT";"Miete Oktober Whg 3";"";"";"";"";"";"";"Hausverwaltung Klein";"DE22";"XYZ";"-950,00";"EUR";"Umsatz gebucht"',
  '"DE00123";"03.10.26";"03.10.26";"KARTENZAHLUNG";"REWE SAGT DANKE 1234";"";"";"";"";"";"";"REWE Markt GmbH";"DE33";"XYZ";"-45,30";"EUR";"Umsatz gebucht"',
  '"DE00123";"05.10.26";"05.10.26";"LASTSCHRIFT";"Netflix.com";"";"";"";"";"";"";"NETFLIX INTERNATIONAL B.V.";"DE44";"XYZ";"-13,99";"EUR";"Umsatz vorgemerkt"'
].join('\r\n');
const ING = [
  'Umsatzanzeige;Datei erstellt am: 15.10.2026 10:00',
  '',
  'IBAN;DE12 5001 0517 0000 0000 00',
  'Kontoname;Girokonto',
  'Bank;ING',
  'Kunde;Max Muster',
  'Zeitraum;01.10.2026 - 15.10.2026',
  'Saldo;1.234,56;EUR',
  '',
  'Sortierung;Datum absteigend',
  '',
  'Buchung;Valuta;Auftraggeber/Empfänger;Buchungstext;Verwendungszweck;Saldo;Währung;Betrag;Währung',
  '07.10.2026;07.10.2026;ALDI SUED;Lastschrift;ALDI SAGT DANKE;1.234,56;EUR;-23,10;EUR',
  '06.10.2026;06.10.2026;Deutsche Bahn;Lastschrift;Ticket 123;1.257,66;EUR;-1.099,00;EUR'
].join('\n');
const DKB = [
  '"Konto";"Girokonto DE00 1203 0000 0000 0000 00"',
  '""',
  '"Kontostand vom 15.10.2026:";"2.000,00 €"',
  '""',
  '"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"',
  '"08.10.26";"08.10.26";"Gebucht";"Max Muster";"Stadtwerke Musterstadt";"Abschlag Strom 10/2026";"Ausgang";"DE55";"-85,00";"";"";""',
  '"09.10.26";"09.10.26";"Gebucht";"Erika Muster";"Max Muster";"Geld zurueck";"Eingang";"DE66";"20,00";"";"";""'
].join('\n');
const N26 = [
  '"Date","Payee","Account number","Transaction type","Payment reference","Amount (EUR)","Amount (Foreign Currency)","Type Foreign Currency","Exchange Rate"',
  '"2026-10-10","Spotify","","MasterCard Payment","","-10.99","","",""',
  '"2026-10-11","Trade Republic","DE77","Outgoing Transfer","Sparplan","-500.0","","",""'
].join('\n');

(function main() {
  console.log('budget:');

  // ---- CSV formats ----------------------------------------------------------------
  let p = B.parseCsv(SPARKASSE);
  ok('Sparkasse CSV-CAMT: 4 rows, DD.MM.YY dates, German amounts, payee and purpose', p.rows.length === 4 && p.rows[0].date === '2026-10-01' && approx(p.rows[0].amount, 3250) && approx(p.rows[2].amount, -45.3)
    && p.rows[2].name === 'REWE Markt GmbH' && /REWE SAGT DANKE/.test(p.rows[2].purpose) && p.format === 'sparkasse', p);
  p = B.parseCsv(ING);
  ok('ING: preamble skipped, the amount (not the balance) column, 1.099,00', p.rows.length === 2 && approx(p.rows[1].amount, -1099) && p.rows[0].name === 'ALDI SUED' && p.rows[0].date === '2026-10-07' && p.format === 'ing', p);
  p = B.parseCsv(DKB);
  ok('DKB: the counterparty by direction (recipient for an outflow, payer for an inflow)', p.rows.length === 2 && p.rows[0].name === 'Stadtwerke Musterstadt' && p.rows[1].name === 'Erika Muster' && approx(p.rows[1].amount, 20), p);
  p = B.parseCsv(N26);
  ok('N26 / generic: comma CSV, ISO dates, dot decimals', p.rows.length === 2 && approx(p.rows[0].amount, -10.99) && p.rows[0].date === '2026-10-10' && p.rows[1].purpose === 'Sparplan', p);
  ok('not a bank export: no rows and a reason', B.parseCsv('a,b\n1,2').rows.length === 0 && !!B.parseCsv('a,b\n1,2').error);

  // ---- ingest and categories ------------------------------------------------------------
  let st = B.normalize(null);
  ok('default categories: income, expenses, savings and transfers', ['salary', 'groceries', 'housing', 'subscriptions', 'savings', 'transfer', 'uncategorized'].every((id) => st.categories.some((c) => c.id === id)));
  let r = B.ingest(st, B.parseCsv(SPARKASSE).rows, { source: 'csv', account: 'Giro' });
  st = r.state;
  ok('ingest: 4 new', r.added === 4 && st.txs.length === 4);
  r = B.ingest(st, B.parseCsv(SPARKASSE).rows, { source: 'csv', account: 'Giro' });
  ok('the same export again adds nothing', r.added === 0 && r.state.txs.length === 4);
  st = B.ingest(st, B.parseCsv(ING).rows, { source: 'csv', account: 'ING' }).state;
  st = B.ingest(st, B.parseCsv(DKB).rows, { source: 'csv', account: 'DKB' }).state;
  st = B.ingest(st, B.parseCsv(N26).rows, { source: 'csv', account: 'N26' }).state;
  const cat = (re) => B.categoryOf(st, st.txs.find((t) => re.test(t.name + ' ' + t.purpose)));
  ok('built-in rules: salary, rent, groceries (REWE, ALDI), subscriptions, utilities, transport', cat(/Gehalt/) === 'salary' && cat(/Miete/) === 'housing' && cat(/REWE/) === 'groceries' && cat(/ALDI/) === 'groceries'
    && cat(/Netflix/) === 'subscriptions' && cat(/Spotify/) === 'subscriptions' && cat(/Stadtwerke/) === 'utilities' && cat(/Deutsche Bahn/) === 'transport', st.txs.map((t) => [t.name, B.categoryOf(st, t)]));
  ok('a broker transfer is saving, not spending', cat(/Trade Republic/) === 'savings');
  ok('unknown outflow: uncategorized; unknown inflow: other income', cat(/Erika/) === 'other-income');

  // User rule wins over the built-ins; a manual category wins over every rule.
  st = B.addRule(st, { field: 'any', contains: 'deutsche bahn', category: 'travel' });
  ok('a user rule wins over the built-in rules', cat(/Deutsche Bahn/) === 'travel');
  const rewe = st.txs.find((t) => /REWE/.test(t.name));
  st = B.setCategory(st, rewe.id, 'restaurants');
  ok('a category set by hand wins over every rule', B.categoryOf(st, st.txs.find((t) => t.id === rewe.id)) === 'restaurants');

  // ---- splits -------------------------------------------------------------------------------
  const aldi = st.txs.find((t) => /ALDI/.test(t.name));
  st = B.setSplits(st, aldi.id, [{ category: 'groceries', amount: -18.1 }, { category: 'household', amount: -5 }]);
  let m = B.monthSummary(st, '2026-10');
  const g = (id) => (m.byCategory.find((c) => c.id === id) || { spent: 0 }).spent;
  ok('a split books each part to its category', approx(g('household'), 5) && approx(g('groceries'), 18.1), m.byCategory);
  let bad = st;
  try { bad = B.setSplits(st, aldi.id, [{ category: 'groceries', amount: -10 }]); } catch (e) { bad = null; }
  ok('splits must add up to the amount', bad === null);

  // ---- month summary ------------------------------------------------------------------------
  ok('income: salary 3,250 + 20 back = 3,270', approx(m.income, 3270), m);
  const expenses = 950 + 45.3 + 13.99 + 23.1 + 1099 + 85 + 10.99;
  ok('expenses: everything going out except savings and transfers', approx(m.expenses, expenses), m.expenses);
  ok('savings 500 and the savings rate (income - expenses) / income', approx(m.savings, 500) && approx(m.savingsRate, (3270 - expenses) / 3270), m);
  st = B.setBudget(st, 'groceries', 300);
  st = B.setBudget(st, 'subscriptions', 20);
  m = B.monthSummary(st, '2026-10');
  const sub = m.byCategory.find((c) => c.id === 'subscriptions');
  ok('budget per month: subscriptions 24.98 of 20, over by 4.98', approx(sub.spent, 24.98) && sub.budget === 20 && approx(sub.remaining, -4.98) && sub.over === true, sub);
  ok('a month without bookings is empty', B.monthSummary(st, '2026-09').expenses === 0);

  // ---- Sankey -------------------------------------------------------------------------------
  const sk = B.sankey(m);
  const flow = (from, to) => (sk.links.find((l) => l.source === from && l.target === to) || { value: 0 }).value;
  ok('Sankey: income sources → budget → expense categories, savings and the rest', approx(flow('salary', 'budget'), 3250) && approx(flow('budget', 'housing'), 950) && approx(flow('budget', 'savings'), 500) && sk.nodes.some((n) => n.id === 'budget'), sk);
  ok('Sankey balances: what flows in flows out (incl. the unspent rest or the deficit)', approx(sk.links.filter((l) => l.target === 'budget').reduce((s, l) => s + l.value, 0), sk.links.filter((l) => l.source === 'budget').reduce((s, l) => s + l.value, 0)));

  // ---- recurring payments ------------------------------------------------------------------------
  let rec = B.normalize(null);
  const mk = (d, amt, name, purpose) => ({ date: d, amount: amt, name, purpose: purpose || '', currency: 'EUR' });
  rec = B.ingest(rec, [
    mk('2026-07-05', -13.99, 'NETFLIX INTERNATIONAL B.V.'), mk('2026-08-05', -13.99, 'Netflix International BV'), mk('2026-09-05', -13.99, 'NETFLIX INTERNATIONAL B.V.'),
    mk('2026-07-01', -950, 'Hausverwaltung Klein', 'Miete'), mk('2026-08-01', -950, 'Hausverwaltung Klein', 'Miete'), mk('2026-09-01', -950, 'Hausverwaltung Klein', 'Miete'), mk('2026-10-01', -950, 'Hausverwaltung Klein', 'Miete'),
    mk('2025-03-15', -89, 'HUK-COBURG', 'Kfz-Versicherung'), mk('2026-03-15', -94, 'HUK-COBURG', 'Kfz-Versicherung'),
    mk('2026-08-12', -45, 'REWE'), mk('2026-09-03', -61, 'REWE'), mk('2026-09-28', -38, 'REWE')
  ], { source: 'csv', account: 'Giro' }).state;
  const rr = B.recurring(rec, { today: '2026-10-14' });
  const find = (re) => rr.find((x) => re.test(x.name));
  ok('recurring: Netflix monthly (names normalised), next on 5 October... after the last, 2026-10-05', find(/netflix/i) && find(/netflix/i).cadence === 'monthly' && find(/netflix/i).next === '2026-10-05' && approx(find(/netflix/i).monthlyCost, 13.99), rr);
  ok('rent monthly 950, next 2026-11-01', find(/Hausverwaltung/) && find(/Hausverwaltung/).next === '2026-11-01' && approx(find(/Hausverwaltung/).amount, 950));
  ok('car insurance yearly (89 → 94 within 10 %), monthly cost 94 / 12', find(/HUK/) && find(/HUK/).cadence === 'yearly' && approx(find(/HUK/).monthlyCost, 94 / 12) && find(/HUK/).next === '2027-03-15', find(/HUK/));
  ok('grocery shopping at irregular amounts and days is not recurring', !find(/REWE/));
  ok('total of the recurring payments per month', approx(B.recurringMonthly(rr), 13.99 + 950 + 94 / 12));

  // ---- storage ----------------------------------------------------------------------------------
  B.save(st);
  const back = B.load();
  ok('saved and loaded: transactions, rules, budgets, splits', back.txs.length === st.txs.length && back.rules.length === 1 && back.budgets.groceries === 300 && back.txs.find((t) => t.id === aldi.id).splits.length === 2);
  const fs = require('fs'), path = require('path');
  const storage = fs.readFileSync(path.join(__dirname, '..', 'storage.js'), 'utf8');
  const backup = fs.readFileSync(path.join(__dirname, '..', 'backup-engine.js'), 'utf8');
  ok('maermin_budget is encrypted, synced and in the backup', /'maermin_budget'/.test(storage) && /'maermin_budget'/.test(backup));

  // ---- FinTS / GoCardless rows -------------------------------------------------------------------
  const fromBank = B.fromBankRows({ iban: 'DE99', currency: 'EUR' }, [{ date: '2026-10-12', amount: -30, name: 'Shell', purpose: 'Tankstelle', bookingText: 'Kartenzahlung' }, { id: 'gc-1', date: '2026-10-13', amount: -5, name: 'Bakery', purpose: '' }]);
  ok('bank rows (FinTS, GoCardless) map to budget rows with their ids', fromBank.length === 2 && fromBank[0].account === 'DE99' && fromBank[1].externalId === 'gc-1', fromBank);
  let s2 = B.ingest(B.normalize(null), fromBank, { source: 'fints' }).state;
  s2 = B.ingest(s2, fromBank, { source: 'fints' }).state;
  ok('a repeat bank sync adds nothing twice; Shell is transport', s2.txs.length === 2 && B.categoryOf(s2, s2.txs.find((t) => t.name === 'Shell')) === 'transport');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
