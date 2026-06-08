/**
 * MAERMIN - Shared formatting & utility helpers
 * ------------------------------------------------------------------
 * Single source of truth for the static (state-independent) formatters
 * that used to live separately inside renderer-components.js.
 *
 * NOTE: renderer.js keeps its own `formatPrice` because that one depends
 * on live component state (selected currency + exchange rate). The helpers
 * here are pure and safe to share.
 */
(function () {
  'use strict';

  // Number with fixed decimals, e.g. 1234.5 -> "1,234.50"
  function formatNumber(value, decimals) {
    decimals = decimals !== undefined ? decimals : 2;
    if (value === undefined || value === null || isNaN(value)) {
      return (0).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    }
    return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  // EUR currency, e.g. 1234.5 -> "1,234.50 EUR"
  function formatCurrencyEUR(value, decimals) {
    decimals = decimals !== undefined ? decimals : 2;
    return (value || 0).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + ' EUR';
  }

  // Signed percent, e.g. 1.23 -> "+1.23%", -1.23 -> "-1.23%"
  function formatPercentSigned(value) {
    if (value === undefined || value === null || isNaN(value)) return '0.00%';
    return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  }

  // Locale date string, e.g. "2024-03-01" -> "3/1/2024"
  function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US');
  }

  // Reasonably-unique id for client-side records
  function generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // Clamp a number into [min, max]
  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  // Insert-or-update a transaction. The single source of truth for the
  // "edit must UPDATE in place, never CREATE a duplicate" invariant that the
  // transaction modal relies on. When `editingId` is set we ONLY update the
  // matching record (id preserved); if it isn't found we make NO change rather
  // than appending a stray duplicate. When `editingId` is empty we append a new
  // record. Pure — unit-tested in test/transactions.test.js.
  function upsertTransaction(transactions, data, editingId, newId) {
    const list = Array.isArray(transactions) ? transactions : [];
    if (editingId !== null && editingId !== undefined && editingId !== '') {
      let found = false;
      const next = list.map((tx) => {
        if (tx && tx.id === editingId) {
          found = true;
          // Spread data first, then force the original id so it can never change.
          return Object.assign({}, tx, data, { id: tx.id });
        }
        return tx;
      });
      return { transactions: next, updated: found, created: false, found };
    }
    const id = (newId !== null && newId !== undefined && newId !== '') ? newId : generateId();
    return { transactions: list.concat([Object.assign({ id }, data)]), updated: false, created: true, found: true };
  }

  // ── Currency conversion ────────────────────────────────────────────────
  // The app's canonical internal currency is EUR; `usdToEur` is the live rate
  // (1 USD = usdToEur EUR). These centralise the conversion so every call site
  // (skins, stocks, commodities, display) agrees and no rounding happens here —
  // values are kept full-precision and only rounded at DISPLAY time. CS2 skin
  // prices are delivered in USD and MUST go through toEUR on ingestion.
  function toEUR(amount, currency, usdToEur) {
    const a = parseFloat(amount) || 0;
    if (currency === 'USD' && usdToEur > 0) return a * usdToEur;
    return a; // already EUR (or unknown → treated as canonical)
  }
  function fromEUR(amountEUR, currency, usdToEur) {
    const a = parseFloat(amountEUR) || 0;
    if (currency === 'USD' && usdToEur > 0) return a / usdToEur;
    return a;
  }

  // Accessibility: make a non-<button> element (div/span/tr/th used as a
  // control) behave like a button for keyboard + assistive-tech users. Returns
  // the prop bag to spread into React.createElement:
  //   React.createElement('div', { ...clickable(() => select(x)), style })
  // It wires onClick AND an Enter/Space onKeyDown to the same handler, and adds
  // role="button" + tabIndex so the element is focusable and announced.
  function clickable(handler, opts) {
    opts = opts || {};
    return {
      role: opts.role || 'button',
      tabIndex: opts.tabIndex === undefined ? 0 : opts.tabIndex,
      onClick: handler,
      onKeyDown: function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          handler(e);
        }
      },
    };
  }

  const MaerminUtils = {
    formatNumber,
    formatCurrencyEUR,
    formatPercentSigned,
    formatDate,
    generateId,
    clamp,
    upsertTransaction,
    toEUR,
    fromEUR,
    clickable,
  };

  if (typeof window !== 'undefined') {
    window.MaerminUtils = MaerminUtils;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MaerminUtils;
  }
})();
