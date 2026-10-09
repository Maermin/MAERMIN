// ============================================================================
// MAERMIN — Import from Portfolio Performance and Parqet  (window.MaerminTrackerImport)
// ----------------------------------------------------------------------------
// P4-8. Two portfolio trackers whose CSV export has a FIXED layout, so - like
// CoinTracking - they are read by their own parser instead of the column
// mapping. Both feed the same wizard preview, ISIN → ticker step and duplicate
// check (import-mapping.js preview()).
//
// Portfolio Performance - "Export CSV" → "Securities Account Transactions" /
// "Account Transactions" (DE: Depotumsätze / Kontoumsätze). Layout taken from
// the exporter's source (name.abuchen.portfolio datatransfer/csv/exporter/
// CSVExporter.java, master 2026-10-09): 15 columns in a fixed order, headers and
// type labels in the program language (English and German read here), numbers
// in the program locale ("1.234,56" with ';' or "1,234.56" with ','), date as
// 2024-01-15T09:30. Value = what moved on the account: purchase incl. fees and
// taxes, sale and dividend after them. Fees and Taxes are in the booking
// currency.
//
// Parqet - Activities → Export (CSV, ';'). Layout from a published export:
//   datetime;date;time;price;shares;amount;tax;fee;realizedgains;type;broker;
//   assettype;identifier;wkn;originalcurrency;currency;fxrate;holding;
//   holdingname;holdingnickname;exchange;avgholdingperiod
// price per share, amount = price × shares (fees apart), dot decimals.
//
// How rows are booked (both):
//   purchase, inbound delivery / transfer in  → buy  (price = gross / shares;
//                                                taxes on a purchase count as costs)
//   sale                                       → sell (taxes withheld on the sale
//                                                go to the note, not the cost basis)
//   dividend                                   → dividend (gross = net + taxes + fees,
//                                                foreign tax → withholdingTax)
//   everything else (cash, interest, fees, taxes, transfers between own accounts,
//   outbound delivery) → not booked, each row listed with the reason.
// File contents are data: no cell is ever evaluated or followed.
//
//   detect(headers)        → { id: 'pp'|'parqet'|'pp-language', name } | null
//   parse(text, opts)      → { format, transactions, errors, warnings, stats }
//
// Pure + dual-exported; tested in test/tracker-import.test.js.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  function im() {
    if (typeof window !== 'undefined' && window.MaerminImportMapping) return window.MaerminImportMapping;
    return require('./import-mapping.js');
  }
  function lc(s) { return String(s == null ? '' : s).trim().toLowerCase(); }
  function r6(n) { return Math.round(n * 1e6) / 1e6; }

  var PP_NAME = 'Portfolio Performance', PARQET_NAME = 'Parqet';

  // Exporter column order (CSVExporter.writeHeader), lower case.
  // Compared lower case with spaces as '_'.
  var PP_HEAD = {
    en: ['date', 'type', 'value', 'transaction_currency', 'gross_amount', 'currency_gross_amount', 'exchange_rate', 'fees', 'taxes', 'shares', 'isin', 'wkn', 'ticker_symbol', 'security_name', 'note'],
    de: ['datum', 'typ', 'wert', 'buchungswährung', 'bruttobetrag', 'währung_bruttobetrag', 'wechselkurs', 'gebühren', 'steuern', 'stück', 'isin', 'wkn', 'ticker-symbol', 'wertpapiername', 'notiz']
  };
  var PP_COL = { date: 0, type: 1, value: 2, currency: 3, fees: 7, taxes: 8, shares: 9, isin: 10, wkn: 11, ticker: 12, name: 13, note: 14 };
  // Transaction type labels (model/labels*.properties) → how they are booked.
  var PP_KIND = {
    buy: 'buy', kauf: 'buy',
    sell: 'sell', verkauf: 'sell',
    dividend: 'dividend', dividende: 'dividend',
    'delivery (inbound)': 'inbound', einlieferung: 'inbound',
    'delivery (outbound)': 'outbound', auslieferung: 'outbound',
    'transfer (inbound)': 'transfer', 'transfer (outbound)': 'transfer', 'umbuchung (eingang)': 'transfer', 'umbuchung (ausgang)': 'transfer',
    deposit: 'cash', einlage: 'cash', withdrawal: 'cash', entnahme: 'cash',
    interest: 'interest', zinsen: 'interest', 'interest charge': 'cash', zinsbelastung: 'cash',
    fees: 'cash', 'gebühren': 'cash', 'fees refund': 'cash', 'gebührenerstattung': 'cash',
    taxes: 'cash', steuern: 'cash', 'tax refund': 'cash', 'steuerrückerstattung': 'cash'
  };

  var PARQET_HEAD = ['datetime', 'date', 'price', 'shares', 'amount', 'tax', 'fee', 'type', 'assettype', 'identifier', 'currency'];
  var PARQET_KIND = { buy: 'buy', sell: 'sell', dividend: 'dividend', transferin: 'inbound', transferout: 'outbound', interest: 'interest',
    deposit: 'cash', withdrawal: 'cash', fee: 'cash', tax: 'cash', feerefund: 'cash', taxrefund: 'cash' };

  function same(a, b) { return a.length === b.length && a.every(function (x, i) { return x === b[i]; }); }

  function detect(headers) {
    var hs = (headers || []).map(function (h) { return lc(h).replace(/\s+/g, '_'); });
    if (same(hs, PP_HEAD.en) || same(hs, PP_HEAD.de)) return { id: 'pp', name: PP_NAME, lang: same(hs, PP_HEAD.de) ? 'de' : 'en' };
    // Same layout in another program language: recognised, not read.
    if (hs.length === 15 && hs[10] === 'isin' && hs[11] === 'wkn') return { id: 'pp-language', name: PP_NAME };
    if (PARQET_HEAD.every(function (h) { return hs.indexOf(h) > -1; })) return { id: 'parqet', name: PARQET_NAME };
    return null;
  }

  // PP writes every amount with exactly two decimals ("#,##0.00"), so the
  // third-last character of the first Value cell is the decimal separator.
  function ppDecimal(values) {
    for (var i = 0; i < values.length; i++) {
      var s = String(values[i] || '').trim();
      if (s.length >= 4 && /\d\d$/.test(s)) { var c = s.charAt(s.length - 3); if (c === ',' || c === '.') return c; }
    }
    return '.';
  }
  function numWith(dec) {
    return function (v) {
      var s = String(v == null ? '' : v).trim();
      if (!s) return 0;
      var neg = s.indexOf('-') > -1;
      s = s.replace(new RegExp('[^0-9' + (dec === ',' ? ',' : '.') + ']', 'g'), '');
      if (dec === ',') s = s.replace(',', '.');
      var n = parseFloat(s);
      return isFinite(n) ? (neg ? -n : n) : NaN;
    };
  }
  function isDomestic(isin) { return /^DE/i.test(String(isin || '').trim()); }

  function empty(format) {
    return { format: format, transactions: [], errors: [], warnings: [], stats: { total: 0, ok: 0, failed: 0 } };
  }

  function notBooked(kind, label) {
    switch (kind) {
      case 'transfer': return __('tiTransfer', '{type}: transfer between your own accounts - not booked', { type: label });
      case 'outbound': return __('tiOutbound', '{type}: securities moved out are not a sale - not booked; reduce the holding by hand if it left for good', { type: label });
      case 'interest': return __('tiInterest', '{type}: interest on cash is not imported', { type: label });
      case 'cash': return __('tiCash', '{type}: cash booking, no security - not booked', { type: label });
      default: return __('tiUnknownType', 'type "{type}" is not booked', { type: label });
    }
  }

  // One booked row from the normalised figures of either format.
  // g = { kind, date, symbol, name, isin, shares, gross, fees, taxes, currency, category, note }
  function book(g, out, rowNo, raw, source) {
    var notes = [source, g.label, g.note].filter(function (s) { return String(s || '').trim(); }).join(' · ');
    var base = { category: g.category || 'stocks', symbol: g.symbol, symbolName: g.name || '', currency: g.currency, date: g.date, notes: notes };
    if (g.kind === 'buy' || g.kind === 'inbound') {
      if (!(g.shares > 0)) { out.errors.push({ row: rowNo, reason: __('imInvalid', 'invalid/missing: {list}', { list: 'shares' }), raw: raw }); return; }
      out.transactions.push(Object.assign(base, { type: 'buy', quantity: g.shares, price: r6(g.gross / g.shares), fees: r6(g.fees + g.taxes) }));
      return;
    }
    if (g.kind === 'sell') {
      if (!(g.shares > 0)) { out.errors.push({ row: rowNo, reason: __('imInvalid', 'invalid/missing: {list}', { list: 'shares' }), raw: raw }); return; }
      if (g.taxes) base.notes = [base.notes, __('tiSaleTax', 'tax withheld on the sale: {amount} {cur}', { amount: g.taxes, cur: g.currency })].join(' · ');
      out.transactions.push(Object.assign(base, { type: 'sell', quantity: g.shares, price: r6(g.gross / g.shares), fees: r6(g.fees) }));
      return;
    }
    // dividend: keep quantity × price = gross (the tax report reads it so)
    var qty = g.shares > 0 ? g.shares : 1;
    var wht = 0;
    if (g.taxes) {
      if (isDomestic(g.isin)) base.notes = [base.notes, __('tiDomesticTax', 'German tax withheld: {amount} {cur}', { amount: g.taxes, cur: g.currency })].join(' · ');
      else { wht = g.taxes; out.foreignTaxRows++; }
    }
    out.transactions.push(Object.assign(base, { type: 'dividend', quantity: qty, price: r6(g.gross / qty), fees: r6(g.fees), withholdingTax: r6(wht) }));
  }

  function finish(out) {
    if (out.foreignTaxRows) out.warnings.push(__('tiForeignTax', '{n} {n:dividend|dividends} with taxes: booked as foreign withholding tax. If German tax was also deducted, correct the amount in the transaction.', { n: out.foreignTaxRows }));
    delete out.foreignTaxRows;
    out.stats.ok = out.transactions.length;
    out.stats.failed = out.errors.length;
    return out;
  }

  function parsePP(headers, rows) {
    var out = empty('pp');
    out.foreignTaxRows = 0;
    var valueKey = headers[PP_COL.value];
    var num = numWith(ppDecimal(rows.map(function (r) { return r[valueKey]; })));
    var M = im();
    rows.forEach(function (row, i) {
      var rowNo = i + 1;
      out.stats.total++;
      var at = function (k) { return String(row[headers[PP_COL[k]]] == null ? '' : row[headers[PP_COL[k]]]).trim(); };
      var label = at('type');
      var kind = PP_KIND[lc(label)];
      if (kind !== 'buy' && kind !== 'sell' && kind !== 'dividend' && kind !== 'inbound') {
        out.errors.push({ row: rowNo, reason: notBooked(kind, label), raw: row });
        return;
      }
      var date = M.parseDate(at('date'));
      var value = Math.abs(num(at('value'))), fees = Math.abs(num(at('fees'))), taxes = Math.abs(num(at('taxes'))), shares = Math.abs(num(at('shares')));
      var isin = at('isin').toUpperCase(), ticker = at('ticker');
      var symbol = isin || ticker.toUpperCase();
      var missing = [];
      if (!date) missing.push('date');
      if (!symbol) missing.push('isin');
      if (!isFinite(value) || !(value > 0)) missing.push('value');
      if (!isFinite(fees) || !isFinite(taxes) || !isFinite(shares)) missing.push('number');
      if (missing.length) { out.errors.push({ row: rowNo, reason: __('imInvalid', 'invalid/missing: {list}', { list: missing.join(', ') }), raw: row }); return; }
      // Value is the cash movement: purchases include fees and taxes, sales and
      // dividends are after them.
      var gross = (kind === 'buy' || kind === 'inbound') ? value - fees - taxes : value + fees + taxes;
      if (!(gross > 0)) { out.errors.push({ row: rowNo, reason: __('imInvalid', 'invalid/missing: {list}', { list: 'value' }), raw: row }); return; }
      book({ kind: kind, label: label, date: date, symbol: symbol, name: at('name'), isin: isin, shares: shares, gross: gross, fees: fees, taxes: taxes,
        currency: (at('currency') || 'EUR').toUpperCase().slice(0, 3), note: at('note') }, out, rowNo, row, PP_NAME);
    });
    return finish(out);
  }

  function parseParqet(headers, rows, opts) {
    var out = empty('parqet');
    out.foreignTaxRows = 0;
    var M = im();
    var key = {};
    headers.forEach(function (h) { key[lc(h)] = h; });
    var unknownCoins = {};
    rows.forEach(function (row, i) {
      var rowNo = i + 1;
      out.stats.total++;
      var at = function (k) { return key[k] && row[key[k]] != null ? String(row[key[k]]).trim() : ''; };
      var n = function (k) { var v = M.parseNumber(at(k)); return isFinite(v) ? Math.abs(v) : 0; };
      var label = at('type');
      var kind = PARQET_KIND[lc(label)];
      if (kind !== 'buy' && kind !== 'sell' && kind !== 'dividend' && kind !== 'inbound') {
        out.errors.push({ row: rowNo, reason: notBooked(kind, label), raw: row });
        return;
      }
      var asset = lc(at('assettype'));
      if (asset !== 'security' && asset !== 'crypto') {
        out.errors.push({ row: rowNo, reason: __('tiAssetType', 'asset type "{type}" is not imported (securities and crypto only)', { type: at('assettype') }), raw: row });
        return;
      }
      // "date" is the local trade day; "datetime" is UTC and can be the day before.
      var date = M.parseDate(at('date'), 'de') || M.parseDate(at('datetime'));
      var id = at('identifier') || at('wkn');
      var symbol = '', category = 'stocks', isin = '';
      if (asset === 'crypto') {
        var g = M.coinGeckoId(id);
        if (id && !g.known) unknownCoins[id.toUpperCase()] = true;
        symbol = g.symbol; category = 'crypto';
      } else {
        symbol = id.toUpperCase();
        isin = M.isISIN(symbol) ? symbol : '';
      }
      var shares = n('shares'), price = n('price');
      var gross = n('amount') || r6(price * shares);
      var missing = [];
      if (!date) missing.push('date');
      if (!symbol) missing.push('identifier');
      if (!(gross > 0)) missing.push('amount');
      if (missing.length) { out.errors.push({ row: rowNo, reason: __('imInvalid', 'invalid/missing: {list}', { list: missing.join(', ') }), raw: row }); return; }
      book({ kind: kind, label: label, date: date, symbol: symbol, name: at('holdingname') || (asset === 'crypto' ? id.toUpperCase() : ''), isin: isin,
        shares: shares, gross: gross, fees: n('fee'), taxes: n('tax'), category: category,
        currency: (at('currency') || (opts && opts.currency) || 'EUR').toUpperCase().slice(0, 3) }, out, rowNo, row, PARQET_NAME);
    });
    var unknown = Object.keys(unknownCoins);
    if (unknown.length) out.warnings.push(__('imCtNoCgId', 'No CoinGecko id known for {list} - imported under the ticker in lower case; edit the symbol if it gets no price.', { list: unknown.join(', ') }));
    return finish(out);
  }

  function parse(text, opts) {
    var M = im();
    var csv = M.parseCSV(text);
    var fmt = detect(csv.headers);
    if (!fmt) {
      var none = empty(null);
      none.errors.push({ row: 0, reason: __('tiNotTracker', 'not a Portfolio Performance or Parqet export (the header row does not match)'), raw: null });
      return none;
    }
    if (fmt.id === 'pp-language') {
      var lang = empty('pp');
      lang.errors.push({ row: 0, reason: __('tiPpLanguage', 'Portfolio Performance export in another language: only English and German exports are read - switch the program language and export again'), raw: null });
      return lang;
    }
    return fmt.id === 'pp' ? parsePP(csv.headers, csv.rows) : parseParqet(csv.headers, csv.rows, opts);
  }

  var api = { detect: detect, parse: parse, PP_HEAD: PP_HEAD };
  if (typeof window !== 'undefined') window.MaerminTrackerImport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
