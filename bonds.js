// ============================================================================
// MAERMIN — Bonds  (window.MaerminBonds)
// ----------------------------------------------------------------------------
// P5-3.9. A bond is a built-in category 'bonds' inside the EXISTING
// transaction model, so FIFO, gains, value and returns need no special case:
//
//   quantity = nominal (e.g. 10000), price = clean price as a fraction of the
//   nominal (101.5 % -> 1.015), so quantity x price is the market value in the
//   bond's currency. A trade may carry `accruedInterest` (Stückzinsen, > 0):
//   paid on a buy, received on a sale.
//
// Terms per symbol live in 'maermin_bonds' (encrypted at rest, in the backup):
//
//   { version: 1, bonds: { SYMBOL: { name, coupon (% p.a.), frequency
//     (1|2|4|12), maturity, issueDate?, dayCount ('act/act' ICMA | '30/360'
//     (30E/360) | 'act/360' | 'act/365'), currency, price? (% manual quote),
//     priceDate? } } }
//
// Coupons are booked like the interest of a Net-Worth account
// (interest-engine.js): one `type:'interest'` row per coupon date for the
// nominal held the day before, marked (portfolio, symbol, couponDate) so a
// re-run never double-books, and posted to the same interest ledger. At
// maturity the nominal still held is redeemed: a sale at 100 %, so FIFO
// realises the gain or loss against the purchase price.
//
// Tax (German rules, tax-report-builder.js): coupons are interest income;
// accrued interest paid on a purchase is negative capital income of that
// year and accrued interest received on a sale positive capital income, both
// in the 'other' pot like the gain or loss of the bond itself.
//
// Pure layer Node-tested in test/bonds.test.js; the Panel only runs in the
// browser.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var STORAGE_KEY = 'maermin_bonds';
  var SCHEMA = 1;
  var CATEGORY = 'bonds';
  var FREQUENCIES = [1, 2, 4, 12];
  var DAY_COUNTS = ['act/act', '30/360', 'act/360', 'act/365'];
  var DAY_MS = 86400000;

  function num(x) { var n = typeof x === 'number' ? x : parseFloat(x); return isFinite(n) ? n : 0; }
  function str(x) { return String(x == null ? '' : x).trim(); }
  function ymd(d) { var s = str(d).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function uid() { return 'bnd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function newId() {
    return (typeof window !== 'undefined' && window.MaerminUtils && window.MaerminUtils.generateId) ? window.MaerminUtils.generateId() : uid();
  }

  function parts(iso) { return [Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10))]; }
  function lastDay(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function iso(y, m, d) { return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d; }
  function days(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY_MS); }
  // The date n months before `anchor`; a month-end anchor stays on month ends,
  // otherwise the day is clamped to the shorter month.
  function monthsBack(anchor, n) {
    var p = parts(anchor), eom = p[2] === lastDay(p[0], p[1]);
    var total = p[0] * 12 + (p[1] - 1) - n;
    var y = Math.floor(total / 12), m = total - y * 12 + 1;
    var ld = lastDay(y, m);
    return iso(y, m, eom ? ld : Math.min(p[2], ld));
  }

  // ---- terms -------------------------------------------------------------------
  function cleanTerms(bt) {
    if (!bt || typeof bt !== 'object') return null;
    var maturity = ymd(bt.maturity);
    var coupon = parseFloat(bt.coupon);
    if (!maturity || !(isFinite(coupon) && coupon >= 0)) return null;
    var f = parseInt(bt.frequency, 10);
    var out = {
      name: str(bt.name), coupon: coupon, frequency: FREQUENCIES.indexOf(f) !== -1 ? f : 1, maturity: maturity,
      dayCount: DAY_COUNTS.indexOf(str(bt.dayCount)) !== -1 ? str(bt.dayCount) : 'act/act',
      currency: /^[A-Z]{3}$/.test(str(bt.currency).toUpperCase()) ? str(bt.currency).toUpperCase() : 'EUR'
    };
    if (ymd(bt.issueDate)) out.issueDate = ymd(bt.issueDate);
    var price = parseFloat(bt.price);
    if (isFinite(price) && price > 0) { out.price = price; if (ymd(bt.priceDate)) out.priceDate = ymd(bt.priceDate); }
    return out;
  }
  function normalize(raw) {
    var obj = raw;
    if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch (e) { obj = null; } }
    if (!obj || typeof obj !== 'object') obj = {};
    var src = (obj.bonds && typeof obj.bonds === 'object') ? obj.bonds : {};
    var bonds = {};
    Object.keys(src).forEach(function (k) {
      var sym = str(k).toUpperCase();
      var bt = cleanTerms(src[k]);
      if (sym && bt) bonds[sym] = bt;
    });
    return { version: SCHEMA, bonds: bonds };
  }
  function termsOf(store, symbol) { return normalize(store).bonds[str(symbol).toUpperCase()] || null; }

  // ---- schedule ----------------------------------------------------------------
  // Coupon dates in (from, to], counted back from maturity; none on or before
  // the issue date.
  function schedule(terms, from, to) {
    var bt = cleanTerms(terms);
    if (!bt) return [];
    var step = 12 / bt.frequency, out = [];
    for (var k = 0; k < 1200; k++) {
      var c = monthsBack(bt.maturity, k * step);
      if ((from && c <= from) || (bt.issueDate && c <= bt.issueDate)) break;
      if (!to || c <= to) out.push(c);
    }
    return out.reverse();
  }
  // The coupon period a date falls in: prev <= date < next (next null from
  // maturity on). prev may lie before the issue date.
  function period(terms, date) {
    var bt = cleanTerms(terms), d = ymd(date);
    if (!bt || !d) return { prev: null, next: null };
    if (d >= bt.maturity) return { prev: bt.maturity, next: null };
    var step = 12 / bt.frequency, next = bt.maturity;
    for (var k = 1; k < 1200; k++) {
      var c = monthsBack(bt.maturity, k * step);
      if (c <= d) return { prev: c, next: next };
      next = c;
    }
    return { prev: null, next: null };
  }

  // Share of a year between start and end under the day count; act/act ICMA
  // measures against the coupon period [ps, pe].
  function yearFraction(dayCount, start, end, ps, pe, frequency) {
    if (end <= start) return 0;
    if (dayCount === '30/360') {
      var a = parts(start), b = parts(end);
      return (360 * (b[0] - a[0]) + 30 * (b[1] - a[1]) + (Math.min(b[2], 30) - Math.min(a[2], 30))) / 360;
    }
    if (dayCount === 'act/360') return days(start, end) / 360;
    if (dayCount === 'act/365') return days(start, end) / 365;
    return days(start, end) / (frequency * days(ps, pe));
  }

  // Accrued interest (Stückzinsen) on `nominal` for a trade valued on `date`.
  function accrued(terms, nominal, date) {
    var bt = cleanTerms(terms), d = ymd(date);
    if (!bt || !d || d >= bt.maturity || (bt.issueDate && d <= bt.issueDate)) return 0;
    var p = period(bt, d);
    if (!p.prev || !p.next) return 0;
    var start = (bt.issueDate && bt.issueDate > p.prev) ? bt.issueDate : p.prev;
    return num(nominal) * bt.coupon / 100 * yearFraction(bt.dayCount, start, d, p.prev, p.next, bt.frequency);
  }
  // The coupon paid on `couponDate` for `nominal` (a short first period runs
  // from the issue date).
  function couponAmount(terms, nominal, couponDate) {
    var bt = cleanTerms(terms), c = ymd(couponDate);
    if (!bt || !c) return 0;
    var pe = c, ps = monthsBack(c, 12 / bt.frequency);
    var start = (bt.issueDate && bt.issueDate > ps) ? bt.issueDate : ps;
    return num(nominal) * bt.coupon / 100 * yearFraction(bt.dayCount, start, pe, ps, pe, bt.frequency);
  }

  // Yield to maturity (decimal, compounded per coupon period) for a clean
  // price in % on `settle`. For information only.
  function ytm(terms, pricePct, settle) {
    var bt = cleanTerms(terms), s = ymd(settle);
    if (!bt || !s || s >= bt.maturity || !(num(pricePct) > 0)) return null;
    var dirty = num(pricePct) + accrued(bt, 100, s);
    var p = period(bt, s);
    var w = days(s, p.next) / days(p.prev, p.next);
    var flows = schedule(bt, s, bt.maturity).map(function (c, i) {
      return { n: i + w, cf: couponAmount(bt, 100, c) + (c === bt.maturity ? 100 : 0) };
    });
    var f = bt.frequency;
    function pv(y) { return flows.reduce(function (acc, x) { return acc + x.cf / Math.pow(1 + y / f, x.n); }, 0); }
    var lo = -0.5, hi = 1;
    for (var i = 0; i < 200; i++) {
      var mid = (lo + hi) / 2;
      if (pv(mid) > dirty) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // ---- form ------------------------------------------------------------------
  // "10.000" / "10,000" / "98,5" / "98.5" -> numbers.
  function parseAmount(v) {
    if (typeof v === 'number') return v;
    var s = str(v).replace(/\s|%/g, '');
    if (!s) return NaN;
    var c = s.lastIndexOf(','), d = s.lastIndexOf('.');
    if (c !== -1 && d !== -1) s = c > d ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (c !== -1) s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    return parseFloat(s);
  }
  function fromForm(o) {
    o = o || {};
    return { quantity: parseAmount(o.nominal), price: parseAmount(o.pricePct) / 100 };
  }

  // ---- prices ------------------------------------------------------------------
  // { SYMBOL: price per unit of nominal in EUR } from the manual quotes;
  // toEUR(value, currency) converts.
  function priceMap(store, toEUR) {
    var conv = typeof toEUR === 'function' ? toEUR : function (v) { return v; };
    var bonds = normalize(store).bonds, out = {};
    Object.keys(bonds).forEach(function (s) {
      var b = bonds[s];
      if (b.price > 0) { var v = conv(b.price / 100, b.currency); if (v > 0) { out[s] = v; out[s.toLowerCase()] = v; } }
    });
    return out;
  }

  // ---- coupon and redemption catch-up --------------------------------------------
  function isBondTrade(tx) { return !!(tx && tx.category === CATEGORY && (tx.type === 'buy' || tx.type === 'sell') && ymd(tx.date)); }
  function pidOf(tx) { return str(tx && tx.portfolioId) || 'default'; }

  // opts = { transactions, bonds (map or store), asOf, ledger? }
  // -> { transactions (input array when nothing was booked), created,
  //      postings, ledger }
  function catchUp(opts) {
    opts = opts || {};
    var txs = Array.isArray(opts.transactions) ? opts.transactions : [];
    var map = (opts.bonds && opts.bonds.bonds) ? normalize(opts.bonds).bonds : normalize({ bonds: opts.bonds || {} }).bonds;
    var asOf = ymd(opts.asOf) || new Date().toISOString().slice(0, 10);
    var groups = {};
    txs.forEach(function (tx) {
      if (!isBondTrade(tx)) return;
      var sym = str(tx.symbol).toUpperCase();
      if (!map[sym]) return;
      var k = pidOf(tx) + '|' + sym;
      (groups[k] || (groups[k] = { pid: tx.portfolioId == null ? null : tx.portfolioId, sym: sym, name: str(tx.symbolName), currency: str(tx.currency), trades: [] })).trades.push(tx);
    });
    var have = {};
    txs.forEach(function (tx) {
      if (!tx || (tx.source !== 'bond-coupon' && tx.source !== 'bond-redemption')) return;
      have[tx.source + '|' + pidOf(tx) + '|' + str(tx.symbol).toUpperCase() + '|' + ymd(tx.couponDate || tx.date)] = true;
    });
    var created = [], postings = [];
    Object.keys(groups).forEach(function (k) {
      var g = groups[k], bt = map[g.sym];
      var trades = g.trades.filter(function (tx) { return tx.source !== 'bond-redemption'; });
      var heldBefore = function (d, inclusive) {
        return trades.reduce(function (q, tx) {
          var td = ymd(tx.date);
          if (inclusive ? td > d : td >= d) return q;
          return q + (tx.type === 'buy' ? 1 : -1) * num(tx.quantity);
        }, 0);
      };
      var first = trades.reduce(function (m, tx) { return !m || ymd(tx.date) < m ? ymd(tx.date) : m; }, '');
      var cur = bt.currency || g.currency || 'EUR';
      var label = bt.name || g.name || g.sym;
      var last = asOf < bt.maturity ? asOf : bt.maturity;
      schedule(bt, first, last).forEach(function (c) {
        var held = heldBefore(c, false);
        if (!(held > 1e-9) || have['bond-coupon|' + pidOf({ portfolioId: g.pid }) + '|' + g.sym + '|' + c]) return;
        var amount = r2(couponAmount(bt, held, c));
        if (!(amount > 0)) return;
        created.push({
          id: newId(), type: 'interest', category: CATEGORY, symbol: g.sym, symbolName: label,
          quantity: 1, price: amount, amount: amount, fees: 0, currency: cur, date: c, couponDate: c,
          portfolioId: g.pid, source: 'bond-coupon', nominal: held, auto: true, notes: __('bondCouponNote', 'Coupon')
        });
        postings.push({ accountId: 'bond:' + pidOf({ portfolioId: g.pid }) + ':' + g.sym, date: c, amount: amount });
      });
      if (asOf >= bt.maturity && !have['bond-redemption|' + pidOf({ portfolioId: g.pid }) + '|' + g.sym + '|' + bt.maturity]) {
        var left = heldBefore(bt.maturity, true);
        if (left > 1e-9) created.push({
          id: newId(), type: 'sell', category: CATEGORY, symbol: g.sym, symbolName: label,
          quantity: left, price: 1, fees: 0, currency: cur, date: bt.maturity, couponDate: bt.maturity,
          portfolioId: g.pid, source: 'bond-redemption', auto: true, notes: __('bondRedemptionNote', 'Redemption')
        });
      }
    });
    var I = interestApi();
    var ledger = I ? I.appendLedger(opts.ledger, postings) : opts.ledger;
    return { transactions: created.length ? txs.concat(created) : txs, created: created, postings: postings, ledger: ledger };
  }
  function interestApi() {
    if (typeof window !== 'undefined' && window.MaerminInterest) return window.MaerminInterest;
    try { return typeof require === 'function' ? require('./interest-engine.js') : null; } catch (e) { return null; }
  }

  // ---- tax -------------------------------------------------------------------
  // Accrued interest of the year's bond trades: paid (buy) negative, received
  // (sell) positive, in the trade currency. [{ symbol, date, type, amount, currency }]
  function accruedRows(transactions, year) {
    var y = String(year);
    return (transactions || []).filter(function (tx) {
      return isBondTrade(tx) && num(tx.accruedInterest) > 0 && ymd(tx.date).slice(0, 4) === y;
    }).map(function (tx) {
      return { symbol: str(tx.symbol).toUpperCase(), date: ymd(tx.date), type: tx.type,
        amount: (tx.type === 'buy' ? -1 : 1) * num(tx.accruedInterest), currency: str(tx.currency) || 'EUR' };
    }).sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });
  }

  // ---- store edits -----------------------------------------------------------------
  // Terms replace the stored ones of the symbol; a stored manual price stays.
  function setTerms(store, symbol, terms) {
    var s = normalize(store), sym = str(symbol).toUpperCase();
    var prev = s.bonds[sym] || {};
    var bt = cleanTerms(Object.assign({}, terms, { price: terms && terms.price != null ? terms.price : prev.price, priceDate: terms && terms.priceDate ? terms.priceDate : prev.priceDate }));
    if (sym && bt) s.bonds[sym] = bt;
    return s;
  }
  function setPrice(store, symbol, pricePct, date) {
    var s = normalize(store), sym = str(symbol).toUpperCase(), p = parseAmount(pricePct);
    if (!s.bonds[sym]) return s;
    if (isFinite(p) && p > 0) { s.bonds[sym].price = p; s.bonds[sym].priceDate = ymd(date) || s.bonds[sym].priceDate; }
    else { delete s.bonds[sym].price; delete s.bonds[sym].priceDate; }
    return s;
  }

  // ---- transaction form ---------------------------------------------------------------
  // The form keeps the price in % and the bond fields as text; these map it
  // to and from a stored row.
  function toForm(tx) {
    var p = num(tx && tx.price) * 100;
    return { price: tx && tx.price != null ? String(Math.round(p * 1e6) / 1e6) : '',
      accruedInterest: tx && num(tx.accruedInterest) > 0 ? String(tx.accruedInterest) : '' };
  }
  function txExtras(form) {
    var a = parseAmount(form && form.accruedInterest);
    return (isFinite(a) && a > 0) ? { accruedInterest: Math.round(a * 100) / 100 } : {};
  }
  function termsFromForm(form, name) {
    form = form || {};
    if (!str(form.bondCoupon) && !str(form.bondMaturity)) return null;
    return cleanTerms({ name: name, coupon: parseAmount(form.bondCoupon), frequency: form.bondFrequency, maturity: form.bondMaturity, currency: form.currency });
  }
  // Accrued interest proposed for a form: the stored terms of the symbol, or
  // the terms typed into the form.
  function proposeAccrued(store, form) {
    form = form || {};
    var bt = termsOf(store, form.symbol) || termsFromForm(form, '');
    var nominal = parseAmount(form.quantity);
    if (!bt || !(nominal > 0) || !ymd(form.date)) return null;
    return Math.round(accrued(bt, nominal, form.date) * 100) / 100;
  }

  // ---- storage ------------------------------------------------------------------
  function ls() { return (typeof localStorage !== 'undefined') ? localStorage : null; }
  function load() { try { return normalize(ls() && ls().getItem(STORAGE_KEY)); } catch (e) { return normalize(null); } }
  function save(state) {
    try { if (!ls()) return false; ls().setItem(STORAGE_KEY, JSON.stringify(normalize(state))); return true; } catch (e) { return false; }
  }

  // ---- UI ----------------------------------------------------------------------------
  function R() { return (typeof window !== 'undefined') ? window.React : null; }
  function themeOf(th) {
    th = th || {};
    return { text: th.text || '#e6edf3', dim: th.textSecondary || '#9aa4b2', border: th.cardBorder || 'rgba(255,255,255,0.1)',
      input: th.inputBg || '#0f172a', inputBorder: th.inputBorder || 'rgba(255,255,255,0.15)', accent: th.accentFill || th.accent || '#3b82f6',
      warn: th.warning || '#f59e0b', card: th.cardBg || th.card || 'transparent' };
  }
  function freqLabel(f) {
    return ({ 1: __('bondFreq1', 'yearly'), 2: __('bondFreq2', 'half-yearly'), 4: __('bondFreq4', 'quarterly'), 12: __('bondFreq12', 'monthly') })[f] || String(f);
  }
  function fmtDate(d) { var I = (typeof window !== 'undefined') && window.MaerminI18n; return d ? (I && I.date ? I.date(d) : d) : '-'; }
  function fmtNum(v, dp) { var I = (typeof window !== 'undefined') && window.MaerminI18n; return I && I.num ? I.num(v, dp) : Number(v).toFixed(dp); }

  // Extra fields of the transaction form for a bond trade.
  // props: { theme, form, onChange(patch), currency }
  function FormFields(props) {
    var React = R();
    if (!React) return null;
    var e = React.createElement, c = themeOf(props.theme), form = props.form || {};
    var known = termsOf(load(), form.symbol);
    var inp = { padding: '0.6rem 0.75rem', background: c.input, border: '1px solid ' + c.inputBorder, borderRadius: '8px', color: c.text, fontSize: '0.875rem', minWidth: 0, boxSizing: 'border-box' };
    var set = function (k) { return function (ev) { var o = {}; o[k] = ev.target.value; props.onChange(o); }; };
    var trade = form.type === 'buy' || form.type === 'sell';
    return e('div', { 'data-testid': 'bond-fields', style: { marginBottom: '1rem' } },
      e('div', { style: { color: c.dim, fontSize: '0.75rem', marginBottom: '0.6rem', lineHeight: 1.5 } },
        __('bondFormHint', 'Quantity = nominal value, price in % of the nominal (e.g. 98.5). Coupons and the redemption at maturity are booked automatically.')),
      known ? e('div', { style: { color: c.dim, fontSize: '0.78rem', marginBottom: '0.6rem' } },
        __('bondKnownTerms', '{coupon} % {freq}, matures {date}', { coupon: fmtNum(known.coupon, 3), freq: freqLabel(known.frequency), date: fmtDate(known.maturity) }))
        : e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.5rem', marginBottom: '0.6rem' } },
          e('input', { type: 'text', inputMode: 'decimal', value: form.bondCoupon || '', onChange: set('bondCoupon'), placeholder: __('bondCouponPh', 'Coupon % p.a.'), 'aria-label': __('bondCoupon', 'Coupon (% p.a.)'), 'data-testid': 'bond-coupon', style: inp }),
          e('select', { value: String(form.bondFrequency || 1), onChange: set('bondFrequency'), 'aria-label': __('bondFrequency', 'Coupon frequency'), style: inp },
            FREQUENCIES.map(function (f) { return e('option', { key: f, value: String(f) }, freqLabel(f)); })),
          e('input', { type: 'date', value: form.bondMaturity || '', onChange: set('bondMaturity'), 'aria-label': __('bondMaturity', 'Maturity'), title: __('bondMaturity', 'Maturity'), 'data-testid': 'bond-maturity', style: inp })),
      trade && e('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center' } },
        e('input', { type: 'text', inputMode: 'decimal', value: form.accruedInterest || '', onChange: set('accruedInterest'), 'data-testid': 'bond-accrued',
          placeholder: __('bondAccruedPh', 'Accrued interest ({cur})', { cur: form.currency || props.currency || 'EUR' }), 'aria-label': __('bondAccrued', 'Accrued interest'), style: Object.assign({ flex: 1 }, inp) }),
        e('button', { type: 'button', 'data-testid': 'bond-propose', onClick: function () {
          var v = proposeAccrued(load(), form);
          if (v != null) props.onChange({ accruedInterest: String(v) });
        }, style: { padding: '0.6rem 0.8rem', background: c.input, border: '1px solid ' + c.inputBorder, borderRadius: '8px', color: c.text, cursor: 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap' } },
          __('bondPropose', 'Calculate'))),
      trade && e('div', { style: { color: c.dim, fontSize: '0.72rem', marginTop: '0.35rem' } },
        form.type === 'buy' ? __('bondAccruedBuy', 'Paid to the seller on top of the price; negative capital income this year.')
          : __('bondAccruedSell', 'Received from the buyer on top of the price; capital income this year.')));
  }

  // Bonds section of the Overview. Renders nothing without bond positions.
  // props: { theme, positions (portfolio.bonds), transactions, today, formatMoney, onChange }
  function Panel(props) {
    var React = R();
    if (!React) return null;
    var positions = (props.positions || []).filter(function (p) { return num(p.amount) > 0; });
    var st = React.useState(null), editing = st[0], setEditing = st[1];
    var dr = React.useState({}), draft = dr[0], setDraft = dr[1];
    if (!positions.length) return null;
    var e = React.createElement, c = themeOf(props.theme);
    var store = load();
    var today = ymd(props.today) || new Date().toISOString().slice(0, 10);
    var money = props.formatMoney || function (v) { return fmtNum(v, 2); };
    var inp = { padding: '0.45rem 0.6rem', background: c.input, border: '1px solid ' + c.inputBorder, borderRadius: '6px', color: c.text, fontSize: '0.8rem', minWidth: 0, boxSizing: 'border-box' };
    var cell = { padding: '0.5rem 0.6rem', borderBottom: '1px solid ' + c.border, fontSize: '0.82rem', color: c.text, whiteSpace: 'nowrap' };
    var head = Object.assign({}, cell, { color: c.dim, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'left' });
    var commit = function (next) { save(next); if (props.onChange) props.onChange(); };
    var openTerms = function (sym, bt, name) {
      setEditing(sym);
      setDraft(bt ? { coupon: String(bt.coupon), frequency: String(bt.frequency), maturity: bt.maturity, issueDate: bt.issueDate || '', dayCount: bt.dayCount, currency: bt.currency, name: bt.name || name }
        : { coupon: '', frequency: '1', maturity: '', issueDate: '', dayCount: 'act/act', currency: 'EUR', name: name });
    };
    var rows = [];
    positions.forEach(function (p) {
      var sym = str(p.symbol).toUpperCase(), bt = store.bonds[sym];
      var name = p.symbolName || p.name || sym;
      var nominal = num(p.amount);
      var nextC = bt ? schedule(bt, today, bt.maturity)[0] : null;
      var y = bt && bt.price ? ytm(bt, bt.price, today) : null;
      rows.push(e('tr', { key: sym, 'data-testid': 'bond-row' },
        e('td', { style: cell }, e('div', { style: { fontWeight: 600 } }, name), e('div', { style: { color: c.dim, fontSize: '0.72rem' } }, sym)),
        e('td', { style: cell }, fmtNum(nominal, 0)),
        e('td', { style: cell }, bt ? fmtNum(bt.coupon, 3) + ' % · ' + freqLabel(bt.frequency) : e('span', { style: { color: c.warn } }, __('bondNoTerms', 'Terms missing: no coupons'))),
        e('td', { style: cell }, bt ? fmtDate(bt.maturity) : '-'),
        e('td', { style: cell }, nextC ? fmtDate(nextC) + ' · ' + money(couponAmount(bt, nominal, nextC), bt.currency) : '-'),
        e('td', { style: cell }, bt ? money(accrued(bt, nominal, today), bt.currency) : '-'),
        e('td', { style: cell }, bt ? e('input', { type: 'text', inputMode: 'decimal', key: sym + '|' + (bt.price || ''), defaultValue: bt.price ? String(bt.price) : '', 'data-testid': 'bond-price',
          placeholder: '%', 'aria-label': __('bondPriceAria', 'Price of {name} in %', { name: name }), style: Object.assign({ width: '80px' }, inp),
          onBlur: function (ev) { var v = ev.target.value; if (String(v) !== String(bt.price || '')) commit(setPrice(load(), sym, v, today)); } }) : '-'),
        e('td', { style: cell }, y != null ? fmtNum(y * 100, 2) + ' %' : '-'),
        e('td', { style: cell }, e('button', { type: 'button', 'data-testid': 'bond-terms', onClick: function () { editing === sym ? setEditing(null) : openTerms(sym, bt, name); },
          style: { padding: '0.35rem 0.65rem', background: 'transparent', border: '1px solid ' + c.inputBorder, borderRadius: '6px', color: c.text, cursor: 'pointer', fontSize: '0.75rem' } },
          bt ? __('bondEditTerms', 'Terms') : __('bondAddTerms', 'Add terms')))));
      if (editing === sym) {
        var setD = function (k) { return function (ev) { var o = Object.assign({}, draft); o[k] = ev.target.value; setDraft(o); }; };
        var valid = cleanTerms({ coupon: parseAmount(draft.coupon), maturity: draft.maturity });
        rows.push(e('tr', { key: sym + '-edit' }, e('td', { colSpan: 9, style: Object.assign({}, cell, { whiteSpace: 'normal' }) },
          e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.5rem', alignItems: 'end' } },
            e('label', { style: { color: c.dim, fontSize: '0.72rem' } }, __('bondCoupon', 'Coupon (% p.a.)'), e('input', { type: 'text', inputMode: 'decimal', value: draft.coupon, onChange: setD('coupon'), 'data-testid': 'bond-t-coupon', style: Object.assign({ width: '100%', display: 'block', marginTop: '0.2rem' }, inp) })),
            e('label', { style: { color: c.dim, fontSize: '0.72rem' } }, __('bondFrequency', 'Coupon frequency'), e('select', { value: draft.frequency, onChange: setD('frequency'), style: Object.assign({ width: '100%', display: 'block', marginTop: '0.2rem' }, inp) },
              FREQUENCIES.map(function (f) { return e('option', { key: f, value: String(f) }, freqLabel(f)); }))),
            e('label', { style: { color: c.dim, fontSize: '0.72rem' } }, __('bondMaturity', 'Maturity'), e('input', { type: 'date', value: draft.maturity, onChange: setD('maturity'), 'data-testid': 'bond-t-maturity', style: Object.assign({ width: '100%', display: 'block', marginTop: '0.2rem' }, inp) })),
            e('label', { style: { color: c.dim, fontSize: '0.72rem' } }, __('bondIssueDate', 'Issue date (optional)'), e('input', { type: 'date', value: draft.issueDate, onChange: setD('issueDate'), style: Object.assign({ width: '100%', display: 'block', marginTop: '0.2rem' }, inp) })),
            e('label', { style: { color: c.dim, fontSize: '0.72rem' } }, __('bondDayCount', 'Day count'), e('select', { value: draft.dayCount, onChange: setD('dayCount'), style: Object.assign({ width: '100%', display: 'block', marginTop: '0.2rem' }, inp) },
              DAY_COUNTS.map(function (dc) { return e('option', { key: dc, value: dc }, dc === 'act/act' ? __('bondActAct', 'act/act (ICMA)') : dc === '30/360' ? __('bond30360', '30E/360') : dc); }))),
            e('label', { style: { color: c.dim, fontSize: '0.72rem' } }, __('currency', 'Currency'), e('select', { value: draft.currency, onChange: setD('currency'), style: Object.assign({ width: '100%', display: 'block', marginTop: '0.2rem' }, inp) },
              ['EUR', 'USD', 'CHF', 'GBP'].map(function (cur) { return e('option', { key: cur, value: cur }, cur); }))),
            e('button', { type: 'button', disabled: !valid, 'data-testid': 'bond-t-save', onClick: function () {
              commit(setTerms(load(), sym, { name: draft.name, coupon: parseAmount(draft.coupon), frequency: draft.frequency, maturity: draft.maturity, issueDate: draft.issueDate, dayCount: draft.dayCount, currency: draft.currency }));
              setEditing(null);
            }, style: { padding: '0.5rem 0.9rem', background: valid ? c.accent : c.input, border: 'none', borderRadius: '8px', color: '#fff', cursor: valid ? 'pointer' : 'default', fontWeight: 600, fontSize: '0.8rem' } },
              __('save', 'Save'))))));
      }
    });
    return e('div', { 'data-testid': 'bonds-panel', style: { border: '1px solid ' + c.border, borderRadius: '14px', padding: '1rem 1.1rem', background: c.card } },
      e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.6rem' } },
        e('h3', { style: { margin: 0, color: c.text, fontSize: '1rem' } }, __('bondsTitle', 'Bonds')),
        e('span', { style: { color: c.dim, fontSize: '0.75rem' } }, __('bondsHint', 'Prices are entered by hand in % of the nominal. Coupons and the redemption are booked on their dates; the yield is for information.'))),
      e('div', { style: { overflowX: 'auto' } },
        e('table', { style: { width: '100%', borderCollapse: 'collapse' } },
          e('thead', null, e('tr', null, [__('bondColBond', 'Bond'), __('bondColNominal', 'Nominal'), __('bondColCoupon', 'Coupon'), __('bondColMaturity', 'Maturity'),
            __('bondColNext', 'Next coupon'), __('bondColAccrued', 'Accrued today'), __('bondColPrice', 'Price %'), __('bondColYield', 'Yield'), ''].map(function (h, i) { return e('th', { key: i, style: head }, h); }))),
          e('tbody', null, rows))));
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY, CATEGORY: CATEGORY, FREQUENCIES: FREQUENCIES, DAY_COUNTS: DAY_COUNTS,
    normalize: normalize, termsOf: termsOf, schedule: schedule, period: period, yearFraction: yearFraction,
    accrued: accrued, couponAmount: couponAmount, ytm: ytm, parseAmount: parseAmount, fromForm: fromForm,
    priceMap: priceMap, catchUp: catchUp, accruedRows: accruedRows, setTerms: setTerms, setPrice: setPrice,
    toForm: toForm, txExtras: txExtras, termsFromForm: termsFromForm, proposeAccrued: proposeAccrued,
    load: load, save: save, FormFields: FormFields, Panel: Panel
  };

  if (typeof window !== 'undefined') window.MaerminBonds = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
