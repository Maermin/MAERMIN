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
    BTC: 92000, ETH: 3100, AAPL: 228, 'VWCE.DE': 132, XAU: 2620, TSLA: 240, MSFT: 412,
    'AK-47 | Redline (Field-Tested)': 41
  };

  const SETTINGS = { exchangeRate: 0.92 }; // USD→EUR used by the demo

  // ── Employee equity (PLAN-EQUITY, decision 10: fictional employers, real
  // tickers, made-up prices) ─────────────────────────────────────────────────
  // Contoso (USD share, EUR salary, DE): an RSU grant of 400 units, 4 years
  // with a 1-year cliff, then quarterly, sell-to-cover; one PSU. Fabrikam
  // (former employer, CHF salary, GBX-quoted share, CH): the non-EUR example.
  // ESPP contributions, purchases and matching follow with their packages.
  // A vest on a weekend takes the previous trading day's rate ('fallback').
  const EQ_VESTS = [
    // [vest date, FMV USD, EUR per USD, rate date, units]
    ['2024-03-01', 415.5, 0.9236, '2024-03-01', 100], ['2024-06-01', 413.4, 0.9216, '2024-05-31', 25],
    ['2024-09-01', 417.1, 0.9035, '2024-08-30', 25], ['2024-12-01', 423.5, 0.9459, '2024-11-29', 25],
    ['2025-03-01', 396.9, 0.9612, '2025-02-28', 25], ['2025-06-01', 460.4, 0.8807, '2025-05-30', 25],
    ['2025-09-01', 506.7, 0.8541, '2025-09-01', 25], ['2025-12-01', 486.7, 0.8617, '2025-12-01', 25],
    ['2026-03-01', 408.2, 0.8702, '2026-02-27', 25], ['2026-06-01', 452.9, 0.8655, '2026-06-01', 25],
    ['2026-09-01', 471.3, 0.8574, '2026-09-01', 25]
  ];
  const EQ_UPCOMING = ['2026-12-01', '2027-03-01'];
  const EQ_PORTFOLIO = 'demo-plan-account';
  const EQUITY = {
    plans: [
      { id: 'demo-eq-contoso', employer: 'Contoso (sample)', ticker: 'MSFT', shareCurrency: 'USD', admin: 'morgan_stanley', portfolioId: EQ_PORTFOLIO, taxCountry: 'DE', salaryCurrency: 'EUR' },
      { id: 'demo-eq-fabrikam', employer: 'Fabrikam (sample)', ticker: 'AZN.L', shareCurrency: 'GBX', admin: 'other', adminLabel: 'Computershare', portfolioId: EQ_PORTFOLIO, taxCountry: 'CH', salaryCurrency: 'CHF' }
    ],
    grants: [
      { id: 'demo-eq-rsu', planId: 'demo-eq-contoso', type: 'RSU', name: 'New hire 2023', grantDate: '2023-03-01', units: 400, withholding: 'sell_to_cover', withholdingRate: 0.45 },
      { id: 'demo-eq-psu', planId: 'demo-eq-contoso', type: 'PSU', name: 'LTI 2024-2026', grantDate: '2024-03-01', units: 120, withholding: 'payroll' },
      { id: 'demo-eq-espp-fab', planId: 'demo-eq-fabrikam', type: 'ESPP', name: 'Sharesave', grantDate: '2021-01-01' }
    ],
    tranches: EQ_VESTS.map((v, i) => ({ id: 'demo-eq-t' + i, grantId: 'demo-eq-rsu', date: v[0], units: v[4], status: 'vested' }))
      .concat(EQ_UPCOMING.map((d, i) => ({ id: 'demo-eq-tu' + i, grantId: 'demo-eq-rsu', date: d, units: 25, status: 'unvested', projected: true })))
      .concat([{ id: 'demo-eq-tpsu', grantId: 'demo-eq-psu', date: '2027-03-01', units: 120, status: 'unvested', projected: true }]),
    events: EQ_VESTS.map((v, i) => {
      const withheld = Math.ceil(v[4] * 0.45);
      return { id: 'demo-eq-v' + i, kind: 'vest', grantId: 'demo-eq-rsu', trancheId: 'demo-eq-t' + i, date: v[0], fmv: v[1], fmvSource: 'close', shareCurrency: 'USD',
        fx: { EUR: { rate: v[2], date: v[3], source: v[3] === v[0] ? 'history' : 'fallback' } },
        grossUnits: v[4], withheldUnits: withheld, coverPrice: Math.round(v[1] * 0.998 * 100) / 100, source: 'auto' };
    }),
    settings: { includeUnvested: false, concentrationWarnPct: 10 }
  };
  // The income timeline: CHF salary at Fabrikam (2021-2022), then EUR at
  // Contoso with a raise in April 2025, a March bonus and a 13th salary.
  const INCOME = {
    entries: [
      { id: 'demo-inc-fab', from: '2021-01-01', to: '2022-12-31', kind: 'base', period: 'year', amount: 118000, currency: 'CHF' },
      { id: 'demo-inc-c1', from: '2023-01-01', to: '2025-03-31', kind: 'base', period: 'year', amount: 78000, currency: 'EUR' },
      { id: 'demo-inc-c2', from: '2025-04-01', kind: 'base', period: 'year', amount: 84000, currency: 'EUR' },
      { id: 'demo-inc-b25', from: '2025-03-31', kind: 'bonus', period: 'once', amount: 9000, currency: 'EUR' },
      { id: 'demo-inc-b26', from: '2026-03-31', kind: 'bonus', period: 'once', amount: 9500, currency: 'EUR' },
      { id: 'demo-inc-13', from: '2025-11-30', kind: '13th', period: 'once', amount: 7000, currency: 'EUR' }
    ]
  };
  function getEquity() { return JSON.parse(JSON.stringify(EQUITY)); }
  function getIncome() { return JSON.parse(JSON.stringify(INCOME)); }

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
  // The shared market move of a day (log return), the same for every series.
  const _shock = {};
  function marketShock(day) {
    if (_shock[day] === undefined) _shock[day] = (seeded('market|' + day)() - 0.5) * 0.02;
    return _shock[day];
  }
  function closeHistory(todayISO) {
    const today = dayNo(todayISO);
    const bySym = {};
    TRANSACTIONS.forEach((t) => {
      if (!HISTORY_CATEGORIES[t.category] || (t.type !== 'buy' && t.type !== 'sell')) return;
      const k = t.category + '|' + t.symbol.toUpperCase();
      (bySym[k] = bySym[k] || { cur: t.currency, sym: t.symbol, anchors: [] }).anchors.push([dayNo(t.date), t.price]);
    });
    // Employee equity: the series pass through every vest FMV (USD shares only;
    // the GBX example has no events yet).
    EQUITY.events.forEach((ev) => {
      const g = EQUITY.grants.find((x) => x.id === ev.grantId), p = g && EQUITY.plans.find((x) => x.id === g.planId);
      if (!p || ev.shareCurrency !== 'USD') return;
      const k = 'stocks|' + p.ticker.toUpperCase();
      (bySym[k] = bySym[k] || { cur: 'USD', sym: p.ticker, anchors: [] }).anchors.push([dayNo(ev.date), ev.fmv]);
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
      // P5-1.8: a shared market move per day, so the holdings (and the sample
      // benchmark built from the world ETF) move together like real markets.
      // [own-noise share, market beta] by kind; funds are mostly market.
      const kind = FUND_TYPES[e.sym] ? [0.25, 1] : k.indexOf('crypto|') === 0 ? [1, 1.4] : k.indexOf('commodities|') === 0 ? [0.6, 0.15] : [0.8, 1];
      const d = [], p = [];
      for (let i = 0; i + 1 < anchors.length; i++) {
        const [d0, p0] = anchors[i], [d1, p1] = anchors[i + 1];
        // Brownian bridge: a random walk with its drift removed, so it is 0 at
        // both anchors and wanders in between.
        const n = Math.max(1, d1 - d0), walk = [0];
        for (let x = 1; x <= n; x++) walk.push(walk[x - 1] + (rnd() - 0.5) * vol * kind[0] + kind[1] * marketShock(d0 + x));
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

  // ── P5-1.7: the richer book ───────────────────────────────────────────────
  // Two portfolios (the second with a clearing account), 30+ positions, three
  // years of monthly savings-plan buys, a dozen-plus dividend payers, an
  // accumulating fund with Vorabpauschale records, one taxed sale with its tax
  // booking and a crypto lot past the one-year mark. All made up and
  // deterministic: fixed dates, prices from a smooth path per symbol. The
  // hand-written rows above stay as they are.
  const BROKER = 'demo-broker';
  const T0 = '2023-01-02', END = '2026-10-01';
  const FX = SETTINGS.exchangeRate;
  const r2 = (x) => Math.round(x * 100) / 100;
  const r4 = (x) => Math.round(x * 10000) / 10000;
  const iso = (n) => new Date(n * DAY).toISOString().slice(0, 10);
  const weekday = (s) => { let n = dayNo(s); while ([0, 6].indexOf(new Date(n * DAY).getUTCDay()) !== -1) n++; return iso(n); };
  const addDays = (s, k) => iso(dayNo(s) + k);
  // Log-linear from p0 (T0) to p1 (END) with a wobble that is 0 at both ends.
  function pathPrice(p0, p1, date, k) {
    const f = (dayNo(date) - dayNo(T0)) / (dayNo(END) - dayNo(T0));
    return r2(Math.exp(Math.log(p0) + (Math.log(p1) - Math.log(p0)) * f + 0.07 * Math.sin(Math.PI * f * k)));
  }
  // [symbol, name, currency, price at T0, price at END, dividend per share]
  // Dividend schedule by country: us = quarterly (Feb/May/Aug/Nov) with 15 %
  // US withholding; de = yearly in May, no foreign tax; nl / fr = yearly in
  // May with 15 % / 12.8 % foreign withholding.
  const STOCKS = [
    ['MSFT', 'Microsoft Corp.', 'USD', 245, 430, 0.75, 'us'],
    ['NVDA', 'NVIDIA Corp.', 'USD', 15, 180, 0, ''],
    ['AMZN', 'Amazon.com Inc.', 'USD', 85, 220, 0, ''],
    ['GOOGL', 'Alphabet Inc. (A)', 'USD', 89, 240, 0, ''],
    ['JNJ', 'Johnson & Johnson', 'USD', 176, 190, 1.24, 'us'],
    ['KO', 'The Coca-Cola Co.', 'USD', 63, 70, 0.49, 'us'],
    ['PG', 'Procter & Gamble Co.', 'USD', 151, 160, 0.99, 'us'],
    ['PEP', 'PepsiCo Inc.', 'USD', 180, 150, 1.3, 'us'],
    ['JPM', 'JPMorgan Chase & Co.', 'USD', 134, 300, 1.15, 'us'],
    ['O', 'Realty Income Corp.', 'USD', 63, 58, 0.78, 'us'],
    ['V', 'Visa Inc. (A)', 'USD', 208, 340, 0.52, 'us'],
    ['XOM', 'Exxon Mobil Corp.', 'USD', 110, 115, 0.96, 'us'],
    ['MCD', 'McDonald’s Corp.', 'USD', 264, 300, 1.67, 'us'],
    ['HD', 'The Home Depot Inc.', 'USD', 316, 400, 2.2, 'us'],
    ['SAP.DE', 'SAP SE', 'EUR', 100, 240, 2.2, 'de'],
    ['ALV.DE', 'Allianz SE', 'EUR', 201, 350, 13.8, 'de'],
    ['SIE.DE', 'Siemens AG', 'EUR', 130, 230, 4.7, 'de'],
    ['MUV2.DE', 'Munich Re', 'EUR', 304, 540, 15, 'de'],
    ['BAS.DE', 'BASF SE', 'EUR', 47, 44, 3.4, 'de'],
    ['DTE.DE', 'Deutsche Telekom AG', 'EUR', 18.6, 30, 0.77, 'de'],
    ['ASML.AS', 'ASML Holding N.V.', 'EUR', 512, 690, 6.1, 'nl'],
    ['OR.PA', 'L’Oréal S.A.', 'EUR', 335, 370, 6.6, 'fr'],
    ['AIR.PA', 'Airbus SE', 'EUR', 111, 200, 0, '']
  ];
  const WHT = { us: 0.15, de: 0, nl: 0.15, fr: 0.128 };
  // Savings-plan funds of the broker portfolio (both accumulating).
  const PLAN = [['VWCE.DE', 'Vanguard FTSE All-World', 96, 132, 250], ['IS3N.DE', 'iShares Core MSCI EM IMI', 27, 36, 100]];
  const FUND_TYPES = { 'VWCE.DE': 'aktienfonds', 'IS3N.DE': 'aktienfonds' };
  // Confirmed Vorabpauschalen per value year (EUR), as the Tax view stores them.
  const VAP_RECORDS = { 'VWCE.DE': { 2023: 21.4, 2024: 74.9, 2025: 118.6 }, 'IS3N.DE': { 2024: 9.8, 2025: 21.3 } };

  (function richerBook() {
    const rows = [];
    const add = (o) => { rows.push(o.category === 'cashflow' ? o : Object.assign({ fees: 0 }, o)); };
    const held = {};   // symbol -> [[date, +/-qty]]
    const book = (sym, date, q) => { (held[sym] = held[sym] || []).push([date, q]); };
    const qtyAt = (sym, date) => (held[sym] || []).reduce((s, [d, q]) => (d < date ? s + q : s), 0);

    STOCKS.forEach(([sym, name, cur, p0, p1], i) => {
      const k = 2 + (i % 4);
      const date = weekday(addDays('2023-01-16', 9 * i));
      const price = pathPrice(p0, p1, date, k);
      const qty = Math.max(1, Math.round(2500 / (price * (cur === 'USD' ? FX : 1))));
      add({ id: 'demo-b-' + sym, category: 'stocks', type: 'buy', symbol: sym, symbolName: name, quantity: qty, price, fees: 1, currency: cur, date });
      book(sym, date, qty);
      if (i % 3 === 0) {
        const d2 = weekday(addDays('2024-02-05', 11 * i));
        const q2 = Math.ceil(qty / 2);
        add({ id: 'demo-b2-' + sym, category: 'stocks', type: 'buy', symbol: sym, symbolName: name, quantity: q2, price: pathPrice(p0, p1, d2, k), fees: 1, currency: cur, date: d2 });
        book(sym, d2, q2);
      }
      PRICES[sym] = r2(p1 * (cur === 'USD' ? FX : 1));
    });

    // The taxed sale: part of the NVDA position in May 2026, with the
    // Abgeltungsteuer + Soli the bank withheld booked on the same day.
    const nv = STOCKS[1], sellDate = '2026-05-14', sellQty = 60;
    const sellPx = pathPrice(nv[3], nv[4], sellDate, 3);
    const buyPx = rows.find((t) => t.id === 'demo-b-NVDA').price;
    add({ id: 'demo-s-NVDA', category: 'stocks', type: 'sell', symbol: 'NVDA', symbolName: nv[1], quantity: sellQty, price: sellPx, fees: 1, currency: 'USD', date: sellDate });
    book('NVDA', sellDate, -sellQty);
    const gainEUR = (sellQty * (sellPx - buyPx) - 2) * FX;
    add({ id: 'demo-tax-NVDA', category: 'cashflow', type: 'tax', amount: r2(Math.max(0, gainEUR - 1000) * 0.26375), currency: 'EUR', date: sellDate, notes: 'Abgeltungsteuer + Soli (NVDA)' });

    // Dividends from the first payout date after the buy up to END.
    STOCKS.forEach(([sym, name, cur, , , dps, kind]) => {
      if (!dps) return;
      for (let y = 2023; y <= 2026; y++) {
        const months = kind === 'us' ? [2, 5, 8, 11] : [5];
        months.forEach((m) => {
          const date = weekday(y + '-' + String(m).padStart(2, '0') + (kind === 'us' ? '-15' : '-12'));
          if (date > END) return;
          const qty = qtyAt(sym, date);
          if (!(qty > 0)) return;
          add({ id: 'demo-d-' + sym + '-' + date, category: 'stocks', type: 'dividend', symbol: sym, symbolName: name, quantity: qty, price: dps, withholdingTax: r2(qty * dps * WHT[kind]), currency: cur, date });
        });
      }
    });

    // Crypto: a second, younger BTC lot (the 2023 lot is past one year) and SOL.
    add({ id: 'demo-c-btc2', category: 'crypto', type: 'buy', symbol: 'BTC', symbolName: 'Bitcoin', quantity: 0.04, price: 78000, fees: 2.5, currency: 'EUR', date: '2026-03-16' });
    add({ id: 'demo-c-sol', category: 'crypto', type: 'buy', symbol: 'SOL', symbolName: 'Solana', quantity: 25, price: 40, fees: 1.5, currency: 'EUR', date: '2023-11-06' });
    PRICES.SOL = 150;

    // Savings plan at the broker: a 400 EUR deposit on the first weekday of
    // each month, the two fund buys the next weekday (Oct 2023 - Sep 2026).
    for (let n = 0; n < 36; n++) {
      const y = 2023 + Math.floor((9 + n) / 12), m = ((9 + n) % 12) + 1;
      const d1 = weekday(y + '-' + String(m).padStart(2, '0') + '-01');
      const d2 = weekday(addDays(d1, 1));
      add({ id: 'demo-dep-' + d1, category: 'cashflow', type: 'deposit', amount: 400, currency: 'EUR', date: d1, portfolioId: BROKER, notes: '' });
      PLAN.forEach(([sym, name, p0, p1, eur], j) => {
        const price = pathPrice(p0, p1, d2, 2 + j);
        add({ id: 'demo-sp-' + sym + '-' + d2, category: 'stocks', type: 'buy', symbol: sym, symbolName: name, quantity: r4(eur / price), price, currency: 'EUR', date: d2, portfolioId: BROKER });
      });
    }
    PRICES['IS3N.DE'] = 36;

    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).forEach((t) => TRANSACTIONS.push(t));
  })();

  // The demo's two portfolios: kept in memory by the renderer while the demo
  // is on, so the user's own portfolio list is never read or written. The
  // renderer translates the names (this file is outside the i18n scan).
  function getPortfolios() {
    return [
      { id: 'default', name: 'Main depot', color: '#8b7cff', icon: '◆' },
      { id: BROKER, name: 'Savings plan broker', color: '#22c55e', icon: '◆', clearing: { enabled: true, openingBalance: 0, openingDate: '' } },
      // the plan administrator's account for the employee shares: its own FIFO
      // pool (separateDepot), like a real Morgan Stanley / Computershare account
      { id: EQ_PORTFOLIO, name: 'Employee plan account', color: 'var(--chart-4)', icon: '◆', separateDepot: true }
    ];
  }
  // Tax settings the demo brings along (fund types, Vorabpauschale records).
  // The tax engine's loaders return these while the demo is on; its savers
  // then write nothing. undefined = not a demo store.
  function store(key) {
    if (key === 'maermin_fund_types') return Object.assign({}, FUND_TYPES);
    if (key === 'maermin_vap_records') return JSON.parse(JSON.stringify(VAP_RECORDS));
    return undefined;
  }

  // P5-1.8: fictional companies for Discovery in the demo (demo-fixtures.js):
  // [symbol, name, kind]. Made up on purpose, so no sample price sits next to
  // a real ticker.
  const SAMPLE_COMPANIES = [
    ['NWTX', 'Northwind Systems (sample)', 'tech'], ['BLUQ', 'Bluequay Robotics (sample)', 'tech'],
    ['CDRV', 'Cedar Valley Foods (sample)', 'div'], ['HLMN', 'Hallmoor Utilities (sample)', 'div'],
    ['ORBL', 'Orbital Freight (sample)', 'small'], ['PNCL', 'Pinnacle Health (sample)', 'growth'],
    ['QRTZ', 'Quartzline Chips (sample)', 'tech'], ['RVNS', 'Ravenstone Energy (sample)', 'div'],
    ['SLTE', 'Slate & Co. Retail (sample)', 'small'], ['TDLW', 'Tidewell Water (sample)', 'div'],
    ['VRDA', 'Verdant Mobility (sample)', 'growth'], ['WLLO', 'Willow Software (sample)', 'tech'],
    ['XNTH', 'Xanthe Biotech (sample)', 'small'], ['YRRW', 'Yarrow Insurance (sample)', 'div'],
    ['ZPHR', 'Zephyr Aerospace (sample)', 'growth']
  ];

  const api = { FLAG, SETTINGS, BROKER, EQ_PORTFOLIO, SAMPLE_COMPANIES, isActive, enable, disable, getTransactions, getPrices, getPortfolios, store, closeHistory, getEquity, getIncome };
  if (typeof window !== 'undefined') window.MaerminDemo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
