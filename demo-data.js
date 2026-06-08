// @ts-check
/**
 * MAERMIN — Demo Mode  (window.MaerminDemo)
 * ---------------------------------------------------------------------------
 * Lets a first-time user EXPERIENCE the app immediately — fully populated, with
 * realistic cross-asset data and offline demo prices — WITHOUT deploying a
 * Cloudflare Worker first. This removes the biggest abandonment point: "empty
 * app + mandatory setup before you see any value".
 *
 * Design: demo data is never written over the user's real `transactions`. The
 * module exposes the demo dataset + offline prices and toggles a localStorage
 * flag (`maermin_demo`). The renderer, when demo is active, seeds its in-memory
 * state from here and reads `getPrices()` instead of hitting the worker. Exiting
 * demo clears the flag and the real data reappears untouched.
 *
 * Pure + injectable storage so it is testable in Node.
 */
(function () {
  'use strict';

  const FLAG = 'maermin_demo';

  // A small but believable portfolio across every supported asset class. Shape
  // matches the app's canonical transaction model (see metrics.buildPositions).
  const TRANSACTIONS = [
    { id: 'demo-1', category: 'crypto', type: 'buy', symbol: 'BTC', symbolName: 'Bitcoin', quantity: 0.25, price: 38000, fees: 4.9, currency: 'EUR', date: '2023-02-14' },
    { id: 'demo-2', category: 'crypto', type: 'buy', symbol: 'ETH', symbolName: 'Ethereum', quantity: 3, price: 1600, fees: 3.5, currency: 'EUR', date: '2023-05-02' },
    { id: 'demo-3', category: 'crypto', type: 'sell', symbol: 'ETH', symbolName: 'Ethereum', quantity: 1, price: 2400, fees: 2.1, currency: 'EUR', date: '2024-03-10' },
    { id: 'demo-4', category: 'stocks', type: 'buy', symbol: 'AAPL', symbolName: 'Apple Inc.', quantity: 12, price: 165, fees: 1, currency: 'USD', date: '2023-01-20' },
    { id: 'demo-5', category: 'stocks', type: 'buy', symbol: 'VWCE.DE', symbolName: 'Vanguard FTSE All-World', quantity: 40, price: 102, fees: 0, currency: 'EUR', date: '2023-07-01' },
    { id: 'demo-6', category: 'stocks', type: 'buy', symbol: 'VWCE.DE', symbolName: 'Vanguard FTSE All-World', quantity: 25, price: 108, fees: 0, currency: 'EUR', date: '2024-01-05' },
    { id: 'demo-7', category: 'stocks', type: 'dividend', symbol: 'AAPL', symbolName: 'Apple Inc.', quantity: 0, price: 0, fees: 0, currency: 'USD', date: '2024-05-16', cashAmount: 11.4 },
    { id: 'demo-8', category: 'skins', type: 'buy', symbol: 'AK-47 | Redline (Field-Tested)', symbolName: 'AK-47 | Redline', quantity: 2, price: 28, fees: 0, currency: 'EUR', date: '2023-09-12' },
    { id: 'demo-9', category: 'commodities', type: 'buy', symbol: 'XAU', symbolName: 'Gold (oz)', quantity: 1.5, price: 1820, fees: 5, currency: 'EUR', date: '2023-03-30' }
  ];

  // Offline "current" prices in the asset's own currency — so the demo shows live
  // P/L without any network. Keyed by symbol (matches what the renderer looks up).
  const PRICES = {
    BTC: 92000, ETH: 3100, AAPL: 228, 'VWCE.DE': 132, XAU: 2620,
    'AK-47 | Redline (Field-Tested)': 41
  };

  const SETTINGS = { exchangeRate: 0.92 }; // USD→EUR used by the demo

  function _store(storage) {
    if (storage) return storage;
    if (typeof localStorage !== 'undefined') return localStorage;
    return null;
  }

  /** Is demo mode currently active? */
  function isActive(storage) {
    const s = _store(storage);
    return !!s && s.getItem(FLAG) === '1';
  }
  /** Turn demo mode on (sets the flag only — never touches real data). */
  function enable(storage) { const s = _store(storage); if (s) s.setItem(FLAG, '1'); return true; }
  /** Turn demo mode off. */
  function disable(storage) { const s = _store(storage); if (s) s.removeItem(FLAG); return true; }

  /** Fresh copy of the demo transactions (callers may mutate freely). */
  function getTransactions() { return TRANSACTIONS.map((t) => Object.assign({}, t)); }
  /** Fresh copy of the offline demo prices. */
  function getPrices() { return Object.assign({}, PRICES); }

  const api = { FLAG, SETTINGS, isActive, enable, disable, getTransactions, getPrices };
  if (typeof window !== 'undefined') window.MaerminDemo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
