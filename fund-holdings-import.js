// ============================================================================
// MAERMIN — Fund holdings files  (window.MaerminFundFiles)
// ----------------------------------------------------------------------------
// P5-2.3. Full ETF look-through from the fund provider's own holdings file,
// which the USER downloads from the provider's website and imports here. The
// file is read on this device only - no Worker, no upload, nothing passed on
// (owner decision 2026-10-13: the providers' terms allow personal use of their
// pages but not automated retrieval or redistribution).
//
//   readTable(fileName, bytes, { inflateRaw })   → Promise<rows[][]>
//       CSV / TXT (delimiter , ; or tab, UTF-8 or Windows-1252), XLSX (zip,
//       first worksheet; read without a library) and Excel 2003 XML ("xls"
//       files some providers send). inflateRaw(Uint8Array) → Promise<Uint8Array>
//       is injectable (browser: DecompressionStream, Node tests: zlib).
//   parseTable(rows, fileName) → { ok, error?, provider, asOf, isin, count,
//       totalWeight, cashWeight, holdings: [{ symbol, name, isin, weight,
//       sector, country, currency }] }   weights as fractions of the fund
//       The header row is found by its column names (English and German), so
//       the layout of a provider does not matter. Cash, futures, FX forwards
//       and other derivatives are summed into cashWeight.
//   toRecord(parsed, { fileName, max, now })   compact stored form: the
//       largest `max` (2,000) holdings plus sector / country / currency splits
//       over the WHOLE file
//   toFundData(record)          the look-through's fund shape (source 'file')
//   load() / put(root, record) / remove(root)   localStorage[KEY]; in the demo
//       an in-memory copy (the demo never writes the user's storage)
//   exportCsv(result)           effective exposure of a look-through as CSV
//
// Storage (sensitive - reveals held funds; in backups; synced end-to-end
// encrypted like the other user data):
//   maermin_fund_holdings = { v: 1, funds: { ROOT: { file, provider, asOf,
//     isin, importedAt, count, cash, top: [[symbol, name, isin, w, sector,
//     country, currency]…], sectors: [[s, w]…], countries: [[c, w]…],
//     currencies: [[c, w]…] } } }
//
// Pure layer dual-exported and Node-tested (test/fund-holdings-import.test.js).
// ============================================================================
(function () {
  'use strict';

  var KEY = 'maermin_fund_holdings';
  var MAX_HOLDINGS = 2000;
  var ISIN_RX = /\b([A-Z]{2}[A-Z0-9]{9}[0-9])\b/;

  // ---- text helpers -----------------------------------------------------------
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function key(s) { return norm(s).toLowerCase().replace(/[^a-z0-9%äöüß ]/g, '').replace(/\s+/g, ' ').trim(); }
  function decodeXml(s) {
    return String(s).replace(/&#x([0-9a-f]+);/gi, function (m, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (m, d) { return String.fromCharCode(parseInt(d, 10)); })
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }
  function decodeText(bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var txt = '';
    try { txt = new TextDecoder('utf-8').decode(u8); } catch (e) { txt = ''; }
    var bad = (txt.match(/�/g) || []).length;
    if (bad > 2) { try { txt = new TextDecoder('windows-1252').decode(u8); } catch (e) { /* keep utf-8 */ } }
    return txt.replace(/^﻿/, '');
  }

  // ---- CSV ------------------------------------------------------------------------
  function splitLine(line, d) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (q) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === d) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }
  function logicalLines(text) { // newlines inside quotes stay in the field
    var lines = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === '"') q = !q;
      if (!q && (ch === '\n' || ch === '\r')) {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        lines.push(cur); cur = '';
      } else cur += ch;
    }
    if (cur) lines.push(cur);
    return lines;
  }
  function parseCsv(text) {
    var lines = logicalLines(text);
    var sample = lines.filter(function (l) { return norm(l); }).slice(0, 60);
    var best = ',', bestScore = -1;
    [',', ';', '\t'].forEach(function (d) {
      // the delimiter that gives most lines the same (largest common) width
      var widths = {};
      sample.forEach(function (l) { var n = splitLine(l, d).length; if (n > 2) widths[n] = (widths[n] || 0) + 1; });
      var score = 0;
      Object.keys(widths).forEach(function (n) { score = Math.max(score, widths[n] * Math.log(+n)); });
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return lines.map(function (l) { return splitLine(l, best); });
  }

  // ---- ZIP / XLSX -----------------------------------------------------------------
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216; }
  function unzip(bytes, inflateRaw) {
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var eocd = -1;
    for (var i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) { if (u32(b, i) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) return Promise.reject(new Error('not-zip'));
    var n = u16(b, eocd + 10), p = u32(b, eocd + 16), entries = [];
    for (var k = 0; k < n && u32(b, p) === 0x02014b50; k++) {
      var method = u16(b, p + 10), csize = u32(b, p + 20), nlen = u16(b, p + 28), elen = u16(b, p + 30), clen = u16(b, p + 32), off = u32(b, p + 42);
      var name = new TextDecoder('utf-8').decode(b.subarray(p + 46, p + 46 + nlen));
      entries.push({ name: name, method: method, csize: csize, off: off });
      p += 46 + nlen + elen + clen;
    }
    function read(entry) {
      var o = entry.off;
      if (u32(b, o) !== 0x04034b50) return Promise.reject(new Error('bad-zip'));
      var start = o + 30 + u16(b, o + 26) + u16(b, o + 28), data = b.subarray(start, start + entry.csize);
      if (entry.method === 0) return Promise.resolve(data);
      if (entry.method === 8 && typeof inflateRaw === 'function') return Promise.resolve(inflateRaw(data));
      return Promise.reject(new Error('zip-method'));
    }
    return Promise.resolve({ names: entries.map(function (x) { return x.name; }), get: function (name) {
      var e = entries.filter(function (x) { return x.name === name; })[0];
      return e ? read(e).then(function (u) { return new TextDecoder('utf-8').decode(u); }) : Promise.resolve(null);
    } });
  }
  function colIndex(ref) {
    var m = /^([A-Z]+)/.exec(ref || ''), n = 0;
    if (!m) return -1;
    for (var i = 0; i < m[1].length; i++) n = n * 26 + (m[1].charCodeAt(i) - 64);
    return n - 1;
  }
  function textOf(xml) { var out = '', rx = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, m; while ((m = rx.exec(xml))) out += decodeXml(m[1]); return out; }
  function sheetRows(xml, shared) {
    var rows = [], rowRx = /<row\b([^>]*)>([\s\S]*?)<\/row>/g, rm, auto = 0;
    while ((rm = rowRx.exec(xml))) {
      var rAttr = /\br="(\d+)"/.exec(rm[1]), r = rAttr ? parseInt(rAttr[1], 10) - 1 : auto;
      auto = r + 1;
      var row = [], cRx = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, cm, col = 0;
      while ((cm = cRx.exec(rm[2]))) {
        var attrs = cm[1], inner = cm[2] || '';
        var ref = /\br="([A-Z]+\d+)"/.exec(attrs), tAttr = /\bt="(\w+)"/.exec(attrs), type = tAttr ? tAttr[1] : 'n';
        if (ref) col = colIndex(ref[1]);
        var v = /<v>([\s\S]*?)<\/v>/.exec(inner), val = '';
        if (type === 's') val = v ? (shared[parseInt(v[1], 10)] || '') : '';
        else if (type === 'inlineStr') val = textOf(inner);
        else if (v) val = type === 'n' ? (isFinite(parseFloat(v[1])) ? parseFloat(v[1]) : decodeXml(v[1])) : decodeXml(v[1]);
        row[col] = val;
        col++;
      }
      rows[r] = row;
    }
    for (var i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
    return rows;
  }
  function readXlsx(bytes, inflateRaw) {
    return unzip(bytes, inflateRaw).then(function (z) {
      var sheets = z.names.filter(function (n) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(n); })
        .sort(function (a, b) { return parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10); });
      if (!sheets.length) throw new Error('no-sheet');
      return Promise.all([z.get('xl/sharedStrings.xml'), z.get(sheets[0])]).then(function (r) {
        var shared = [];
        if (r[0]) { var si = /<si>([\s\S]*?)<\/si>/g, m; while ((m = si.exec(r[0]))) shared.push(textOf(m[1])); }
        return sheetRows(r[1] || '', shared);
      });
    });
  }
  // Excel 2003 XML ("SpreadsheetML"), first worksheet
  function readXmlSheet(text) {
    var ws = /<(?:ss:)?Worksheet\b[\s\S]*?<\/(?:ss:)?Worksheet>/.exec(text);
    var src = ws ? ws[0] : text, rows = [], rowRx = /<(?:ss:)?Row\b[^>]*>([\s\S]*?)<\/(?:ss:)?Row>/g, rm;
    while ((rm = rowRx.exec(src))) {
      var row = [], cRx = /<(?:ss:)?Cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ss:)?Cell>)/g, cm, col = 0;
      while ((cm = cRx.exec(rm[1]))) {
        var idx = /ss:Index="(\d+)"/.exec(cm[1]);
        if (idx) col = parseInt(idx[1], 10) - 1;
        var d = /<(?:ss:)?Data\b([^>]*)>([\s\S]*?)<\/(?:ss:)?Data>/.exec(cm[2] || '');
        var val = d ? decodeXml(d[2].replace(/<[^>]+>/g, '')) : '';
        if (d && /Type="Number"/.test(d[1]) && isFinite(parseFloat(val))) val = parseFloat(val);
        row[col] = val;
        col++;
      }
      rows.push(row);
    }
    return rows;
  }
  function browserInflate(data) {
    var DS = typeof DecompressionStream !== 'undefined' ? DecompressionStream : null;
    if (!DS) return Promise.reject(new Error('no-inflate'));
    return new Response(new Blob([data]).stream().pipeThrough(new DS('deflate-raw'))).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }
  function readTable(fileName, bytes, opts) {
    opts = opts || {};
    var b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var inflate = opts.inflateRaw || browserInflate;
    if (b.length > 3 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return readXlsx(b, inflate);
    if (b.length > 7 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return Promise.reject(new Error('old-xls'));
    var text = decodeText(b);
    if (/^\s*<\?xml[\s\S]{0,400}<(?:ss:)?Workbook|urn:schemas-microsoft-com:office:spreadsheet/.test(text.slice(0, 2000))) return Promise.resolve(readXmlSheet(text));
    return Promise.resolve(parseCsv(text));
  }

  // ---- table → holdings -------------------------------------------------------------
  var COLS = {
    name: ['name', 'security name', 'holding name', 'holding', 'holdings', 'constituent', 'constituent name', 'security', 'security description', 'description', 'issuer', 'issuer name', 'company', 'bezeichnung', 'wertpapier', 'name des wertpapiers', 'emittent', 'titel'],
    weight: ['weight', 'weight %', 'weight (%)', '% weight', 'weighting', 'weighting %', 'portfolio weight', '% of net assets', '% of fund', '% of funds', '% of net asset value', '% of nav', 'market value weight', 'percent of fund', 'percentage of fund', 'gewichtung', 'gewichtung %', 'gewicht', 'anteil', 'anteil %', '% des fondsvermögens', 'fondsanteil', 'wertanteil'],
    symbol: ['ticker', 'ticker symbol', 'symbol', 'issuer ticker', 'ticker code', 'code', 'kürzel'],
    isin: ['isin', 'isin code', 'security isin'],
    sector: ['sector', 'gics sector', 'sector classification', 'industry sector', 'sektor', 'branche', 'gics sektor'],
    country: ['location', 'country', 'country of risk', 'location of risk', 'country of incorporation', 'country of domicile', 'land', 'standort', 'risikoland', 'domizil'],
    currency: ['currency', 'market currency', 'trading currency', 'local currency', 'währung', 'handelswährung', 'ccy'],
    asset: ['asset class', 'security type', 'asset type', 'type', 'instrument type', 'anlageklasse', 'wertpapierart', 'instrumententyp']
  };
  function findCol(cells, list) {
    for (var i = 0; i < cells.length; i++) { if (list.indexOf(cells[i]) !== -1) return i; }
    return -1;
  }
  function findHeader(rows) {
    for (var r = 0; r < Math.min(rows.length, 80); r++) {
      var cells = (rows[r] || []).map(key);
      var name = findCol(cells, COLS.name), weight = findCol(cells, COLS.weight);
      if (weight < 0) cells.forEach(function (c, i) { if (weight < 0 && /\bweight\b|gewicht|% of (net|fund)|anteil/.test(c) && !/notional|nominal/.test(c)) weight = i; });
      if (name >= 0 && weight >= 0) {
        return { row: r, name: name, weight: weight, symbol: findCol(cells, COLS.symbol), isin: findCol(cells, COLS.isin),
          sector: findCol(cells, COLS.sector), country: findCol(cells, COLS.country), currency: findCol(cells, COLS.currency), asset: findCol(cells, COLS.asset) };
      }
    }
    return null;
  }
  // A number as written: decimal comma or point decided per file (`comma`).
  function parseNum(v, comma) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v == null ? '' : v).replace(/[%\s ']/g, '');
    if (!s || s === '-' || s === '--') return null;
    var neg = /^\(.*\)$/.test(s); if (neg) s = s.slice(1, -1);
    s = comma ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    var n = parseFloat(s);
    return isFinite(n) ? (neg ? -n : n) : null;
  }
  function likelyComma(values) {
    var c = 0, p = 0;
    values.forEach(function (v) {
      if (typeof v !== 'string') return;
      var s = v.replace(/[%\s]/g, '');
      if (/^-?\d{1,3}(\.\d{3})*,\d+$/.test(s) || /^-?\d+,\d+$/.test(s)) c++;
      else if (/^-?\d{1,3}(,\d{3})*\.\d+$/.test(s) || /^-?\d+\.\d+$/.test(s)) p++;
    });
    return c > p;
  }
  var SECTORS = {
    'information technology': 'Technology', 'technology': 'Technology', 'it': 'Technology', 'informationstechnologie': 'Technology', 'informationstechnik': 'Technology', 'it-dienstleistungen': 'Technology',
    'financials': 'Financials', 'financial': 'Financials', 'finance': 'Financials', 'financial services': 'Financials', 'finanzwesen': 'Financials', 'finanzen': 'Financials', 'finanzdienstleistungen': 'Financials',
    'health care': 'Healthcare', 'healthcare': 'Healthcare', 'gesundheitswesen': 'Healthcare', 'gesundheit': 'Healthcare', 'gesundheitspflege': 'Healthcare',
    'industrials': 'Industrials', 'industrial': 'Industrials', 'industrie': 'Industrials', 'industriegüter': 'Industrials',
    'consumer discretionary': 'Consumer Discretionary', 'consumer cyclical': 'Consumer Discretionary', 'nicht-basiskonsumgüter': 'Consumer Discretionary', 'zyklische konsumgüter': 'Consumer Discretionary', 'nichtbasiskonsumgüter': 'Consumer Discretionary',
    'consumer staples': 'Consumer Staples', 'consumer defensive': 'Consumer Staples', 'basiskonsumgüter': 'Consumer Staples', 'nichtzyklische konsumgüter': 'Consumer Staples',
    'communication': 'Communication Services', 'communication services': 'Communication Services', 'communications': 'Communication Services', 'telecommunication services': 'Communication Services', 'kommunikation': 'Communication Services', 'kommunikationsdienste': 'Communication Services', 'kommunikationsdienstleistungen': 'Communication Services',
    'energy': 'Energy', 'energie': 'Energy',
    'materials': 'Materials', 'basic materials': 'Materials', 'materialien': 'Materials', 'grundstoffe': 'Materials', 'roh hilfs betriebsstoffe': 'Materials', 'rohstoffe': 'Materials',
    'utilities': 'Utilities', 'versorger': 'Utilities', 'versorgungsbetriebe': 'Utilities', 'versorgung': 'Utilities',
    'real estate': 'Real Estate', 'immobilien': 'Real Estate'
  };
  var COUNTRIES = {
    'united states': 'USA', 'united states of america': 'USA', 'usa': 'USA', 'us': 'USA', 'vereinigte staaten': 'USA', 'vereinigte staaten von amerika': 'USA',
    'united kingdom': 'UK', 'uk': 'UK', 'gb': 'UK', 'great britain': 'UK', 'vereinigtes königreich': 'UK', 'großbritannien': 'UK', 'grossbritannien': 'UK',
    'japan': 'Japan', 'jp': 'Japan', 'france': 'France', 'fr': 'France', 'frankreich': 'France', 'canada': 'Canada', 'ca': 'Canada', 'kanada': 'Canada',
    'switzerland': 'Switzerland', 'ch': 'Switzerland', 'schweiz': 'Switzerland', 'germany': 'Germany', 'de': 'Germany', 'deutschland': 'Germany',
    'netherlands': 'Netherlands', 'nl': 'Netherlands', 'niederlande': 'Netherlands', 'australia': 'Australia', 'au': 'Australia', 'australien': 'Australia',
    'china': 'China', 'cn': 'China', 'taiwan': 'Taiwan', 'tw': 'Taiwan', 'korea': 'South Korea', 'korea (south)': 'South Korea', 'south korea': 'South Korea', 'kr': 'South Korea', 'südkorea': 'South Korea', 'korea republik': 'South Korea',
    'india': 'India', 'in': 'India', 'indien': 'India', 'denmark': 'Denmark', 'dk': 'Denmark', 'dänemark': 'Denmark', 'sweden': 'Sweden', 'se': 'Sweden', 'schweden': 'Sweden',
    'italy': 'Italy', 'it': 'Italy', 'italien': 'Italy', 'spain': 'Spain', 'es': 'Spain', 'spanien': 'Spain', 'ireland': 'Ireland', 'ie': 'Ireland', 'irland': 'Ireland',
    'hong kong': 'Hong Kong', 'hk': 'Hong Kong', 'hongkong': 'Hong Kong', 'brazil': 'Brazil', 'br': 'Brazil', 'brasilien': 'Brazil', 'finland': 'Finland', 'fi': 'Finland', 'finnland': 'Finland',
    'belgium': 'Belgium', 'be': 'Belgium', 'belgien': 'Belgium', 'norway': 'Norway', 'no': 'Norway', 'norwegen': 'Norway', 'singapore': 'Singapore', 'sg': 'Singapore', 'singapur': 'Singapore',
    'israel': 'Israel', 'il': 'Israel', 'austria': 'Austria', 'at': 'Austria', 'österreich': 'Austria', 'south africa': 'South Africa', 'za': 'South Africa', 'südafrika': 'South Africa',
    'mexico': 'Mexico', 'mx': 'Mexico', 'mexiko': 'Mexico', 'saudi arabia': 'Saudi Arabia', 'sa': 'Saudi Arabia', 'saudi-arabien': 'Saudi Arabia'
  };
  function normSector(s) { var k = key(s).replace(/[-&,]/g, ' ').replace(/\s+/g, ' '); return SECTORS[key(s)] || SECTORS[k] || (norm(s) || null); }
  function normCountry(s) { return COUNTRIES[key(s)] || (norm(s) || null); }
  var CASH_RX = /\bcash\b|money market|futures?\b|forward|\bfx\b|derivat|\bswaps?\b|liquidit|geldmarkt|barmittel|bankguthaben|collateral|margin/i;
  var PROVIDERS = [[/ishares|blackrock/i, 'iShares'], [/xtrackers|\bdws\b/i, 'Xtrackers'], [/amundi|lyxor/i, 'Amundi'], [/vanguard/i, 'Vanguard'],
    [/\bspdr\b|state street|ssga/i, 'SPDR'], [/invesco/i, 'Invesco'], [/vaneck/i, 'VanEck'], [/wisdomtree/i, 'WisdomTree'], [/hsbc/i, 'HSBC'], [/ubs/i, 'UBS']];
  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12, mär: 3, mai: 5, okt: 10, dez: 12 };
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function findDate(text) {
    var m;
    if ((m = /\b(20\d\d)-(\d\d)-(\d\d)\b/.exec(text))) return m[1] + '-' + m[2] + '-' + m[3];
    if ((m = /\b(\d{1,2})[./](\d{1,2})[./](20\d\d)\b/.exec(text))) return m[3] + '-' + pad(+m[2]) + '-' + pad(+m[1]);
    if ((m = /\b([A-Za-zä]{3})[a-zä]*\.? (\d{1,2}),? (20\d\d)\b/.exec(text)) && MONTHS[m[1].toLowerCase()]) return m[3] + '-' + pad(MONTHS[m[1].toLowerCase()]) + '-' + pad(+m[2]);
    if ((m = /\b(\d{1,2})\.? ([A-Za-zä]{3})[a-zä]*\.? (20\d\d)\b/.exec(text)) && MONTHS[m[2].toLowerCase()]) return m[3] + '-' + pad(MONTHS[m[2].toLowerCase()]) + '-' + pad(+m[1]);
    return null;
  }

  function parseTable(rows, fileName) {
    rows = (rows || []).map(function (r) { return Array.isArray(r) ? r : []; });
    var h = findHeader(rows);
    if (!h) return { ok: false, error: 'no-header' };
    var cell = function (r, i) { return i >= 0 ? r[i] : undefined; };
    var data = rows.slice(h.row + 1).filter(function (r) { return norm(cell(r, h.name)) && cell(r, h.weight) !== undefined && norm(cell(r, h.weight)) !== ''; });
    if (!data.length) return { ok: false, error: 'no-rows' };
    var comma = likelyComma(data.map(function (r) { return cell(r, h.weight); }));
    var raw = [];
    data.forEach(function (r) {
      var w = parseNum(cell(r, h.weight), comma);
      if (w === null) return;
      raw.push({ r: r, w: w });
    });
    if (!raw.length) return { ok: false, error: 'no-rows' };
    var sum = raw.reduce(function (s, x) { return s + x.w; }, 0), max = raw.reduce(function (m, x) { return Math.max(m, x.w); }, 0);
    var scale = (sum > 20 || max > 1.5) ? 0.01 : 1; // percent vs fraction
    var holdings = [], cash = 0;
    raw.forEach(function (x) {
      var r = x.r, w = x.w * scale, name = norm(cell(r, h.name));
      var asset = norm(cell(r, h.asset)), sector = norm(cell(r, h.sector));
      if (CASH_RX.test(asset) || CASH_RX.test(sector) || /^(cash|eur|usd|gbp|jpy|chf)\b.*\b(cash|currency)?$/i.test(name) && /cash|currency|curr/i.test(name + ' ' + asset)) { cash += w; return; }
      if (!(w > 0)) { cash += w; return; }
      var isinRaw = norm(cell(r, h.isin)).toUpperCase(), sym = norm(cell(r, h.symbol)).toUpperCase();
      var cur = norm(cell(r, h.currency)).toUpperCase();
      holdings.push({
        symbol: sym && sym !== '-' ? sym : null,
        name: name,
        isin: ISIN_RX.test(isinRaw) ? ISIN_RX.exec(isinRaw)[1] : null,
        weight: w,
        sector: sector ? normSector(sector) : null,
        country: norm(cell(r, h.country)) ? normCountry(cell(r, h.country)) : null,
        currency: /^[A-Z]{3}$/.test(cur) ? cur : null
      });
    });
    if (!holdings.length) return { ok: false, error: 'no-rows' };
    holdings.sort(function (a, b) { return b.weight - a.weight; });
    var total = holdings.reduce(function (s, x) { return s + x.weight; }, 0) + cash;
    if (!(total > 0.3 && total < 1.6)) return { ok: false, error: 'weights', totalWeight: total };
    var pre = rows.slice(0, h.row).map(function (r) { return r.map(norm).join(' '); }).join(' \n ');
    var isinM = ISIN_RX.exec(pre), all = (fileName || '') + ' ' + pre + ' ' + rows[h.row].map(norm).join(' ');
    var provider = null;
    PROVIDERS.forEach(function (p) { if (!provider && p[0].test(all)) provider = p[1]; });
    return { ok: true, provider: provider, asOf: findDate(pre), isin: isinM ? isinM[1] : null, count: holdings.length,
      totalWeight: total, cashWeight: cash, holdings: holdings };
  }

  // ---- stored form ------------------------------------------------------------------
  function split(holdings, field) {
    var m = {};
    holdings.forEach(function (x) { if (x[field]) m[x[field]] = (m[x[field]] || 0) + x.weight; });
    return Object.keys(m).map(function (k) { return [k, m[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
  }
  function toRecord(parsed, opts) {
    opts = opts || {};
    var max = opts.max > 0 ? opts.max : MAX_HOLDINGS;
    var h = parsed.holdings || [];
    return {
      file: String(opts.fileName || '').slice(0, 120), provider: parsed.provider || null, asOf: parsed.asOf || null, isin: parsed.isin || null,
      importedAt: opts.now || new Date().toISOString().slice(0, 10), count: h.length, cash: parsed.cashWeight || 0,
      top: h.slice(0, max).map(function (x) { return [x.symbol, x.name, x.isin, x.weight, x.sector, x.country, x.currency]; }),
      sectors: split(h, 'sector'), countries: split(h, 'country'), currencies: split(h, 'currency')
    };
  }
  function toFundData(rec) {
    if (!rec || !Array.isArray(rec.top)) return null;
    var pairs = function (list, name) { return (list || []).map(function (p) { var o = { weight: p[1] }; o[name] = p[0]; return o; }); };
    var sectors = pairs(rec.sectors, 'sector');
    if (rec.cash > 0) sectors.push({ sector: 'Cash', weight: rec.cash });
    var curSum = (rec.currencies || []).reduce(function (s, p) { return s + p[1]; }, 0);
    return {
      name: rec.provider ? rec.provider + ' file' : 'Holdings file',
      ter: null,
      holdings: rec.top.map(function (x) { return { symbol: x[0] || null, name: x[1] || x[0] || '', isin: x[2] || null, weight: x[3] }; }),
      sectors: sectors,
      countries: pairs(rec.countries, 'country'),
      currencies: curSum >= 0.5 ? pairs(rec.currencies, 'currency') : null,
      source: 'file', asOf: rec.asOf || rec.importedAt || null, provider: rec.provider || null, fileCount: rec.count || rec.top.length
    };
  }

  // ---- storage (sensitive key; demo: memory only) -------------------------------------
  var _demo = null;
  function demoActive() { return typeof window !== 'undefined' && window.MaerminDemo && window.MaerminDemo.isActive && window.MaerminDemo.isActive(); }
  function store() { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } }
  function empty() { return { v: 1, funds: {} }; }
  function load() {
    if (demoActive()) return _demo || (_demo = empty());
    var ls = store();
    try {
      var o = ls ? JSON.parse(ls.getItem(KEY) || 'null') : null;
      return o && o.funds && typeof o.funds === 'object' ? o : empty();
    } catch (e) { return empty(); }
  }
  function save(o) {
    if (demoActive()) { _demo = o; return true; }
    var ls = store();
    try { if (ls) ls.setItem(KEY, JSON.stringify(o)); return true; } catch (e) { return false; }
  }
  function rootOf(symbol) { var s = String(symbol || '').trim().toUpperCase(), d = s.indexOf('.'); return d > 0 ? s.slice(0, d) : s; }
  function put(symbol, rec) { var o = load(); o.funds[rootOf(symbol)] = rec; return save(o) ? o : null; }
  function remove(symbol) { var o = load(); delete o.funds[rootOf(symbol)]; save(o); return o; }
  function fundDataMap() {
    var o = load(), out = {};
    Object.keys(o.funds).forEach(function (k) { var d = toFundData(o.funds[k]); if (d) { d.symbol = k; out[k] = d; } });
    return out;
  }

  // ---- export -----------------------------------------------------------------------
  // Text that a spreadsheet would read as a formula (= + - @, tab, CR) gets a
  // leading apostrophe; plain numbers stay numbers.
  function csvCell(v) {
    var s = v == null ? '' : String(v);
    if (!(s.trim() !== '' && isFinite(Number(s))) && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCsv(result) {
    var lines = [['Security', 'Key', 'Effective weight %', 'Direct weight %', 'Via funds weight %', 'Value EUR', 'Via'].join(',')];
    ((result && result.effectiveExposure) || []).forEach(function (x) {
      lines.push([csvCell(x.name), csvCell(x.key), (x.effectiveWeight * 100).toFixed(4), (x.directWeight * 100).toFixed(4), (x.fundedWeight * 100).toFixed(4),
        (x.valueEUR || 0).toFixed(2), csvCell((x.via || []).map(function (v) { return v.fund; }).join(' '))].join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }

  var api = { KEY: KEY, MAX_HOLDINGS: MAX_HOLDINGS, readTable: readTable, parseCsv: parseCsv, unzip: unzip, parseTable: parseTable, parseNum: parseNum,
    toRecord: toRecord, toFundData: toFundData, load: load, put: put, remove: remove, fundDataMap: fundDataMap, rootOf: rootOf, exportCsv: exportCsv,
    normSector: normSector, normCountry: normCountry };
  if (typeof window !== 'undefined') window.MaerminFundFiles = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
