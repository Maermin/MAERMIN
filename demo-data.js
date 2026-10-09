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
    { id: 'demo-7', category: 'stocks', type: 'dividend', symbol: 'AAPL', symbolName: 'Apple Inc.', quantity: 12, price: 0.95, fees: 0, withholdingTax: 1.71, currency: 'USD', date: '2024-05-16' },
    { id: 'demo-8', category: 'skins', type: 'buy', symbol: 'AK-47 | Redline (Field-Tested)', symbolName: 'AK-47 | Redline', quantity: 2, price: 28, fees: 0, currency: 'EUR', date: '2023-09-12' },
    // A position bought and sold in full: shows up under Overview → Closed.
    { id: 'demo-10', category: 'stocks', type: 'buy', symbol: 'TSLA', symbolName: 'Tesla Inc.', quantity: 5, price: 180, fees: 1, currency: 'USD', date: '2023-04-03' },
    { id: 'demo-11', category: 'stocks', type: 'sell', symbol: 'TSLA', symbolName: 'Tesla Inc.', quantity: 5, price: 255, fees: 1, currency: 'USD', date: '2024-11-20' },
    { id: 'demo-9', category: 'commodities', type: 'buy', symbol: 'XAU', symbolName: 'Gold (oz)', quantity: 1.5, price: 1820, fees: 5, currency: 'EUR', date: '2023-03-30' }
  ];

  // Offline "current" prices in EUR (the app values holdings at these as they
  // are: 12 AAPL × 228 = 2,736 € on the Overview) — so the demo shows live P/L
  // without any network. Keyed by symbol (matches what the renderer looks up).
  const PRICES = {
    BTC: 92000, ETH: 3100, AAPL: 228, 'VWCE.DE': 132, XAU: 2620, TSLA: 240,
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

  // ── Sample daily closes ───────────────────────────────────────────────────
  // So the value chart, TWR, the monthly returns grid and the risk figures
  // work in the demo without a Worker. Made-up, deterministic series: they pass
  // through every demo trade price on its trade day and end at the demo price
  // today, with a seeded wobble in between. Same shape as close-history.js
  // ({ v, series: { 'category|SYMBOL': { cur, d: [day number], p: [close] } } }),
  // kept in memory only - never stored.
  const DAY = 86400000;
  const HISTORY_CATEGORIES = { stocks: 1, commodities: 1, crypto: 1 };
  function dayNo(iso) { return Math.round(Date.parse(iso + 'T00:00:00Z') / DAY); }
  function seeded(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function () { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  }
  function closeHistory(todayISO) {
    const today = dayNo(todayISO);
    const bySym = {};
    TRANSACTIONS.forEach((t) => {
      if (!HISTORY_CATEGORIES[t.category] || (t.type !== 'buy' && t.type !== 'sell')) return;
      const k = t.category + '|' + t.symbol.toUpperCase();
      (bySym[k] = bySym[k] || { cur: t.currency, sym: t.symbol, anchors: [] }).anchors.push([dayNo(t.date), t.price]);
    });
    const series = {};
    Object.keys(bySym).forEach((k) => {
      const e = bySym[k];
      const anchors = e.anchors.sort((a, b) => a[0] - b[0]);
      const start = anchors[0][0] - 7;
      anchors.unshift([start, anchors[0][1]]);
      // PRICES are what the app values the holding at (EUR); a USD series ends
      // at that price in USD, so today's close and the live price agree.
      const end = PRICES[e.sym] ? (e.cur === 'USD' ? PRICES[e.sym] / SETTINGS.exchangeRate : PRICES[e.sym]) : anchors[anchors.length - 1][1];
      if (anchors[anchors.length - 1][0] < today) anchors.push([today, end]);
      const rnd = seeded(k);
      const weekdaysOnly = k.indexOf('crypto|') !== 0;
      const vol = weekdaysOnly ? 0.025 : 0.05;
      const d = [], p = [];
      for (let i = 0; i + 1 < anchors.length; i++) {
        const [d0, p0] = anchors[i], [d1, p1] = anchors[i + 1];
        // Brownian bridge: a random walk with its drift removed, so it is 0 at
        // both anchors and wanders in between.
        const n = Math.max(1, d1 - d0), walk = [0];
        for (let x = 1; x <= n; x++) walk.push(walk[x - 1] + (rnd() - 0.5) * vol);
        const last = i + 2 === anchors.length;
        for (let x = 0; x <= n; x++) {
          if (x === n && !last) break;                 // the next segment starts here
          const day = d0 + x, t = x / n;
          const wd = new Date(day * DAY).getUTCDay();
          if (weekdaysOnly && (wd === 0 || wd === 6) && x !== 0 && day !== d1) continue;   // trade days stay
          const close = Math.exp(Math.log(p0) + (Math.log(p1) - Math.log(p0)) * t + walk[x] - walk[n] * t);
          d.push(day); p.push(Math.round(close * 100) / 100);
        }
      }
      series[k] = { cur: e.cur, src: 'demo', sym: e.sym, from: new Date(start * DAY).toISOString().slice(0, 10), to: todayISO, req: '', at: 0, d, p };
    });
    return { v: 1, series, miss: {} };
  }

  const api = { FLAG, SETTINGS, isActive, enable, disable, getTransactions, getPrices, closeHistory };
  if (typeof window !== 'undefined') window.MaerminDemo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
