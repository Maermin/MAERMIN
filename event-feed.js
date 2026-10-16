// ============================================================================
// MAERMIN — Event feed and ICS export  (window.MaerminEventFeed)
// ----------------------------------------------------------------------------
// P5-5.5. One dated list for the symbols you hold and the ones you watch:
//   - earnings, ex-dividend and pay dates (the Worker's `earnings` route, which
//     reads Yahoo's calendarEvents - market data only, a symbol in, dates out);
//   - expected pay dates from the dividend schedule (estimates; a confirmed
//     pay date within 30 days replaces one);
//   - upcoming splits, savings-plan executions;
//   - tax dates: Vorabpauschale debit, crypto lots turning tax-free, the IRA
//     deadline, the yearly return deadline (DE, AT, US);
//   - ECB and Fed rate decisions (published schedules, below).
// `toICS` writes the same events as an RFC 5545 calendar file. Everything is
// built on this device; the file is only a download.
// Node-tested in test/event-feed.test.js.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }
  var W = typeof window !== 'undefined' ? window : {};

  var DAY_MS = 24 * 60 * 60 * 1000;
  var CONFIRM_WINDOW = 30; // days within which a confirmed pay date replaces an estimate (payouts are at most monthly)
  var KIND_ORDER = ['macro', 'earnings', 'exdiv', 'pay', 'split', 'plan', 'tax'];
  var KINDS = KIND_ORDER.slice();
  var PRODID = ['PRODID:-', 'MAERMIN', 'events', 'EN'].join('//'); // RFC 5545 product id, not UI text

  // Rate decision days (the day the decision is announced). ECB: Governing
  // Council monetary policy meetings; Fed: second day of each FOMC meeting
  // (2027 tentative). Sources: ecb.europa.eu, federalreserve.gov.
  var MACRO = {
    ecb: ['2026-02-05', '2026-03-19', '2026-04-30', '2026-06-11', '2026-07-23', '2026-09-10', '2026-10-29', '2026-12-17',
      '2027-02-04', '2027-03-18', '2027-04-29', '2027-06-10', '2027-07-22', '2027-09-09', '2027-10-28', '2027-12-16'],
    fomc: ['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
      '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-09', '2027-07-28', '2027-09-15', '2027-10-27', '2027-12-08']
  };

  function ymd(d) { return String(d || '').slice(0, 10); }
  function isISO(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function toDate(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); }
  function fromDate(d) { return d.toISOString().slice(0, 10); }
  function addDays(iso, n) { return fromDate(new Date(toDate(iso).getTime() + n * DAY_MS)); }
  function daysBetween(a, b) { return Math.round((toDate(b) - toDate(a)) / DAY_MS); }
  // Saturday and Sunday move to the Monday after.
  function rollWeekend(iso) { var w = toDate(iso).getUTCDay(); return w === 6 ? addDays(iso, 2) : w === 0 ? addDays(iso, 1) : iso; }
  function upper(s) { return String(s || '').trim().toUpperCase(); }
  function safe(s) { return String(s || '').replace(/[^A-Za-z0-9._-]/g, '_'); }
  function fmt2(v) { return (Math.round(v * 100) / 100).toFixed(2); }

  // PURE. input: { today, held: [sym], watched: [sym],
  //   earnings: [{ symbol, earningsDate, earningsDateEnd, isEstimate, epsEstimate, exDividendDate, dividendDate }],
  //   dividends: [{ symbol, date, amount, currency }]  (the schedule: estimates),
  //   splits: [{ symbol, date, num, den }],
  //   plans: [{ id, symbol, amount, currency, frequency, startDate, endDate, active }],
  //   vap: { year, tax }, crypto: [{ symbol, date, quantity }], ira: { year, remaining },
  //   jurisdiction: 'de' | 'at' | 'ch' | 'us' }
  // opts: { days (120), back (0), kinds: { <kind>: false }, amounts (true), money(v, cur), num(v, d), date(iso) }
  // -> [{ uid, date, kind, symbol, title, detail, watched, estimated }] sorted by date.
  function build(input, opts) {
    input = input || {}; opts = opts || {};
    var today = isISO(input.today) ? input.today : new Date().toISOString().slice(0, 10);
    var from = addDays(today, -(opts.back > 0 ? opts.back : 0));
    var to = addDays(today, opts.days > 0 ? opts.days : 120);
    var on = {}; KINDS.forEach(function (k) { on[k] = !(opts.kinds && opts.kinds[k] === false); });
    var amounts = opts.amounts !== false;
    var money = opts.money || function (v, cur) { return fmt2(v) + (cur ? ' ' + cur : ''); };
    var nm = opts.num || function (v, d) { return Number(v).toFixed(d); };
    var dt = opts.date || function (iso) { return iso; };
    var held = {}; (input.held || []).forEach(function (s) { held[upper(s)] = true; });
    var watchedOnly = function (s) { return !held[s] && (input.watched || []).some(function (w) { return upper(w) === s; }); };
    var out = [], seen = {};
    function inRange(d) { return isISO(d) && d >= from && d <= to; }
    function push(ev) {
      if (!on[ev.kind] || !inRange(ev.date) || seen[ev.uid]) return;
      seen[ev.uid] = true;
      out.push({ uid: ev.uid, date: ev.date, kind: ev.kind, symbol: ev.symbol || null, title: ev.title, detail: ev.detail || '',
        watched: !!ev.watched, estimated: !!ev.estimated });
    }

    // ---- symbols: earnings, ex-dates, confirmed pay dates ---------------------------
    var confirmedPay = {};
    (input.earnings || []).forEach(function (r) {
      if (!r || !r.symbol) return;
      var s = upper(r.symbol), w = watchedOnly(s);
      if (isISO(r.earningsDate)) {
        var est = !!r.isEstimate || (isISO(r.earningsDateEnd) && r.earningsDateEnd !== r.earningsDate);
        var eps = num(r.epsEstimate);
        push({ uid: 'earnings-' + safe(s) + '-' + r.earningsDate, date: r.earningsDate, kind: 'earnings', symbol: s, watched: w, estimated: est,
          title: est ? __('evfEarningsEst', '{sym} earnings (estimated)', { sym: s }) : __('evfEarnings', '{sym} earnings', { sym: s }),
          detail: [est && isISO(r.earningsDateEnd) ? __('evfWindow', 'Expected between {a} and {b}', { a: dt(r.earningsDate), b: dt(r.earningsDateEnd) }) : '',
            amounts && eps != null ? __('evfEps', 'Consensus EPS {v}', { v: nm(eps, 2) }) : ''].filter(Boolean).join(' · ') });
      }
      if (isISO(r.exDividendDate)) push({ uid: 'exdiv-' + safe(s) + '-' + r.exDividendDate, date: r.exDividendDate, kind: 'exdiv', symbol: s, watched: w,
        title: __('evfExDiv', '{sym} ex-dividend', { sym: s }), detail: __('evfExDivDetail', 'Buy before this day to receive the next dividend.') });
      if (isISO(r.dividendDate)) {
        (confirmedPay[s] = confirmedPay[s] || []).push(r.dividendDate);
        push({ uid: 'pay-' + safe(s) + '-' + r.dividendDate, date: r.dividendDate, kind: 'pay', symbol: s, watched: w,
          title: __('evfPay', '{sym} dividend payment', { sym: s }), detail: '' });
      }
    });
    // ---- the dividend schedule (held positions, estimates) --------------------------
    (input.dividends || []).forEach(function (x) {
      if (!x || !x.symbol || !isISO(ymd(x.date))) return;
      var s = upper(x.symbol), d = ymd(x.date);
      if ((confirmedPay[s] || []).some(function (c) { return Math.abs(daysBetween(c, d)) <= CONFIRM_WINDOW; })) return;
      var amt = num(x.amount);
      push({ uid: 'pay-' + safe(s) + '-' + d, date: d, kind: 'pay', symbol: s, estimated: true,
        title: __('evfPayEst', '{sym} dividend (expected)', { sym: s }),
        detail: amounts && amt != null && amt > 0 ? __('evfPayAmount', 'About {v}', { v: money(amt, x.currency) }) : '' });
    });
    // ---- splits ---------------------------------------------------------------------
    (input.splits || []).forEach(function (x) {
      if (!x || !x.symbol || !isISO(x.date)) return;
      var s = upper(x.symbol);
      push({ uid: 'split-' + safe(s) + '-' + x.date, date: x.date, kind: 'split', symbol: s,
        title: __('evfSplit', '{sym} split {r}', { sym: s, r: x.num + ' : ' + x.den }), detail: '' });
    });
    // ---- savings plans --------------------------------------------------------------
    var R = W.MaerminRecurring || (typeof require === 'function' ? require('./recurring.js') : null);
    (input.plans || []).forEach(function (p) {
      if (!p || p.active === false || !isISO(p.startDate) || !R) return;
      var s = upper(p.symbol), amt = num(p.amount);
      R.expandOccurrences({ id: p.id, name: s, amount: amt > 0 ? amt : 1, interval: p.frequency || 'monthly', startDate: p.startDate, endDate: p.endDate || null }, from, to, 2000)
        .forEach(function (o) {
          push({ uid: 'plan-' + safe(p.id || s) + '-' + o.date, date: o.date, kind: 'plan', symbol: s,
            title: __('evfPlan', 'Savings plan {sym}', { sym: s }),
            detail: amounts && amt > 0 ? __('evfPlanAmount', '{v} invested', { v: money(amt, p.currency || 'EUR') }) : '' });
        });
    });
    // ---- tax dates ------------------------------------------------------------------
    var jur = String(input.jurisdiction || '').toLowerCase();
    if (input.vap && input.vap.tax > 0 && input.vap.year) {
      var vd = rollWeekend((Number(input.vap.year) + 1) + '-01-02');
      push({ uid: 'tax-vap-' + input.vap.year, date: vd, kind: 'tax', title: __('evfVap', 'Vorabpauschale {y} debited', { y: input.vap.year }),
        detail: amounts ? __('evfVapDetail', 'About {v} tax. Keep it on the clearing account.', { v: money(input.vap.tax, 'EUR') }) : __('evfVapGeneric', 'Keep the tax on the clearing account.') });
    }
    (input.crypto || []).forEach(function (x) {
      if (!x || !x.symbol || !(x.quantity > 0)) return;
      var s = upper(x.symbol), d = ymd(x.date);
      push({ uid: 'tax-crypto-' + safe(s) + '-' + d, date: d, kind: 'tax', symbol: s,
        title: __('evfCrypto', '{sym} tax-free', { sym: s }),
        detail: amounts ? __('evfCryptoDetail', '{q} {sym} held over one year from this day.', { q: nm(x.quantity, 8).replace(/\.?0+$/, ''), sym: s }) : __('evfCryptoGeneric', 'A lot has been held over one year from this day.') });
    });
    if (input.ira && input.ira.year && input.ira.remaining > 0) {
      push({ uid: 'tax-ira-' + input.ira.year, date: rollWeekend((Number(input.ira.year) + 1) + '-04-15'), kind: 'tax',
        title: __('evfIra', 'IRA contributions for {y} close', { y: input.ira.year }),
        detail: amounts ? __('evfIraDetail', 'Room left: {v}', { v: money(input.ira.remaining, 'USD') }) : '' });
    }
    var y0 = Number(today.slice(0, 4));
    [y0 - 2, y0 - 1, y0].forEach(function (y) {
      if (jur === 'de') push({ uid: 'tax-return-de-' + y, date: rollWeekend((y + 1) + '-07-31'), kind: 'tax', title: __('evfReturnDe', 'Tax return {y} due', { y: y }),
        detail: __('evfReturnDeDetail', 'If you have to file and no tax adviser files for you.') });
      if (jur === 'at') push({ uid: 'tax-return-at-' + y, date: rollWeekend((y + 1) + '-06-30'), kind: 'tax', title: __('evfReturnAt', 'Tax return {y} due (FinanzOnline)', { y: y }),
        detail: __('evfReturnAtDetail', 'If you have to file: 30 April on paper, 30 June online.') });
      if (jur === 'us') push({ uid: 'tax-day-us-' + y, date: rollWeekend((y + 1) + '-04-15'), kind: 'tax', title: __('evfTaxDayUs', 'Tax Day: {y} return due', { y: y }),
        detail: __('evfTaxDayUsDetail', 'Federal return or extension; a weekday holiday moves it further.') });
    });
    // ---- central banks --------------------------------------------------------------
    MACRO.ecb.forEach(function (d) { push({ uid: 'macro-ecb-' + d, date: d, kind: 'macro', title: __('evfEcb', 'ECB rate decision'), detail: __('evfEcbTime', '14:15 CET, press conference 14:45') }); });
    MACRO.fomc.forEach(function (d) { push({ uid: 'macro-fomc-' + d, date: d, kind: 'macro', title: __('evfFomc', 'Fed rate decision (FOMC)'), detail: __('evfFomcTime', '14:00 ET, press conference 14:30') }); });

    out.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      var k = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
      if (k) return k;
      return String(a.symbol || '') < String(b.symbol || '') ? -1 : String(a.symbol || '') > String(b.symbol || '') ? 1 : (a.uid < b.uid ? -1 : 1);
    });
    return out;
  }

  // ---- ICS (RFC 5545) -------------------------------------------------------------
  function icsEscape(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n'); }
  function utf8Len(ch) { var c = ch.codePointAt(0); return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; }
  // Lines longer than 75 octets continue on the next line after one space;
  // characters are never split.
  function fold(line) {
    var out = [], cur = '', n = 0, limit = 75;
    Array.from(line).forEach(function (ch) {
      var l = utf8Len(ch);
      if (n + l > limit) { out.push(cur); cur = ' '; n = 1; limit = 75; }
      cur += ch; n += l;
    });
    out.push(cur);
    return out.join('\r\n');
  }
  function stamp(now) {
    var d = now ? new Date(now) : new Date();
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }
  // events: build() output. opts: { now, name }
  function toICS(events, opts) {
    opts = opts || {};
    var dt = stamp(opts.now);
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', PRODID, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'X-WR-CALNAME:' + icsEscape(opts.name || 'MAERMIN')];
    (events || []).forEach(function (ev) {
      if (!ev || !isISO(ev.date)) return;
      lines.push('BEGIN:VEVENT', 'UID:' + icsEscape(ev.uid) + '@maermin', 'DTSTAMP:' + dt,
        'DTSTART;VALUE=DATE:' + ev.date.replace(/-/g, ''), 'DTEND;VALUE=DATE:' + addDays(ev.date, 1).replace(/-/g, ''),
        'SUMMARY:' + icsEscape(ev.title));
      if (ev.detail) lines.push('DESCRIPTION:' + icsEscape(ev.detail));
      lines.push('CATEGORIES:' + icsEscape(ev.kind), 'TRANSP:TRANSPARENT', 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  }

  // ---- the view ---------------------------------------------------------------------
  function kindLabel(k) {
    switch (k) {
      case 'earnings': return __('evfKindEarnings', 'Earnings');
      case 'exdiv': return __('evfKindExDiv', 'Ex-dates');
      case 'pay': return __('evfKindPay', 'Payments');
      case 'split': return __('evfKindSplit', 'Splits');
      case 'plan': return __('evfKindPlan', 'Savings plans');
      case 'tax': return __('evfKindTax', 'Tax dates');
      case 'macro': return __('evfKindMacro', 'Central banks');
      default: return k;
    }
  }
  var LOAD_MAX = 40;    // symbols asked for per visit
  var LOAD_PARALLEL = 3;
  var memo = {};        // symbol -> parsed earnings row, for this session
  function parseEarnings(j) {
    if (!j || typeof j !== 'object' || j.error || !j.symbol) return null;
    return { symbol: upper(j.symbol), earningsDate: j.earningsDate || null, earningsDateEnd: j.earningsDateEnd || null, isEstimate: !!j.isEstimate,
      epsEstimate: j.epsEstimate, exDividendDate: j.exDividendDate || null, dividendDate: j.dividendDate || null };
  }

  // props: { theme, workerUrl, held: [sym], watched: [sym], input (dividends, vap, crypto, ira, jurisdiction), plans, splits, privacy }
  function View(props) {
    var React = W.React;
    if (!React) return null;
    var e = React.createElement, useState = React.useState, useEffect = React.useEffect;
    var th = props.theme || {};
    var text = th.text || '#e6edf3', dim = th.textSecondary || '#9aa4b2', border = th.cardBorder || 'rgba(255,255,255,0.1)';
    var warn = th.warning || '#f59e0b', accent = th.accent || '#8b7cff';
    var I = W.MaerminI18n;
    var base = String(props.workerUrl || '').replace(/\/+$/, '');
    var held = (props.held || []).map(upper), watched = (props.watched || []).map(upper);
    var syms = held.concat(watched.filter(function (s) { return held.indexOf(s) < 0; })).slice(0, LOAD_MAX);
    var s0 = useState({ state: 'idle', rows: [] }); var load = s0[0], setLoad = s0[1];
    var s1 = useState(function () { var o = {}; KINDS.forEach(function (k) { o[k] = true; }); return o; }); var on = s1[0], setOn = s1[1];
    var s2 = useState(true); var withWatched = s2[0], setWithWatched = s2[1];
    var s3 = useState(false); var icsAmounts = s3[0], setIcsAmounts = s3[1];
    var key = syms.join(',');
    useEffect(function () {
      if (!base || !syms.length) { setLoad({ state: base ? 'ok' : 'noworker', rows: [] }); return; }
      var dead = false, queue = syms.slice(), rows = [], old = false;
      setLoad({ state: 'loading', rows: [] });
      function next() {
        var s = queue.shift();
        if (!s || dead) return Promise.resolve();
        if (memo[s] !== undefined) { if (memo[s]) rows.push(memo[s]); return next(); }
        return fetch(base + '/?action=earnings&symbol=' + encodeURIComponent(s))
          .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
          .then(function (r) {
            if (r.status === 400 && /action/i.test(JSON.stringify(r.j))) old = true;
            var row = r.status === 200 ? parseEarnings(r.j) : null;
            memo[s] = row; if (row) rows.push(row);
          }, function () { /* offline: no row */ })
          .then(next);
      }
      var workers = []; for (var i = 0; i < LOAD_PARALLEL; i++) workers.push(next());
      Promise.all(workers).then(function () { if (!dead) setLoad({ state: old ? 'old' : 'ok', rows: rows.slice() }); });
      return function () { dead = true; };
    }, [key, base]);

    var inp = props.input || {};
    var money = function (v, cur) { return I ? I.money(v, cur || 'EUR') : fmt2(v); };
    var numF = function (v, d) { return I ? I.num(v, d) : Number(v).toFixed(d); };
    function events(amounts, kinds) {
      return build({ today: new Date().toISOString().slice(0, 10), held: held, watched: withWatched ? watched : [],
        earnings: load.rows.filter(function (r) { return withWatched || held.indexOf(r.symbol) >= 0; }),
        dividends: inp.dividends, splits: props.splits, plans: props.plans, vap: inp.vap, crypto: inp.crypto, ira: inp.ira, jurisdiction: inp.jurisdiction },
        { days: 120, amounts: amounts, kinds: kinds, money: money, num: numF, date: function (d) { return I && I.date ? I.date(d) : d; } });
    }
    var list = events(!props.privacy, on);
    function download() {
      var ics = toICS(events(icsAmounts && !props.privacy, on), { name: 'MAERMIN' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' })); a.download = 'maermin-events.ics';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }

    var card = { background: th.card || th.cardBg, border: '1px solid ' + border, borderRadius: '14px', padding: '1rem 1.25rem', marginBottom: '1rem' };
    var chip = function (active) { return { padding: '0.3rem 0.65rem', borderRadius: '999px', border: '1px solid ' + (active ? accent : border), background: active ? (th.accentFill || accent) : th.inputBg, color: active ? '#fff' : text, cursor: 'pointer', fontSize: '0.74rem', fontWeight: 600 }; };
    var months = [], byMonth = {};
    list.forEach(function (ev) { var m = ev.date.slice(0, 7); if (!byMonth[m]) { byMonth[m] = []; months.push(m); } byMonth[m].push(ev); });
    var monthName = function (m) { return I && I.date ? I.date(m + '-01', 'monthLong') : m; };
    var dayLabel = function (d) { return I && I.date ? I.date(d) : d; };

    return e('div', { 'data-testid': 'events-view', style: { padding: '1.5rem' } },
      e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem' } },
        e('h2', { style: { color: text, fontSize: '1.5rem', fontWeight: 700, margin: 0 } }, __('evfTitle', 'Events')),
        e('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' } },
          e('label', { style: { color: dim, fontSize: '0.78rem', display: 'flex', gap: '0.3rem', alignItems: 'center' } },
            e('input', { type: 'checkbox', 'data-testid': 'evf-ics-amounts', checked: icsAmounts, disabled: !!props.privacy, onChange: function (ev) { setIcsAmounts(ev.target.checked); } }),
            __('evfIcsAmounts', 'Amounts in the file')),
          e('button', { 'data-testid': 'evf-ics', style: chip(true), onClick: download, disabled: !list.length }, __('evfIcs', 'Export calendar (.ics)')))),
      e('p', { style: { color: dim, fontSize: '0.82rem', margin: '0 0 0.9rem', maxWidth: '60rem' } },
        __('evfIntro', 'The next 120 days for what you hold and watch: earnings, ex-dates and payments, splits, savings plans, tax dates and central-bank decisions. The calendar file stays on this device until you import it somewhere; amounts are left out unless you tick the box.')),
      e('div', { style: { display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '1rem' } },
        KINDS.map(function (k) { return e('button', { key: k, 'data-testid': 'evf-kind-' + k, 'aria-pressed': on[k] ? 'true' : 'false', style: chip(on[k]), onClick: function () { var n = Object.assign({}, on); n[k] = !n[k]; setOn(n); } }, kindLabel(k)); }),
        watched.length ? e('button', { 'data-testid': 'evf-watched', 'aria-pressed': withWatched ? 'true' : 'false', style: chip(withWatched), onClick: function () { setWithWatched(!withWatched); } }, __('evfWatched', 'Watchlist')) : null),
      load.state === 'noworker' ? e('div', { style: Object.assign({}, card, { color: warn, fontSize: '0.82rem' }) }, __('evfNoWorker', 'Earnings, ex-dates and pay dates come through your Worker (API Settings). Everything else is shown without one.')) : null,
      load.state === 'old' ? e('div', { style: Object.assign({}, card, { color: warn, fontSize: '0.82rem' }) }, __('evfOldWorker', 'Your Worker has no earnings route yet. Redeploy it (API Settings) for earnings and ex-dates.')) : null,
      load.state === 'loading' ? e('div', { 'data-testid': 'evf-loading', style: { color: dim, fontSize: '0.8rem', marginBottom: '0.75rem' } }, __('evfLoading', 'Loading dates for {n} symbols…', { n: syms.length })) : null,
      !list.length && load.state !== 'loading' ? e('div', { style: Object.assign({}, card, { color: dim, fontSize: '0.85rem' }) }, __('evfEmpty', 'Nothing in the next 120 days for the selected types.')) : null,
      months.map(function (m) {
        return e('div', { key: m, style: card },
          e('h3', { style: { color: text, fontSize: '1rem', fontWeight: 700, margin: '0 0 0.4rem' } }, monthName(m)),
          byMonth[m].map(function (ev) {
            return e('div', { key: ev.uid, 'data-testid': 'evf-row', 'data-kind': ev.kind, style: { display: 'grid', gridTemplateColumns: 'minmax(6.5rem, auto) 1fr', gap: '0.75rem', padding: '0.5rem 0', borderTop: '1px solid ' + border } },
              e('div', { style: { color: dim, fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums' } }, dayLabel(ev.date)),
              e('div', null,
                e('div', { style: { color: text, fontWeight: 600, fontSize: '0.88rem' } },
                  ev.title,
                  ev.watched ? e('span', { style: { marginLeft: '0.4rem', color: dim, fontSize: '0.7rem', border: '1px solid ' + border, borderRadius: '6px', padding: '0 0.3rem' } }, __('evfWatchedTag', 'watched')) : null),
                e('div', { style: { color: dim, fontSize: '0.76rem' } }, [kindLabel(ev.kind), ev.detail].filter(Boolean).join(' · '))));
          }));
      }),
      e('p', { style: { color: dim, fontSize: '0.72rem', margin: '0.5rem 0 0' } },
        __('evfSource', 'Dates: Yahoo Finance (personal use), your dividend schedule and savings plans, the ECB and Fed meeting calendars. Expected dates can move.')));
  }

  var api = { build: build, toICS: toICS, fold: fold, rollWeekend: rollWeekend, MACRO: MACRO, KINDS: KINDS, View: View };
  if (typeof window !== 'undefined') window.MaerminEventFeed = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
