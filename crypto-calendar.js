// ============================================================================
// MAERMIN — Crypto tax-free calendar  (window.MaerminCryptoCalendar)
// ----------------------------------------------------------------------------
// P5-4.5. Per coin the amount that is tax-free today and in 1, 3, 6, 9 and 12
// months: a private sale (sec. 23 (1) Nr. 2 EStG) is tax-free once the coin
// was held for more than a year, i.e. from the day after the anniversary of
// its purchase (MaerminSellSim.freeDate; a 29 February purchase is free from
// 1 March). The open lots come from the ONE FIFO ledger (ledger.js), so the
// tax-free part is also the part a sale takes first.
//
// With the one-year rule switched off in the tax settings nothing is listed
// as tax-free. Nothing is stored. The pure part is Node-tested in
// test/crypto-calendar.test.js; the Panel is browser-only. Not tax advice.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var HORIZONS = [0, 1, 3, 6, 9, 12];
  var EPS = 1e-12;
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function ymd(d) { return String(d || '').slice(0, 10); }
  function ledger() {
    if (typeof window !== 'undefined' && window.MaerminLedger) return window.MaerminLedger;
    return require('./ledger.js');
  }
  function freeDate(iso) {
    var S = (typeof window !== 'undefined' && window.MaerminSellSim) || require('./sell-simulator.js');
    return S.freeDate(iso);
  }

  // ISO date plus n months; the day is clamped to the month's last day.
  function addMonths(iso, n) {
    var s = ymd(iso);
    var y = parseInt(s.slice(0, 4), 10), m = parseInt(s.slice(5, 7), 10) - 1 + n, d = parseInt(s.slice(8, 10), 10);
    var ty = y + Math.floor(m / 12), tm = ((m % 12) + 12) % 12;
    var last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
    return new Date(Date.UTC(ty, tm, Math.min(d, last))).toISOString().slice(0, 10);
  }

  // opts: { today, prices: { SYM: EUR }, priceEUR(sym), exchangeRate, fxAt,
  //         cryptoExemption (default true), perWallet (FIFO per portfolio) }
  // -> { exemption, horizons: [{ months, date }],
  //      coins: [{ symbol, held, price, buckets: [{ months, date, quantity, value, gain }],
  //               next: { date, quantity } | null, lots: [{ acquisitionDate, quantity, unitCostEUR, freeOn, free }] }],
  //      totals: [{ months, date, value, gain }] }
  function calendar(transactions, opts) {
    opts = opts || {};
    var today = ymd(opts.today) || new Date().toISOString().slice(0, 10);
    var exemption = opts.cryptoExemption !== false;
    var horizons = HORIZONS.map(function (n) { return { months: n, date: addMonths(today, n) }; });
    function priceOf(sym) {
      var p = opts.prices || {};
      var v = typeof opts.priceEUR === 'function' ? opts.priceEUR(sym) : (p[sym] != null ? p[sym] : p[sym.toLowerCase()]);
      v = parseFloat(v);
      return isFinite(v) && v > 0 ? v : null;
    }
    var txs = (transactions || []).filter(function (tx) { return tx && tx.category === 'crypto' && ymd(tx.date) <= today; });
    // Per wallet (P5-4.6): FIFO runs per portfolio, the lots are then summed
    // per coin again.
    var built = ledger().build(txs, { exchangeRate: num(opts.exchangeRate) || 1, fxAt: opts.fxAt, categories: ['crypto'], perWallet: opts.perWallet ? ['crypto'] : undefined }).list;
    var bySym = {}, groups = [];
    built.forEach(function (g) {
      var sym = String(g.symbol || '').toUpperCase();
      if (!bySym[sym]) { bySym[sym] = { symbol: g.symbol, symbolName: g.symbolName, openLots: [] }; groups.push(bySym[sym]); }
      bySym[sym].openLots = bySym[sym].openLots.concat(g.openLots || []);
    });

    var coins = [];
    groups.forEach(function (g) {
      var sym = String(g.symbol || '').toUpperCase();
      var lots = (g.openLots || []).filter(function (l) { return l.qty > EPS; }).sort(function (a, b) { return ymd(a.date) < ymd(b.date) ? -1 : ymd(a.date) > ymd(b.date) ? 1 : 0; }).map(function (l) {
        var on = freeDate(l.date);
        return { acquisitionDate: ymd(l.date), quantity: l.qty, unitCostEUR: l.unitCostEUR, freeOn: on, free: exemption && on <= today };
      });
      if (!sym || !lots.length) return;
      var price = priceOf(sym);
      var held = lots.reduce(function (s, l) { return s + l.quantity; }, 0);
      var buckets = horizons.map(function (h) {
        var qty = 0, cost = 0;
        if (exemption) lots.forEach(function (l) { if (l.freeOn <= h.date) { qty += l.quantity; cost += l.quantity * l.unitCostEUR; } });
        return { months: h.months, date: h.date, quantity: qty, value: price != null ? qty * price : null, gain: price != null ? qty * price - cost : null };
      });
      var next = null;
      if (exemption) {
        lots.forEach(function (l) { if (l.freeOn > today && (!next || l.freeOn < next.date)) next = { date: l.freeOn, quantity: 0 }; });
        if (next) lots.forEach(function (l) { if (l.freeOn === next.date) next.quantity += l.quantity; });
      }
      coins.push({ symbol: sym, name: g.symbolName || sym, held: held, price: price, value: price != null ? held * price : null, buckets: buckets, next: next, lots: lots });
    });
    coins.sort(function (a, b) {
      if ((a.value == null) !== (b.value == null)) return a.value == null ? 1 : -1;
      return (b.value || 0) - (a.value || 0) || (a.symbol < b.symbol ? -1 : 1);
    });
    var totals = horizons.map(function (h, i) {
      var value = 0, gain = 0;
      coins.forEach(function (c) { if (c.buckets[i].value != null) { value += c.buckets[i].value; gain += c.buckets[i].gain; } });
      return { months: h.months, date: h.date, value: value, gain: gain };
    });
    return { exemption: exemption, today: today, horizons: horizons, coins: coins, totals: totals };
  }

  // ---- panel (Tax view, German rules) ----------------------------------------
  // props: { theme, transactions, prices, exchangeRate, fxAt, formatMoney, today, rev }
  function Panel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement, useMemo = React.useMemo;
    var th = props.theme || {};
    var text = th.text || '#e6edf3', dim = th.textSecondary || '#9aa4b2', border = th.cardBorder || 'rgba(255,255,255,0.1)';
    var good = th.success || '#22c55e', warn = th.warning || '#f59e0b';
    var money = props.formatMoney || function (v) { return window.MaerminI18n.money(v, 'EUR'); };
    var I18N = window.MaerminI18n;
    var today = props.today || new Date().toISOString().slice(0, 10);
    var res = useMemo(function () {
      var TS = window.MaerminTaxSettings, s = null;
      try { s = TS ? TS.load() : null; } catch (err) { s = null; }
      try {
        // Crypto prices in the app's price map are EUR (as in tax-advisor.js).
        return calendar(props.transactions || [], { today: today, exchangeRate: props.exchangeRate, fxAt: props.fxAt,
          cryptoExemption: s ? s.cryptoExemption !== false : true, perWallet: !!(s && s.cryptoPerWallet), prices: props.prices || {} });
      } catch (err) { return null; }
    }, [props.transactions, props.prices, props.exchangeRate, props.fxAt, props.rev, today]);
    if (!res) return null;

    var qty = function (v) { return I18N.num(v, { min: 0, max: 8 }); };
    var cell = { padding: '0.35rem 0.5rem', borderTop: '1px solid ' + border, fontSize: '0.78rem', color: text, textAlign: 'right', whiteSpace: 'nowrap', verticalAlign: 'top' };
    var head = { padding: '0.3rem 0.5rem', color: dim, fontSize: '0.64rem', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'right', whiteSpace: 'nowrap' };
    var colLabel = function (h) { return h.months === 0 ? __('ccToday', 'Today') : __('ccInMonths', 'In {n} mo.', { n: h.months }); };

    return e('div', { 'data-testid': 'crypto-calendar-panel', style: { background: th.card || th.cardBg, border: '1px solid ' + border, borderRadius: '14px', padding: '1.25rem', margin: '1.5rem 0 0' } },
      e('h3', { style: { color: text, fontSize: 'var(--text-body)', fontWeight: 700, margin: '0 0 0.35rem' } }, __('ccTitle', 'Crypto tax-free calendar')),
      e('p', { style: { color: dim, fontSize: 'var(--text-sm)', margin: '0 0 0.75rem', lineHeight: 1.5 } },
        __('ccIntro', 'How much of each coin can be sold tax-free (held for more than a year) today and in the coming months. A sale takes the oldest lots first (FIFO), so the tax-free part is also the part that is sold first.')),
      !res.exemption ? e('div', { 'data-testid': 'cc-off', style: { color: warn, fontSize: 'var(--text-sm)', marginBottom: '0.5rem' } },
        __('ccOff', 'The one-year rule for crypto is switched off in your tax settings, so nothing counts as tax-free.')) : null,
      !res.coins.length ? window.MaerminUtils.emptyState({ compact: true, testid: 'cc-empty', text: __('ccEmpty', 'No crypto held.') }) :
      e('div', { style: { overflowX: 'auto' } },
        e('table', { 'data-testid': 'cc-table', style: { width: '100%', borderCollapse: 'collapse' } },
          e('thead', null, e('tr', null,
            e('th', { style: Object.assign({}, head, { textAlign: 'left' }) }, __('ccCoin', 'Coin')),
            e('th', { style: head }, __('ccHeld', 'Held')),
            res.horizons.map(function (h) { return e('th', { key: h.months, style: head, title: I18N.date(h.date) }, colLabel(h)); }),
            e('th', { style: head }, __('ccNext', 'Next')))),
          e('tbody', null,
            res.coins.map(function (c) {
              return e('tr', { key: c.symbol, 'data-testid': 'cc-row-' + c.symbol },
                e('td', { style: Object.assign({}, cell, { textAlign: 'left', fontWeight: 700 }) }, c.symbol),
                e('td', { style: cell }, qty(c.held)),
                c.buckets.map(function (b, i) {
                  return e('td', { key: i, 'data-testid': 'cc-' + c.symbol + '-' + b.months, style: Object.assign({}, cell, { color: b.quantity > EPS ? (Math.abs(b.quantity - c.held) < 1e-9 ? good : text) : dim }) },
                    b.quantity > EPS ? qty(b.quantity) : '–',
                    b.quantity > EPS && b.value != null ? e('div', { style: { color: dim, fontSize: 'var(--text-2xs)' } }, money(b.value)) : null);
                }),
                e('td', { style: cell }, c.next ? e('div', null, I18N.date(c.next.date), e('div', { style: { color: dim, fontSize: 'var(--text-2xs)' } }, qty(c.next.quantity))) : '–'));
            }),
            e('tr', { 'data-testid': 'cc-total' },
              e('td', { style: Object.assign({}, cell, { textAlign: 'left', color: dim }) }, __('ccTotal', 'Value tax-free')),
              e('td', { style: cell }),
              res.totals.map(function (t, i) { return e('td', { key: i, style: Object.assign({}, cell, { fontWeight: 700 }) }, money(t.value)); }),
              e('td', { style: cell }))))),
      e('div', { style: { color: dim, fontSize: 'var(--text-2xs)', marginTop: '0.6rem', lineHeight: 1.5 } },
        __('ccNote', 'Values at today\'s price. A coin is tax-free from the day after the anniversary of its purchase. Gains of coins held for one year or less count towards the 1,000 EUR Freigrenze. Not tax advice.')));
  }

  var api = { HORIZONS: HORIZONS, addMonths: addMonths, calendar: calendar, Panel: Panel };
  if (typeof window !== 'undefined') window.MaerminCryptoCalendar = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
