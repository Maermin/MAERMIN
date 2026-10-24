// Node harness for P5-2.3: fund holdings files the user imports
// (MaerminFundFiles) and the look-through on top of them. Every fixture is
// made up here in the LAYOUT of a provider file (no provider data in the repo).
// Run: node test/fund-holdings-import.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}
const near = (a, b, e) => a !== null && b !== null && a !== undefined && Math.abs(a - b) < (e || 1e-9);
const zlib = require('zlib');
const inflateRaw = (u8) => Promise.resolve(new Uint8Array(zlib.inflateRawSync(Buffer.from(u8))));

// a tiny xlsx: zip with deflated entries (CRC not checked by the reader)
function zip(files) {
  const parts = [], central = []; let off = 0;
  Object.keys(files).forEach((name) => {
    const nameB = Buffer.from(name), data = zlib.deflateRawSync(Buffer.from(files[name])), size = Buffer.byteLength(files[name]);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(size, 22); lh.writeUInt16LE(nameB.length, 26);
    parts.push(lh, nameB, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(size, 24); ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, nameB);
    off += 30 + nameB.length + data.length;
  });
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat(parts.concat([cd, end])));
}

const store = {}; globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
globalThis.window = {};
const FF = require('../fund-holdings-import.js');
const LT = require('../etf-lookthrough.js');

// iShares-like CSV: preamble, header, holdings, cash and a future, footer
const ishares = [
  'iShares Core MSCI World UCITS ETF', 'Fund Holdings as of,"Oct 10, 2026"', 'Inception Date,"Sep 25, 2009"', '',
  'Ticker,Name,Sector,Asset Class,Market Value,Weight (%),Notional Value,Shares,Price,Location,Exchange,Currency,FX Rate,Market Currency',
  'AAPL,APPLE INC,Information Technology,Equity,"1,000,000.00",4.80,"1,000,000.00",1000,200.00,United States,NASDAQ,USD,1.10,USD',
  'NVDA,NVIDIA CORP,Information Technology,Equity,"900,000.00",4.50,"900,000.00",500,180.00,United States,NASDAQ,USD,1.10,USD',
  'SAP,SAP,Information Technology,Equity,"300,000.00",1.50,"300,000.00",100,250.00,Germany,Xetra,EUR,1.00,EUR',
  'NESN,NESTLE SA,Consumer Staples,Equity,"250,000.00",1.20,"250,000.00",90,95.00,Switzerland,SIX Swiss Exchange,CHF,1.05,CHF',
  '7203,TOYOTA MOTOR CORP,Consumer Discretionary,Equity,"200,000.00",87.70,"200,000.00",800,20.00,Japan,Tokyo Stock Exchange,JPY,0.006,JPY',
  'USD,USD CASH,Cash and/or Derivatives,Cash,"40,000.00",0.25,"40,000.00",40000,1.00,United States,-,USD,1.10,USD',
  'MESZ6,MSCI EAFE DEC 26,Cash and/or Derivatives,Futures,0.00,0.05,"500,000.00",5,2000.00,United States,-,USD,1.10,USD',
  '', '"The content contained herein is owned or licensed by BlackRock."'
].join('\r\n');
// Xtrackers-like German CSV: semicolons, decimal comma, ISIN instead of ticker
const xtrackers = [
  'Xtrackers MSCI World UCITS ETF 1C;IE00BJ0KDQ92', 'Stand: 10.10.2026', '',
  'Name;ISIN;Land;Währung;Anlageklasse;Gewichtung;Sektor',
  'APPLE INC;US0378331005;Vereinigte Staaten;USD;Aktie;4,79 %;Informationstechnologie',
  'MICROSOFT CORP;US5949181045;Vereinigte Staaten;USD;Aktie;4,10 %;Informationstechnologie',
  'SAP SE;DE0007164600;Deutschland;EUR;Aktie;1,49 %;Informationstechnologie',
  'ALLIANZ SE;DE0008404005;Deutschland;EUR;Aktie;89,62 %;Finanzwesen'
].join('\n');

(async function run() {
  console.log('CSV (iShares layout):');
  const t1 = await FF.readTable('IWDA_holdings.csv', new TextEncoder().encode('﻿' + ishares));
  const p1 = FF.parseTable(t1, 'IWDA_holdings.csv');
  ok('header found below the preamble, 5 holdings', p1.ok && p1.count === 5, JSON.stringify(p1).slice(0, 200));
  ok('weights in percent become fractions; the largest first', near(p1.holdings[0].weight, 0.877) && p1.holdings[0].name === 'TOYOTA MOTOR CORP');
  ok('cash and futures rows are summed apart (0.30 %)', near(p1.cashWeight, 0.003, 1e-9), String(p1.cashWeight));
  ok('total weight 100 %', near(p1.totalWeight, 1, 1e-9), String(p1.totalWeight));
  const aapl = p1.holdings.filter((h) => h.symbol === 'AAPL')[0];
  ok('ticker, sector (Information Technology → Technology), country (United States → USA), currency', !!aapl && aapl.sector === 'Technology' && aapl.country === 'USA' && aapl.currency === 'USD', JSON.stringify(aapl));
  ok('provider iShares and the "as of" date from the preamble', p1.provider === 'iShares' && p1.asOf === '2026-10-10', p1.provider + ' ' + p1.asOf);

  console.log('CSV (German layout):');
  const p2 = FF.parseTable(await FF.readTable('holdings.csv', new TextEncoder().encode(xtrackers)), 'holdings.csv');
  ok('semicolons and decimal commas: 4,79 % → 0.0479', p2.ok && p2.count === 4 && near(p2.holdings.filter((h) => h.isin === 'US0378331005')[0].weight, 0.0479), JSON.stringify(p2).slice(0, 200));
  ok('German labels: Land, Sektor, Gewichtung → USA, Technology / Financials, Germany', p2.holdings[0].sector === 'Financials' && p2.holdings[0].country === 'Germany' && p2.holdings[1].sector === 'Technology');
  ok('fund ISIN, date (10.10.2026) and provider from the preamble', p2.isin === 'IE00BJ0KDQ92' && p2.asOf === '2026-10-10' && p2.provider === 'Xtrackers', p2.isin + ' ' + p2.asOf + ' ' + p2.provider);
  ok('no ticker column → symbol null, ISIN kept', p2.holdings.every((h) => h.symbol === null && /^[A-Z]{2}/.test(h.isin)));

  console.log('XLSX and Excel XML:');
  const ss = ['Amundi MSCI World', 'As of', '10/10/2026', 'Name', 'ISIN', 'Weight', 'Country', 'Sector', 'APPLE INC', 'US0378331005', 'United States', 'Information Technology', 'NOVO NORDISK A/S', 'DK0062498333', 'Denmark', 'Health Care'];
  const sst = '<?xml version="1.0"?><sst>' + ss.map((s) => '<si><t>' + s.replace(/&/g, '&amp;') + '</t></si>').join('') + '</sst>';
  const sheet = '<?xml version="1.0"?><worksheet><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="s"><v>2</v></c></row>' +
    '<row r="4"><c r="A4" t="s"><v>3</v></c><c r="B4" t="s"><v>4</v></c><c r="C4" t="s"><v>5</v></c><c r="D4" t="s"><v>6</v></c><c r="E4" t="s"><v>7</v></c></row>' +
    '<row r="5"><c r="A5" t="s"><v>8</v></c><c r="B5" t="s"><v>9</v></c><c r="C5"><v>0.6</v></c><c r="D5" t="s"><v>10</v></c><c r="E5" t="s"><v>11</v></c></row>' +
    '<row r="6"><c r="A6" t="s"><v>12</v></c><c r="B6" t="s"><v>13</v></c><c r="C6"><v>0.4</v></c><c r="D6" t="s"><v>14</v></c><c r="E6" t="s"><v>15</v></c></row>' +
    '</sheetData></worksheet>';
  const x = zip({ '[Content_Types].xml': '<Types/>', 'xl/workbook.xml': '<workbook/>', 'xl/sharedStrings.xml': sst, 'xl/worksheets/sheet1.xml': sheet });
  const p3 = FF.parseTable(await FF.readTable('amundi.xlsx', x, { inflateRaw }), 'amundi.xlsx');
  ok('xlsx read without a library: shared strings, numbers, gaps between rows', p3.ok && p3.count === 2 && near(p3.holdings[0].weight, 0.6) && p3.holdings[1].name === 'NOVO NORDISK A/S', JSON.stringify(p3).slice(0, 220));
  ok('fractions stay fractions; Health Care → Healthcare; Denmark', p3.holdings[1].sector === 'Healthcare' && p3.holdings[1].country === 'Denmark' && near(p3.totalWeight, 1));
  ok('provider from the preamble (Amundi), date 10/10/2026', p3.provider === 'Amundi' && p3.asOf === '2026-10-10');
  const xml = '<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Holdings"><Table>' +
    '<Row><Cell><Data ss:Type="String">Security Name</Data></Cell><Cell><Data ss:Type="String">% of Net Assets</Data></Cell><Cell><Data ss:Type="String">Ticker</Data></Cell></Row>' +
    '<Row><Cell><Data ss:Type="String">MICROSOFT CORP</Data></Cell><Cell><Data ss:Type="Number">70</Data></Cell><Cell><Data ss:Type="String">MSFT</Data></Cell></Row>' +
    '<Row><Cell><Data ss:Type="String">AT&amp;T INC</Data></Cell><Cell ss:Index="2"><Data ss:Type="Number">30</Data></Cell><Cell><Data ss:Type="String">T</Data></Cell></Row>' +
    '</Table></Worksheet></Workbook>';
  const p4 = FF.parseTable(await FF.readTable('spdr.xls', new TextEncoder().encode(xml)), 'spdr.xls');
  ok('Excel 2003 XML ("xls"): cells, numbers, entities, ss:Index', p4.ok && p4.count === 2 && p4.holdings[1].name === 'AT&T INC' && near(p4.holdings[0].weight, 0.7) && p4.provider === 'SPDR', JSON.stringify(p4).slice(0, 200));

  console.log('files that are not holdings:');
  ok('no name/weight header → no-header', FF.parseTable([['Date', 'Close'], ['2026-01-02', '100']], 'x.csv').error === 'no-header');
  ok('weights that do not add up to a fund → weights', FF.parseTable([['Name', 'Weight'], ['A', '5'], ['B', '3']], 'x.csv').error === 'weights');
  let oldXls = '';
  try { await FF.readTable('old.xls', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])); } catch (e) { oldXls = e.message; }
  ok('a binary Excel 97 file is reported (save as xlsx or csv)', oldXls === 'old-xls');
  ok('numbers: 1.234,5 / 1,234.5 / (2.5) / 4,79 %', FF.parseNum('1.234,5', true) === 1234.5 && FF.parseNum('1,234.5', false) === 1234.5 && FF.parseNum('(2.5)', false) === -2.5 && FF.parseNum('4,79 %', true) === 4.79);

  console.log('stored form and storage:');
  const big = { ok: true, provider: 'iShares', asOf: '2026-10-10', isin: null, cashWeight: 0.01, holdings: [] };
  for (let i = 0; i < 2500; i++) big.holdings.push({ symbol: 'S' + i, name: 'Co ' + i, isin: null, weight: 0.99 / 2500, sector: i % 2 ? 'Technology' : 'Financials', country: i < 2000 ? 'USA' : 'Japan', currency: i < 2000 ? 'USD' : 'JPY' });
  const rec = FF.toRecord(big, { fileName: 'big.csv', now: '2026-10-13' });
  ok('large files keep the 2,000 largest holdings', rec.top.length === 2000 && rec.count === 2500);
  ok('… but the country split covers the whole file (USA 79.2 %, Japan 19.8 %)', near(rec.countries[0][1], 0.792, 1e-9) && rec.countries[1][0] === 'Japan' && near(rec.countries[1][1], 0.198, 1e-9));
  const fd = FF.toFundData(rec);
  ok('look-through shape: source file, sectors incl. cash, currencies, date', fd.source === 'file' && fd.sectors.some((s) => s.sector === 'Cash') && fd.currencies.length === 2 && fd.asOf === '2026-10-10' && fd.fileCount === 2500);
  FF.put('IWDA.AS', FF.toRecord(p1, { fileName: 'IWDA_holdings.csv', now: '2026-10-13' }));
  ok('stored under the fund root in maermin_fund_holdings', !!JSON.parse(store[FF.KEY]).funds.IWDA && FF.fundDataMap().IWDA.holdings.length === 5);
  FF.remove('IWDA'); ok('removed again', !JSON.parse(store[FF.KEY]).funds.IWDA);
  window.MaerminDemo = { isActive: () => true };
  const before = store[FF.KEY];
  FF.put('VWCE', rec);
  ok('demo: kept in memory, the storage is not touched', store[FF.KEY] === before && !!FF.load().funds.VWCE);
  delete window.MaerminDemo;
  ok('outside the demo the memory copy is not used', !FF.load().funds.VWCE);

  console.log('look-through with files:');
  const files = { IWDA: FF.toFundData(FF.toRecord(p1, {})), XDWD: FF.toFundData(FF.toRecord(p2, {})) };
  const loaded = await LT.loadFundData('', ['IWDA.AS', 'XDWD.DE'], { files });
  ok('loadFundData: an imported file wins and needs no Worker', loaded.holdings.IWDA.source === 'file' && loaded.holdings.XDWD.source === 'file');
  const rows = [{ symbol: 'IWDA.AS', name: 'iShares Core MSCI World', cls: 'stocks', valueEUR: 6000 }, { symbol: 'XDWD.DE', name: 'Xtrackers MSCI World', cls: 'stocks', valueEUR: 4000 }];
  const r = LT.analyze(rows, loaded.holdings, { getMeta: () => null });
  const apple = r.effectiveExposure.filter((e) => /APPLE/.test(e.name))[0];
  ok('Apple by ticker in one file and by ISIN in the other is ONE security (ISIN ↔ ticker from the files)', !!apple && apple.via.length === 2 && near(apple.effectiveWeight, 0.6 * 0.048 + 0.4 * 0.0479, 1e-9), JSON.stringify(apple));
  ok('overlap of the two files counts Apple and SAP', r.overlapPairs.length === 1 && r.overlapPairs[0].shared.some((s) => /APPLE/.test(s.name)), JSON.stringify(r.overlapPairs));
  const usd = r.currencyExposure.filter((c) => c.currency === 'USD')[0], jpy = r.currencyExposure.filter((c) => c.currency === 'JPY')[0];
  ok('currencies from the files: USD 0.6 × 9.30 % + 0.4 × 8.89 %, JPY 0.6 × 87.7 %', near(usd.weight, 0.6 * 0.093 + 0.4 * 0.0889, 1e-9) && near(jpy.weight, 0.6 * 0.877, 1e-9), JSON.stringify(r.currencyExposure));
  ok('the fund rows carry the file date and holding count', r.funds.every((f) => f.source === 'file') && r.funds.filter((f) => f.symbol === 'IWDA')[0].asOf === '2026-10-10');
  ok('names compare without legal forms and punctuation', LT.nameKey('Apple Inc.') === 'APPLE' && LT.nameKey('SAP SE') === 'SAP' && LT.nameKey('Alphabet Inc Class A') === 'ALPHABET' && LT.nameKey('Coca-Cola Co') === 'COCA COLA' && LT.nameKey('Siemens') === 'SIEMENS');
  { const a = { holdings: [{ symbol: 'NOVO-B', name: 'Novo Nordisk A/S Class B', weight: 0.5 }, { symbol: 'ASML', name: 'ASML Holding NV', weight: 0.5 }] };
    const b = { holdings: [{ symbol: null, name: 'NOVO NORDISK A/S CL B', isin: 'DK0062498333', weight: 0.4 }, { symbol: null, name: 'ASML HOLDING N.V.', isin: 'NL0010273215', weight: 0.6 }] };
    const rr = LT.analyze([{ symbol: 'A1', name: 'fund a', cls: 'stocks', valueEUR: 1 }, { symbol: 'B1', name: 'fund b', cls: 'stocks', valueEUR: 1 }], { A1: a, B1: b }, {});
    ok('different spellings of the same company meet (Novo Nordisk, ASML)', rr.overlapPairs.length === 1 && rr.overlapPairs[0].shared.length === 2 && near(rr.overlapPairs[0].overlap, 0.9), JSON.stringify(rr.overlapPairs)); }
  { const rr = LT.analyze([{ symbol: 'IWDA.AS', name: 'w', cls: 'stocks', valueEUR: 1 }, { symbol: 'NVDA', name: 'NVIDIA Corp.', cls: 'stocks', valueEUR: 1 }], { IWDA: files.IWDA }, {});
    ok('a security also held directly keeps the direct name', rr.effectiveExposure.filter((x) => x.key === 'NVDA')[0].name === 'NVIDIA Corp.'); }
  const csv = FF.exportCsv(r);
  ok('CSV export: header + one line per security, quoted names', /^Security,Key,Effective weight %/.test(csv) && csv.trim().split('\r\n').length === r.effectiveExposure.length + 1 && /NESTLE SA/.test(csv));
  const csvText = FF.exportCsv({ effectiveExposure: [{ name: '=1+1', key: '@K', effectiveWeight: 0.5, directWeight: 0.5, fundedWeight: 0, valueEUR: -3, via: [{ fund: '-F' }] }] }).split('\r\n')[1];
  ok('CSV export: text cells starting with = @ - are written as text', csvText.indexOf("'=1+1,'@K,") === 0 && /,'-F$/.test(csvText), csvText);
  ok('CSV export: a negative value stays a plain number', csvText.split(',')[5] === '-3.00', csvText);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
