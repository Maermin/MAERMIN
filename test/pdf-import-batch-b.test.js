// Node harness for P5-3.3: PDF importers batch B (Baader Bank, Smartbroker+,
// Sparkasse / DekaBank, Postbank) and the dividend and tax documents of Trade
// Republic and Scalable (issued by Baader). Fixtures are MADE UP from public
// layouts (no real statements, no binary PDFs in the repo).
// Run: node test/pdf-import-batch-b.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : '')); }
}
function approx(a, b, eps) { return Math.abs(a - b) < (eps || 1e-6); }

const P = require('../pdf-import.js');
const IM = require('../import-mapping.js');

const BAADER_BUY = [
  'Baader Bank AG · Weihenstephaner Str. 4 · 85716 Unterschleißheim',
  'Wertpapierabrechnung: Kauf',
  'Handelstag 05.03.2025 Handelszeit 10:12:01',
  'Nominale ISIN: IE00B3RBWM25 WKN: A1JX52 Kurs',
  'STK 12 Vanguard FTSE All-World U.ETF EUR 105,32',
  'Kurswert EUR 1.263,84',
  'Provision EUR 0,99',
  'Zu Lasten Konto EUR -1.264,83'
].join('\n');

const SCALABLE_DIVIDEND = [
  'Baader Bank AG',
  'Scalable Capital GmbH',
  'Dividende',
  'Nominale ISIN: US0378331005 WKN: 865985',
  'STK 10 Apple Inc. Registered Shares o.N.',
  'Zahltag: 15.05.2025',
  'Ertrag pro Stück 0,25 USD',
  'Devisenkurs EUR / USD 1,1200',
  'US-Quellensteuer 15 % USD -0,38 USD',
  'Kapitalertragsteuer EUR -0,22',
  'Solidaritätszuschlag EUR -0,01',
  'Zu Gunsten Konto EUR 1,61'
].join('\n');

const SCALABLE_VORAB = [
  'Baader Bank AG',
  'Scalable Capital GmbH',
  'Vorabpauschale',
  'Nominale ISIN: IE00B4L5Y983',
  'STK 40 iShs Core MSCI World U.ETF',
  'Valuta 02.01.2025',
  'Kapitalertragsteuer EUR -3,15',
  'Solidaritätszuschlag EUR -0,17',
  'Zu Lasten Konto EUR -3,32'
].join('\n');

const TR_DIVIDEND = [
  'TRADE REPUBLIC BANK GMBH',
  'DIVIDENDE',
  'POSITION ANZAHL ERTRAG BETRAG',
  'Apple Inc. Registered Shares o.N.',
  'ISIN: US0378331005 8,4 Stk. 0,25 USD 2,10 USD',
  'Quellensteuer für US-Emittenten -0,32 USD',
  'Zahlung am 15.05.2025'
].join('\n');

const TR_TAX_CORRECTION = [
  'TRADE REPUBLIC BANK GMBH',
  'STEUERKORREKTUR',
  'DATUM 03.02.2025',
  'Kapitalertragsteuer 12,50 EUR',
  'Solidaritätszuschlag 0,69 EUR',
  'GESAMT 13,19 EUR',
  'Gutschrift auf das Verrechnungskonto'
].join('\n');

const DEKA_BUY = [
  'DekaBank Deutsche Girozentrale',
  'Sparkasse KölnBonn · Depot 1234567',
  'Kaufabrechnung Sparplan',
  'Deka-GlobalChampions CF DE000DK0ECU8',
  'Anteile 0,7843',
  'Abrechnungspreis 254,96 EUR',
  'Ausgabeaufschlag 7,51 EUR',
  'Abrechnungstag 15.04.2025'
].join('\n');

const SPARKASSE_DIVIDEND = [
  'Sparkasse Musterstadt',
  'Ertragsgutschrift',
  'Bestand 15,0000 Anteile Deka-DividendenStrategie CF (A) DE000DK2CDS0',
  'Ausschüttung pro Anteil 1,20 EUR',
  'Zahltag 20.03.2025',
  'Kapitalertragsteuer EUR 3,15',
  'Solidaritätszuschlag EUR 0,17'
].join('\n');

const POSTBANK_BUY = [
  'Postbank – eine Niederlassung der Deutsche Bank AG',
  'Abrechnung: Kauf von Wertpapieren',
  'Allianz SE vink.Namens-Aktien o.N. DE0008404005',
  'Nominale Stück 4',
  'Kurs EUR 280,40',
  'Provision EUR 9,95',
  'Handelstag 12.02.2025'
].join('\n');

const SMARTBROKER_SELL = [
  'Smartbroker+ · DAB BNP Paribas',
  'Wertpapierabrechnung Verkauf',
  'Gattungsbezeichnung ISIN',
  'Tesla Inc. Registered Shares DL-,001 US88160R1014',
  'Nominal Kurs',
  'STK 2 USD 245,10',
  'Handelstag 18.03.2025',
  'Devisenkurs EUR / USD 1,0890',
  'Provision EUR 0,00',
  'Kapitalertragsteuer EUR 10,00'
].join('\n');

(function run() {
  console.log('pdf-import batch B (P5-3.3):');

  // ---- detection ----------------------------------------------------------------
  const id = (t) => (P.detectBrokerFromText(t) || {}).id;
  ok('detects Baader Bank', id(BAADER_BUY) === 'baader', id(BAADER_BUY));
  ok('Scalable documents issued by Baader stay Scalable', id(SCALABLE_DIVIDEND) === 'scalable' && id(SCALABLE_VORAB) === 'scalable', [id(SCALABLE_DIVIDEND), id(SCALABLE_VORAB)]);
  ok('detects DekaBank', id(DEKA_BUY) === 'deka', id(DEKA_BUY));
  ok('a Sparkasse securities document is Sparkasse / Deka', id(SPARKASSE_DIVIDEND) === 'deka' && P.detectBrokerFromText(SPARKASSE_DIVIDEND).name === 'Sparkasse / Deka');
  ok('a plain Sparkasse account statement stays unknown', P.detectBrokerFromText('Kontoauszug Sparkasse') === null);
  ok('detects Postbank', id(POSTBANK_BUY) === 'postbank', id(POSTBANK_BUY));
  ok('detects Smartbroker+', id(SMARTBROKER_SELL) === 'smartbroker', id(SMARTBROKER_SELL));
  ok('batch A brokers are still listed', ['flatex', 'degiro', 'consorsbank', 'onvista'].every((b) => P.PDF_BROKERS.some((x) => x.id === b)));

  // ---- Baader buy -----------------------------------------------------------------
  const bb = P.parseText(BAADER_BUY).candidates;
  const b = bb[0];
  ok('Baader buy: one candidate', bb.length === 1, bb);
  ok('Baader buy: "STK 12 <name> EUR 105,32"', b && b.type === 'buy' && b.symbol === 'IE00B3RBWM25' && approx(b.quantity, 12) && approx(b.price, 105.32) && b.currency === 'EUR', b);
  ok('Baader buy: name from the STK line, fee, date', b && b.symbolName === 'Vanguard FTSE All-World U.ETF' && approx(b.fees, 0.99) && b.date === '2025-03-05', b);

  // ---- Scalable (Baader) dividend and Vorabpauschale -------------------------------
  const sd = P.parseText(SCALABLE_DIVIDEND);
  const s = sd.candidates[0];
  ok('Scalable dividend: 10 at 0,25 USD ("Ertrag pro Stück")', sd.candidates.length === 1 && s.type === 'dividend' && approx(s.quantity, 10) && approx(s.price, 0.25) && s.currency === 'USD', sd);
  // 0,38 USD + (0,22 + 0,01) EUR × 1,12
  ok('Scalable dividend: withholding US + German taxes in USD', approx(s.withholdingTax, 0.6376), s.withholdingTax);
  ok('Scalable dividend: Zahltag and name from the STK line', s.date === '2025-05-15' && s.symbolName === 'Apple Inc. Registered Shares o.N.', s);
  const sv = P.parseText(SCALABLE_VORAB).candidates;
  ok('Scalable Vorabpauschale: one tax row of 3,32 on the value date, no trade', sv.length === 1 && sv[0].type === 'tax' && approx(sv[0].amount, 3.32) && sv[0].date === '2025-01-02', sv);

  // ---- Trade Republic dividend and tax correction -----------------------------------
  const tdc = P.parseText(TR_DIVIDEND).candidates;
  const td = tdc[0];
  ok('TR dividend: 8,4 shares at 0,25 USD with 0,32 USD withholding', tdc.length === 1 && td.type === 'dividend' && approx(td.quantity, 8.4) && approx(td.price, 0.25) && approx(td.withholdingTax, 0.32) && td.currency === 'USD', tdc);
  ok('TR dividend: payment date and name', td && td.date === '2025-05-15' && td.symbolName === 'Apple Inc. Registered Shares o.N.', td);
  const tc = P.parseText(TR_TAX_CORRECTION).candidates;
  ok('TR Steuerkorrektur credited: one tax refund of 13,19 (the total)', tc.length === 1 && tc[0].type === 'tax_refund' && approx(tc[0].amount, 13.19) && tc[0].date === '2025-02-03', tc);
  const tcDebit = P.parseText(TR_TAX_CORRECTION.replace('Gutschrift auf das Verrechnungskonto', 'Belastung des Verrechnungskontos')).candidates;
  ok('TR Steuerkorrektur debited: a tax row', tcDebit.length === 1 && tcDebit[0].type === 'tax' && approx(tcDebit[0].amount, 13.19), tcDebit);

  // ---- Deka / Sparkasse --------------------------------------------------------------
  const dk = P.parseText(DEKA_BUY).candidates[0];
  ok('Deka savings plan: 0,7843 units at 254,96 EUR', dk && dk.type === 'buy' && dk.symbol === 'DE000DK0ECU8' && approx(dk.quantity, 0.7843) && approx(dk.price, 254.96), dk);
  ok('Deka savings plan: front load as fee, Abrechnungstag, name', dk && approx(dk.fees, 7.51) && dk.date === '2025-04-15' && dk.symbolName === 'Deka-GlobalChampions CF', dk);
  const sk = P.parseText(SPARKASSE_DIVIDEND).candidates;
  const skd = sk[0];
  ok('Sparkasse fund payout: 15 units at 1,20 EUR', sk.length === 1 && skd.type === 'dividend' && approx(skd.quantity, 15) && approx(skd.price, 1.2), sk);
  ok('Sparkasse fund payout: German taxes as withholding, Zahltag, name', approx(skd.withholdingTax, 3.32) && skd.date === '2025-03-20' && skd.symbolName === 'Deka-DividendenStrategie CF A', skd);

  // ---- Postbank, Smartbroker+ ---------------------------------------------------------
  const pb = P.parseText(POSTBANK_BUY).candidates[0];
  ok('Postbank buy: "Nominale Stück 4", "Kurs EUR 280,40"', pb && pb.type === 'buy' && approx(pb.quantity, 4) && approx(pb.price, 280.4) && pb.currency === 'EUR', pb);
  ok('Postbank buy: fee, date, name', pb && approx(pb.fees, 9.95) && pb.date === '2025-02-12' && pb.symbolName === 'Allianz SE vink.Namens-Aktien o.N.', pb);
  const sb = P.parseText(SMARTBROKER_SELL).candidates;
  const sbs = sb.find((c) => c.type === 'sell'), sbt = sb.find((c) => c.type === 'tax');
  ok('Smartbroker+ sale: 2 at 245,10 USD', sbs && approx(sbs.quantity, 2) && approx(sbs.price, 245.1) && sbs.currency === 'USD' && sbs.date === '2025-03-18', sbs);
  ok('Smartbroker+ sale: the tax row stays in EUR as charged', sbt && approx(sbt.amount, 10) && sbt.currency === 'EUR', sbt);

  // ---- the earlier layouts are unchanged ------------------------------------------------
  ok('batch A onvista "STK 8,000 EUR 230,15" still reads', approx(P.parseText('onvista bank\nWertpapierabrechnung Kauf\nSAP SE DE0007164600\nSTK 8,000 EUR 230,15\nHandelstag 21.01.2025').candidates[0].price, 230.15));

  // ---- round trip -------------------------------------------------------------------------
  const all = [].concat(bb, sd.candidates, sv, tc, sb);
  const prev = IM.preview(P.candidatesToCSV(all), { existing: [] });
  ok('preview: every row imports', prev.stats.ok === all.length && prev.errors.length === 0, { stats: prev.stats, errors: prev.errors });
  ok('preview: the EUR tax row of the USD sale keeps EUR', prev.transactions.some((x) => x.type === 'tax' && x.currency === 'EUR' && approx(x.amount, 10)));

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
