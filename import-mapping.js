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
      must: ['cur.'], nice: ['buy', 'sell', 'exchange', 'trade-group'] }
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
    cointracking:  { date: ['date'], type: ['type'], symbol: ['buy', 'sell', 'cur.'], quantity: ['buy', 'sell'], price: ['price'], fee: ['fee'], currency: ['cur.'] }
  };

  // Normalisation tables for transaction "type".
  const BUY_WORDS  = ['buy', 'kauf', 'purchase', 'deposit', 'einzahlung', 'long', 'b', 'acquisition'];
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

  /** Normalise a free-text transaction type → 'buy'|'sell'|'dividend'. */
  function normalizeType(value) {
    const t = lc(value);
    if (!t) return 'buy';
    if (DIV_WORDS.some((w) => t.includes(w))) return 'dividend';
    if (SELL_WORDS.some((w) => t === w || t.includes(w))) return 'sell';
    if (BUY_WORDS.some((w) => t === w || t.includes(w))) return 'buy';
    return 'buy';
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
  function parseCSV(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '');
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
      const quantity = Math.abs(parseNumber(get('quantity'), locale));
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
      const feeNum = parseNumber(get('fee'), locale);
      transactions.push({
        category,
        type: normalizeType(get('type')),
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

  const api = {
    FIELDS, REQUIRED, BROKERS,
    detectBroker, suggestMapping, applyMapping, findDuplicates,
    parseNumber, parseDate, normalizeType, normalizeSymbol, parseCSV,
    preview, commit
  };

  if (typeof window !== 'undefined') window.MaerminImportMapping = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
