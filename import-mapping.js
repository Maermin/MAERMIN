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
      const symbol = normalizeSymbol(get('symbol'), category);
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
        errors.push({ row: rowNo, reason: 'invalid/missing: ' + missing.join(', '), raw: row });
        return;
      }
      // Type: a known word, or - with no type value - the quantity's sign
      // (exports mark sells with a negative quantity). An unrecognised type is
      // reported instead of silently booked as a buy.
      const rawType = String(get('type') == null ? '' : get('type')).trim();
      let type = classifyType(rawType);
      if (!type && rawType) {
        errors.push({ row: rowNo, reason: 'unknown type "' + rawType + '" (map it or edit the file)', raw: row });
        return;
      }
      if (!type) type = rawQty < 0 ? 'sell' : 'buy';
      const feeNum = parseNumber(get('fee'), locale);
      transactions.push({
        category,
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
      return { transactions: [], errors: [{ row: 0, reason: 'no data rows below the header line', raw: null }] };
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
  function preview(csvText, opts) {
    opts = opts || {};
    const { headers, rows } = parseCSV(csvText);
    const broker = detectBroker(headers);
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

  const api = {
    FIELDS, REQUIRED, BROKERS,
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
