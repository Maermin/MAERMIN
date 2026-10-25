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
    if (kind === 'tax') return base + ' ' + __('trustTaxRules', 'German, Austrian, Swiss and US tax rules are supported. Check the figures against your tax documents or with a tax adviser.');
    return base + ' ' + __('trustInvest', 'The findings are rules of thumb applied to your data, not a recommendation to buy or sell.');
  }

  function Disclaimer(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var th = props.theme || {};
    // R4.2: the shared note look (.ui-disclaimer); R4.6: a caller adds spacing by class, not inline
    return React.createElement('div', { role: 'note', 'data-testid': 'disclaimer', 'data-kind': props.kind || 'invest', className: ['ui-disclaimer', props.className || ''].join(' ').trim() },
      React.createElement('span', { 'aria-hidden': 'true', className: 'ui-disclaimer__mark' }, '!'),
      React.createElement('span', null, disclaimerText(props.kind)));
  }

  // Sections of the Privacy page: [title, [lines]].
  function privacySections() {
    return [
      [__('pvLocalTitle', 'Stays on this device'), [
        __('pvLocal1', 'Your transactions, portfolios, settings and every other record are stored in this browser (localStorage and IndexedDB). With encryption at rest switched on - the default for a new vault - your financial records are encrypted with your password (AES-256-GCM); a few settings (tax settings, exchange-rate history, the security log) stay unencrypted.'),
        __('pvLocal2', 'Your password and recovery code never leave the device; nobody can reset them for you.'),
        __('pvLocal3', 'The security log stays on the device. There is no analytics, telemetry or tracking, and the fonts are part of the app.'),
        __('pvLocal4', 'Backups and exports are files you save yourself; MAERMIN does not upload them.')]],
      [__('pvWorkerTitle', 'Your Cloudflare Worker'), [
        __('pvWorker1', 'The Worker runs in your own Cloudflare account. It receives the symbols of your holdings and your search terms, and fetches prices, history, dividends, fund data and news for them from Yahoo Finance and CoinGecko, and the CS2 price list.'),
        __('pvWorker2', 'It caches the answers, for up to 30 days (company profiles). Amounts and quantities are not sent.')]],
      [__('pvDirectTitle', 'Requests from your browser to other services'), [
        __('pvDirect1', 'CoinGecko image server: coin icons in the symbol search.'),
        __('pvDirect2', 'open.er-api.com / ExchangeRate-API: exchange rates, without any portfolio data.'),
        __('pvDirect3', 'unpkg.com (React, on the first start and after an update; otherwise from the offline cache) and cdnjs.cloudflare.com (PDF tools, on the first PDF export or import): program code, version-pinned and integrity-checked.'),
        __('pvDirect4', 'Logos and pictures load from Yahoo, CoinGecko and the Steam CDN, so those services see which ones you view.')]],
      [__('pvOptTitle', 'Only if you turn it on'), [
        __('pvSync', 'Cloud sync: your Worker stores your data encrypted on your device, under an anonymous account id. It cannot read it.'),
        __('pvSyncFile', 'Sync through a file or WebDAV: the same encrypted copy goes to a file you pick or to your WebDAV folder, signed with a key from your vault. That storage sees ciphertext only. The WebDAV login stays on this device, encrypted.'),
        __('pvShare', 'Share & Compare: a redacted snapshot (percentages and scores, no amounts or quantities) is stored by your Worker for 90 days, plus an anonymous aggregate for the comparison.'),
        __('pvExchange', 'Exchange connections: your Worker relays each request to the exchange. The API key travels with every request (Binance: the request is signed in your browser and the secret stays here). Keys are stored encrypted in your vault.'),
        __('pvSteam', 'Steam inventory import: your Worker asks Steam for the inventory of the profile you enter. The profile is not stored.'),
        __('pvPush', 'Push notifications: each reminder is encrypted on your device and your Worker only stores the ciphertext and the send time. Send times follow your expected dividend pay dates, so they can hint at which payers you hold. If you also let it check price rules while the app is closed, it sees each rule\'s symbol and threshold, never amounts or quantities.'),
        __('pvMcp', 'Local MCP server (maermin-mcp, a separate program you install yourself): it reads an encrypted backup on your computer with your password, so an AI assistant there can answer questions about your portfolio. It sends nothing; with --sync it only fetches your encrypted sync data from your own Worker. Amounts only if you start it with --amounts.')]]
    ];
  }

  function PrivacyView(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement, th = props.theme || {};
    // R4.6: one Card; sections as dialog-style blocks with the shared text styles
    var UIC = window.MaerminComponents;
    // the page header has the title; the intro is the view's lead
    return e('div', { className: 'ui-view', 'data-testid': 'privacy-view' },
      e('p', { className: 'ui-view__lead' }, __('pvIntro', 'MAERMIN has no server of its own. Apart from loading the app itself (from GitHub Pages or wherever you host it), this page lists everything that leaves your device and where it goes.')),
      // Feature 2 (audit 2026-10-24): where the data lives, and whether the
      // browser keeps it
      (typeof window !== 'undefined' && window.MaerminStorageHealth) ? e(window.MaerminStorageHealth.Card, null) : null,
      e(UIC.Card, { className: 'ui-pv' },
      privacySections().map(function (sec, i) {
        return e('section', { key: i, className: 'ui-pv-sec' },
          e(window.MaerminComponents.Heading, { className: 'ui-dlg-sec__title' }, sec[0]),
          e('ul', { className: 'ui-pv-list' },
            sec[1].map(function (line, j) { return e('li', { key: j }, line); })));
      }),
      // P4-5: copy a summary for an AI assistant (built here, never sent)
      (typeof window !== 'undefined' && window.MaerminAIPrompt) ? e(window.MaerminAIPrompt.Panel, { theme: th, portfolio: props.portfolio, prices: props.prices, transactions: props.transactions, priceHistory: props.priceHistory, privacyMode: props.privacyMode }) : null,
      e(Disclaimer, { theme: th, kind: 'invest' })));
  }

  var api = { disclaimerText: disclaimerText, Disclaimer: Disclaimer, privacySections: privacySections, PrivacyView: PrivacyView };
  if (typeof window !== 'undefined') window.MaerminTrust = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
