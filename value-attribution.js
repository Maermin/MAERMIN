// ============================================================================
// MAERMIN — Value-change attribution  (window.MaerminValueAttribution)
// ----------------------------------------------------------------------------
// P5-2.1. "Where did the change in value come from?" For a period it splits
//   end value − start value
// into money moved and profit by source:
//   moneyIn / moneyOut   money that entered or left the measured book
//   income               dividends and interest, gross
//   realized             FIFO gains of the sales in the period, before fees
//   unrealized           change in unrealized gains, before fees, without FX
//   fx                   what exchange rates added or removed
//   fees, taxes          paid in the period (shown as costs)
//   residual             whatever the data cannot explain (0 when complete)
// The parts add up exactly: Δvalue = in − out + income + realized + unrealized
// + fx − fees − taxes + residual.
//
//   compute(transactions, series, opts) → Result | null (nothing to measure)
//     series: the renderer's EUR daily closes { 'category|SYMBOL': { cur, closes: [[iso, eur]…] } }
//     opts:   { start   value at the END of this day is the start value (exclusive),
//               end     last day (inclusive, default today), today,
//               exchangeRate, fxAt, rateAt(cur, iso) → EUR per unit (FX split),
//               live: { key: eur }, splits: { key: [{ date, num, den }] },
//               clearings: { portfolioId: MaerminLedger.clearingBalance(...) } }
//   Result = { start, end, startValue, endValue, change, profit, cash,
//              parts: { moneyIn, moneyOut, income, realized, unrealized, fx, fees, taxes, residual },
//              detail: { dividends, interest, withholding, tradeFees }, missing: [{ key, symbol, category }],
//              flows: [{ d, amount }] money in (+) / out (−) per day, oldest first }
//   periodStart(period, today, transactions?)  '1M' | '3M' | 'YTD' | '1Y' | 'MAX'
//   biggest(parts) → { key, amount } the largest profit source (signed) | null
//
// The measured book follows the value path (value-path.js) exactly: holdings
// with a daily close history, valued at the close (today's quote on today),
// quantities adjusted with the RECORDED splits only, the clearing account's
// cash where a portfolio keeps one. Without a clearing account the book is the
// securities alone: a purchase is money in, a sale and a payout are money out,
// a fee or tax booking is paid in from outside. With one, only deposits,
// withdrawals, transfers and the opening balance move money in or out - and
// the cash of a holding without price history (it is not measured).
// Realized gains come from the one FIFO ledger (ledger.js) with the fees left
// out, so fees appear once, in the period they were paid. The FX part of a
// holding quoted in another currency is units × the previous local price ×
// change of the rate, day by day; it is taken out of the unrealized part.
//
// Pure layer dual-exported and Node-tested (test/value-attribution.test.js);
// Panel = the "Profit by source" card in Analysis → Returns.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var EPS = 1e-9;
  var DAY = 86400000;
  var PARTS = ['moneyIn', 'moneyOut', 'income', 'realized', 'unrealized', 'fx', 'fees', 'taxes', 'residual'];
  var PROFIT = ['income', 'realized', 'unrealized', 'fx', 'fees', 'taxes'];
  var COSTS = { moneyOut: 1, fees: 1, taxes: 1 }; // shown with a minus sign
  var PERIODS = ['1M', '3M', 'YTD', '1Y', 'MAX'];
  var USD_LIKE = { USD: 1, USDT: 1, USDC: 1, DAI: 1, BUSD: 1, TUSD: 1, USDP: 1, FDUSD: 1, PYUSD: 1 };

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function ymd(d) {
    if (!d) return '';
    var s = String(d);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    var t = new Date(d);
    if (isNaN(t.getTime())) return '';
    return typeof d === 'number' ? t.toISOString().slice(0, 10) : (typeof window !== 'undefined' && window.MaerminUtils ? window.MaerminUtils : require('./utils.js')).todayISO(t); // a local time: its local date
  }
  function addDays(iso, n) { return new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10); }
  function normKey(k) {
    var s = String(k || ''), i = s.indexOf('|');
    return i < 0 ? s : s.slice(0, i) + '|' + s.slice(i + 1).trim().toUpperCase();
  }
  function keyOf(tx) { return (tx.category || 'crypto') + '|' + String(tx.symbol || tx.name || '').trim().toUpperCase(); }
  function req(load) { try { return load(); } catch (e) { return null; } }
  function ledger() { return (typeof window !== 'undefined' && window.MaerminLedger) || req(function () { return require('./ledger.js'); }); }
  function fxh() { return (typeof window !== 'undefined' && window.MaerminFxHistory) || req(function () { return require('./fx-history.js'); }); }
  function skip(tx) { return !tx || !ymd(tx.date) || tx.category === 'options' || tx.category === 'cash' || tx.source === 'interest-accrual'; }

  function compute(transactions, series, opts) {
    opts = opts || {};
    series = series || {};
    var L = ledger(), F = fxh();
    var today = ymd(opts.today) || (typeof window !== 'undefined' && window.MaerminUtils ? window.MaerminUtils : require('./utils.js')).todayISO();
    var end = ymd(opts.end) || today; if (end > today) end = today;
    var rate = num(opts.exchangeRate), fxAt = typeof opts.fxAt === 'function' ? opts.fxAt : null;
    var live = opts.live || {}, clearings = opts.clearings || {};
    var toEUR = function (amount, tx) {
      if (F && F.txToEUR) return F.txToEUR(num(amount), tx.currency, tx.date, rate, fxAt).value;
      return tx.currency === 'USD' ? num(amount) * ((fxAt && fxAt(ymd(tx.date))) || rate || 1) : num(amount);
    };
    var rateAt = typeof opts.rateAt === 'function' ? opts.rateAt : function (cur, d) {
      var c = String(cur || 'EUR').toUpperCase();
      if (c === 'EUR') return 1;
      if (USD_LIKE[c]) return (fxAt && fxAt(d)) || rate || null;
      return F && F.currencyRateAt ? (F.currencyRateAt(c, d) || null) : null;
    };

    var rows = (transactions || []).filter(function (tx) { return !skip(tx) && ymd(tx.date) <= today; });
    if (!rows.length) return null;
    var first = rows.reduce(function (m, tx) { var d = ymd(tx.date); return !m || d < m ? d : m; }, '');
    var start = ymd(opts.start) || addDays(first, -1);
    if (start > end) start = end;
    var inPeriod = function (d) { return d > start && d <= end; };
    var hasClr = function (tx) { return !!clearings[String(tx.portfolioId || 'default')]; };

    var parts = { moneyIn: 0, moneyOut: 0, income: 0, realized: 0, unrealized: 0, fx: 0, fees: 0, taxes: 0, residual: 0 };
    var detail = { dividends: 0, interest: 0, withholding: 0, tradeFees: 0 };
    // money in (+) / out (−) per day, for the benchmark replay (P5-2.2)
    var flowDay = {};
    var moveIn = function (d, a) { parts.moneyIn += a; flowDay[d] = (flowDay[d] || 0) + a; };
    var moveOut = function (d, a) { parts.moneyOut += a; flowDay[d] = (flowDay[d] || 0) - a; };

    // ---- which holdings are measured -----------------------------------------
    var meta = {}, covered = {}, missing = [];
    rows.forEach(function (tx) {
      if ((tx.type !== 'buy' && tx.type !== 'sell') || !(num(tx.quantity) > 0)) return;
      var k = keyOf(tx);
      if (!meta[k]) meta[k] = { key: k, symbol: tx.symbol || tx.name || '', category: tx.category || 'crypto' };
    });
    Object.keys(meta).forEach(function (k) {
      var s = series[k];
      if (s && Array.isArray(s.closes) && s.closes.length) covered[k] = true; else missing.push(meta[k]);
    });

    // ---- payouts and cash bookings (classified the same with or without an account)
    rows.forEach(function (tx) {
      var d = ymd(tx.date);
      if (!inPeriod(d)) return;
      var own = hasClr(tx);
      if (L && L.isCash && L.isCash(tx)) {
        var a = num(tx.amount);
        if (!(a > 0)) return;
        var eur = toEUR(a, tx), t = tx.type;
        if (t === 'fee' || t === 'interest_charge') { parts.fees += eur; if (!own) moveIn(d, eur); }
        else if (t === 'fee_refund') { parts.fees -= eur; if (!own) moveOut(d, eur); }
        else if (t === 'tax') { parts.taxes += eur; if (!own) moveIn(d, eur); }
        else if (t === 'tax_refund') { parts.taxes -= eur; if (!own) moveOut(d, eur); }
        // deposits, withdrawals, transfers: only a clearing account sees them (below)
        return;
      }
      if (tx.type !== 'dividend' && tx.type !== 'interest') return;
      var gross = toEUR((num(tx.quantity) * num(tx.price)) || num(tx.amount), tx);
      var wht = toEUR(Math.max(0, num(tx.withholdingTax)), tx), fee = toEUR(Math.max(0, num(tx.fees)), tx);
      parts.income += gross;
      detail[tx.type === 'dividend' ? 'dividends' : 'interest'] += gross;
      parts.taxes += wht; detail.withholding += wht;
      parts.fees += fee;
      if (!own) moveOut(d, gross - wht - fee);
    });

    // ---- clearing accounts: money in / out and the cash at both ends ----------
    var cash0 = 0, cash1 = 0, anyCash = false;
    Object.keys(clearings).forEach(function (pid) {
      var c = clearings[pid];
      if (!c || !Array.isArray(c.events)) return;
      anyCash = true;
      c.events.forEach(function (e) {
        if (!e || !e.d || e.d > end) return;
        if (e.d <= start) cash0 += e.amount;
        cash1 += e.amount;
        if (!inPeriod(e.d)) return;
        if (e.kind === 'external' || (e.kind === 'trade' && e.key && !covered[normKey(e.key)])) {
          if (e.amount >= 0) moveIn(e.d, e.amount); else moveOut(e.d, -e.amount);
        }
      });
    });

    // ---- daily walk over the measured holdings (the value path's rules) -------
    var factor = function (k, date) {
      var f = 1;
      ((opts.splits && opts.splits[k]) || []).forEach(function (s) { if (s && s.den > 0 && s.num > 0 && date < s.date) f *= s.num / s.den; });
      return f;
    };
    var byDay = {};
    rows.forEach(function (tx) {
      if ((tx.type !== 'buy' && tx.type !== 'sell') || !(num(tx.quantity) > 0)) return;
      var k = keyOf(tx), d = ymd(tx.date);
      if (!covered[k] || d > end) return;
      var f = factor(k, d);
      (byDay[d] || (byDay[d] = [])).push({ k: k, buy: tx.type === 'buy', qty: num(tx.quantity) * f,
        unit: toEUR(tx.price, tx) / f, fee: Math.max(0, toEUR(tx.fees, tx)), own: hasClr(tx) });
    });
    var grid = {};
    Object.keys(covered).forEach(function (k) { series[k].closes.forEach(function (c) { if (c[0] <= end) grid[c[0]] = true; }); });
    Object.keys(byDay).forEach(function (d) { grid[d] = true; });
    if (end === today && Object.keys(covered).some(function (k) { return live[k] > 0; })) grid[today] = true;
    grid[end] = true;
    var dates = Object.keys(grid).sort();

    var ptr = {}, price = {}, local = {}, tradePx = {}, qty = {}, lastRate = {};
    Object.keys(covered).forEach(function (k) { ptr[k] = 0; });
    var px = function (k) { return price[k] > 0 ? price[k] : (tradePx[k] || 0); };
    var valueNow = function () { var v = 0; Object.keys(qty).forEach(function (k) { if (qty[k] > EPS) v += qty[k] * px(k); }); return v; };
    var market = 0, v0 = null;
    dates.forEach(function (d) {
      if (v0 === null && d > start) v0 = valueNow();
      var counts = d > start;
      Object.keys(covered).forEach(function (k) {
        var before = px(k), localBefore = local[k], cl = series[k].closes, cur = series[k].cur || 'EUR';
        while (ptr[k] < cl.length && cl[ptr[k]][0] <= d) {
          if (cl[ptr[k]][1] > 0) {
            price[k] = cl[ptr[k]][1];
            var r0 = rateAt(cur, cl[ptr[k]][0]);
            local[k] = r0 > 0 ? price[k] / r0 : null;
          }
          ptr[k]++;
        }
        if (d === today && live[k] > 0) { price[k] = live[k]; var rl = rateAt(cur, d); local[k] = rl > 0 ? live[k] / rl : null; }
        var q = qty[k] || 0, r = String(cur).toUpperCase() === 'EUR' ? 1 : rateAt(cur, d);
        if (q > EPS && counts) {
          market += q * (px(k) - before);
          // the rate moves first (on the local price held), then the local price
          if (r > 0 && lastRate[k] > 0 && localBefore > 0 && price[k] > 0) parts.fx += q * localBefore * (r - lastRate[k]);
        }
        lastRate[k] = r > 0 ? r : lastRate[k];
      });
      (byDay[d] || []).sort(function (a, b) { return (a.buy ? 0 : 1) - (b.buy ? 0 : 1); }).forEach(function (tr) {
        if (!(price[tr.k] > 0) && tr.unit > 0) tradePx[tr.k] = tr.unit;
        var held = qty[tr.k] || 0, p = px(tr.k), gift = !(tr.unit > 0);
        if (gift) tr.unit = p; // units moved without a price: neither gain nor loss
        if (tr.buy) {
          qty[tr.k] = held + tr.qty;
          if (!counts) return;
          market += tr.qty * (p - tr.unit);
          parts.fees += tr.fee; detail.tradeFees += tr.fee;
          if (!tr.own || gift) moveIn(d, tr.qty * tr.unit + (tr.own ? 0 : tr.fee));
          return;
        }
        var sold = Math.min(tr.qty, held);
        if (!(sold > EPS)) return;
        var fee = tr.fee * (sold / tr.qty);
        qty[tr.k] = held - sold;
        if (!counts) return;
        market += sold * (tr.unit - p);
        parts.fees += fee; detail.tradeFees += fee;
        if (!tr.own || gift) moveOut(d, sold * tr.unit - (tr.own ? 0 : fee));
      });
    });
    if (v0 === null) v0 = valueNow();
    var v1 = valueNow();

    // ---- realized (FIFO, fees left out) / unrealized ---------------------------
    if (L && L.build) {
      try {
        var noFees = rows.filter(function (tx) { return covered[keyOf(tx)]; }).map(function (tx) { return Object.assign({}, tx, { fees: 0 }); });
        L.build(noFees, { exchangeRate: rate, fxAt: fxAt }).list.forEach(function (g) {
          g.disposals.forEach(function (x) { if (inPeriod(x.disposalDate) && x.disposalDate <= end) parts.realized += x.gain; });
        });
      } catch (e) { parts.realized = 0; }
    }
    parts.unrealized = market - parts.realized - parts.fx;

    var startValue = v0 + cash0, endValue = v1 + cash1, change = endValue - startValue;
    var explained = parts.moneyIn - parts.moneyOut + parts.income + parts.realized + parts.unrealized + parts.fx - parts.fees - parts.taxes;
    parts.residual = change - explained;
    if (Math.abs(parts.residual) < 1e-7) parts.residual = 0;
    return { start: start, end: end, startValue: startValue, endValue: endValue, change: change,
      profit: change - parts.moneyIn + parts.moneyOut, cash: anyCash, parts: parts, detail: detail, missing: missing,
      flows: Object.keys(flowDay).sort().filter(function (d) { return Math.abs(flowDay[d]) > 1e-9; }).map(function (d) { return { d: d, amount: flowDay[d] }; }) };
  }

  // Exclusive start day of a period ending today. Month steps keep the month
  // end (31 Mar − 1 month = 28 Feb). MAX = the day before the first booking.
  function periodStart(period, today, transactions) {
    var t = ymd(today) || (typeof window !== 'undefined' && window.MaerminUtils ? window.MaerminUtils : require('./utils.js')).todayISO();
    var y = parseInt(t.slice(0, 4), 10), m = parseInt(t.slice(5, 7), 10), d = parseInt(t.slice(8, 10), 10);
    var back = function (months) {
      var mm = m - months, yy = y;
      while (mm < 1) { mm += 12; yy--; }
      var last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
      return yy + '-' + String(mm).padStart(2, '0') + '-' + String(Math.min(d, last)).padStart(2, '0');
    };
    if (period === '1M') return back(1);
    if (period === '3M') return back(3);
    if (period === '1Y') return back(12);
    if (period === 'YTD') return (y - 1) + '-12-31';
    var first = (transactions || []).filter(function (tx) { return !skip(tx); })
      .reduce(function (mn, tx) { var x = ymd(tx.date); return !mn || x < mn ? x : mn; }, '');
    return first ? addDays(first, -1) : back(12);
  }

  // Signed contribution of a part to the profit (fees and taxes are costs).
  function signed(parts, k) { return COSTS[k] ? -(parts[k] || 0) : (parts[k] || 0); }
  function biggest(parts) {
    var best = null;
    PROFIT.forEach(function (k) {
      var a = signed(parts || {}, k);
      if (Math.abs(a) >= 0.005 && (!best || Math.abs(a) > Math.abs(best.amount))) best = { key: k, amount: a };
    });
    return best;
  }

  function labelOf(k) {
    return {
      moneyIn: __('vaMoneyIn', 'Money in'),
      moneyOut: __('vaMoneyOut', 'Money out'),
      income: __('vaIncome', 'Dividends & interest'),
      realized: __('vaRealized', 'Realised gains'),
      unrealized: __('vaUnrealized', 'Change in unrealised gains'),
      fx: __('vaFx', 'Currency effect'),
      fees: __('vaFees', 'Fees'),
      taxes: __('vaTaxes', 'Taxes'),
      residual: __('vaResidual', 'Not explained by the data')
    }[k];
  }

  // ---- "Profit by source" card ------------------------------------------------
  // props: { transactions, series, clearings, live, splits, exchangeRate, fxAt,
  //          today, theme, formatPrice }
  function Panel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement;
    var I18N = window.MaerminI18n;
    var money = function (v) { return I18N && I18N.money ? I18N.money(v) : (props.formatPrice ? props.formatPrice(v) : (Math.round(v * 100) / 100).toFixed(2) + ' €'); };
    var sP = React.useState('YTD'), period = sP[0], setPeriod = sP[1];
    var today = props.today || (window.MaerminUtils && window.MaerminUtils.todayISO ? window.MaerminUtils.todayISO() : (typeof window !== 'undefined' && window.MaerminUtils ? window.MaerminUtils : require('./utils.js')).todayISO());
    var res = React.useMemo(function () {
      try {
        return compute(props.transactions, props.series, { start: periodStart(period, today, props.transactions), today: today,
          exchangeRate: props.exchangeRate, fxAt: props.fxAt, live: props.live, splits: props.splits, clearings: props.clearings || {} });
      } catch (err) { return null; }
    }, [props.transactions, props.series, props.clearings, props.live, props.splits, props.exchangeRate, props.fxAt, period, today]);

    // R4.1: periods on the shared Segmented; the parts as a waterfall from the
    // start value to the end value (each bar starts where the one before ended).
    var UIC = window.MaerminComponents;
    var periods = e(UIC.Segmented, { label: __('vaPeriod', 'Period'), value: period, size: 'sm', onChange: setPeriod,
      options: PERIODS.map(function (p) { return { value: p, label: p === 'MAX' ? __('vaMax', 'Max') : p === 'YTD' ? __('vaYtd', 'YTD') : p, attrs: { 'data-testid': 'va-period-' + p } }; }) });

    var body;
    if (!res) {
      body = e('p', { className: 'ui-muted' }, __('vaEmpty', 'Add transactions to see where your profit came from.'));
    } else {
      // zero rows are left out; the residual only shows from 50 cents (rounding)
      var list = PARTS.filter(function (k) { return Math.abs(res.parts[k]) >= (k === 'residual' ? 0.5 : 0.005); });
      var steps = [], run = 0, lo = 0, hi = 0;
      list.forEach(function (k) { var a = signed(res.parts, k); steps.push({ k: k, a: a, from: run, to: run + a }); run += a; lo = Math.min(lo, run); hi = Math.max(hi, run); });
      var span = (hi - lo) || 1;
      var toneOf = function (k, a) { return k === 'residual' ? 'rest' : (k === 'moneyIn' || k === 'moneyOut') ? 'flow' : (a >= 0 ? 'gain' : 'loss'); };
      var amount = function (a) { return (a === 0 ? '' : a > 0 ? '+' : '−') + money(Math.abs(a)); };
      var row = function (key, label, value, step) {
        var bar = step ? e('span', { className: 'ui-wf__track', 'aria-hidden': 'true' },
          e('span', { className: 'ui-wf__bar', 'data-tone': toneOf(key, step.a),
            style: { left: ((Math.min(step.from, step.to) - lo) / span * 100) + '%', width: Math.max(0.6, Math.abs(step.a) / span * 100) + '%' } })) : e('span', { className: ['ui-wf__track', 'is-total'].join(' '), 'aria-hidden': 'true' });
        return e('li', { key: key, 'data-testid': 'va-row-' + key, className: ['ui-wf__row', step ? '' : 'is-total'].join(' ').trim() },
          e('span', { className: 'ui-wf__label' }, label),
          bar,
          e('span', { className: ['ui-wf__value', 'num', step ? 'tone-' + toneOf(key, step.a) : ''].join(' ').trim() }, step ? amount(step.a) : money(value)));
      };
      var top = biggest(res.parts);
      body = e('div', null,
        e('ol', { className: 'ui-wf', 'aria-label': __('vaTitle', 'Profit by source') },
          row('start', __('vaStart', 'Value at the start'), res.startValue, null),
          steps.map(function (s) { return row(s.k, labelOf(s.k), s.a, s); }),
          row('end', __('vaEnd', 'Value at the end'), res.endValue, null)),
        e('ul', { className: 'ui-chart__legend' },
          e('li', null, e('span', { className: 'ui-chart__swatch', 'data-series': 'gain', 'aria-hidden': 'true' }), __('vaLegendGain', '+ added value')),
          e('li', null, e('span', { className: 'ui-chart__swatch', 'data-series': 'loss', 'aria-hidden': 'true' }), __('vaLegendLoss', '− took value')),
          e('li', null, e('span', { className: 'ui-chart__swatch', 'data-series': '1', 'aria-hidden': 'true' }), __('vaLegendFlow', 'money in / out'))),
        e('p', { 'data-testid': 'va-profit', className: 'ui-wf__sum' },
          e('b', null, __('vaProfit', 'Profit in this period: {amount}', { amount: (res.profit < 0 ? '−' : '+') + money(Math.abs(res.profit)) })), ' ',
          top ? e('span', { 'data-testid': 'va-biggest' }, __('vaBiggest', 'Biggest driver: {source} ({amount}).',
            { source: labelOf(top.key), amount: (top.amount < 0 ? '−' : '+') + money(Math.abs(top.amount)) })) : null),
        res.missing.length ? e('p', { className: 'ui-note' },
          __('vaMissing', 'Not priced, so not measured: {list}.', { list: res.missing.map(function (m) { return m.symbol; }).join(', ') })) : null,
        e('p', { className: 'ui-note' },
          res.cash ? __('vaNoteCash', 'Money in and out = deposits, withdrawals and transfers of the clearing account. Gains are shown before fees; fees and taxes count when they were paid. Realised gains follow the FIFO ledger; the currency effect is taken out of the unrealised gains.')
            : __('vaNoteNoCash', 'Without a clearing account, purchases count as money in and sales and payouts as money out. Gains are shown before fees; fees and taxes count when they were paid. Realised gains follow the FIFO ledger; the currency effect is taken out of the unrealised gains.')));
    }

    return e(UIC.Card, { 'data-testid': 'value-attribution', title: __('vaTitle', 'Profit by source'), headingLevel: 'h3', action: periods, className: 'ui-chart' }, body);
  }

  var api = { compute: compute, periodStart: periodStart, biggest: biggest, PARTS: PARTS, PERIODS: PERIODS, Panel: Panel };
  if (typeof window !== 'undefined') window.MaerminValueAttribution = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
