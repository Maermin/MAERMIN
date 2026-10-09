// @ts-check
/**
 * MAERMIN — Import Mapping & Normalisation  (window.MaerminImportMapping)
 * ---------------------------------------------------------------------------
 * Preprocessing layer that sits IN FRONT of import-export-engine.js. The legacy
 * engine still does the actual import; this module makes that import *trustworthy*
 * and *debuggable* by solving the things that make CSV import a frustration:
 *
 *   1. Broker auto-detection from the CSV header (Trade Republic, DEGIRO,
 *      Scalable, Interactive Brokers, Coinbase, Binance, Kraken, CoinTracking),
 *      with a generic fallback.
 *   2. An EDITABLE column-mapping preview (which CSV column → which field) before
 *      anything is written.
 *   3. Locale-aware number ("1.234,56" vs "1,234.56") and date normalisation.
 *   4. Row-level error reporting — every rejected row says WHY.
 *   5. Duplicate detection against existing transactions (same key) so re-imports
 *      mark dupes instead of double-counting.
 *
 * Pure, dependency-light and self-contained: works in Node (module.exports) for
 * tests and in the browser (window.MaerminImportMapping). Reuses
 * window.MaerminTickers for symbol normalisation when present.
 *
 * Canonical transaction shape produced (matches the app's tx model):
 *   { category, type, symbol, symbolName?, quantity, price, fees, currency, date }
 */
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  /** Logical fields a mapping can target. `fee` maps onto the tx `fees` prop. */
  const FIELDS = ['date', 'type', 'symbol', 'quantity', 'price', 'fee', 'currency'];
  const REQUIRED = ['date', 'symbol', 'quantity', 'price'];

  // --- Broker signatures -----------------------------------------------------
  // Each broker is recognised by header tokens that are highly characteristic of
  // its export. `must` = all required (lowercased substring match against any
  // header); `score` bumps confidence. Highest scorer above threshold wins.
  const BROKERS = [
    { id: 'traderepublic', name: 'Trade Republic', category: 'stocks',
      must: ['isin'], nice: ['type', 'shares', 'price', 'transaction'] },
    { id: 'degiro', name: 'DEGIRO', category: 'stocks',
      must: ['isin', 'product'], nice: ['datum', 'date', 'quantity', 'aantal'] },
    { id: 'scalable', name: 'Scalable Capital', category: 'stocks',
      must: ['isin', 'reference'], nice: ['status', 'type', 'description'] },
    { id: 'ibkr', name: 'Interactive Brokers', category: 'stocks',
      must: ['symbol'], nice: ['t. price', 'comm/fee', 'date/time', 'proceeds', 'quantity'] },
    { id: 'coinbase', name: 'Coinbase', category: 'crypto',
      must: ['asset'], nice: ['transaction type', 'quantity transacted', 'spot price', 'timestamp'] },
    { id: 'binance', name: 'Binance', category: 'crypto',
      must: ['pair'], nice: ['executed', 'side', 'date(utc)', 'amount', 'fee'] },
    { id: 'kraken', name: 'Kraken', category: 'crypto',
      must: ['pair', 'vol'], nice: ['ordertxid', 'cost', 'fee', 'ordertype'] },
    { id: 'cointracking', name: 'CoinTracking', category: 'crypto',
      must: ['cur.'], nice: ['buy', 'sell', 'exchange', 'trade-group'] },
    // DACH-popular brokers, recognised by tokens characteristic enough not to
    // collide with the ISIN-based German brokers above.
    { id: 'trading212', name: 'Trading 212', category: 'stocks',
      must: ['no. of shares'], nice: ['ticker', 'action', 'price / share', 'isin', 'total'] },
    { id: 'revolut', name: 'Revolut', category: 'stocks',
      must: ['ticker', 'price per share'], nice: ['type', 'quantity', 'total amount'] },
    { id: 'flatex', name: 'flatex', category: 'stocks',
      must: ['isin', 'buchtag'], nice: ['stück', 'kurs', 'depot', 'nominal'] },
    { id: 'consorsbank', name: 'Consorsbank', category: 'stocks',
      must: ['isin', 'wertpapierbezeichnung'], nice: ['nominal', 'kurswert', 'ausführungskurs', 'buchungstag'] },
    { id: 'bitpanda', name: 'Bitpanda', category: 'crypto',
      must: ['asset', 'fee asset'], nice: ['fiat', 'transaction type', 'amount asset', 'amount fiat'] }
  ];

  /** Suggested column → field map per broker (header substrings, first match wins). */
  const BROKER_HINTS = {
    traderepublic: { date: ['date', 'datum'], type: ['type', 'transaction'], symbol: ['isin', 'ticker', 'symbol'], quantity: ['shares', 'anzahl', 'quantity'], price: ['price', 'kurs', 'share price'], fee: ['fee', 'gebühr'], currency: ['currency', 'währung'] },
    degiro:        { date: ['datum', 'date'], type: ['description', 'beschrijving'], symbol: ['isin'], quantity: ['quantity', 'aantal'], price: ['price', 'koers'], fee: ['fee', 'kosten', 'transaction costs'], currency: ['currency', 'valuta'] },
    scalable:      { date: ['date', 'datum'], type: ['type'], symbol: ['isin'], quantity: ['quantity', 'shares'], price: ['price', 'executionprice'], fee: ['fee'], currency: ['currency'] },
    ibkr:          { date: ['date/time', 'date'], type: ['buy/sell', 'type'], symbol: ['symbol'], quantity: ['quantity'], price: ['t. price', 'price'], fee: ['comm/fee', 'commission'], currency: ['currency'] },
    coinbase:      { date: ['timestamp', 'date'], type: ['transaction type'], symbol: ['asset'], quantity: ['quantity transacted', 'quantity'], price: ['spot price at transaction', 'spot price'], fee: ['fees', 'fee'], currency: ['spot price currency', 'currency'] },
    binance:       { date: ['date(utc)', 'date', 'utc_time'], type: ['side', 'operation'], symbol: ['pair', 'coin', 'market'], quantity: ['executed', 'amount', 'change'], price: ['price'], fee: ['fee'], currency: ['quote', 'currency'] },
    kraken:        { date: ['time'], type: ['type'], symbol: ['pair'], quantity: ['vol'], price: ['price'], fee: ['fee'], currency: ['currency'] },
    cointracking:  { date: ['date'], type: ['type'], symbol: ['buy', 'sell', 'cur.'], quantity: ['buy', 'sell'], price: ['price'], fee: ['fee'], currency: ['cur.'] },
    trading212:    { date: ['time', 'date'], type: ['action', 'type'], symbol: ['ticker', 'isin'], quantity: ['no. of shares', 'quantity'], price: ['price / share', 'price'], fee: ['fee', 'charge amount'], currency: ['currency (price / share)', 'currency'] },
    revolut:       { date: ['date', 'completed date'], type: ['type'], symbol: ['ticker'], quantity: ['quantity'], price: ['price per share'], fee: ['fee', 'commission'], currency: ['currency'] },
    flatex:        { date: ['buchtag', 'valuta', 'date'], type: ['transaktion', 'type', 'art'], symbol: ['isin'], quantity: ['stück', 'nominal', 'menge'], price: ['kurs', 'ausführungskurs'], fee: ['provision', 'entgelt', 'gebühr'], currency: ['währung', 'currency'] },
    consorsbank:   { date: ['buchungstag', 'datum', 'date'], type: ['transaktionstyp', 'art', 'type'], symbol: ['isin'], quantity: ['nominal', 'stück', 'menge'], price: ['ausführungskurs', 'kurs'], fee: ['provision', 'entgelt'], currency: ['währung', 'currency'] },
    bitpanda:      { date: ['timestamp', 'date'], type: ['transaction type', 'in/out'], symbol: ['asset'], quantity: ['amount asset', 'amount'], price: ['asset market price', 'price'], fee: ['fee'], currency: ['fiat', 'currency'] }
  };

  // Normalisation tables for transaction "type".
  // Single letters (IBKR 'B'/'S') only ever match the WHOLE value - matched as
  // a substring, 's' turned "Savings plan", "Purchase" or "Deposit" into sells.
  const BUY_WORDS  = ['buy', 'kauf', 'purchase', 'deposit', 'einzahlung', 'long', 'b', 'acquisition', 'sparplan', 'savings plan', 'savingsplan'];
  const SELL_WORDS = ['sell', 'verkauf', 'sale', 'withdrawal', 'auszahlung', 'short', 's', 'disposal'];
  const DIV_WORDS  = ['dividend', 'dividende', 'distribution', 'ausschüttung', 'interest', 'zinsen', 'staking', 'reward'];

  // --- helpers ---------------------------------------------------------------

  function lc(s) { return String(s == null ? '' : s).trim().toLowerCase(); }

  /** Detect the most likely broker from CSV headers. → {id,name,category,confidence} | null */
  function detectBroker(headers) {
    const hs = (headers || []).map(lc);
    let best = null;
    for (const b of BROKERS) {
      if (!b.must.every((m) => hs.some((h) => h.includes(m)))) continue;
      const niceHits = (b.nice || []).filter((n) => hs.some((h) => h.includes(n))).length;
      const score = b.must.length * 2 + niceHits;
      if (!best || score > best.score) best = { id: b.id, name: b.name, category: b.category, score, confidence: Math.min(1, score / (b.must.length * 2 + (b.nice || []).length)) };
    }
    return best;
  }

  /**
   * Locale-aware number parse. Handles "1.234,56" (DE), "1,234.56" (US), plain
   * decimals and currency-symbol noise. `locale` ('de'|'us') forces the decimal
   * separator when a value is genuinely ambiguous (e.g. "1,234"). → Number | NaN
   */
  function parseNumber(value, locale) {
    if (typeof value === 'number') return value;
    let s = String(value == null ? '' : value).trim();
    if (!s) return NaN;
    const neg = /^-/.test(s) || /\(.*\)/.test(s); // (123) accounting negatives
    s = s.replace(/[^\d.,]/g, '');
    if (!s) return NaN;
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
      // Rightmost separator is the decimal point.
      if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.'); // DE
      else s = s.replace(/,/g, '');                                        // US
    } else if (lastComma > -1) {
      const parts = s.split(',');
      const decimalLike = parts.length === 2 && parts[1].length !== 3;
      if (locale === 'de' || decimalLike) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, ''); // treat as thousands separator
    } else if (lastDot > -1) {
      const parts = s.split('.');
      const thousandsLike = locale === 'de' && parts.length === 2 && parts[1].length === 3;
      if (thousandsLike) s = s.replace(/\./g, '');
    }
    const n = parseFloat(s);
    if (isNaN(n)) return NaN;
    return neg ? -Math.abs(n) : n;
  }

  /**
   * Parse a date string into ISO `YYYY-MM-DD`. Understands ISO, `DD.MM.YYYY`,
   * `DD/MM/YYYY`, `MM/DD/YYYY` (with optional time). `locale` disambiguates the
   * slash format ('de' → day-first, 'us' → month-first). → 'YYYY-MM-DD' | null
   */
  function parseDate(value, locale) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return null;
    // ISO first (YYYY-MM-DD[...])
    let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    // DD.MM.YYYY  (always day-first)
    m = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
    if (m) return iso(m[3], m[2], m[1]);
    // D/M/Y or M/D/Y
    m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) {
      let a = +m[1], b = +m[2];
      let day, month;
      if (a > 12) { day = a; month = b; }
      else if (b > 12) { day = b; month = a; }
      else if (locale === 'us') { month = a; day = b; }
      else { day = a; month = b; } // default day-first (EU)
      return iso(m[3], month, day);
    }
    const t = Date.parse(raw);
    if (!isNaN(t)) { const d = new Date(t); return iso(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
    return null;
  }
  function iso(y, mo, d) {
    y = +y; if (y < 100) y += y < 70 ? 2000 : 1900;
    const p = (n) => String(n).padStart(2, '0');
    if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null;
    return `${y}-${p(mo)}-${p(d)}`;
  }

  /**
   * Classify a free-text transaction type → 'buy'|'sell'|'dividend', or null
   * when the value is empty or matches no known word (the caller decides:
   * applyMapping rejects an unknown type instead of guessing a buy).
   */
  function classifyType(value) {
    const t = lc(value);
    if (!t) return null;
    const hit = (w) => (w.length === 1 ? t === w : t.includes(w));
    if (DIV_WORDS.some(hit)) return 'dividend';
    if (SELL_WORDS.some(hit)) return 'sell';
    if (BUY_WORDS.some(hit)) return 'buy';
    return null;
  }
  /** Normalise a free-text transaction type → 'buy'|'sell'|'dividend' (unknown → 'buy'). */
  function normalizeType(value) {
    return classifyType(value) || 'buy';
  }

  /** Normalise a symbol via MaerminTickers when available, else uppercase trim. */
  function normalizeSymbol(raw, category) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    const T = (typeof window !== 'undefined' && window.MaerminTickers) || null;
    if (T && typeof T.parseSymbol === 'function') {
      try { const p = T.parseSymbol(s); if (p && p.symbol) return p.symbol; } catch { /* fall through */ }
    }
    return s.toUpperCase();
  }

  // --- CSV parsing (self-contained; quote + delimiter aware) ------------------

  /** Sniff the delimiter from the header line (',' ';' or tab). */
  function sniffDelimiter(line) {
    const counts = { ',': (line.match(/,/g) || []).length, ';': (line.match(/;/g) || []).length, '\t': (line.match(/\t/g) || []).length };
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || ',';
  }
  function splitLine(line, delim) {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === delim) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  }
  /** Parse CSV text → { headers:string[], rows:object[] }. */
  // Newlines inside quoted fields stay in their record; BOM stripped.
  function splitRecords(text) {
    const s = String(text || '').replace(/^\uFEFF/, '');
    const out = [];
    let cur = '', inQ = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"') { inQ = !inQ; cur += c; continue; }
      if (!inQ && (c === '\n' || c === '\r')) {
        if (c === '\r' && s[i + 1] === '\n') i++;
        if (cur.trim() !== '') out.push(cur);
        cur = '';
        continue;
      }
      cur += c;
    }
    if (cur.trim() !== '') out.push(cur);
    return out;
  }
  function parseCSV(text) {
    const lines = splitRecords(text);
    if (lines.length === 0) return { headers: [], rows: [] };
    const delim = sniffDelimiter(lines[0]);
    const headers = splitLine(lines[0], delim);
    const rows = lines.slice(1).map((line) => {
      const vals = splitLine(line, delim);
      const obj = {};
      headers.forEach((h, i) => { obj[h] = vals[i] != null ? vals[i] : ''; });
      return obj;
    });
    return { headers, rows };
  }

  // --- mapping ---------------------------------------------------------------

  /**
   * Suggest a column→field mapping. Uses the broker hint table when a broker is
   * known, then a generic keyword pass for any still-unmapped field. The result
   * is meant to be SHOWN to the user and edited before commit.
   * → { date, type, symbol, quantity, price, fee, currency } (header name | null)
   */
  function suggestMapping(headers, brokerId) {
    const hs = headers || [];
    const find = (subs) => hs.find((h) => subs.some((s) => lc(h).includes(s))) || null;
    const mapping = {};
    const hints = (brokerId && BROKER_HINTS[brokerId]) || {};
    for (const f of FIELDS) {
      mapping[f] = (hints[f] && find(hints[f])) || null;
    }
    const generic = { date: ['date', 'datum', 'time', 'zeit'], type: ['type', 'side', 'action', 'transaction', 'typ'], symbol: ['symbol', 'isin', 'ticker', 'asset', 'pair', 'coin', 'wkn'], quantity: ['quantity', 'qty', 'shares', 'amount', 'anzahl', 'vol', 'executed'], price: ['price', 'kurs', 'rate', 'koers'], fee: ['fee', 'fees', 'commission', 'gebühr', 'kosten'], currency: ['currency', 'währung', 'cur', 'valuta'] };
    for (const f of FIELDS) if (!mapping[f]) mapping[f] = find(generic[f]);
    return mapping;
  }

  /**
   * Apply a mapping to parsed rows. Returns canonical transactions plus a
   * row-accurate error report — nothing fails silently.
   * → { transactions:[], errors:[{row,reason,raw}], stats:{total,ok,failed} }
   */
  function applyMapping(rows, mapping, opts) {
    opts = opts || {};
    const category = opts.category || 'stocks';
    const locale = opts.locale;
    const transactions = [];
    const errors = [];
    (rows || []).forEach((row, i) => {
      const rowNo = i + 1; // 1-based, header is row 0
      const get = (f) => (mapping[f] ? row[mapping[f]] : undefined);
      // A CS2 market name is a skin whatever the file's default category says,
      // and keeps its spelling (market names are matched exactly; upper-casing it
      // as a stock ticker left it without a price and sent it to Yahoo).
      const T = tickersApi();
      const rawSym = String(get('symbol') == null ? '' : get('symbol')).trim();
      const isSkin = !!(T && T.looksLikeSkin && T.looksLikeSkin(rawSym));
      const rowCategory = isSkin ? 'skins' : category;
      const symbol = isSkin ? (T.normalizeSkinName ? T.normalizeSkinName(rawSym) : rawSym) : normalizeSymbol(rawSym, category);
      const date = parseDate(get('date'), locale);
      const rawQty = parseNumber(get('quantity'), locale);
      const quantity = Math.abs(rawQty);
      const price = parseNumber(get('price'), locale);
      const missing = [];
      if (!symbol) missing.push('symbol');
      if (!date) missing.push('date');
      if (!isFinite(quantity) || quantity <= 0) missing.push('quantity');
      if (!isFinite(price)) missing.push('price');
      if (missing.length) {
        errors.push({ row: rowNo, reason: __('imInvalid', 'invalid/missing: {list}', { list: missing.join(', ') }), raw: row });
        return;
      }
      // Type: a known word, or - with no type value - the quantity's sign
      // (exports mark sells with a negative quantity). An unrecognised type is
      // reported instead of silently booked as a buy.
      const rawType = String(get('type') == null ? '' : get('type')).trim();
      let type = classifyType(rawType);
      if (!type && rawType) {
        errors.push({ row: rowNo, reason: __('imUnknownType', 'unknown type "{type}" (map it or edit the file)', { type: rawType }), raw: row });
        return;
      }
      if (!type) type = rawQty < 0 ? 'sell' : 'buy';
      const feeNum = parseNumber(get('fee'), locale);
      transactions.push({
        category: rowCategory,
        type,
        symbol,
        quantity,
        price: Math.abs(price),
        fees: isFinite(feeNum) ? Math.abs(feeNum) : 0,
        currency: (String(get('currency') || opts.currency || 'EUR').trim().toUpperCase()).slice(0, 3) || 'EUR',
        date
      });
    });
    return { transactions, errors, stats: { total: (rows || []).length, ok: transactions.length, failed: errors.length } };
  }

  /**
   * CSV pasted into the quick Import dialog → { transactions, errors }. Same
   * parsing, type rules and row errors as the wizard (suggestMapping +
   * applyMapping); on top, a `category` column is honoured per row (falling
   * back to opts.category, default 'crypto') and a `notes` column is kept.
   */
  const QUICK_CATEGORIES = ['crypto', 'stocks', 'skins', 'commodities'];
  function quickCSV(text, opts) {
    opts = opts || {};
    const { headers, rows } = parseCSV(text);
    if (!headers.length || !rows.length) {
      return { transactions: [], errors: [{ row: 0, reason: __('imNoRows', 'no data rows below the header line'), raw: null }] };
    }
    if (isCoinTracking(headers)) {
      const ct = parseCoinTracking(text, opts);
      return { transactions: ct.transactions, errors: ct.errors, warnings: ct.warnings };
    }
    const TI = trackerApi();
    if (TI && TI.detect(headers)) {
      const tr = TI.parse(text, opts);
      return { transactions: tr.transactions, errors: tr.errors, warnings: tr.warnings };
    }
    const mapping = suggestMapping(headers);
    const catHeader = headers.find((h) => lc(h) === 'category');
    const notesHeader = headers.find((h) => lc(h) === 'notes' || lc(h) === 'note');
    const fallback = QUICK_CATEGORIES.indexOf(opts.category) > -1 ? opts.category : 'crypto';
    const transactions = [], errors = [];
    rows.forEach((row, i) => {
      const c = catHeader ? lc(row[catHeader]) : '';
      const category = QUICK_CATEGORIES.indexOf(c) > -1 ? c : fallback;
      const res = applyMapping([row], mapping, { category, locale: opts.locale, currency: opts.currency });
      res.errors.forEach((e) => errors.push(Object.assign({}, e, { row: i + 1 })));
      res.transactions.forEach((tx) => {
        if (notesHeader && row[notesHeader]) tx.notes = String(row[notesHeader]);
        transactions.push(tx);
      });
    });
    return { transactions, errors };
  }

  /** Stable identity key for duplicate detection. */
  function dupKey(tx) {
    return [tx.date, tx.type, lc(tx.symbol), round(tx.quantity), round(tx.price)].join('|');
  }
  function round(n) { return Math.round((Number(n) || 0) * 1e6) / 1e6; }

  /**
   * Flag candidates that already exist in `existing` (same dupKey). Does not
   * drop anything — the UI decides. → { unique:[], duplicates:[], marked:[] }
   */
  function findDuplicates(candidates, existing) {
    const seen = new Set((existing || []).map(dupKey));
    const unique = [], duplicates = [], marked = [];
    for (const tx of candidates || []) {
      const isDup = seen.has(dupKey(tx));
      const m = Object.assign({}, tx, { duplicate: isDup });
      marked.push(m);
      (isDup ? duplicates : unique).push(m);
      seen.add(dupKey(tx)); // also dedupe within the same import batch
    }
    return { unique, duplicates, marked };
  }

  /**
   * One-call pipeline: raw CSV → an editable PREVIEW (no writes). Pass the result
   * (after the user edits `mapping`) back to `commit()`.
   * → { headers, rows, broker, mapping, transactions, errors, duplicates, stats }
   */
  // Broker ids of the import wizard (features2.js) → ids of BROKERS.
  const WIZARD_BROKER_ALIASES = { traderepublic: 'traderepublic', interactivebrokers: 'ibkr' };
  function chosenBroker(id) {
    const key = lc(id);
    if (!key) return null;
    const b = BROKERS.find((x) => x.id === (WIZARD_BROKER_ALIASES[key] || key));
    return b ? { id: b.id, name: b.name, category: b.category, score: null, confidence: 1, chosen: true } : null;
  }

  function preview(csvText, opts) {
    opts = opts || {};
    const { headers, rows } = parseCSV(csvText);
    // The broker the user picked in the wizard wins over header sniffing (it
    // reported "Detected: Interactive Brokers" for a chosen Scalable file).
    const broker = chosenBroker(opts.broker) || detectBroker(headers);
    // Portfolio Performance and Parqet (tracker-import.js): an exact header
    // match is unambiguous, so it wins over a picked broker; own parser, no
    // column mapping.
    const TI = !opts.mapping ? trackerApi() : null;
    const tracker = TI ? TI.detect(headers) : null;
    if (tracker) {
      const tr = TI.parse(csvText, opts);
      const dupTr = findDuplicates(tr.transactions, opts.existing || []);
      return {
        headers, rows, broker: { id: tracker.id, name: tracker.name, category: 'stocks', score: null, confidence: 1 },
        category: 'stocks', mapping: suggestMapping(headers), fixedFormat: true, format: tr.format, warnings: tr.warnings,
        transactions: dupTr.marked, errors: tr.errors, duplicates: dupTr.duplicates.length,
        stats: Object.assign({}, tr.stats, { duplicates: dupTr.duplicates.length })
      };
    }
    // CoinTracking has a fixed two-leg layout: its own parser, no column mapping.
    if (!opts.mapping && (broker && broker.id === 'cointracking') && isCoinTracking(headers)) {
      const ct = parseCoinTracking(csvText, opts);
      const dupCt = findDuplicates(ct.transactions, opts.existing || []);
      return {
        headers, rows, broker, category: 'crypto', mapping: suggestMapping(headers, 'cointracking'),
        fixedFormat: true, warnings: ct.warnings,
        transactions: dupCt.marked, errors: ct.errors, duplicates: dupCt.duplicates.length,
        stats: Object.assign({}, ct.stats, { duplicates: dupCt.duplicates.length })
      };
    }
    const category = opts.category || (broker && broker.category) || 'stocks';
    const mapping = opts.mapping || suggestMapping(headers, broker && broker.id);
    const applied = applyMapping(rows, mapping, { category, locale: opts.locale, currency: opts.currency });
    const dup = findDuplicates(applied.transactions, opts.existing || []);
    return {
      headers, rows, broker, category, mapping,
      transactions: dup.marked,
      errors: applied.errors,
      duplicates: dup.duplicates.length,
      stats: Object.assign({ duplicates: dup.duplicates.length }, applied.stats)
    };
  }

  /**
   * Finalise a (possibly user-edited) preview into the rows to import. By default
   * duplicates are excluded; pass { includeDuplicates:true } to keep them.
   * → { transactions:[], skipped:number, errors:[] }
   */
  function commit(prev, opts) {
    opts = opts || {};
    const txs = (prev.transactions || []).filter((t) => opts.includeDuplicates || !t.duplicate);
    const clean = txs.map((t) => { const c = Object.assign({}, t); delete c.duplicate; return c; });
    return { transactions: clean, skipped: (prev.transactions || []).length - clean.length, errors: prev.errors || [] };
  }

  // --- reusable import presets (WI-8) ----------------------------------------
  // Named, saved column mappings so a returning user re-imports a file from the
  // same (unknown) broker without re-mapping. Persisted under
  // 'maermin_import_presets' (in the full-vault backup). A preset is:
  //   { id, name, delimiter, columnMap, dateFormat, signRules, category, currency }
  // columnMap is the same {field: header|null} shape suggestMapping produces.
  const PRESETS_KEY = 'maermin_import_presets';
  const PRESETS_SCHEMA = 1;

  function presetId() { return 'imp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function normalizeColumnMap(raw) {
    const out = {};
    const src = (raw && typeof raw === 'object') ? raw : {};
    for (const f of FIELDS) {
      const v = src[f];
      out[f] = (typeof v === 'string' && v.trim()) ? v : null;
    }
    return out;
  }

  function normalizePreset(p) {
    if (!p || typeof p !== 'object') return null;
    const name = String(p.name == null ? '' : p.name).trim();
    if (!name) return null;
    return {
      id: p.id ? String(p.id) : presetId(),
      name,
      delimiter: (typeof p.delimiter === 'string' && p.delimiter) ? p.delimiter : null,
      columnMap: normalizeColumnMap(p.columnMap || p.mapping),
      dateFormat: (typeof p.dateFormat === 'string' && p.dateFormat) ? p.dateFormat : null,
      signRules: (p.signRules && typeof p.signRules === 'object') ? p.signRules : {},
      category: (typeof p.category === 'string' && p.category) ? p.category : 'stocks',
      currency: (typeof p.currency === 'string' && p.currency) ? p.currency.toUpperCase().slice(0, 3) : null
    };
  }

  function normalizePresets(raw) {
    let obj = raw;
    if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch (e) { obj = null; } }
    if (!obj || typeof obj !== 'object') obj = {};
    const list = Array.isArray(obj.presets) ? obj.presets : (Array.isArray(obj) ? obj : []);
    const presets = [];
    list.forEach((p) => { const n = normalizePreset(p); if (n) presets.push(n); });
    return { version: PRESETS_SCHEMA, presets };
  }

  // Build a preset from a live preview/mapping (e.g. the wizard's current state).
  function buildPreset(input) {
    input = input || {};
    return normalizePreset({
      name: input.name,
      delimiter: input.delimiter,
      columnMap: input.columnMap || input.mapping,
      dateFormat: input.dateFormat || input.locale,
      signRules: input.signRules,
      category: input.category,
      currency: input.currency
    });
  }

  function upsertPreset(state, preset) {
    const st = normalizePresets(state);
    const n = normalizePreset(preset);
    if (!n) return st;
    const idx = st.presets.findIndex((p) => p.id === n.id || p.name.toLowerCase() === n.name.toLowerCase());
    if (idx >= 0) st.presets[idx] = Object.assign({}, n, { id: st.presets[idx].id });
    else st.presets.push(n);
    return st;
  }
  function removePreset(state, id) {
    const st = normalizePresets(state);
    st.presets = st.presets.filter((p) => p.id !== id);
    return st;
  }
  function getPreset(state, id) {
    return normalizePresets(state).presets.find((p) => p.id === id) || null;
  }

  // Apply a preset's columnMap to a concrete header list. A header that is no
  // longer present degrades to null (and is reported) — nothing throws.
  // → { mapping:{field:header|null}, missing:[field], category, currency }
  function applyPreset(preset, headers) {
    const p = normalizePreset(preset) || { columnMap: {}, category: 'stocks', currency: null };
    const hs = Array.isArray(headers) ? headers : [];
    const mapping = {}, missing = [];
    for (const f of FIELDS) {
      const want = p.columnMap[f];
      if (want && hs.indexOf(want) !== -1) mapping[f] = want;
      else { mapping[f] = null; if (want) missing.push(f); }
    }
    return { mapping, missing, category: p.category, currency: p.currency };
  }

  function loadPresets() {
    if (typeof localStorage === 'undefined') return { version: PRESETS_SCHEMA, presets: [] };
    try { return normalizePresets(localStorage.getItem(PRESETS_KEY)); } catch (e) { return { version: PRESETS_SCHEMA, presets: [] }; }
  }
  function savePresets(state) {
    if (typeof localStorage === 'undefined') return false;
    try { localStorage.setItem(PRESETS_KEY, JSON.stringify(normalizePresets(state))); return true; } catch (e) { return false; }
  }

  // --- ISIN -> priceable ticker ----------------------------------------------
  // Broker exports identify securities by ISIN, but quotes are fetched per
  // listing (AAPL, APC.DE, ...). An ISIN left in the symbol field imported fine
  // and then never got a price. The preview therefore proposes one listing per
  // ISIN, editable before the import; the ISIN stays on the transaction.

  /** Structural + check-digit (Luhn over the letter-expanded string) ISIN test. */
  function isISIN(value) {
    const s = String(value == null ? '' : value).trim().toUpperCase();
    if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(s)) return false;
    let digits = '';
    for (const ch of s) digits += (ch >= 'A' && ch <= 'Z') ? String(ch.charCodeAt(0) - 55) : ch;
    let sum = 0, dbl = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let d = digits.charCodeAt(i) - 48;
      if (dbl) { d *= 2; if (d > 9) d -= 9; }
      sum += d; dbl = !dbl;
    }
    return sum % 10 === 0;
  }

  // Yahoo listing suffix -> quote currency. No suffix = US listing.
  const SUFFIX_CURRENCY = {
    DE: 'EUR', F: 'EUR', MU: 'EUR', SG: 'EUR', BE: 'EUR', DU: 'EUR', HM: 'EUR', HA: 'EUR',
    PA: 'EUR', AS: 'EUR', MI: 'EUR', MC: 'EUR', BR: 'EUR', LS: 'EUR', VI: 'EUR', HE: 'EUR', IR: 'EUR',
    L: 'GBP', IL: 'USD', SW: 'CHF', ST: 'SEK', CO: 'DKK', OL: 'NOK', TO: 'CAD', V: 'CAD',
    T: 'JPY', HK: 'HKD', AX: 'AUD', SI: 'SGD', WA: 'PLN', PR: 'CZK'
  };
  // Within one currency, prefer the main venue (Xetra before the regional
  // German floors, Paris/Amsterdam/Milan before nothing in particular).
  const SUFFIX_RANK = ['DE', 'PA', 'AS', 'MI', 'MC', 'BR', 'VI', 'HE', 'LS', 'IR', 'F', 'SG', 'MU', 'BE', 'DU', 'HM', 'HA'];

  function listingSuffix(symbol) {
    const m = /\.([A-Z]{1,2})$/.exec(String(symbol || '').toUpperCase());
    return m ? m[1] : '';
  }
  /** Quote currency of a Yahoo symbol, from its exchange suffix (null if unknown). */
  function listingCurrency(symbol) {
    const sfx = listingSuffix(symbol);
    if (!sfx) return String(symbol || '').trim() ? 'USD' : null;
    return SUFFIX_CURRENCY[sfx] || null;
  }

  /**
   * Choose the listing to propose for a trade booked in `tradeCurrency`.
   * candidates: [{symbol, name, exchange, type, score}] (Worker `yfsearch`).
   * Same-currency listings win (so price and cost share a currency); among
   * them the main venue, then Yahoo's score. No same-currency listing -> the
   * best overall, flagged `currencyMismatch`. -> {symbol,name,currency,currencyMismatch} | null
   */
  function pickListing(candidates, tradeCurrency) {
    const list = (candidates || []).filter((c) => c && c.symbol);
    if (!list.length) return null;
    const want = String(tradeCurrency || 'EUR').toUpperCase();
    const rank = (c) => { const i = SUFFIX_RANK.indexOf(listingSuffix(c.symbol)); return i === -1 ? SUFFIX_RANK.length : i; };
    const byPref = (a, b) => (rank(a) - rank(b)) || ((b.score || 0) - (a.score || 0));
    const same = list.filter((c) => listingCurrency(c.symbol) === want).sort(byPref);
    const best = same[0] || list.slice().sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    return {
      symbol: String(best.symbol).toUpperCase(), name: best.name || '',
      currency: listingCurrency(best.symbol), currencyMismatch: !same.length
    };
  }

  /** Distinct ISINs in the symbol field, each with the trade currency most used for it. */
  function collectIsins(transactions) {
    const by = {};
    (transactions || []).forEach((tx) => {
      const sym = String((tx && tx.symbol) || '').toUpperCase();
      if (!isISIN(sym)) return;
      const cur = String(tx.currency || 'EUR').toUpperCase();
      by[sym] = by[sym] || {};
      by[sym][cur] = (by[sym][cur] || 0) + 1;
    });
    return Object.keys(by).map((isin) => ({
      isin, currency: Object.keys(by[isin]).sort((a, b) => by[isin][b] - by[isin][a])[0]
    }));
  }

  /**
   * Rewrite a preview with the chosen tickers. tickerMap: { ISIN: 'TICKER' | {symbol,name} }.
   * Mapped rows get symbol = ticker and keep `isin`; rows whose ISIN has no
   * ticker stay as they are and are flagged `unresolvedIsin`. Duplicates are
   * re-detected against `existing` under the ticker AND under the ISIN (rows
   * imported before this feature carry the ISIN as their symbol).
   */
  function applyTickerMap(prev, tickerMap, existing) {
    tickerMap = tickerMap || {};
    const seen = new Set((existing || []).map(dupKey));
    let unresolved = 0, mapped = 0, duplicates = 0;
    const transactions = (prev.transactions || []).map((tx) => {
      const isin = String(tx.isin || tx.symbol || '').toUpperCase();
      const out = Object.assign({}, tx);
      delete out.unresolvedIsin;
      if (isISIN(isin)) {
        const pick = tickerMap[isin];
        const ticker = String((pick && typeof pick === 'object' ? pick.symbol : pick) || '').trim().toUpperCase();
        out.isin = isin;
        if (ticker && !isISIN(ticker)) {
          out.symbol = ticker; mapped++;
          if (pick && typeof pick === 'object' && pick.name) out.symbolName = pick.name;
        } else { out.symbol = isin; out.unresolvedIsin = true; unresolved++; }
      }
      const keyTicker = dupKey(out);
      const keyIsin = out.isin ? dupKey(Object.assign({}, out, { symbol: out.isin })) : keyTicker;
      out.duplicate = seen.has(keyTicker) || seen.has(keyIsin);
      if (out.duplicate) duplicates++;
      seen.add(keyTicker); // also dedupe within the batch
      return out;
    });
    return Object.assign({}, prev, {
      transactions, duplicates,
      stats: Object.assign({}, prev.stats, { duplicates, isinMapped: mapped, isinUnresolved: unresolved })
    });
  }

  /**
   * Look up listings for each ISIN through the Worker's symbol search.
   * -> Promise<{ ISIN: [{symbol,name,exchange,type,score}] }> ([] on any failure).
   * fetchFn is injectable for tests.
   */
  function resolveIsins(isins, opts) {
    opts = opts || {};
    const base = String(opts.workerBase || '').trim().replace(/\/$/, '');
    const fetchFn = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    const out = {};
    const list = (isins || []).map((x) => (typeof x === 'string' ? x : x && x.isin)).filter(Boolean);
    if (!base || !fetchFn || !list.length) { list.forEach((i) => { out[i] = []; }); return Promise.resolve(out); }
    return list.reduce((chain, isin) => chain.then(() =>
      fetchFn(base + '?action=yfsearch&q=' + encodeURIComponent(isin) + '&type=stock')
        .then((r) => (r && r.ok ? r.json() : []))
        .then((rows) => { out[isin] = Array.isArray(rows) ? rows : []; })
        .catch(() => { out[isin] = []; })
    ), Promise.resolve()).then(() => out);
  }

  // --- CoinTracking ------------------------------------------------------------
  // The CoinTracking trade list has one row per movement with TWO legs (Buy and
  // Sell) and three columns all named "Cur.", so the column mapping above cannot
  // read it. This parser finds the columns by position relative to their
  // labels (EN + DE export, with or without the "value in EUR/USD" columns of
  // the full export) and books each row the way the ledger needs it:
  //   Trade fiat -> coin       buy  (price = fiat / quantity)
  //   Trade coin -> fiat       sell
  //   Trade coin -> coin       sell + buy, priced from the value columns
  //   Income, Staking, ...     buy at the market value (the cost basis)
  //   Spend                    sell at the market value (a disposal)
  //   Deposit / Withdrawal     not booked - a transfer between own wallets
  //   Donation, Gift, Lost ... not booked - reported, enter by hand if needed
  // Stablecoins count as the fiat they track. Coin tickers become CoinGecko ids
  // (the app prices crypto by id); unknown tickers are listed in `warnings`.

  // The ticker -> CoinGecko id table lives in ticker-validation.js (shared with
  // the price lookup). It loads after this file, so it is looked up per call.
  function trackerApi() {
    if (typeof window !== 'undefined' && window.MaerminTrackerImport) return window.MaerminTrackerImport;
    try { return typeof require === 'function' ? require('./tracker-import.js') : null; } catch (e) { return null; }
  }
  function tickersApi() {
    if (typeof window !== 'undefined' && window.MaerminTickers) return window.MaerminTickers;
    try { return typeof require === 'function' ? require('./ticker-validation.js') : null; } catch (e) { return null; }
  }
  const CT_FIAT = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'TRY', 'HKD', 'SGD', 'CNY', 'KRW', 'BRL', 'MXN', 'ZAR', 'INR', 'RUB'];
  /** Stablecoins -> the fiat they track. */
  const CT_STABLE = { USDT: 'USD', USDC: 'USD', BUSD: 'USD', DAI: 'USD', TUSD: 'USD', USDP: 'USD', FDUSD: 'USD', UST: 'USD', USTC: 'USD', FRAX: 'USD', PYUSD: 'USD', USDE: 'USD', GUSD: 'USD', USDS: 'USD', EURT: 'EUR', EURC: 'EUR', EUROC: 'EUR', EURS: 'EUR' };
  function ctFiat(cur) {
    const c = String(cur || '').trim().toUpperCase();
    if (CT_FIAT.indexOf(c) > -1) return c;
    return CT_STABLE[c] || null;
  }

  /** CoinTracking ticker -> { symbol, known }. Unknown tickers stay lowercase. */
  function coinGeckoId(ticker) {
    const t = String(ticker || '').trim().toUpperCase();
    if (!t) return { symbol: '', known: false };
    const T = tickersApi();
    const ids = (T && T.COINGECKO_IDS) || {};
    if (Object.prototype.hasOwnProperty.call(ids, t)) return { symbol: ids[t], known: true };
    return { symbol: t.toLowerCase(), known: false };
  }

  // Row type -> how it is booked. Keys are lowercase EN + DE labels.
  const CT_KIND = {
    trade: 'trade', handel: 'trade',
    deposit: 'transfer', einzahlung: 'transfer', withdrawal: 'transfer', auszahlung: 'transfer',
    income: 'income', einnahme: 'income', einkommen: 'income', 'other income': 'income', 'sonstige einnahme': 'income',
    mining: 'income', 'mining (commercial)': 'income', staking: 'income', airdrop: 'income',
    'gift/tip': 'income', 'gift/tip(in)': 'income', 'geschenk/trinkgeld': 'income', 'reward / bonus': 'income',
    'reward/bonus': 'income', 'belohnung / bonus': 'income', 'belohnung/bonus': 'income',
    'interest income': 'income', zinseinnahme: 'income', zinsen: 'income', 'lending income': 'income',
    'dividends income': 'income', dividendeneinnahme: 'income', masternode: 'income', minting: 'income',
    spend: 'spend', ausgabe: 'spend',
    donation: 'nobook', spende: 'nobook', gift: 'nobook', geschenk: 'nobook', 'gift(out)': 'nobook',
    lost: 'nobook', verlust: 'nobook', verloren: 'nobook', stolen: 'nobook', gestohlen: 'nobook'
  };

  function ctColumns(headers) {
    const hs = headers.map(lc);
    const first = (names, from) => {
      for (let i = from || 0; i < hs.length; i++) if (names.indexOf(hs[i]) > -1) return i;
      return -1;
    };
    // The "Cur." / "value in X" column belonging to a leg is the next one after it.
    const after = (start, test) => {
      if (start < 0) return -1;
      for (let i = start + 1; i < hs.length && i <= start + 3; i++) if (test(hs[i])) return i;
      return -1;
    };
    const isCur = (h) => h === 'cur.' || h === 'cur' || h === 'currency' || h === 'währung';
    const isVal = (h) => /^(value|wert)\b/.test(h) || /\b(value|wert) in\b/.test(h);
    const type = first(['type', 'typ']);
    const buy = first(['buy', 'kauf', 'buy amount', 'eingang']);
    const sell = first(['sell', 'verkauf', 'sell amount', 'ausgang']);
    const fee = first(['fee', 'gebühr', 'gebuehr', 'fee amount']);
    const col = {
      type, buy, buyCur: after(buy, isCur), buyVal: after(buy, isVal),
      sell, sellCur: after(sell, isCur), sellVal: after(sell, isVal),
      fee, feeCur: after(fee, isCur), feeVal: after(fee, isVal),
      exchange: first(['exchange', 'börse', 'boerse']),
      comment: first(['comment', 'kommentar']),
      tradeId: first(['trade id', 'trade-id', 'tx-id', 'txid']),
      date: first(['date', 'datum', 'trade date'])
    };
    // "value in EUR" -> EUR: the currency every value column is quoted in.
    const valHeader = [col.buyVal, col.sellVal, col.feeVal].filter((i) => i > -1).map((i) => headers[i])[0] || '';
    const m = /\b([A-Z]{3})\b\s*\)?\s*$/.exec(String(valHeader).toUpperCase());
    col.valueCurrency = m && CT_FIAT.indexOf(m[1]) > -1 ? m[1] : null;
    return col;
  }

  /** Does this header row look like a CoinTracking trade list? */
  function isCoinTracking(headers) {
    const c = ctColumns(headers || []);
    return c.type > -1 && c.buy > -1 && c.buyCur > -1 && c.sell > -1 && c.sellCur > -1 && c.date > -1;
  }

  /**
   * CoinTracking CSV -> { transactions, errors, warnings, stats, headers }.
   * errors: [{row, reason, raw}] for every row that is not booked (transfers
   * included, so nothing disappears silently). opts.locale forces '1.234,56'.
   */
  function parseCoinTracking(text, opts) {
    opts = opts || {};
    const lines = splitRecords(text);
    const out = { transactions: [], errors: [], warnings: [], headers: [], stats: { total: 0, ok: 0, failed: 0, transfers: 0 } };
    if (!lines.length) return out;
    const delim = sniffDelimiter(lines[0]);
    const headers = splitLine(lines[0], delim);
    out.headers = headers;
    const col = ctColumns(headers);
    if (!isCoinTracking(headers)) {
      out.errors.push({ row: 0, reason: __('imNotCt', 'not a CoinTracking trade list (expected the columns Type, Buy, Cur., Sell, Cur., Date)'), raw: null });
      return out;
    }
    const locale = opts.locale;
    const unknownCoins = {};
    let cryptoFees = 0;

    const num = (v) => { const n = parseNumber(v, locale); return isFinite(n) ? Math.abs(n) : 0; };

    lines.slice(1).forEach((line, i) => {
      const rowNo = i + 1;
      const v = splitLine(line, delim);
      const at = (k) => (col[k] > -1 && v[col[k]] != null ? v[col[k]] : '');
      const raw = {}; headers.forEach((h, k) => { raw[h + (raw[h] !== undefined ? '#' + k : '')] = v[k] != null ? v[k] : ''; });
      out.stats.total++;
      const skip = (reason) => { out.errors.push({ row: rowNo, reason, raw }); };

      const rawType = String(at('type')).trim();
      const kind = CT_KIND[lc(rawType)];
      const date = parseDate(at('date'), locale || 'de');
      if (!kind) { skip(__('imCtType', 'type "{type}" is not booked (margin, futures, fees and loans stay in CoinTracking)', { type: rawType })); return; }
      if (!date) { skip(__('imInvalid', 'invalid/missing: {list}', { list: 'date' })); return; }
      if (kind === 'transfer') { out.stats.transfers++; skip(__('imCtTransfer', '{type}: transfer between your own wallets, not a purchase or sale - not booked', { type: rawType })); return; }
      if (kind === 'nobook') { skip(__('imCtNoBook', '{type}: not booked automatically (no sale price) - enter it by hand if it should reduce the holding', { type: rawType })); return; }

      const buyAmt = num(at('buy')), buyCur = String(at('buyCur')).trim().toUpperCase();
      const sellAmt = num(at('sell')), sellCur = String(at('sellCur')).trim().toUpperCase();
      const feeAmt = num(at('fee')), feeCur = String(at('feeCur')).trim().toUpperCase();
      const buyVal = col.buyVal > -1 ? num(at('buyVal')) : 0;
      const sellVal = col.sellVal > -1 ? num(at('sellVal')) : 0;
      const feeVal = col.feeVal > -1 ? num(at('feeVal')) : 0;
      const valCur = col.valueCurrency;
      const notes = ['CoinTracking', rawType, at('exchange'), at('comment')].map((s) => String(s || '').trim()).filter(Boolean).join(' · ');
      const tradeId = String(at('tradeId') || '').trim();

      const coin = (ticker) => {
        const g = coinGeckoId(ticker);
        if (!g.known) unknownCoins[ticker] = true;
        return g.symbol;
      };
      const push = (tx) => {
        const row = Object.assign({ category: 'crypto', fees: 0, date, notes }, tx);
        row.symbolName = row.symbolName || '';
        if (tradeId) row.externalId = 'cointracking:' + tradeId + ':' + row.type;
        out.transactions.push(row);
      };
      // Fee in a currency the trade is priced in -> fees field; a fee paid in a
      // coin uses its value column, else it is reported (not deducted).
      const feeIn = (cur) => {
        if (!feeAmt) return 0;
        if (feeCur && ctFiat(feeCur) === cur) return feeAmt;
        if (feeVal && valCur === cur) return feeVal;
        cryptoFees++;
        return 0;
      };

      if (kind === 'trade') {
        if (!(buyAmt > 0) || !buyCur || !(sellAmt > 0) || !sellCur) { skip(__('imCtNoAmounts', 'trade without both amounts and currencies')); return; }
        const buyFiat = ctFiat(buyCur), sellFiat = ctFiat(sellCur);
        if (buyFiat && sellFiat) { skip(__('imCtFiat', 'fiat/stablecoin exchange ({from} -> {to}) - not booked', { from: sellCur, to: buyCur })); return; }
        if (sellFiat) {
          push({ type: 'buy', symbol: coin(buyCur), symbolName: buyCur, quantity: buyAmt, price: sellAmt / buyAmt, currency: sellFiat, fees: feeIn(sellFiat) });
        } else if (buyFiat) {
          push({ type: 'sell', symbol: coin(sellCur), symbolName: sellCur, quantity: sellAmt, price: buyAmt / sellAmt, currency: buyFiat, fees: feeIn(buyFiat) });
        } else {
          // Coin -> coin: a sale of one coin and a purchase of the other, both
          // at the market value CoinTracking recorded for the trade.
          const value = sellVal || buyVal;
          if (!(value > 0) || !valCur) { skip(__('imCtCoinCoin', 'coin-to-coin trade ({from} -> {to}) needs the "value in EUR" columns - export "CSV (full)" from CoinTracking', { from: sellCur, to: buyCur })); return; }
          const fee = feeIn(valCur);
          push({ type: 'sell', symbol: coin(sellCur), symbolName: sellCur, quantity: sellAmt, price: (sellVal || value) / sellAmt, currency: valCur, fees: fee });
          push({ type: 'buy', symbol: coin(buyCur), symbolName: buyCur, quantity: buyAmt, price: (buyVal || value) / buyAmt, currency: valCur });
        }
        return;
      }

      if (kind === 'income') {
        if (!(buyAmt > 0) || !buyCur) { skip(__('imCtNoAmount', '{type} without an amount', { type: rawType })); return; }
        if (ctFiat(buyCur)) { skip(__('imCtPaidIn', '{type} paid in {cur} - not a coin position, not booked', { type: rawType, cur: buyCur })); return; }
        const hasVal = buyVal > 0 && valCur;
        push({ type: 'buy', symbol: coin(buyCur), symbolName: buyCur, quantity: buyAmt,
          price: hasVal ? buyVal / buyAmt : 0, currency: hasVal ? valCur : (opts.currency || 'EUR'),
          fees: hasVal ? feeIn(valCur) : 0 });
        if (!hasVal) out.warnings.push(__('imCtZeroCost', 'Row {row}: {type} {amount} {cur} booked with a cost basis of 0 (no value column in the file).', { row: rowNo, type: rawType, amount: buyAmt, cur: buyCur }));
        return;
      }

      if (kind === 'spend') {
        if (!(sellAmt > 0) || !sellCur) { skip(__('imCtNoAmount', '{type} without an amount', { type: rawType })); return; }
        if (ctFiat(sellCur)) { skip(__('imCtPaidIn', '{type} paid in {cur} - not a coin position, not booked', { type: rawType, cur: sellCur })); return; }
        if (!(sellVal > 0) || !valCur) { skip(__('imCtSpendValue', '{type} of {cur} needs the "value in EUR" column to be booked as a sale', { type: rawType, cur: sellCur })); return; }
        push({ type: 'sell', symbol: coin(sellCur), symbolName: sellCur, quantity: sellAmt, price: sellVal / sellAmt, currency: valCur, fees: feeIn(valCur) });
      }
    });

    const unknown = Object.keys(unknownCoins);
    if (unknown.length) out.warnings.unshift(__('imCtNoCgId', 'No CoinGecko id known for {list} - imported under the ticker in lower case; edit the symbol if it gets no price.', { list: unknown.join(', ') }));
    if (cryptoFees) out.warnings.push(__('imCtCoinFees', '{n} {n:fee|fees} paid in a coin were not deducted (the file has no value for them).', { n: cryptoFees }));
    out.stats.ok = out.transactions.length;
    out.stats.failed = out.errors.length;
    return out;
  }

  const api = {
    FIELDS, REQUIRED, BROKERS,
    // CoinTracking
    coinGeckoId, isCoinTracking, parseCoinTracking,
    // ISIN -> ticker
    isISIN, listingCurrency, pickListing, collectIsins, applyTickerMap, resolveIsins,
    detectBroker, suggestMapping, applyMapping, quickCSV, findDuplicates,
    parseNumber, parseDate, normalizeType, normalizeSymbol, parseCSV,
    preview, commit,
    // presets (WI-8)
    PRESETS_KEY, PRESETS_SCHEMA,
    normalizePresets, buildPreset, upsertPreset, removePreset, getPreset, applyPreset,
    loadPresets, savePresets
  };

  if (typeof window !== 'undefined') window.MaerminImportMapping = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
