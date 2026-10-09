// ============================================================================
// MAERMIN — Portfolio summary to paste into an AI assistant  (window.MaerminAIPrompt)
// ----------------------------------------------------------------------------
// P4-5. Settings → Privacy builds a plain-text summary the user copies and
// pastes into any AI assistant themselves. Nothing is sent anywhere: the text
// is built on the device and only leaves it through the user's clipboard.
//
// Two levels:
//   redacted  exactly what a share snapshot may carry (share-snapshot.js
//             allowlist): percentage weights by asset class, sector, region
//             and currency, health score, effective number of holdings. The
//             text is built ONLY from MaerminShare.validateSnapshot()'s output,
//             so it cannot hold more than a share link does.
//   full      + every holding: symbol, name, class, quantity, price, value,
//             weight, cost and gain, plus the total. Only after an explicit
//             confirmation, and never while Privacy Mode is on.
// Never included at either level: journal / transaction notes, API keys,
// exchange connections, account or tax details. The full level reads only the
// fields listed in positionsOf(), never whole records.
//
//   redactedText(snapshot)                    → string | null
//   positionsOf(portfolio, prices)            → [{ category, symbol, name, quantity, price, value, cost }]
//   fullText(positions, snapshot)             → string | null
//   build(level, { portfolio, prices, transactions }) → string | null   (browser glue)
//
// Pure apart from build(); tested in test/ai-prompt.test.js.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }
  function I18N() { return (typeof window !== 'undefined' && window.MaerminI18n) || require('./i18n.js'); }
  function Share() { return (typeof window !== 'undefined' && window.MaerminShare) || require('./share-snapshot.js'); }

  var CLASS_ORDER = ['stocks', 'crypto', 'commodities', 'skins'];
  function num(x) { var n = typeof x === 'number' ? x : parseFloat(x); return isFinite(n) ? n : 0; }
  function pct(v) { return I18N().pct(v, 1); }
  function list(rows, labelOf) {
    return rows.map(function (r) { return labelOf(r.name) + ' ' + pct(r.pct); }).join(', ');
  }

  // The allowlisted sections, from a VALIDATED snapshot only.
  function sections(snapshot) {
    var I = I18N(), out = [];
    var cls = Object.keys(snapshot.assetClasses).sort(function (a, b) { return snapshot.assetClasses[b] - snapshot.assetClasses[a]; });
    out.push(__('aiClasses', 'Asset classes: {list}', { list: cls.map(function (c) { return I.category(c) + ' ' + pct(snapshot.assetClasses[c]); }).join(', ') }));
    if (snapshot.sectors) out.push(__('aiSectors', 'Stocks by sector: {list}', { list: list(snapshot.sectors, function (n) { return I.sector ? I.sector(n) : n; }) }));
    if (snapshot.regions) out.push(__('aiRegions', 'Stocks by country: {list}', { list: list(snapshot.regions, function (n) { return I.country ? I.country(n) : n; }) }));
    if (snapshot.currencies) out.push(__('aiCurrencies', 'Currencies: {list}', { list: list(snapshot.currencies, function (n) { return n; }) }));
    var m = snapshot.metrics || {};
    if (m.healthScore != null) out.push(__('aiHealth', 'Diversification health score: {n} of 100', { n: m.healthScore }));
    if (m.effectiveN != null) out.push(__('aiEffectiveN', 'Effective number of holdings: {n}', { n: I.num(m.effectiveN, { min: 0, max: 1 }) }));
    return out;
  }

  function redactedText(snapshot) {
    var v = Share().validateSnapshot(snapshot);
    if (!v.ok) return null;
    return [
      __('aiIntroRedacted', 'Here is a summary of my investment portfolio. It contains percentages only, no amounts and no names of holdings.'),
      ''
    ].concat(sections(v.snapshot).map(function (l) { return '- ' + l; }), [
      '',
      __('aiAsk', 'Please look at how this portfolio is spread, point out concentration risks and what I could check. This is not a request for personal investment advice.')
    ]).join('\n');
  }

  // The fields of each holding the full level may use - nothing else is read.
  function positionsOf(portfolio, prices) {
    var out = [];
    portfolio = portfolio || {}; prices = prices || {};
    Object.keys(portfolio).forEach(function (cat) {
      if (!Array.isArray(portfolio[cat]) || cat === 'options') return;
      portfolio[cat].forEach(function (p) {
        if (!p) return;
        var symbol = String(p.symbol || p.name || '').trim();
        var quantity = num(p.amount);
        if (!symbol || !(quantity > 0)) return;
        var price = num(prices[symbol] || prices[symbol.toLowerCase()] || prices[symbol.toUpperCase()]) || num(p.purchasePrice);
        var cost = p.totalCostEUR != null ? num(p.totalCostEUR) : num(p.purchasePrice) * quantity;
        out.push({ category: cat, symbol: symbol, name: String(p.symbolName || '').trim(), quantity: quantity, price: price, value: price * quantity, cost: cost });
      });
    });
    return out.sort(function (a, b) { return b.value - a.value; });
  }

  function fullText(positions, snapshot) {
    var I = I18N();
    positions = (positions || []).filter(function (p) { return p && p.value > 0; });
    if (!positions.length) return null;
    var total = positions.reduce(function (s, p) { return s + p.value; }, 0);
    var cost = positions.reduce(function (s, p) { return s + p.cost; }, 0);
    var money = function (v) { return I.money(v, 'EUR'); };
    var lines = [
      __('aiIntroFull', 'Here is a summary of my investment portfolio, with my holdings and amounts (in EUR).'),
      '',
      __('aiTotal', 'Total value: {value} (cost {cost}, gain {gain})', { value: money(total), cost: money(cost), gain: cost > 0 ? I.pct((total / cost - 1) * 100, 1, true) : '—' }),
      '',
      __('aiHoldings', 'Holdings:')
    ];
    positions.forEach(function (p) {
      lines.push('- ' + __('aiHolding', '{symbol}{name}, {class}: {qty} × {price} = {value} ({weight}); cost {cost}, gain {gain}', {
        symbol: p.symbol, name: p.name && p.name !== p.symbol ? ' (' + p.name + ')' : '', class: I.category(p.category),
        qty: I.num(p.quantity, { min: 0, max: 6 }), price: money(p.price), value: money(p.value), weight: pct(total > 0 ? p.value / total * 100 : 0),
        cost: money(p.cost), gain: p.cost > 0 ? I.pct((p.value / p.cost - 1) * 100, 1, true) : '—'
      }));
    });
    var v = snapshot ? Share().validateSnapshot(snapshot) : { ok: false };
    if (v.ok) lines = lines.concat([''], sections(v.snapshot).map(function (l) { return '- ' + l; }));
    lines.push('', __('aiAsk', 'Please look at how this portfolio is spread, point out concentration risks and what I could check. This is not a request for personal investment advice.'));
    return lines.join('\n');
  }

  function build(level, inputs) {
    inputs = inputs || {};
    var S = Share();
    var snapshot = S.buildSnapshot(S.gatherInputs(inputs.portfolio, inputs.prices, inputs.transactions));
    if (level === 'full') return fullText(positionsOf(inputs.portfolio, inputs.prices), snapshot);
    return snapshot ? redactedText(snapshot) : null;
  }

  // ---- Settings → Privacy section ---------------------------------------------
  function Panel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement, th = props.theme || {};
    var lv = React.useState(null), level = lv[0], setLevel = lv[1];
    var cp = React.useState(''), copied = cp[0], setCopied = cp[1];
    var privacy = !!props.privacyMode;
    var shown = privacy && level === 'full' ? null : level; // Privacy Mode hides a full summary at once
    var text = shown ? build(shown, props) : null;
    var dim = th.textSecondary, border = th.cardBorder;
    function btn(id, label, onClick) {
      var on = shown === id;
      return e('button', { type: 'button', 'data-ai-level': id, 'aria-pressed': on, onClick: onClick,
        style: { padding: '0.45rem 0.85rem', fontSize: '0.8rem', fontWeight: 600, borderRadius: '8px', cursor: 'pointer', minHeight: '32px',
          background: on ? (th.accentFill || th.accent) : 'transparent', color: on ? '#ffffff' : th.text, border: '1px solid ' + (on ? 'transparent' : border) } }, label);
    }
    function askFull() {
      window.MaerminUI.confirm({
        title: __('aiFullTitle', 'Show the summary with your holdings and amounts?'),
        message: __('aiFullMsg', 'The text names every holding with its quantity, value and gain. Whoever you paste it to (an AI service, its provider, its logs) can read it. Journal notes and API keys are never included.'),
        confirmLabel: __('aiFullConfirm', 'Show full summary'), cancelLabel: __('cancel', 'Cancel'), danger: true
      }).then(function (yes) { if (yes) { setCopied(''); setLevel('full'); } });
    }
    function copy() {
      var done = function () { setCopied(__('aiCopied', 'Copied. Paste it into the assistant of your choice.')); };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, function () { setCopied(__('aiCopyFailed', 'Copy did not work - select the text and copy it yourself.')); }); return; }
      } catch (err) { /* fall through */ }
      setCopied(__('aiCopyFailed', 'Copy did not work - select the text and copy it yourself.'));
    }
    return e('section', { 'data-testid': 'ai-export', style: { borderTop: '1px solid ' + border, padding: '0.85rem 0' } },
      e('h3', { style: { color: th.text, fontSize: '0.95rem', fontWeight: 700, margin: '0 0 0.4rem' } }, __('aiTitle', 'Summary for an AI assistant')),
      e('p', { style: { color: dim, fontSize: '0.84rem', margin: '0 0 0.6rem', lineHeight: 1.55 } },
        __('aiIntro', 'Builds a text about your portfolio that you can copy and paste into any AI assistant. Nothing is sent from here: the text only leaves this device when you paste it somewhere. Journal notes and API keys are never part of it.')),
      e('div', { role: 'group', 'aria-label': __('aiLevelAria', 'What the summary contains'), style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.6rem' } },
        btn('redacted', __('aiRedacted', 'Without amounts (percentages only)'), function () { setCopied(''); setLevel('redacted'); }),
        privacy ? null : btn('full', __('aiFull', 'With holdings and amounts…'), askFull)),
      privacy ? e('p', { 'data-testid': 'ai-privacy-note', style: { color: dim, fontSize: '0.8rem', margin: '0 0 0.6rem' } },
        __('aiPrivacyOnly', '"Hide amounts" is on, so only the summary without amounts is offered.')) : null,
      shown && !text ? e('p', { style: { color: dim, fontSize: '0.82rem', margin: 0 } }, __('aiEmpty', 'There is nothing to summarise yet: add transactions first.')) : null,
      text ? e('div', null,
        e('textarea', { readOnly: true, value: text, 'aria-label': __('aiTextAria', 'Summary text'), 'data-testid': 'ai-text', rows: Math.min(18, text.split('\n').length + 1),
          onFocus: function (ev) { ev.target.select(); },
          style: { width: '100%', boxSizing: 'border-box', padding: '0.6rem 0.75rem', background: th.inputBg, color: th.text, border: '1px solid ' + (th.inputBorder || border), borderRadius: '8px', fontSize: '0.8rem', fontFamily: 'ui-monospace, Menlo, monospace', lineHeight: 1.5, resize: 'vertical' } }),
        e('div', { style: { display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.4rem' } },
          e('button', { type: 'button', 'data-testid': 'ai-copy', onClick: copy, style: { padding: '0.45rem 0.9rem', fontSize: '0.8rem', fontWeight: 700, borderRadius: '8px', cursor: 'pointer', minHeight: '32px', background: th.accentFill || th.accent, color: '#ffffff', border: 'none' } }, __('aiCopy', 'Copy text')),
          copied ? e('span', { role: 'status', style: { color: dim, fontSize: '0.8rem' } }, copied) : null)) : null);
  }

  var api = { redactedText: redactedText, positionsOf: positionsOf, fullText: fullText, build: build, Panel: Panel };
  if (typeof window !== 'undefined') window.MaerminAIPrompt = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
