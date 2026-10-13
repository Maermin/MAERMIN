// Node harness for P5-3.2: PDF importers batch A (flatex, Consorsbank,
// DEGIRO, onvista bank) - buy, sell, dividend, tax and fee documents, taxes
// withheld on dividends and sales, several entries per PDF, and the round trip
// through MaerminImportMapping.preview. Fixtures are MADE UP from public
// layouts (no real statements, no binary PDFs in the repo).
// Run: node test/pdf-import-batch-a.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : '')); }
}
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 1e-6); }

const P = require('../pdf-import.js');
const IM = require('../import-mapping.js');

// ---- flatex ------------------------------------------------------------------
const FLATEX_BUY = [
  'flatexDEGIRO Bank AG · www.flatex.de',
  'Wertpapierabrechnung Kauf',
  'Nr.123456789 iShares Core DAX UCITS ETF (DE0005933931/593393)',
  'Ausgeführt : 12 St. Kurswert : 1.674,24 EUR',
  'Kurs : 139,52 EUR Provision : 5,90 EUR',
  'Schlusstag : 04.02.2025 Fremde Spesen : 0,00 EUR',
  'Valuta : 06.02.2025 Endbetrag : -1.680,14 EUR'
].join('\n');

const FLATEX_SELL = [
  'flatexDEGIRO Bank AG · www.flatex.de',
  'Wertpapierabrechnung Verkauf',
  'Nr.987654321 Apple Inc. (US0378331005/865985)',
  'Ausgeführt : 5 St. Kurswert : 1.050,00 EUR',
  'Kurs : 210,00 EUR Provision : 5,90 EUR',
  'Schlusstag : 10.03.2025',
  'Bemessungsgrundlage : 180,80 EUR',
  'Kapitalertragsteuer : -45,20 EUR',
  'Solidaritätszuschlag : -2,48 EUR',
  'Kirchensteuer : 0,00 EUR',
  'Endbetrag : 996,42 EUR'
].join('\n');

// ---- Consorsbank -------------------------------------------------------------
const CONSORS_DIVIDEND = [
  'Consorsbank · BNP Paribas S.A. Niederlassung Deutschland',
  'Dividendengutschrift',
  'Bestand 20 Stück MICROSOFT CORP. US5949181045 (870747)',
  'Dividende pro Stück 0,83 USD',
  'Brutto in USD 16,60 USD',
  'Devisenkurs EUR / USD 1,0800',
  'Quellensteuer 15 % USD 2,49 USD',
  'anrechenbare Quellensteuer 15 % EUR 2,31 EUR',
  'Kapitalertragsteuer 25 % auf 9,99 EUR EUR 2,50 EUR',
  'Solidaritätszuschlag 5,5 % auf 2,50 EUR EUR 0,13 EUR',
  'Zahltag 13.06.2025',
  'Netto zugunsten 10,51 EUR'
].join('\n');

const CONSORS_FEE = [
  'Consorsbank',
  'Rechnung Depotentgelt',
  'Abrechnungszeitraum 01.10.2025 - 31.12.2025',
  'Datum 05.01.2026',
  'Depotentgelt EUR 4,50',
  'Umsatzsteuer 19 % EUR 0,86',
  'Rechnungsbetrag EUR 5,36'
].join('\n');

// ---- onvista bank --------------------------------------------------------------
const ONVISTA_BUY = [
  'onvista bank · Wildunger Straße 6a · 60487 Frankfurt am Main',
  'Wertpapierabrechnung Kauf Aktien',
  'Handelstag 21.01.2025 Handelszeit 15:30',
  'Gattungsbezeichnung ISIN',
  'SAP SE Inhaber-Aktien o.N. DE0007164600',
  'STK 8,000 EUR 230,15',
  'Kurswert EUR 1.841,20',
  'Orderprovision EUR 1,00',
  'Börsengebühr EUR 1,50',
  'Betrag zu Ihren Lasten EUR 1.843,70'
].join('\n');

const ONVISTA_TAX_REFUND = [
  'onvista bank',
  'Steuerausgleich nach § 43a Abs. 3 EStG',
  'Datum 30.12.2025',
  'Erstattung Kapitalertragsteuer EUR 30,00',
  'Erstattung Solidaritätszuschlag EUR 1,65',
  'Betrag zu Ihren Gunsten EUR 31,65'
].join('\n');

const ONVISTA_VORAB = [
  'onvista bank',
  'Steuerpflichtige Vorabpauschale',
  'Bestand 40 Stück iShares Core MSCI World IE00B4L5Y983',
  'Vorabpauschale pro Stück 1,20 EUR',
  'Datum 02.01.2025',
  'Kapitalertragsteuer EUR 8,40',
  'Solidaritätszuschlag EUR 0,46',
  'Betrag zu Ihren Lasten EUR 8,86'
].join('\n');

// ---- DEGIRO ------------------------------------------------------------------
const DEGIRO_TX = [
  'flatexDEGIRO Bank AG · www.degiro.de',
  'Transaktionsübersicht 01-01-2025 - 31-03-2025',
  'Datum Uhrzeit Produkt ISIN Referenzbörse Ausführungsort Anzahl Kurs Wert in Lokalwährung Wert Wechselkurs Transaktionskosten Gesamt',
  '15-01-2025 09:05 VANGUARD FTSE ALL-WORLD UCITS ETF IE00BK5BQT80 XET XETA 5 118,20 EUR -591,00 EUR -591,00 EUR -1,00 EUR -592,00 EUR',
  '03-02-2025 15:41 APPLE INC. - COMMON ST US0378331005 NDQ XNAS 3 230,50 USD -691,60 USD -665,00 EUR 1,0400 -2,00 EUR -667,00 EUR',
  '20-03-2025 10:12 VANGUARD FTSE ALL-WORLD UCITS ETF IE00BK5BQT80 XET XETA -2 121,00 EUR 242,00 EUR 242,00 EUR 242,00 EUR'
].join('\n');

const DEGIRO_ACCOUNT = [
  'flatexDEGIRO Bank AG · www.degiro.de',
  'Kontoauszug 01-01-2025 - 31-12-2025',
  'Datum Uhrzeit Valutadatum Produkt ISIN Beschreibung FX Änderung Saldo',
  '02-01-2025 08:00 01-01-2025 DEGIRO Gebühr für Börsenverbindung 2025 (Xetra) EUR -2,50 EUR 497,50',
  '15-01-2025 09:05 15-01-2025 VANGUARD FTSE ALL-WORLD UCITS ETF IE00BK5BQT80 Kauf 5 zu je 118,2 EUR EUR -591,00 EUR -93,50',
  '01-07-2025 07:30 30-06-2025 COCA-COLA CO US1912161007 Dividende USD 38,80 USD 38,80',
  '01-07-2025 07:30 30-06-2025 COCA-COLA CO US1912161007 Dividendensteuer USD -5,82 USD 32,98'
].join('\n');

(function run() {
  console.log('pdf-import batch A (P5-3.2):');

  // ---- detection ----------------------------------------------------------------
  const id = (t) => (P.detectBrokerFromText(t) || {}).id;
  ok('detects flatex (flatexDEGIRO letterhead + flatex.de)', id(FLATEX_BUY) === 'flatex', id(FLATEX_BUY));
  ok('detects DEGIRO (flatexDEGIRO letterhead + degiro.de)', id(DEGIRO_TX) === 'degiro', id(DEGIRO_TX));
  ok('only the shared letterhead: a DEGIRO table means DEGIRO', id('flatexDEGIRO Bank AG\nTransaktionsübersicht') === 'degiro');
  ok('only the shared letterhead: a settlement means flatex', id('flatexDEGIRO Bank AG\nWertpapierabrechnung Kauf') === 'flatex');
  ok('detects Consorsbank', id(CONSORS_DIVIDEND) === 'consorsbank');
  ok('detects onvista bank', id(ONVISTA_BUY) === 'onvista');
  ok('the five earlier brokers are still listed', ['traderepublic', 'scalable', 'ing', 'dkb', 'comdirect'].every((b) => P.PDF_BROKERS.some((x) => x.id === b)));

  // ---- flatex buy ---------------------------------------------------------------
  const fb = P.parseText(FLATEX_BUY);
  const fbc = fb.candidates[0];
  ok('flatex buy: one candidate', fb.candidates.length === 1, fb);
  ok('flatex buy: ISIN, buy, 12 shares ("12 St.")', fbc && fbc.symbol === 'DE0005933931' && fbc.type === 'buy' && approx(fbc.quantity, 12), fbc);
  ok('flatex buy: price from "Kurs", not "Kurswert"', fbc && approx(fbc.price, 139.52), fbc && fbc.price);
  ok('flatex buy: Provision as fee', fbc && approx(fbc.fees, 5.9), fbc && fbc.fees);
  ok('flatex buy: Schlusstag, not Valuta', fbc && fbc.date === '2025-02-04', fbc && fbc.date);
  ok('flatex buy: name without the order number', fbc && fbc.symbolName === 'iShares Core DAX UCITS ETF', fbc && fbc.symbolName);
  ok('flatex buy: no tax row', fb.candidates.every((c) => c.type !== 'tax'));

  // ---- flatex sell with tax -------------------------------------------------------
  const fs = P.parseText(FLATEX_SELL);
  const fsSell = fs.candidates.find((c) => c.type === 'sell');
  const fsTax = fs.candidates.find((c) => c.type === 'tax');
  ok('flatex sell: the sale', fsSell && fsSell.symbol === 'US0378331005' && approx(fsSell.quantity, 5) && approx(fsSell.price, 210), fsSell);
  ok('flatex sell: taxes withheld become one tax row (45,20 + 2,48; not the Bemessungsgrundlage)', fsTax && approx(fsTax.amount, 47.68) && fsTax.category === 'cashflow', fsTax);
  ok('flatex sell: the tax row has the trade date and currency', fsTax && fsTax.date === '2025-03-10' && fsTax.currency === 'EUR', fsTax);

  // ---- Consorsbank dividend -----------------------------------------------------------
  const cd = P.parseText(CONSORS_DIVIDEND);
  const cdc = cd.candidates[0];
  ok('Consors dividend: one candidate, dividend', cd.candidates.length === 1 && cdc.type === 'dividend', cd);
  ok('Consors dividend: 20 shares at 0,83 USD ("pro Stück")', approx(cdc.quantity, 20) && approx(cdc.price, 0.83) && cdc.currency === 'USD', cdc);
  // 2,49 USD + (2,50 + 0,13) EUR × 1,08 = 2,49 + 2,8404 USD; anrechenbare QSt is information only
  ok('Consors dividend: withholding = foreign + German taxes, EUR taxes converted at the Devisenkurs', approx(cdc.withholdingTax, 5.3304), cdc.withholdingTax);
  ok('Consors dividend: Zahltag', cdc.date === '2025-06-13', cdc.date);
  ok('Consors dividend: name after "Bestand 20 Stück"', cdc.symbolName === 'MICROSOFT CORP.', cdc.symbolName);
  const noRate = P.parseText(CONSORS_DIVIDEND.replace('Devisenkurs EUR / USD 1,0800\n', ''));
  ok('without a Devisenkurs the EUR taxes are not guessed and the gap is reported', approx(noRate.candidates[0].withholdingTax, 2.49) && noRate.errors.some((e) => /exchange rate/i.test(e)), noRate);

  // ---- Consorsbank fee document ----------------------------------------------------------
  const cf = P.parseText(CONSORS_FEE);
  ok('Consors fee: one fee row of the invoice total', cf.candidates.length === 1 && cf.candidates[0].type === 'fee' && approx(cf.candidates[0].amount, 5.36), cf);
  ok('Consors fee: the document date, not the period start', cf.candidates[0] && cf.candidates[0].date === '2026-01-05', cf.candidates[0]);

  // ---- onvista ---------------------------------------------------------------------------
  const ob = P.parseText(ONVISTA_BUY);
  const obc = ob.candidates[0];
  ok('onvista buy: "STK 8,000 EUR 230,15"', obc && approx(obc.quantity, 8) && approx(obc.price, 230.15) && obc.currency === 'EUR', obc);
  ok('onvista buy: fees with the currency in front (1,00 + 1,50)', obc && approx(obc.fees, 2.5), obc && obc.fees);
  ok('onvista buy: Handelstag and name', obc && obc.date === '2025-01-21' && obc.symbolName === 'SAP SE Inhaber-Aktien o.N.', obc);
  const ot = P.parseText(ONVISTA_TAX_REFUND);
  ok('onvista Steuerausgleich: one tax refund of 31,65', ot.candidates.length === 1 && ot.candidates[0].type === 'tax_refund' && approx(ot.candidates[0].amount, 31.65), ot);
  ok('onvista Steuerausgleich: dated', ot.candidates[0] && ot.candidates[0].date === '2025-12-30');
  const ov = P.parseText(ONVISTA_VORAB);
  ok('onvista Vorabpauschale: a tax row of 8,86, no buy', ov.candidates.length === 1 && ov.candidates[0].type === 'tax' && approx(ov.candidates[0].amount, 8.86), ov);

  // ---- several settlements in one PDF -------------------------------------------------------
  const two = P.parseText(FLATEX_BUY + '\n\n' + FLATEX_SELL.split('\n').slice(1).join('\n'));
  ok('two settlements in one PDF -> both trades and the tax row', two.candidates.filter((c) => c.type === 'buy').length === 1 && two.candidates.filter((c) => c.type === 'sell').length === 1 && two.candidates.filter((c) => c.type === 'tax').length === 1, two.candidates.map((c) => c.type));

  // ---- DEGIRO Transaktionsübersicht ---------------------------------------------------------
  const dt = P.parseText(DEGIRO_TX);
  ok('DEGIRO table: one entry per row (3)', dt.candidates.length === 3, dt);
  const [d1, d2, d3] = dt.candidates;
  ok('DEGIRO row 1: buy 5 at 118,20 EUR, costs 1,00', d1 && d1.type === 'buy' && d1.symbol === 'IE00BK5BQT80' && approx(d1.quantity, 5) && approx(d1.price, 118.2) && approx(d1.fees, 1) && d1.date === '2025-01-15', d1);
  ok('DEGIRO row 2: USD trade, EUR costs converted to USD (2,00 × 1,04)', d2 && d2.currency === 'USD' && approx(d2.price, 230.5) && approx(d2.fees, 2.08), d2);
  ok('DEGIRO row 3: a negative quantity is a sale without costs', d3 && d3.type === 'sell' && approx(d3.quantity, 2) && approx(d3.fees, 0) && d3.date === '2025-03-20', d3);
  ok('DEGIRO row names', d1 && d1.symbolName === 'VANGUARD FTSE ALL-WORLD UCITS ETF', d1 && d1.symbolName);

  // ---- DEGIRO Kontoauszug --------------------------------------------------------------------
  const da = P.parseText(DEGIRO_ACCOUNT);
  const fee = da.candidates.find((c) => c.type === 'fee');
  const div = da.candidates.find((c) => c.type === 'dividend');
  ok('DEGIRO account: the connection fee as a fee row', fee && approx(fee.amount, 2.5) && fee.date === '2025-01-02' && fee.currency === 'EUR', fee);
  ok('DEGIRO account: the dividend with its Dividendensteuer as withholding', div && div.symbol === 'US1912161007' && approx(div.quantity * div.price, 38.8) && approx(div.withholdingTax, 5.82) && div.currency === 'USD' && div.date === '2025-07-01', div);
  ok('DEGIRO account: trades are left to the Transaktionsübersicht (no buy, said so)', !da.candidates.some((c) => c.type === 'buy') && da.errors.some((e) => /Transaktions/i.test(e)), da.errors);
  ok('DEGIRO account: the missing share count is said, not hidden', da.errors.some((e) => /share count/i.test(e)), da.errors);

  // ---- round trip through the existing mapping flow ------------------------------------------
  const all = [].concat(fs.candidates, cd.candidates, cf.candidates, ot.candidates);
  const csv = P.candidatesToCSV(all);
  const prev = IM.preview(csv, { existing: [] });
  ok('preview: every row imports without errors', prev.stats.ok === all.length && prev.errors.length === 0, { stats: prev.stats, errors: prev.errors });
  const byType = (t) => prev.transactions.find((x) => x.type === t);
  ok('preview: the tax row is a cash booking of 47,68', byType('tax') && byType('tax').category === 'cashflow' && approx(byType('tax').amount, 47.68), byType('tax'));
  ok('preview: the dividend keeps its withholding tax', byType('dividend') && approx(byType('dividend').withholdingTax, 5.3304), byType('dividend'));
  ok('preview: fee and tax refund rows', byType('fee') && approx(byType('fee').amount, 5.36) && byType('tax_refund') && approx(byType('tax_refund').amount, 31.65));
  ok('preview: the sale is unchanged', byType('sell') && approx(byType('sell').price, 210) && approx(byType('sell').quantity, 5) && approx(byType('sell').fees, 5.9));
  ok('withholding on a non-dividend row is ignored', IM.preview('Date;Type;Symbol;Quantity;Price;Fee;Currency;WithholdingTax\n2025-01-02;buy;DE0007164600;1;100;0;EUR;5', {}).transactions[0].withholdingTax === undefined);

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
