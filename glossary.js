// ============================================================================
// MAERMIN — Glossary popovers  (window.MaerminGlossary)
// ----------------------------------------------------------------------------
// Audit 2026-10-24, feature 6. Terms such as XIRR, TWR, Vorabpauschale or
// Teilfreistellung appear as bare labels. A small "?" button next to them
// opens a short plain-language explanation (en/de). The texts explain what a
// figure means and how MAERMIN computes it; they never say what to do (no
// investment or tax advice).
//
//   TERMS: { id: { title(), text() } }        entry(id) -> { title, text } | null
//   Term({ id, children })  the label plus its "?" button and popover
// The popover is a portal on <body> with position: fixed, so a card's
// overflow never clips it; Escape, a click outside, scrolling or resizing
// close it, and focus returns to the button. The "?" is drawn by CSS, so the
// label's text is unchanged for screen readers and tests.
// Pure parts tested in test/glossary.test.js.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var TERMS = {
    xirr: {
      title: function () { return __('glXirrT', 'XIRR (money-weighted return)'); },
      text: function () { return __('glXirr', 'The yearly return of your own money, taking into account when and how much you paid in or took out. Two people with the same funds can have different XIRRs because they bought at different times.'); }
    },
    twr: {
      title: function () { return __('glTwrT', 'TWR (time-weighted return)'); },
      text: function () { return __('glTwr', 'The return of the portfolio itself, with deposits and withdrawals taken out. It shows how the investments did, independent of when you added money, and is the figure funds publish.'); }
    },
    maxDrawdown: {
      title: function () { return __('glMddT', 'Max drawdown'); },
      text: function () { return __('glMdd', 'The largest fall from a previous high to a later low in the period, in percent. It shows the worst loss you would have seen on the way, not the result at the end.'); }
    },
    vorabpauschale: {
      title: function () { return __('glVapT', 'Vorabpauschale'); },
      text: function () { return __('glVap', 'A German tax on accumulating funds: each January a minimum yield of the previous year is taxed in advance, based on the base rate, even if the fund paid nothing. It is counted against later gains when you sell.'); }
    },
    teilfreistellung: {
      title: function () { return __('glTfT', 'Teilfreistellung'); },
      text: function () { return __('glTf', 'A German partial exemption for fund income: depending on the fund type, a share of the gains and distributions is tax-free (for example 30 % for equity funds), because the fund has already paid tax inside.'); }
    },
    sparerpauschbetrag: {
      title: function () { return __('glSpbT', 'Sparerpauschbetrag'); },
      text: function () { return __('glSpb', 'The yearly German allowance for capital income: 1,000 € per person (2,000 € for joint filers). Income up to this amount is tax-free.'); }
    },
    freistellungsauftrag: {
      title: function () { return __('glFsaT', 'Freistellungsauftrag'); },
      text: function () { return __('glFsa', 'The order you give a German bank or broker to use (part of) your Sparerpauschbetrag there, so it does not withhold tax on that income. The orders at all banks together may not exceed the allowance.'); }
    }
  };

  function entry(id) {
    var t = TERMS[id];
    return t ? { title: t.title(), text: t.text() } : null;
  }

  var seq = 0;
  function Term(props) {
    var React = window.React, h = React.createElement;
    var e = entry(props.id);
    var st = React.useState(null), pos = st[0], setPos = st[1];          // { top, left } while open
    var btnRef = React.useRef(null), popRef = React.useRef(null);
    var idRef = React.useRef(null);
    if (!idRef.current) idRef.current = 'mx-gl-' + (++seq);
    function close(focus) { setPos(null); if (focus && btnRef.current) { try { btnRef.current.focus(); } catch (x) { /* gone */ } } }
    function toggle(ev) {
      ev.stopPropagation(); ev.preventDefault();                          // a clickable tile must not navigate
      if (pos) { close(false); return; }
      var r = btnRef.current.getBoundingClientRect();
      var w = Math.min(300, window.innerWidth - 32);
      setPos({ top: Math.round(r.bottom + 6), left: Math.round(Math.max(16, Math.min(r.left, window.innerWidth - w - 16))), width: w });
    }
    React.useEffect(function () {
      if (!pos) return undefined;
      function onKey(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); close(true); } }
      function onDown(ev) { if (popRef.current && popRef.current.contains(ev.target)) return; if (btnRef.current && btnRef.current.contains(ev.target)) return; close(false); }
      function onMove() { close(false); }
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('mousedown', onDown, true);
      document.addEventListener('touchstart', onDown, true);
      window.addEventListener('scroll', onMove, true);
      window.addEventListener('resize', onMove);
      return function () {
        document.removeEventListener('keydown', onKey, true);
        document.removeEventListener('mousedown', onDown, true);
        document.removeEventListener('touchstart', onDown, true);
        window.removeEventListener('scroll', onMove, true);
        window.removeEventListener('resize', onMove);
      };
    }, [pos]);
    if (!e) return h(React.Fragment, null, props.children);
    var pop = pos && window.ReactDOM && window.ReactDOM.createPortal
      ? window.ReactDOM.createPortal(h('div', {
          ref: popRef, id: idRef.current, role: 'note', className: 'mx-glossary', 'data-testid': 'glossary-pop', 'data-term': props.id,
          style: { top: pos.top + 'px', left: pos.left + 'px', width: pos.width + 'px' }
        }, h('strong', { className: 'mx-glossary__title' }, e.title), h('p', { className: 'mx-glossary__text' }, e.text)), document.body)
      : null;
    // No wrapper element: the label keeps its structure (text, then the "?").
    return h(React.Fragment, null, props.children,
      h('button', {
        ref: btnRef, type: 'button', className: 'mx-term__info', 'data-term': props.id,
        'aria-label': __('glWhatIs', 'What is {term}?', { term: e.title }), 'aria-expanded': pos ? 'true' : 'false', 'aria-controls': pos ? idRef.current : undefined,
        onClick: toggle, onKeyDown: function (ev) { if (ev.key === 'Enter' || ev.key === ' ') ev.stopPropagation(); }
      }), pop);
  }

  var api = { TERMS: TERMS, entry: entry, Term: Term };
  if (typeof window !== 'undefined') window.MaerminGlossary = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
