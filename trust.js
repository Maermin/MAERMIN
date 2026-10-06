// ============================================================================
// MAERMIN — Trust pages  (window.MaerminTrust)
// ----------------------------------------------------------------------------
// P2-5. One disclaimer component for every view whose figures could be read
// as advice (tax, tax advisor, advisor findings, Portfolio Intelligence), and
// the Privacy page: what stays on the device and what goes where.
//
// The privacy statements mirror README → "Privacy & Security"; change both
// together when a data flow changes.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  // kind: 'tax' (also names the supported tax rules) | 'invest'
  function disclaimerText(kind) {
    var base = __('trustNoAdvice', 'No tax or investment advice — estimates only.');
    if (kind === 'tax') return base + ' ' + __('trustTaxRules', 'Only German and US tax rules are supported. Check the figures against your tax documents or with a tax adviser.');
    return base + ' ' + __('trustInvest', 'The findings are rules of thumb applied to your data, not a recommendation to buy or sell.');
  }

  function Disclaimer(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var th = props.theme || {};
    return React.createElement('div', { role: 'note', 'data-testid': 'disclaimer', 'data-kind': props.kind || 'invest',
      style: Object.assign({ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: '0.65rem 0.9rem', borderRadius: '10px', fontSize: '0.8rem', lineHeight: 1.5,
        color: th.textSecondary || '#9aa4b2', background: (th.warning || '#f59e0b') + '12', border: '1px solid ' + (th.warning || '#f59e0b') + '44' }, props.style || {}) },
      React.createElement('span', { 'aria-hidden': 'true', style: { color: th.warning || '#f59e0b', fontWeight: 800 } }, '!'),
      React.createElement('span', null, disclaimerText(props.kind)));
  }

  // Sections of the Privacy page: [title, [lines]].
  function privacySections() {
    return [
      [__('pvLocalTitle', 'Stays on this device'), [
        __('pvLocal1', 'Your transactions, portfolios, settings and every other record are stored in this browser, encrypted with your password (AES-256-GCM).'),
        __('pvLocal2', 'Your password and recovery code never leave the device; nobody can reset them for you.'),
        __('pvLocal3', 'The security log stays on the device. There is no analytics, telemetry or tracking, and the fonts are part of the app.'),
        __('pvLocal4', 'Backups and exports are files you save yourself; MAERMIN does not upload them.')]],
      [__('pvWorkerTitle', 'Your Cloudflare Worker'), [
        __('pvWorker1', 'The Worker runs in your own Cloudflare account. It receives the symbols of your holdings and your search terms, and fetches prices, history, dividends, fund data and news for them from Yahoo Finance, and the CS2 price list.'),
        __('pvWorker2', 'For these requests it keeps only short-lived caches of the answers. Amounts and quantities are not sent.')]],
      [__('pvDirectTitle', 'Requests from your browser to other services'), [
        __('pvDirect1', 'CoinGecko: the coins you hold, for prices and coin icons.'),
        __('pvDirect2', 'open.er-api.com / ExchangeRate-API: exchange rates, without any portfolio data.'),
        __('pvDirect3', 'unpkg.com (React, on every start) and cdnjs.cloudflare.com (PDF tools, on the first PDF export or import): program code, version-pinned and integrity-checked.'),
        __('pvDirect4', 'Logos and pictures load from Yahoo, CoinGecko and the Steam CDN, so those services see which ones you view.')]],
      [__('pvOptTitle', 'Only if you turn it on'), [
        __('pvSync', 'Cloud sync: your Worker stores your data encrypted on your device, under an anonymous account id. It cannot read it.'),
        __('pvShare', 'Share & Compare: a redacted snapshot (percentages and scores, no amounts or quantities) is stored by your Worker for 90 days, plus an anonymous aggregate for the comparison.'),
        __('pvExchange', 'Exchange connections: requests are signed in your browser and relayed by your Worker to the exchange. The API keys stay in your encrypted vault.'),
        __('pvSteam', 'Steam inventory import: your Worker asks Steam for the inventory of the profile you enter. The profile is not stored.')]]
    ];
  }

  function PrivacyView(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement, th = props.theme || {};
    var text = th.text || '#e6edf3', dim = th.textSecondary || '#9aa4b2', border = th.cardBorder || 'rgba(255,255,255,0.1)';
    return e('div', { 'data-testid': 'privacy-view', style: { background: th.cardBg, border: '1px solid ' + border, borderRadius: '14px', padding: '1.25rem', maxWidth: '52rem' } },
      e('h2', { style: { color: text, fontSize: '1.2rem', fontWeight: 800, margin: '0 0 0.4rem' } }, __('pvTitle', 'Privacy')),
      e('p', { style: { color: dim, fontSize: '0.85rem', margin: '0 0 1rem', lineHeight: 1.55 } },
        __('pvIntro', 'MAERMIN has no server of its own. This page lists everything that leaves your device and where it goes.')),
      privacySections().map(function (sec, i) {
        return e('section', { key: i, style: { borderTop: '1px solid ' + border, padding: '0.85rem 0' } },
          e('h3', { style: { color: text, fontSize: '0.95rem', fontWeight: 700, margin: '0 0 0.4rem' } }, sec[0]),
          e('ul', { style: { margin: 0, paddingLeft: '1.1rem', color: dim, fontSize: '0.84rem', lineHeight: 1.6 } },
            sec[1].map(function (line, j) { return e('li', { key: j }, line); })));
      }),
      e(Disclaimer, { theme: th, kind: 'invest', style: { marginTop: '0.5rem' } }));
  }

  var api = { disclaimerText: disclaimerText, Disclaimer: Disclaimer, privacySections: privacySections, PrivacyView: PrivacyView };
  if (typeof window !== 'undefined') window.MaerminTrust = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
