// Node harness for the PDF statement-import pure layer: broker detection,
// the generic German settlement parser against frozen TEXT fixtures (one per
// supported broker layout - no binary PDFs in the repo), the CSV serialisation
// into the existing mapping flow, and the round trip through
// MaerminImportMapping.preview. pdf.js extraction is browser-only.
// Run: node test/pdf-import.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 1e-9); }

const P = require('../pdf-import.js');
const IM = require('../import-mapping.js');

// ---- frozen text fixtures (as the line-reconstructing extractor emits them) --
const TRADE_REPUBLIC_BUY = [
  'TRADE REPUBLIC BANK GMBH',
  'WERTPAPIERABRECHNUNG SPARPLANAUSFUEHRUNG',
  'Market-Order Kauf am 02.05.2024, um 10:15 Uhr an der Lang & Schwarz Exchange.',
  'POSITION ANZAHL KURS BETRAG',
  'iShares Core MSCI World UCITS ETF USD (Acc)',
  'ISIN: IE00B4L5Y983 2 Stk. 80,46 EUR 160,92 EUR',
  'Fremdkostenzuschlag -1,00 EUR',
  'GESAMT 161,92 EUR'
].join('\n');

const SCALABLE_SELL = [
  'Scalable Capital GmbH',
  'Wertpapierabrechnung: Verkauf',
  'Stück 10 VANGUARD FTSE ALL-WORLD U.ETF IE00BK5BQT80 (A2PKXG)',
  'Ausführungskurs 95,50 EUR Auftragsart Market-Order',
  'Ausführungstag 03.01.2025 Ausführungszeit 09:04:11',
  'Provision 0,99 EUR',
  'Ausmachender Betrag 954,01 EUR'
].join('\n');

const ING_BUY = [
  'ING-DiBa AG Wertpapierabrechnung',
  'Wertpapierbezeichnung iShares STOXX Europe 600 UCITS ETF (DE)',
  'ISIN (WKN) DE0002635307 (263530)',
  'Nominale Stück 25,00',
  'Kurs 45,1200 EUR',
  'Handelstag / -zeit 15.03.2025 um 11:22:33 Uhr',
  'Provision 4,90 EUR',
  'Endbetrag zu Ihren Lasten 1.132,90 EUR'
].join('\n');

const DKB_DIVIDEND = [
  'Deutsche Kreditbank AG',
  'Dividendengutschrift',
  'Stück 80 COCA-COLA CO. US1912161007 (850663)',
  'Dividende je Stück 0,485 USD',
  'Bruttobetrag 38,80 USD',
  'Zahlbarkeitstag 01.07.2025',
  'Datum 01.07.2025'
].join('\n');

const COMDIRECT_BUY = [
  'comdirect bank AG Wertpapierkauf',
  'Wertpapier-Bezeichnung DWS Top Dividende LD DE0009848119 (984811)',
  'St. 1,5 zum Kurs von 132,40 EUR',
  'Geschäftstag : 20.11.2024 Handelszeit : 10:01',
  'Provision : 9,90 EUR',
  'Kurswert : 198,60 EUR'
].join('\n');

(function run() {
  console.log('pdf-import:');

  // ---- broker detection -------------------------------------------------------
  ok('detects Trade Republic', P.detectBrokerFromText(TRADE_REPUBLIC_BUY).id === 'traderepublic');
  ok('detects Scalable', P.detectBrokerFromText(SCALABLE_SELL).id === 'scalable');
  ok('detects ING', P.detectBrokerFromText(ING_BUY).id === 'ing');
  ok('detects DKB', P.detectBrokerFromText(DKB_DIVIDEND).id === 'dkb');
  ok('detects Comdirect', P.detectBrokerFromText(COMDIRECT_BUY).id === 'comdirect');
  ok('unknown text -> null', P.detectBrokerFromText('Kontoauszug Sparkasse') === null);
  ok('named broker beats the generic marker', P.detectBrokerFromText('Wertpapierabrechnung\ncomdirect bank AG').id === 'comdirect');

  // ---- Trade Republic buy -------------------------------------------------------
  const tr = P.parseText(TRADE_REPUBLIC_BUY);
  ok('TR: one candidate, no blocking errors', tr.candidates.length === 1);
  const trc = tr.candidates[0];
  ok('TR: ISIN as symbol', trc.symbol === 'IE00B4L5Y983');
  ok('TR: type buy (Sparplan counts as buy)', trc.type === 'buy');
  ok('TR: quantity from the Stk. notation', approx(trc.quantity, 2));
  ok('TR: per-share price, not the total', approx(trc.price, 80.46));
  ok('TR: Fremdkostenzuschlag as fee', approx(trc.fees, 1.0));
  ok('TR: trade date from the am-clause', trc.date === '2024-05-02');
  ok('TR: currency EUR', trc.currency === 'EUR');

  // ---- Scalable sell --------------------------------------------------------------
  const sc = P.parseText(SCALABLE_SELL);
  const scc = sc.candidates[0];
  ok('Scalable: sell detected', scc && scc.type === 'sell');
  ok('Scalable: Stueck quantity', approx(scc.quantity, 10));
  ok('Scalable: Ausfuehrungskurs wins over other numbers', approx(scc.price, 95.5));
  ok('Scalable: Ausfuehrungstag as date', scc.date === '2025-01-03');
  ok('Scalable: name extracted before the ISIN', /VANGUARD/.test(scc.symbolName));

  // ---- ING buy ----------------------------------------------------------------------
  const ing = P.parseText(ING_BUY);
  const ingc = ing.candidates[0];
  ok('ING: candidate parsed', !!ingc);
  ok('ING: German decimal quantity (25,00)', approx(ingc.quantity, 25));
  ok('ING: Kurs label', approx(ingc.price, 45.12));
  ok('ING: Handelstag date', ingc.date === '2025-03-15');
  ok('ING: Provision fee', approx(ingc.fees, 4.9));

  // ---- DKB dividend --------------------------------------------------------------------
  const dkb = P.parseText(DKB_DIVIDEND);
  const dkbc = dkb.candidates[0];
  ok('DKB: dividend type wins over Stueck noise', dkbc && dkbc.type === 'dividend');
  ok('DKB: per-share dividend in USD', approx(dkbc.price, 0.485) && dkbc.currency === 'USD');
  ok('DKB: US ISIN', dkbc.symbol === 'US1912161007');
  ok('DKB: 80 Stueck', approx(dkbc.quantity, 80));

  // Gross-only dividend statements derive the per-share amount.
  const grossOnly = P.parseText(DKB_DIVIDEND.replace('Dividende je Stück 0,485 USD\n', ''));
  ok('dividend without per-share line derives from Bruttobetrag', approx(grossOnly.candidates[0].price, 38.8 / 80));

  // ---- Comdirect buy ----------------------------------------------------------------------
  const cd = P.parseText(COMDIRECT_BUY);
  const cdc = cd.candidates[0];
  ok('Comdirect: St.-notation quantity (1,5)', cdc && approx(cdc.quantity, 1.5));
  ok('Comdirect: zum-Kurs-von price', approx(cdc.price, 132.4));
  ok('Comdirect: Geschaeftstag date', cdc.date === '2024-11-20');

  // ---- failure reporting -----------------------------------------------------------------
  const broken = P.parseText('Trade Republic\nWERTPAPIERABRECHNUNG KAUF\nkein Inhalt');
  ok('unparseable statement -> no candidate, explicit errors', broken.candidates.length === 0 && broken.errors.length >= 3);
  ok('errors name the missing fields', broken.errors.some((e) => /isin/i.test(e)) && broken.errors.some((e) => /date/i.test(e)));

  // ---- CSV round trip through the EXISTING mapping flow -----------------------------------
  const csv = P.candidatesToCSV([trc, scc, dkbc]);
  ok('CSV has a header and one line per candidate', csv.split('\n').length === 4);
  const prev = IM.preview(csv, { existing: [] });
  ok('mapping preview parses all rows without errors', prev.stats.ok === 3 && prev.errors.length === 0);
  ok('preview keeps types through normalisation', prev.transactions[0].type === 'buy' && prev.transactions[1].type === 'sell' && prev.transactions[2].type === 'dividend');
  ok('preview keeps the per-share prices', approx(prev.transactions[0].price, 80.46) && approx(prev.transactions[2].price, 0.485));
  ok('preview keeps dates ISO', prev.transactions[0].date === '2024-05-02');
  const prevDup = IM.preview(csv, { existing: [{ date: '2024-05-02', type: 'buy', symbol: 'IE00B4L5Y983', quantity: 2, price: 80.46 }] });
  ok('existing transactions are flagged as duplicates downstream', prevDup.stats.duplicates === 1);
  ok('quoted names with special chars survive', /iShares Core MSCI World/.test(csv));

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
