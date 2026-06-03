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

  const MaerminUtils = {
    formatNumber,
    formatCurrencyEUR,
    formatPercentSigned,
    formatDate,
    generateId,
    clamp,
  };

  if (typeof window !== 'undefined') {
    window.MaerminUtils = MaerminUtils;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = MaerminUtils;
  }
})();
