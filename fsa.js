// ============================================================================
// MAERMIN — Freistellungsaufträge per broker  (window.MaerminFSA)
// ----------------------------------------------------------------------------
// P2-6. The Sparerpauschbetrag (1,000 EUR single / 2,000 EUR joint, the
// allowance in the tax settings) can be split across brokers by
// Freistellungsauftrag. The user enters the amount per broker and, optionally,
// the portfolios held there. The panel warns when the orders add up to more
// than the allowance, and shows per broker how much of its order this year's
// capital income has used and what is left.
//
// Income per broker = the German capital income (after Teilfreistellung and
// loss pots, before the allowance; crypto and other private sales excluded)
// of the linked portfolios' transactions, with their own FIFO - each broker
// keeps its own depot. Computed with MaerminTaxReport.build, so it matches the
// Tax Report.
//
// Storage key 'maermin_fsa' (encrypted, synced, in the backup):
//   { version: 1, brokers: [{ id, name, amount, portfolioIds: [] }] }
// Pure helpers are Node-tested in test/fsa.test.js.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var KEY = 'maermin_fsa';
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function round2(v) { return Math.round(v * 100) / 100; }

  // ---- pure ------------------------------------------------------------------
  function normalize(raw) {
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { raw = null; } }
    var list = raw && Array.isArray(raw.brokers) ? raw.brokers : [];
    return { version: 1, brokers: list.filter(function (b) { return b && b.id; }).map(function (b) {
      return { id: String(b.id), name: String(b.name || '').slice(0, 80), amount: Math.max(0, round2(num(b.amount))),
        portfolioIds: Array.isArray(b.portfolioIds) ? b.portfolioIds.map(String) : [] };
    }) };
  }
  function upsert(state, broker) {
    state = normalize(state);
    var b = normalize({ brokers: [broker] }).brokers[0];
    if (!b) return state;
    var i = state.brokers.findIndex(function (x) { return x.id === b.id; });
    if (i > -1) state.brokers[i] = b; else state.brokers.push(b);
    return state;
  }
  function remove(state, id) {
    state = normalize(state);
    state.brokers = state.brokers.filter(function (b) { return b.id !== id; });
    return state;
  }

  // incomeOf(broker) -> capital income at that broker this year, or null when
  // unknown (no portfolio linked). Returns the whole picture for the panel.
  function summarize(state, allowance, incomeOf) {
    state = normalize(state);
    allowance = Math.max(0, num(allowance));
    var total = 0;
    var rows = state.brokers.map(function (b) {
      total += b.amount;
      var income = incomeOf ? incomeOf(b) : null;
      var known = income != null && isFinite(income);
      var used = known ? Math.min(b.amount, Math.max(0, income)) : null;
      return { id: b.id, name: b.name, amount: b.amount, portfolioIds: b.portfolioIds,
        income: known ? round2(income) : null, used: known ? round2(used) : null,
        headroom: known ? round2(b.amount - used) : null,
        // income beyond the order is taxed at the broker; the tax return can still
        // apply unassigned allowance to it
        taxedAtBroker: known ? round2(Math.max(0, income - b.amount)) : null };
    });
    total = round2(total);
    return { allowance: allowance, total: total, over: total > allowance + 0.004, excess: round2(Math.max(0, total - allowance)),
      unassigned: round2(Math.max(0, allowance - total)), rows: rows };
  }

  // ---- storage ---------------------------------------------------------------
  function ls() { return (typeof localStorage !== 'undefined') ? localStorage : null; }
  function load() { var s = ls(); return normalize(s ? s.getItem(KEY) : null); }
  function save(state) { var s = ls(); if (s) { try { s.setItem(KEY, JSON.stringify(normalize(state))); } catch (e) { /* quota */ } } }

  // ---- panel (Tax view, German rules) ---------------------------------------
  // props: { theme, transactions, portfolios, year, exchangeRate, fxAt, allowance, formatMoney }
  function Panel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement, useState = React.useState, useMemo = React.useMemo;
    var th = props.theme || {};
    var text = th.text || '#e6edf3', dim = th.textSecondary || '#9aa4b2', border = th.cardBorder || 'rgba(255,255,255,0.1)';
    var inputBg = th.inputBg || '#0f172a', warn = th.warning || '#f59e0b', ok = th.success || '#22c55e';
    var money = props.formatMoney || function (v) { return window.MaerminI18n.money(v, 'EUR'); };
    var s0 = useState(load); var st = s0[0], setSt = s0[1];
    var f0 = useState({ name: '', amount: '' }); var form = f0[0], setForm = f0[1];
    function mutate(next) { save(next); setSt(normalize(next)); }
    var portfolios = props.portfolios || [];
    var txs = props.transactions || [];
    var TR = window.MaerminTaxReport;

    var incomeByKey = useMemo(function () {
      var memo = {};
      return function (b) {
        if (!b.portfolioIds.length || !TR) return null;
        var key = b.portfolioIds.slice().sort().join('|');
        if (memo[key] === undefined) {
          var subset = txs.filter(function (tx) { return b.portfolioIds.indexOf(String(tx.portfolioId || 'default')) > -1; });
          var rep = null;
          try { rep = TR.build(subset, { year: props.year, jurisdiction: 'de', baseCurrency: 'EUR', exchangeRate: props.exchangeRate, fxAt: props.fxAt }); } catch (err) { rep = null; }
          var g = rep && rep.summary && rep.summary.germanDetail;
          memo[key] = g ? num(g.nettedIncome) : null;
        }
        return memo[key];
      };
    }, [txs, props.year, props.exchangeRate, props.fxAt]);

    var sum = summarize(st, props.allowance, incomeByKey);
    var inp = { padding: '0.45rem 0.6rem', background: inputBg, border: '1px solid ' + border, borderRadius: '7px', color: text, fontSize: '0.82rem' };

    function add() {
      var name = form.name.trim(), amount = window.MaerminUtils ? window.MaerminUtils.parseDecimal(form.amount) : num(form.amount);
      if (!name || !(amount >= 0)) return;
      mutate(upsert(st, { id: 'fsa_' + Date.now().toString(36), name: name, amount: amount, portfolioIds: [] }));
      setForm({ name: '', amount: '' });
    }
    function togglePf(b, pid) {
      var ids = b.portfolioIds.indexOf(pid) > -1 ? b.portfolioIds.filter(function (x) { return x !== pid; }) : b.portfolioIds.concat([pid]);
      mutate(upsert(st, Object.assign({}, b, { portfolioIds: ids })));
    }

    return e('div', { 'data-testid': 'fsa-panel', style: { background: th.cardBg, border: '1px solid ' + border, borderRadius: '14px', padding: '1.25rem', margin: '1.5rem 0 0' } },
      e('h3', { style: { color: text, fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.35rem' } }, __('fsaTitle', 'Freistellungsaufträge per broker')),
      e('p', { style: { color: dim, fontSize: '0.8rem', margin: '0 0 0.9rem', lineHeight: 1.5 } },
        __('fsaIntro', 'Split your allowance of {a} across your brokers. Link the portfolios you hold at each broker to see how much of its order this year has used.', { a: money(sum.allowance) })),
      sum.over && e('div', { role: 'alert', 'data-testid': 'fsa-over', style: { color: warn, background: warn + '14', border: '1px solid ' + warn + '55', borderRadius: '8px', padding: '0.55rem 0.8rem', fontSize: '0.82rem', marginBottom: '0.8rem' } },
        __('fsaOver', 'Your orders add up to {t}, {x} more than your allowance of {a}. Lower one of them: banks may not exempt more than the allowance in total.', { t: money(sum.total), x: money(sum.excess), a: money(sum.allowance) })),
      sum.rows.length > 0 && e('div', { style: { overflowX: 'auto' } },
        e('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', color: text } },
          e('thead', null, e('tr', { style: { color: dim, textAlign: 'left' } },
            [__('fsaBroker', 'Broker'), __('fsaOrder', 'Order'), __('fsaIncome', 'Capital income {y}', { y: props.year }), __('fsaUsed', 'Used'), __('fsaLeft', 'Left'), ''].map(function (h, i) {
              return e('th', { key: i, style: { padding: '0.4rem 0.5rem', fontWeight: 600, borderBottom: '1px solid ' + border, textAlign: i > 0 && i < 5 ? 'right' : 'left' } }, h);
            }))),
          e('tbody', null, sum.rows.map(function (r) {
            var b = st.brokers.filter(function (x) { return x.id === r.id; })[0];
            var cell = function (v, color) { return e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: color || text, whiteSpace: 'nowrap' } }, v); };
            return e(React.Fragment, { key: r.id },
              e('tr', { 'data-fsa-broker': r.name },
                e('td', { style: { padding: '0.45rem 0.5rem', fontWeight: 600 } }, r.name),
                e('td', { style: { padding: '0.3rem 0.5rem', textAlign: 'right' } },
                  e('input', { type: 'text', inputMode: 'decimal', defaultValue: window.MaerminI18n.num(r.amount, 2), 'aria-label': __('fsaOrderAria', 'Order at {name}', { name: r.name }),
                    onBlur: function (ev) { var v = window.MaerminUtils.parseDecimal(ev.target.value); if (v >= 0) mutate(upsert(st, Object.assign({}, b, { amount: v }))); },
                    style: Object.assign({}, inp, { width: '7rem', textAlign: 'right' }) })),
                cell(r.income == null ? '—' : money(r.income)),
                cell(r.used == null ? '—' : money(r.used)),
                cell(r.headroom == null ? '—' : money(r.headroom), r.headroom == null ? dim : (r.headroom > 0 ? ok : warn)),
                e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right' } },
                  e('button', { type: 'button', 'aria-label': __('fsaRemoveAria', 'Remove {name}', { name: r.name }),
                    onClick: function () { window.MaerminUtils.confirmThen({ title: __('fsaRemoveTitle', 'Remove the order at "{name}"?', { name: r.name }), confirmLabel: __('remove', 'Remove'), cancelLabel: __('cancel', 'Cancel') }, function () { mutate(remove(st, r.id)); }); },
                    style: { background: 'none', border: 'none', color: dim, cursor: 'pointer', fontSize: '0.9rem' } }, '×'))),
              e('tr', null, e('td', { colSpan: 6, style: { padding: '0 0.5rem 0.6rem', borderBottom: '1px solid ' + border, color: dim, fontSize: '0.76rem' } },
                __('fsaPortfolios', 'Portfolios at this broker:') + ' ',
                portfolios.map(function (p) {
                  var on = b.portfolioIds.indexOf(String(p.id)) > -1;
                  return e('label', { key: p.id, style: { marginRight: '0.75rem', whiteSpace: 'nowrap', cursor: 'pointer' } },
                    e('input', { type: 'checkbox', checked: on, onChange: function () { togglePf(b, String(p.id)); }, style: { marginRight: '0.25rem' } }), p.name);
                }),
                r.taxedAtBroker > 0 ? e('div', { style: { color: warn, marginTop: '0.2rem' } },
                  __('fsaTaxedAtBroker', '{x} of the income is above the order, so the broker withholds tax on it. Unassigned allowance can still be claimed in the tax return.', { x: money(r.taxedAtBroker) })) : null)));
          })),
          e('tfoot', null, e('tr', { style: { color: dim } },
            e('td', { style: { padding: '0.45rem 0.5rem' } }, __('fsaTotal', 'Total')),
            e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: sum.over ? warn : text, fontWeight: 700 } }, money(sum.total)),
            e('td', { colSpan: 4, style: { padding: '0.45rem 0.5rem', textAlign: 'right' } },
              sum.over ? '' : __('fsaUnassigned', 'Not assigned: {x}', { x: money(sum.unassigned) })))))),
      e('div', { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.9rem', alignItems: 'center' } },
        e('input', { type: 'text', value: form.name, placeholder: __('fsaNamePh', 'Broker, e.g. Trade Republic'), 'aria-label': __('fsaBroker', 'Broker'),
          onChange: function (ev) { setForm(Object.assign({}, form, { name: ev.target.value })); }, style: Object.assign({}, inp, { flex: '1 1 12rem' }) }),
        e('input', { type: 'text', inputMode: 'decimal', value: form.amount, placeholder: '1000', 'aria-label': __('fsaOrder', 'Order'),
          onChange: function (ev) { setForm(Object.assign({}, form, { amount: ev.target.value })); },
          onKeyDown: function (ev) { if (ev.key === 'Enter') add(); }, style: Object.assign({}, inp, { width: '7rem' }) }),
        e('button', { type: 'button', onClick: add, disabled: !form.name.trim(), style: { padding: '0.45rem 0.9rem', borderRadius: '7px', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem',
          background: th.accent || '#8b7cff', color: '#ffffff', opacity: form.name.trim() ? 1 : 0.5 } }, __('fsaAdd', 'Add broker'))));
  }

  var api = { KEY: KEY, normalize: normalize, upsert: upsert, remove: remove, summarize: summarize, load: load, save: save, Panel: Panel };
  if (typeof window !== 'undefined') window.MaerminFSA = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
