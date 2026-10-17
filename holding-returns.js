// ============================================================================
// MAERMIN — Returns per holding, trades, capital flow  (window.MaerminHoldingReturns)
// ----------------------------------------------------------------------------
// P5-2.6. Pure figures behind the "Per holding" section of Analysis → Returns.
// Pure + dual-exported; tested in test/holding-returns.test.js.
//
//   flowsOf(txs, { toEUR(amount, tx), basis })
//     → { 'category|SYMBOL': { key, category, symbol, flows: [{ date, amount }] } }
//     buy −(qty × price + fee), sale +(qty × price − fee), dividend / interest
//     +(gross − withholding); basis 'gross' leaves fees and withholding out
//     (P5-2.5). Cash bookings and options belong to no holding.
//   irr(txs, { valueOf(key) → EUR, today, toEUR, basis })
//     → [{ key, category, symbol, irr, invested, returned, value, open, since, short }]
//     XIRR of the holding's flows plus today's value; best first. short =
//     the flows span less than a year (the figure is scaled to a year).
//   irrBy(txs, { valueOf, today, toEUR, basis, tags })
//     → { classes: [Row], tags: [Row] }   Row = { kind, name, holdings, irr, invested, returned, value… }
//     The same per asset class / custom category (tx.category) and per tag
//     (maermin_tags, grouped like the heatmap filter of P5-2.4).
//   trades(ledgerBuild, { n })
//     → { all, best, worst }: one row per sale (FIFO lots of the ledger) with
//     cost, proceeds, gain, ret, days (quantity-weighted holding period),
//     annualized (only from one year held), lots. best = gains by return,
//     worst = losses by return, n each (default 5).
//   capitalFlow(txs, { toEUR, today })
//     → { months: [{ ym, buys, sells, net }], years: [{ y, buys, sells, net,
//         months, avg }], total: { buys, sells, net, months, avg } }
//     Buys incl. fees, sales after fees, every month from the first trade to
//     this month; avg = net per month (this year: the months so far).
// ============================================================================
(function () {
  'use strict';

  var W = typeof window !== 'undefined' ? window : {};
  function req(load) { try { return load(); } catch (e) { return null; } }
  function num(x) { var n = parseFloat(x); return isFinite(n) ? n : 0; }
  function ymd(d) { return String(d == null ? '' : d).slice(0, 10); }
  function sym(s) { return String(s || '').trim().toUpperCase(); }
  function cat(tx) { return tx.category || 'crypto'; }
  function todayISO(o) { return ymd(o && o.today) || new Date().toISOString().slice(0, 10); }
  var DAY = 86400000;
  function days(a, b) { return Math.round((Date.parse(ymd(b) + 'T00:00:00Z') - Date.parse(ymd(a) + 'T00:00:00Z')) / DAY); }
  function isTrade(tx) { return tx && (tx.type === 'buy' || tx.type === 'sell') && num(tx.quantity) > 0; }

  function flowsOf(txs, opts) {
    opts = opts || {};
    var toEUR = typeof opts.toEUR === 'function' ? opts.toEUR : function (a) { return a; };
    var gross = opts.basis === 'gross';
    var out = {};
    (txs || []).forEach(function (tx) {
      if (!tx || !ymd(tx.date) || !tx.symbol || tx.category === 'options' || tx.category === 'cashflow' || tx.category === 'cash') return;
      var g = num(tx.quantity) * num(tx.price), fee = gross ? 0 : Math.max(0, num(tx.fees)), amt;
      if (tx.type === 'buy' && num(tx.quantity) > 0) amt = -(g + fee);
      else if (tx.type === 'sell' && num(tx.quantity) > 0) amt = g - fee;
      else if (tx.type === 'dividend' || tx.type === 'interest') amt = (g || num(tx.amount)) - (gross ? 0 : Math.max(0, num(tx.withholdingTax)));
      else return;
      if (!amt) return;
      var k = cat(tx) + '|' + sym(tx.symbol);
      var h = out[k] || (out[k] = { key: k, category: cat(tx), symbol: sym(tx.symbol), flows: [] });
      h.flows.push({ date: ymd(tx.date), amount: num(toEUR(amt, tx)) });
    });
    Object.keys(out).forEach(function (k) { out[k].flows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }); });
    return out;
  }

  function rowOf(flows, value, today, R) {
    var invested = 0, returned = 0, first = '';
    flows.forEach(function (f) { if (f.amount < 0) invested -= f.amount; else returned += f.amount; if (!first || f.date < first) first = f.date; });
    var all = flows.slice();
    if (value > 0) all.push({ date: today, amount: value });
    var last = all.reduce(function (m, f) { return f.date > m ? f.date : m; }, '');
    return { irr: R ? R.xirr(all) : null, invested: invested, returned: returned, value: value > 0 ? value : 0,
      open: value > 0, since: first, short: !!first && days(first, last) < 365 };
  }
  function byIrr(a, b) { return (b.irr === null ? -Infinity : b.irr) - (a.irr === null ? -Infinity : a.irr); }

  function irr(txs, opts) {
    opts = opts || {};
    var R = (W.MaerminReturns || req(function () { return require('./returns-engine.js'); }));
    var valueOf = typeof opts.valueOf === 'function' ? opts.valueOf : function () { return 0; };
    var today = todayISO(opts);
    var map = flowsOf(txs, opts);
    return Object.keys(map).map(function (k) {
      var h = map[k], r = rowOf(h.flows, num(valueOf(k)), today, R);
      r.key = k; r.category = h.category; r.symbol = h.symbol;
      return r;
    }).sort(byIrr);
  }

  function irrBy(txs, opts) {
    opts = opts || {};
    var D = (W.MaerminHeatmapDrill || req(function () { return require('./heatmap-drilldown.js'); }));
    var R = (W.MaerminReturns || req(function () { return require('./returns-engine.js'); }));
    var valueOf = typeof opts.valueOf === 'function' ? opts.valueOf : function () { return 0; };
    var today = todayISO(opts);
    var held = (txs || []).filter(function (tx) { return tx && tx.category !== 'cashflow' && tx.category !== 'options' && tx.category !== 'cash'; });
    var out = { classes: [], tags: [] };
    if (!D) return out;
    var o = D.options(held, opts.tags);
    function group(kind, value) {
      var sub = D.filterTransactions(held, { kind: kind, value: value }, opts.tags);
      var map = flowsOf(sub, opts), flows = [], val = 0;
      Object.keys(map).forEach(function (k) { flows = flows.concat(map[k].flows); val += num(valueOf(k)); });
      if (!flows.length) return null;
      var r = rowOf(flows, val, today, R);
      r.kind = kind; r.name = value; r.holdings = Object.keys(map).length;
      return r;
    }
    o.classes.forEach(function (c) { var r = group('class', c); if (r) out.classes.push(r); });
    o.tags.forEach(function (t) { var r = group('tag', t); if (r) out.tags.push(r); });
    out.classes.sort(byIrr); out.tags.sort(byIrr);
    return out;
  }

  function trades(built, opts) {
    opts = opts || {};
    var n = opts.n > 0 ? opts.n : 5;
    var by = {}, all = [];
    ((built && built.list) || []).forEach(function (g) {
      if (!g || g.category === 'options') return;
      var hk = String(g.key).split('|p:')[0]; // a perPortfolio build: one holding, one key
      (g.disposals || []).forEach(function (d) {
        var k = hk + '@' + d.disposalDate;
        var t = by[k];
        if (!t) {
          t = by[k] = { key: hk, category: g.category, symbol: g.symbol, symbolName: g.symbolName || '', date: d.disposalDate, qty: 0, cost: 0, proceeds: 0, wdays: 0, lots: 0, opened: d.acquisitionDate };
          all.push(t);
        }
        t.qty += d.qty; t.cost += d.costBasis; t.proceeds += d.proceeds; t.wdays += d.qty * d.holdingPeriodDays; t.lots++;
        if (d.acquisitionDate < t.opened) t.opened = d.acquisitionDate;
      });
    });
    all.forEach(function (t) {
      t.gain = t.proceeds - t.cost;
      t.ret = t.cost > 0 ? t.gain / t.cost : null;
      t.days = t.qty > 0 ? Math.round(t.wdays / t.qty) : 0;
      t.annualized = t.ret !== null && t.days >= 365 && t.proceeds > 0 ? Math.pow(t.proceeds / t.cost, 365.25 / t.days) - 1 : null;
      delete t.wdays;
    });
    all.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    var rank = function (a, b) { return (b.ret - a.ret) || (b.gain - a.gain); };
    var best = all.filter(function (t) { return t.ret !== null && t.gain >= 0; }).sort(rank).slice(0, n);
    var worst = all.filter(function (t) { return t.ret !== null && t.gain < 0; }).sort(function (a, b) { return rank(b, a); }).slice(0, n);
    return { all: all, best: best, worst: worst };
  }

  function capitalFlow(txs, opts) {
    opts = opts || {};
    var toEUR = typeof opts.toEUR === 'function' ? opts.toEUR : function (a) { return a; };
    var today = todayISO(opts);
    var by = {}, first = '';
    (txs || []).forEach(function (tx) {
      if (!isTrade(tx) || !ymd(tx.date) || tx.category === 'options' || ymd(tx.date) > today) return;
      var ym = ymd(tx.date).slice(0, 7);
      var g = num(tx.quantity) * num(tx.price), fee = Math.max(0, num(tx.fees));
      var m = by[ym] || (by[ym] = { buys: 0, sells: 0 });
      if (tx.type === 'buy') m.buys += num(toEUR(g + fee, tx)); else m.sells += num(toEUR(g - fee, tx));
      if (!first || ym < first) first = ym;
    });
    var out = { months: [], years: [], total: { buys: 0, sells: 0, net: 0, months: 0, avg: 0 } };
    if (!first) return out;
    var y = parseInt(first.slice(0, 4), 10), m = parseInt(first.slice(5, 7), 10);
    var end = today.slice(0, 7), years = {};
    for (;;) {
      var ym = y + '-' + String(m).padStart(2, '0');
      if (ym > end) break;
      var v = by[ym] || { buys: 0, sells: 0 };
      var row = { ym: ym, buys: v.buys, sells: v.sells, net: v.buys - v.sells };
      out.months.push(row);
      var yr = years[y] || (years[y] = { y: y, buys: 0, sells: 0, net: 0, months: 0, avg: 0 });
      yr.buys += row.buys; yr.sells += row.sells; yr.net += row.net; yr.months++;
      out.total.buys += row.buys; out.total.sells += row.sells; out.total.net += row.net; out.total.months++;
      m++; if (m > 12) { m = 1; y++; }
    }
    Object.keys(years).forEach(function (k) { var yr = years[k]; yr.avg = yr.months ? yr.net / yr.months : 0; out.years.push(yr); });
    out.years.sort(function (a, b) { return a.y - b.y; });
    out.total.avg = out.total.months ? out.total.net / out.total.months : 0;
    return out;
  }

  var api = { flowsOf: flowsOf, irr: irr, irrBy: irrBy, trades: trades, capitalFlow: capitalFlow };
  api.Panel = Panel;
  if (typeof window !== 'undefined') window.MaerminHoldingReturns = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // --------------------------------------------------------------------------
  // React view: Analysis → Returns, "Per holding" (IRR table, trades, capital flow)
  // --------------------------------------------------------------------------
  function __(k, f, v) { return (W.MaerminI18n ? W.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  function Panel(props) {
    var React = W.React, e = React.createElement;
    var theme = props.theme || {};
    var I = W.MaerminI18n, U = W.MaerminUtils, FX = W.MaerminFxHistory;
    var txs = props.transactions || [];
    var basis = props.basis === 'gross' ? 'gross' : 'net';
    var fmt = props.formatPrice || function (x) { return I.num(x, 2); };
    var cur = props.getCurrencySymbol ? props.getCurrencySymbol() : '€';
    var today = U && U.todayISO ? U.todayISO() : new Date().toISOString().slice(0, 10);
    var toEUR = function (amount, tx) {
      if (FX && FX.txToEUR) return FX.txToEUR(amount, tx.currency || 'EUR', tx.date, props.exchangeRate, props.fxAt).value;
      return U ? U.toEUR(amount, tx.currency || 'EUR', props.exchangeRate) : amount;
    };
    // today's EUR value per holding, with the price lookup of the Returns view
    var values = React.useMemo(function () {
      var out = {}, pf = props.portfolio || {}, prices = props.prices || {};
      Object.keys(pf).forEach(function (c) {
        if (!Array.isArray(pf[c])) return;
        pf[c].forEach(function (pos) {
          var s = pos.symbol || pos.name || '';
          var p = prices[s] || prices[s.toLowerCase()] || prices[s.toUpperCase()] || pos.purchasePrice || 0;
          var k = c + '|' + sym(s);
          out[k] = (out[k] || 0) + num(pos.amount) * p;
        });
      });
      return out;
    }, [props.portfolio, props.prices]);
    var valueOf = function (k) { return values[k] || 0; };
    var tags = React.useMemo(function () { try { return W.MaerminTags ? W.MaerminTags.load() : null; } catch (err) { return null; } }, [txs]);
    var byState = React.useState('holding'), by = byState[0], setBy = byState[1];
    var cfState = React.useState('year'), cfBy = cfState[0], setCfBy = cfState[1];

    var holdings = React.useMemo(function () { return irr(txs, { valueOf: valueOf, today: today, toEUR: toEUR, basis: basis }); }, [txs, values, basis, props.exchangeRate, props.fxAt]);
    var groups = React.useMemo(function () { return irrBy(txs, { valueOf: valueOf, today: today, toEUR: toEUR, basis: basis, tags: tags }); }, [txs, values, basis, tags, props.exchangeRate, props.fxAt]);
    var tr = React.useMemo(function () {
      var L = W.MaerminLedger;
      return L ? trades(L.build(txs, { exchangeRate: props.exchangeRate, fxAt: props.fxAt, perPortfolio: true })) : { all: [], best: [], worst: [] };
    }, [txs, props.exchangeRate, props.fxAt]);
    var cf = React.useMemo(function () { return capitalFlow(txs, { toEUR: toEUR, today: today }); }, [txs, props.exchangeRate, props.fxAt]);

    if (!holdings.length && !cf.months.length) return null;
    var text = theme.text, dim = theme.textSecondary, border = theme.cardBorder || 'rgba(127,127,127,0.2)';
    var tone = function (v) { return v > 1e-9 ? theme.success : v < -1e-9 ? theme.danger : dim; };
    var pct = function (v) { return v === null || v === undefined ? '–' : I.pct(v * 100, 1, true); };
    var money = function (v) { return fmt(v) + ' ' + cur; };
    var card = function (testid, title, sub, body, right) {
      return e('section', { 'data-testid': testid, style: { background: theme.card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.1rem', marginBottom: '1rem', minWidth: 0 } },
        e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.75rem' } },
          e('div', { style: { minWidth: 0, flex: '1 1 240px' } },
            e('h3', { style: { color: text, fontWeight: 700, fontSize: 'var(--text-md)', margin: 0 } }, title),
            sub && e('div', { style: { color: dim, fontSize: 'var(--text-xs)', marginTop: '0.2rem', lineHeight: 1.5 } }, sub)),
          right || null),
        body);
    };
    var seg = function (label, items, value, set, prefix) {
      return e('div', { role: 'group', 'aria-label': label, style: { display: 'flex', gap: '0.15rem', background: theme.inputBg, borderRadius: '8px', padding: '0.2rem', flexWrap: 'wrap' } },
        items.map(function (it) {
          var on = value === it[0];
          return e('button', { key: it[0], type: 'button', 'data-testid': prefix + it[0], 'aria-pressed': on, onClick: function () { set(it[0]); },
            style: { minHeight: '32px', padding: '0.3rem 0.7rem', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: 'var(--text-xs)', fontWeight: on ? 700 : 500,
              background: on ? (theme.accentFill || theme.accent) : 'transparent', color: on ? 'var(--on-accent)' : dim } }, it[1]);
        }));
    };
    var th = function (label, i, left) {
      return e('th', { key: i, scope: 'col', style: { padding: '0.45rem 0.6rem', textAlign: left ? 'left' : 'right', color: dim, fontWeight: 600, fontSize: 'var(--text-2xs)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', borderBottom: '1px solid ' + border, position: left ? 'sticky' : undefined, left: left ? 0 : undefined, background: left ? theme.card : undefined } }, label);
    };
    var tdS = function (extra) { return Object.assign({ padding: '0.45rem 0.6rem', textAlign: 'right', whiteSpace: 'nowrap', borderBottom: '1px solid ' + border, fontVariantNumeric: 'tabular-nums' }, extra || {}); };
    var head = function (label) { return e('th', { scope: 'row', style: tdS({ textAlign: 'left', color: text, fontWeight: 700, position: 'sticky', left: 0, background: theme.card }) }, label); };
    var table = function (cols, rows) { return e('div', { style: { overflowX: 'auto', maxWidth: '100%' } }, e('table', { style: { borderCollapse: 'collapse', width: '100%', fontSize: 'var(--text-sm)' } }, e('thead', null, e('tr', null, cols)), e('tbody', null, rows))); };
    var muted = function (msg) { return e('div', { style: { color: dim, fontSize: 'var(--text-base)' } }, msg); };

    // ---- IRR ----
    var list = by === 'holding' ? holdings : by === 'class' ? groups.classes : groups.tags;
    var nameOf = function (r) {
      if (by === 'holding') return r.symbol + ' ';
      return by === 'class' ? I.category(r.name) : r.name;
    };
    var anyShort = list.some(function (r) { return r.short && r.irr !== null; });
    var irrBody = !list.length ? muted(by === 'tag' ? __('hrNoTags', 'No tag holds any of these holdings yet.') : __('hrNone', 'No holdings yet.'))
      : table([th(by === 'holding' ? __('hrHolding', 'Holding') : by === 'class' ? __('hrClass', 'Asset class') : __('hrTag', 'Tag'), 0, true), th(__('hrIrr', 'IRR p.a.'), 1), th(__('hrInvested', 'Invested'), 2), th(__('hrReturned', 'Paid out'), 3), th(__('hrValue', 'Value now'), 4)],
          list.map(function (r) {
            var key = by === 'holding' ? r.key : by + ':' + r.name;
            return e('tr', { key: key, 'data-key': key, 'data-value': r.value, 'data-invested': r.invested },
              head(e('span', null, nameOf(r), by === 'holding' && !r.open ? e('span', { style: { color: dim, fontWeight: 400, fontSize: 'var(--text-xs)' } }, __('hrClosed', '(closed)')) : null)),
              e('td', { 'data-k': 'irr', 'data-v': r.irr === null ? '' : r.irr, style: tdS({ color: tone(r.irr || 0), fontWeight: 700 }) }, pct(r.irr) + (r.short && r.irr !== null ? '*' : '')),
              e('td', { style: tdS({ color: text }) }, money(r.invested)),
              e('td', { style: tdS({ color: dim }) }, money(r.returned)),
              e('td', { style: tdS({ color: dim }) }, r.value > 0 ? money(r.value) : '–'));
          }));
    var irrCard = card('hr-irr', __('hrIrrTitle', 'Return per holding (IRR)'),
      __('hrIrrSub', 'Money-weighted per year: buys, sales and dividends on their dates, and the value today.') + ' ' + (basis === 'gross' ? __('gnGrossTitle', 'Before taxes and fees') : __('gnNetTitle', 'After taxes and fees')) + '.',
      e('div', null, irrBody, anyShort && e('div', { style: { color: dim, fontSize: 'var(--text-xs)', marginTop: '0.5rem' } }, __('hrShortNote', '* held less than a year: the return is scaled to a year.'))),
      seg(__('hrByAria', 'Group by'), [['holding', __('hrByHolding', 'Holdings')], ['class', __('hrByClass', 'Classes')], ['tag', __('hrByTag', 'Tags')]], by, setBy, 'hr-by-'));

    // ---- trades ----
    var tradeList = function (testid, title, rows, none) {
      return e('div', { 'data-testid': testid, style: { flex: '1 1 280px', minWidth: 0 } },
        e('div', { style: { color: dim, fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600, marginBottom: '0.35rem' } }, title),
        !rows.length ? muted(none) : rows.map(function (t, i) {
          return e('div', { key: t.key + t.date, 'data-key': t.key, 'data-date': t.date, 'data-ret': t.ret, style: { display: 'flex', justifyContent: 'space-between', gap: '0.5rem', padding: '0.45rem 0', borderTop: i ? '1px solid ' + border : 'none', fontSize: 'var(--text-sm)' } },
            e('div', { style: { minWidth: 0 } },
              e('div', { style: { color: text, fontWeight: 700 } }, t.symbol),
              e('div', { style: { color: dim, fontSize: 'var(--text-xs)' } }, __('hrSoldHeld', 'sold {date} · held {n} {n:day|days}', { date: I.date(t.date), n: t.days }))),
            e('div', { style: { textAlign: 'right', whiteSpace: 'nowrap' } },
              e('div', { style: { color: tone(t.gain), fontWeight: 700 } }, pct(t.ret)),
              e('div', { style: { color: dim, fontSize: 'var(--text-xs)' } }, (t.gain >= 0 ? '+' : '') + money(t.gain) + (t.annualized !== null ? ' · ' + __('retPa', '{pct} p.a.', { pct: I.pct(t.annualized * 100, 1, true) }) : ''))));
        }));
    };
    var tradesCard = card('hr-trades', __('hrTradesTitle', 'Best and worst sales'),
      __('hrTradesSub', 'Each sale against the cost of the lots it sold (first in, first out, fees included); holding period weighted by quantity.'),
      !tr.all.length ? muted(__('hrNoSales', 'No sales yet.'))
        : e('div', { style: { display: 'flex', gap: '1.25rem', flexWrap: 'wrap' } }, tradeList('hr-best', __('hrBest', 'Best'), tr.best, __('hrNoGains', 'No sale with a gain.')), tradeList('hr-worst', __('hrWorst', 'Worst'), tr.worst, __('hrNoLosses', 'No sale at a loss.'))));

    // ---- capital flow ----
    var cfRows = cfBy === 'year'
      ? cf.years.slice().reverse().map(function (r) {
          return e('tr', { key: r.y, 'data-y': r.y }, head(String(r.y)),
            e('td', { style: tdS({ color: text }) }, money(r.buys)), e('td', { style: tdS({ color: text }) }, money(r.sells)),
            e('td', { 'data-k': 'net', 'data-v': r.net, style: tdS({ color: tone(r.net), fontWeight: 700 }) }, money(r.net)),
            e('td', { 'data-k': 'avg', 'data-v': r.avg, style: tdS({ color: dim }) }, money(r.avg)));
        })
      : cf.months.slice().reverse().map(function (r) {
          var d = new Date(parseInt(r.ym.slice(0, 4), 10), parseInt(r.ym.slice(5, 7), 10) - 1, 1);
          return e('tr', { key: r.ym, 'data-ym': r.ym }, head(I.date(d, { month: 'short', year: 'numeric' })),
            e('td', { style: tdS({ color: r.buys ? text : dim }) }, r.buys ? money(r.buys) : '–'), e('td', { style: tdS({ color: r.sells ? text : dim }) }, r.sells ? money(r.sells) : '–'),
            e('td', { 'data-k': 'net', 'data-v': r.net, style: tdS({ color: tone(r.net), fontWeight: 700 }) }, money(r.net)));
        });
    var cfCols = [th(cfBy === 'year' ? __('dhYear', 'Year') : __('hrMonth', 'Month'), 0, true), th(__('hrBuys', 'Bought'), 1), th(__('hrSells', 'Sold'), 2), th(__('hrNet', 'Net invested'), 3)]
      .concat(cfBy === 'year' ? [th(__('hrAvgMonth', 'Per month'), 4)] : []);
    var cfCard = card('hr-capital', __('hrCfTitle', 'Capital flow'),
      __('hrCfSub', 'Money put into and taken out of holdings: buys incl. fees, sales after fees. Dividends and cash bookings are not included.'),
      !cf.months.length ? muted(__('hrNone', 'No holdings yet.')) : e('div', null,
        e('div', { 'data-testid': 'hr-cf-avg', 'data-v': cf.total.avg, style: { color: text, fontSize: 'var(--text-base)', marginBottom: '0.6rem' } },
          __('hrCfAvg', 'On average {amount} net invested per month over {n} {n:month|months}.', { amount: money(cf.total.avg), n: cf.total.months })),
        e('div', { style: { maxHeight: cfBy === 'month' ? '420px' : undefined, overflowY: cfBy === 'month' ? 'auto' : undefined } }, table(cfCols, cfRows))),
      seg(__('hrCfAria', 'Show per'), [['year', __('hrPerYear', 'Year')], ['month', __('hrPerMonth', 'Month')]], cfBy, setCfBy, 'hr-cf-'));

    return e('div', { 'data-testid': 'holding-returns', style: { marginTop: '1.5rem' } },
      e('h3', { style: { color: text, fontSize: 'var(--text-lg)', fontWeight: 800, margin: '0 0 0.75rem' } }, __('hrTitle', 'Per holding')),
      irrCard, tradesCard, cfCard);
  }
})();
