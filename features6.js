// ============================================================================
// MAERMIN v9.0 — Real Historical Portfolio Chart
//
// Primary data source: Yahoo Finance via Cloudflare Worker
//   → ALL global exchanges: XETRA, London, NASDAQ, Copenhagen, etc.
//   → No API key needed  → no rate limits per-symbol
//   → Worker caches responses (5 min short, 1h long periods)
//
// Fallback: Alpha Vantage (existing key) if Worker URL not set
// Crypto: CoinGecko (free, direct)
//
// Periods: 1H · 1D · 1W · 1M · 1Y · 3Y · 5Y · Max
// ============================================================================
(function () {
'use strict';

const { useState, useEffect, useMemo, useCallback, useRef } = React;

// ─────────────────────────────────────────────────────────────────────────────
// CHART STYLE HELPERS (pure, dual-exported, tested in test/chart-helpers.test.js)
// ─────────────────────────────────────────────────────────────────────────────

// Relative luminance of a CSS color (#rgb, #rrggbb, rgb()/rgba()). Used to
// pick a palette that works on BOTH themes — the previous axis/grid colors
// were hard-coded white-based rgba values, invisible on the light theme.
function colorLuminance(css) {
  const s = String(css || '').trim();
  let r = null, g = null, b = null;
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) { r = parseInt(m[1][0] + m[1][0], 16); g = parseInt(m[1][1] + m[1][1], 16); b = parseInt(m[1][2] + m[1][2], 16); }
  m = m || /^#([0-9a-f]{6})/i.exec(s);
  if (r === null && m) { r = parseInt(m[1].slice(0, 2), 16); g = parseInt(m[1].slice(2, 4), 16); b = parseInt(m[1].slice(4, 6), 16); }
  if (r === null) {
    m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
    if (m) { r = +m[1]; g = +m[2]; b = +m[3]; }
  }
  if (r === null) return 0; // unknown → treat as dark
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
function isDarkTheme(theme) {
  return colorLuminance((theme && (theme.bg || theme.card)) || '#000') < 0.5;
}

// Harmonised, accessible chart palette derived from the active theme.
// Dark: lighter emerald/rose for contrast on dark cards; light: deeper tones
// so the line holds up on white. Grid/axis derive from the text color.
function chartPalette(theme) {
  const dark = isDarkTheme(theme);
  return {
    up:        dark ? '#34d399' : '#059669',
    down:      dark ? '#fb7185' : '#dc2626',
    neutral:   (theme && theme.accent) || '#f5a524',
    info:      dark ? '#60a5fa' : '#2563eb',
    grid:      dark ? 'rgba(148,163,184,0.12)' : 'rgba(71,85,105,0.14)',
    gridStrong: dark ? 'rgba(148,163,184,0.28)' : 'rgba(71,85,105,0.32)',
    axisText:  (theme && theme.textSecondary) || (dark ? 'rgba(226,232,240,0.55)' : 'rgba(51,65,85,0.7)'),
    dark
  };
}

// Smooth a point list into a cubic-Bezier SVG path (Catmull-Rom derived,
// tension 1/6 — gentle, never overshoots wildly). points: [{x, y}].
function smoothPath(points) {
  const pts = (points || []).filter(p => p && isFinite(p.x) && isFinite(p.y));
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
  const k = 1 / 6;
  let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) * k, c1y = p1.y + (p2.y - p0.y) * k;
    const c2x = p2.x - (p3.x - p1.x) * k, c2y = p2.y - (p3.y - p1.y) * k;
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

// The matching area fill: the smooth path closed down to a baseline.
function smoothAreaPath(points, baselineY) {
  const pts = (points || []).filter(p => p && isFinite(p.x) && isFinite(p.y));
  if (pts.length < 2) return '';
  return smoothPath(pts) +
    ` L${pts[pts.length - 1].x.toFixed(2)},${baselineY.toFixed(2)}` +
    ` L${pts[0].x.toFixed(2)},${baselineY.toFixed(2)} Z`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PERIOD CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const PERIODS = [
  { id: '1H',  label: '1H',  yfRange: '1d',  yfInterval: '1m',  cgDays: 1,    avCompact: true  },
  { id: '1D',  label: '1D',  yfRange: '1d',  yfInterval: '5m',  cgDays: 1,    avCompact: true  },
  { id: '1W',  label: '1W',  yfRange: '5d',  yfInterval: '60m', cgDays: 7,    avCompact: true  },
  { id: '1M',  label: '1M',  yfRange: '1mo', yfInterval: '1d',  cgDays: 30,   avCompact: true  },
  { id: '1Y',  label: '1Y',  yfRange: '1y',  yfInterval: '1d',  cgDays: 365,  avCompact: true  },
  { id: '3Y',  label: '3Y',  yfRange: '5y',  yfInterval: '1wk', cgDays: 1095, avCompact: false },
  { id: '5Y',  label: '5Y',  yfRange: '5y',  yfInterval: '1wk', cgDays: 1825, avCompact: false },
  { id: 'Max', label: 'Max', yfRange: 'max', yfInterval: '1mo', cgDays: 'max', avCompact: false },
];

// Yahoo Finance symbol map for known European stocks
// Most EU stocks work automatically with .DE / .CO etc — YF auto-detects many
const YF_SYMBOL_MAP = {
  // XETRA (.DE) — funktioniert direkt
  'SIX2': 'SIX2.DE', 'SIE': 'SIE.DE', 'SAP': 'SAP.DE', 'BMW': 'BMW.DE',
  'VOW3': 'VOW3.DE', 'BAS': 'BAS.DE', 'ALV': 'ALV.DE', 'DTE': 'DTE.DE',
  'DBK': 'DBK.DE', 'ADS': 'ADS.DE', 'RWE': 'RWE.DE', 'MRK': 'MRK.DE',
  'HEN3': 'HEN3.DE', 'MUV2': 'MUV2.DE', 'LIN': 'LIN.DE', 'BAYN': 'BAYN.DE',
  'EOAN': 'EOAN.DE', 'FRE': 'FRE.DE', 'IFX': 'IFX.DE', 'MTX': 'MTX.DE',
  // Kopenhagen — Yahoo nutzt .CO
  'NOVO-B': 'NOVO-B.CO', 'ORSTED': 'ORSTED.CO', 'DSV': 'DSV.CO',
  // NVO = US ADR auf NYSE, kein Suffix nötig
  'NVO': 'NVO',
  // Stockholm — Yahoo nutzt .ST
  'ERIC-B': 'ERIC-B.ST', 'HM-B': 'HM-B.ST', 'VOLV-B': 'VOLV-B.ST',
  // FI = Fiserv Inc. (NYSE) — YF sometimes returns no data for bare "FI"
  // Try bare first, suffix fallback (.DE/.L etc.) handles the rest automatically
  'FI': 'FI',
  'FISV': 'FI', // legacy Fiserv ticker alias
  // Amsterdam (.AS)
  'ASML': 'ASML.AS', 'SHELL': 'SHEL.AS', 'ING': 'INGA.AS', 'PHIA': 'PHIA.AS',
  // London (.L)
  'SHEL': 'SHEL.L', 'AZN': 'AZN.L', 'BP': 'BP.L', 'HSBC': 'HSBA.L',
  'GSK': 'GSK.L', 'ULVR': 'ULVR.L', 'RIO': 'RIO.L',
  // Paris (.PA)
  'LVMH': 'MC.PA', 'TTE': 'TTE.PA', 'AIR': 'AIR.PA', 'BNP': 'BNP.PA',
  'SAN': 'SAN.PA', 'OR': 'OR.PA', 'RI': 'RI.PA',
  // Milan (.MI)
  'ENI': 'ENI.MI', 'ENEL': 'ENEL.MI', 'ISP': 'ISP.MI',
  // Futures — Rohstoffe
  'GOLD': 'GC=F', 'XAU': 'GC=F',
  'SILVER': 'SI=F', 'XAG': 'SI=F',
  'OIL': 'CL=F', 'WTI': 'CL=F',
  'BRENT': 'BZ=F',
  'GAS': 'NG=F', 'NATURAL_GAS': 'NG=F',
  'COPPER': 'HG=F',
  'PLATINUM': 'PL=F', 'XPT': 'PL=F',
  'PALLADIUM': 'PA=F', 'XPD': 'PA=F',
  'WHEAT': 'ZW=F', 'CORN': 'ZC=F',
};

// ─────────────────────────────────────────────────────────────────────────────
// DATA FETCHING
// ─────────────────────────────────────────────────────────────────────────────

// Yahoo Finance via Worker — with automatic exchange suffix fallback
// If the mapped symbol returns 404, tries common EU suffixes automatically
async function fetchYFHistory(symbol, period, workerUrl) {
  const base   = workerUrl.replace(/\/$/, '');
  const symU   = symbol.toUpperCase();
  const mapped = YF_SYMBOL_MAP[symU];

  // Build candidate list: mapped symbol first, then bare, then EU suffixes
  const candidates = mapped
    ? [mapped]
    : symU.includes('.')
      ? [symU]  // already has suffix — use as-is
      : [symU, `${symU}.DE`, `${symU}.L`, `${symU}.PA`, `${symU}.AS`, `${symU}.ST`, `${symU}.CO`, `${symU}.MI`];

  let lastError = 'No data';

  for (const sym of candidates) {
    const url = `${base}?action=yf&symbol=${encodeURIComponent(sym)}&interval=${period.yfInterval}&range=${period.yfRange}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) { lastError = `Worker YF ${res.status} for ${sym}`; continue; }
      const data = await res.json();
      if (data.error || !data.prices || data.prices.length === 0) {
        lastError = data.error || `No prices for ${sym}`;
        continue;
      }
      if (sym !== symU) console.log(`[CHART] YF auto-matched ${symbol} → ${sym}`);
      return { prices: data.prices, currency: data.currency || 'USD', matchedSym: sym };
    } catch(e) {
      lastError = e.message;
    }
  }

  throw new Error(lastError);
}

// CoinGecko: [{ts, date, price_eur}] — direct, no CORS on CoinGecko
async function fetchCryptoHistory(coinId, period) {
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coinId)}/market_chart` +
    `?vs_currency=eur&days=${period.cgDays}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const data = await res.json();
  return (data.prices || []).map(([ms, price]) => ({
    ts:    Math.floor(ms / 1000),
    date:  new Date(ms).toISOString().split('T')[0],
    price, // EUR already
    inEur: true,
  }));
}

// Alpha Vantage fallback for stocks (if no worker URL)
async function fetchAVHistory(symbol, avKey, period) {
  const outputsize = period.avCompact ? 'compact' : 'full';
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=${outputsize}&apikey=${avKey}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`AV ${res.status}`);
  const data = await res.json();
  if (data['Note'] || data['Information']) throw new Error('Rate limit');
  const series = data['Time Series (Daily)'];
  if (!series) throw new Error(data['Error Message'] || 'No data');
  return Object.entries(series).map(([date, v]) => ({
    ts: Math.floor(new Date(date).getTime() / 1000),
    date, price: parseFloat(v['4. close']), inEur: false,
  })).sort((a, b) => a.ts - b.ts);
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
function PortfolioHistoryChart({ portfolio, prices, transactions, apiKeys, theme, formatPrice, getCurrencySymbol, exchangeRate, currentValue, totalInvested, totalProfit, totalProfitPercent }) {
  const [period, setPeriod]         = useState('1M');
  const chartMode = 'value'; // return tab removed — always show value chart
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [chartData, setChartData]   = useState([]);
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const svgRef = useRef(null);
  const cacheRef     = useRef({});

  const usdToEur      = exchangeRate || 0.91;
  const workerUrl     = (apiKeys?.cs2Worker || '').trim();
  const avKey         = apiKeys?.alphaVantage;
  const hasWorker     = workerUrl.length > 5;
  const currentPeriod = PERIODS.find(p => p.id === period) || PERIODS[3];

  // True ROI from transaction cost basis — same as stats cards
  const trueROI    = (typeof totalProfitPercent === 'number') ? totalProfitPercent : 0;
  const trueProfit = (typeof totalProfit        === 'number') ? totalProfit        : 0;
  const isROIup    = trueROI >= 0;


  // Build positions WITH transaction history for time-accurate amount calculation
  const positions = useMemo(() => {
    // Build tx history per symbol+category: [{ts, qty, type}]
    const txHistory = {}; // key: `${cat}-${symLower}` → [{ts, qty, type}]
    const firstBuy  = {}; // key → first buy ts

    (transactions || []).forEach(tx => {
      if (tx.type !== 'buy' && tx.type !== 'sell') return;
      const cat = tx.category || 'crypto';
      const key = `${cat}-${(tx.symbol || '').toLowerCase()}`;
      const ts  = Math.floor(new Date(tx.date || 0).getTime() / 1000);
      if (!txHistory[key]) txHistory[key] = [];
      txHistory[key].push({ ts, qty: parseFloat(tx.quantity) || 0, type: tx.type });
      if (tx.type === 'buy') {
        if (!firstBuy[key] || ts < firstBuy[key]) firstBuy[key] = ts;
      }
    });

    const result = [];
    ['crypto','stocks','skins','commodities'].forEach(cat => {
      (portfolio[cat] || []).forEach(pos => {
        if ((pos.amount || 0) <= 0.000001) return;
        const symL = (pos.symbol || pos.name || '').toLowerCase();
        const key  = `${cat}-${symL}`;

        let firstTs = firstBuy[key];
        if (!firstTs && pos.purchaseDate) firstTs = Math.floor(new Date(pos.purchaseDate).getTime() / 1000);
        if (!firstTs) firstTs = Math.floor(Date.now() / 1000) - 86400;

        // Sort tx history by time
        const history = (txHistory[key] || []).sort((a, b) => a.ts - b.ts);

        result.push({
          sym:     symL,
          symOrig: pos.symbol || pos.name || '',
          amount:  pos.amount, // current total (for reference)
          cat,
          firstTs,
          txHistory: history, // ← full buy/sell history for time-accurate amounts
        });
      });
    });
    return result;
  }, [portfolio, transactions]);



  const buildChart = useCallback(async () => {
    if (positions.length === 0) return;
    setChartData([]);   // Clear immediately — no stale data shown during load
    setHoveredIdx(null);
    setLoading(true);
    setError(null);

    try {
      const historyMap = {}; // symOrig → [{ts, date, price (EUR)}]

      // ── Crypto: CoinGecko (parallel, free) ─────────────────────────────
      await Promise.all(
        positions.filter(p => p.cat === 'crypto').map(async pos => {
          const ckey = `${pos.sym}|${period}`;
          if (cacheRef.current[ckey]) { historyMap[pos.symOrig] = cacheRef.current[ckey]; return; }
          try {
            const hist = await fetchCryptoHistory(pos.sym, currentPeriod);
            cacheRef.current[ckey] = hist;
            historyMap[pos.symOrig] = hist;
          } catch(e) {
            console.warn('[CHART] CoinGecko failed for', pos.sym, '—', e.message);
            const p = prices[pos.symOrig] || prices[pos.sym] || 0;
            if (p > 0) historyMap[pos.symOrig] = flatLine(p, pos.firstTs);
          }
        })
      );

      // ── CS2 Skins: Steam Market Price History via Worker ────────────────
      const skinPositions = positions.filter(p => p.cat === 'skins');
      if (hasWorker && skinPositions.length > 0) {
        await Promise.all(skinPositions.map(async pos => {
          const ckey = `${pos.symOrig}|${period}|steam`;
          if (cacheRef.current[ckey]) { historyMap[pos.symOrig] = cacheRef.current[ckey]; return; }
          try {
            const base = workerUrl.replace(/\/$/, '');
            // ONE normalising place for market_hash_name (Souvenir/StatTrak
            // prefixes, separator spacing) — same as the price lookup uses.
            const hashName = window.MaerminTickers?.normalizeSkinName
              ? window.MaerminTickers.normalizeSkinName(pos.symOrig) : pos.symOrig;
            const url  = `${base}?action=steamhistory&name=${encodeURIComponent(hashName)}`;
            const res  = await fetch(url, { signal: AbortSignal.timeout(15000) });
            if (!res.ok) throw new Error(`Steam history ${res.status}`);
            const data = await res.json();
            if (data.error || !data.prices?.length) throw new Error((data.error || 'No data') + (data.note ? ` (${data.note})` : ''));
            // Currency: new Workers say currency:'USD' honestly (they always
            // delivered USD); legacy Workers mislabel the same USD numbers as
            // 'EUR' and lack the `source` field — convert in both cases. Only
            // a future Worker that really sends EUR (label + source) skips it.
            const rate = (data.currency === 'EUR' && data.source) ? 1 : usdToEur;
            const hist = data.prices.map(h => ({ ...h, price: h.price * rate }));
            cacheRef.current[ckey] = hist;
            historyMap[pos.symOrig] = hist;
            console.log(`[CHART] Steam history: ${pos.symOrig} → ${hist.length} points (${data.source || 'legacy'})`);
          } catch(e) {
            console.warn('[CHART] Steam history failed for', pos.symOrig, '—', e.message);
            const p = prices[pos.symOrig] || prices[pos.sym] || 0;
            if (p > 0) historyMap[pos.symOrig] = flatLine(p, pos.firstTs);
          }
        }));
      } else {
        skinPositions.forEach(pos => {
          const p = prices[pos.symOrig] || prices[pos.sym] || 0;
          if (p > 0) historyMap[pos.symOrig] = flatLine(p, pos.firstTs);
        });
      }

      // ── Stocks + Commodities: Yahoo Finance via Worker (parallel) ────────
      const nonCrypto = positions.filter(p => p.cat !== 'crypto' && p.cat !== 'skins');

      if (hasWorker && nonCrypto.length > 0) {
        await Promise.all(nonCrypto.map(async pos => {
          const ckey = `${pos.symOrig}|${period}|yf`;
          if (cacheRef.current[ckey]) { historyMap[pos.symOrig] = cacheRef.current[ckey]; return; }
          try {
            const { prices: hist, currency } = await fetchYFHistory(pos.symOrig, currentPeriod, workerUrl);
            const rate    = (currency === 'EUR') ? 1 : usdToEur;
            const histEUR = hist.map(h => ({ ...h, price: h.price * rate }));
            cacheRef.current[ckey] = histEUR;
            historyMap[pos.symOrig] = histEUR;
            console.log(`[CHART] YF: ${pos.symOrig} (${currency}) → ${hist.length} points`);
          } catch(e) {
            console.warn('[CHART] YF failed for', pos.symOrig, '—', e.message);
            if (pos.cat === 'stocks' && avKey) {
              try {
                const hist    = await fetchAVHistory(pos.symOrig.toUpperCase(), avKey, currentPeriod);
                const histEUR = hist.map(h => ({ ...h, price: h.price * usdToEur }));
                cacheRef.current[`${pos.symOrig}|${period}|av`] = histEUR;
                historyMap[pos.symOrig] = histEUR;
                console.log(`[CHART] AV fallback: ${pos.symOrig} → ${hist.length} points`);
                return;
              } catch(e2) {
                console.warn('[CHART] AV fallback failed for', pos.symOrig, '—', e2.message);
              }
            }
            const p = prices[pos.symOrig] || prices[(pos.symOrig||'').toLowerCase()] || 0;
            if (p > 0) historyMap[pos.symOrig] = flatLine(p, pos.firstTs);
          }
        }));

      } else if (!hasWorker && avKey && nonCrypto.length > 0) {
        let rateLimited = false;
        for (const pos of nonCrypto) {
          const ckey = `${pos.symOrig}|${period}|av`;
          if (cacheRef.current[ckey]) { historyMap[pos.symOrig] = cacheRef.current[ckey]; continue; }
          if (rateLimited) {
            const p = prices[pos.symOrig] || 0;
            if (p > 0) historyMap[pos.symOrig] = flatLine(p, pos.firstTs);
            continue;
          }
          try {
            const hist    = await fetchAVHistory(pos.symOrig.toUpperCase(), avKey, currentPeriod);
            const histEUR = hist.map(h => ({ ...h, price: h.price * usdToEur }));
            cacheRef.current[ckey] = histEUR;
            historyMap[pos.symOrig] = histEUR;
          } catch(e) {
            if ((e.message||'').includes('Rate limit')) rateLimited = true;
            const p = prices[pos.symOrig] || 0;
            if (p > 0) historyMap[pos.symOrig] = flatLine(p, pos.firstTs);
          }
          if (!rateLimited) await new Promise(r => setTimeout(r, 12500));
        }
      } else {
        nonCrypto.forEach(pos => {
          const p = prices[pos.symOrig] || prices[(pos.symOrig||'').toLowerCase()] || 0;
          if (p > 0) historyMap[pos.symOrig] = flatLine(p, pos.firstTs);
        });
      }

      // ── Build portfolio value curve ──────────────────────────────────────
      // KEY FIX: For each timestamp, calculate how many units were HELD at that
      // time by replaying transactions up to that point.
      // This makes buy/sell events visible as actual jumps in the chart.

      // Helper: amount held at a given timestamp
      const amountAt = (pos, ts) => {
        let held = 0;
        for (const tx of pos.txHistory) {
          if (tx.ts > ts) break; // transaction is in the future
          if (tx.type === 'buy')  held += tx.qty;
          if (tx.type === 'sell') held -= tx.qty;
        }
        return Math.max(0, held);
      };

      // Global earliest buy = minimum firstTs across all positions
      const globalFirstTs = Math.min(...positions.map(p => p.firstTs));

      // All price timestamps from all histories that fall after any position's first buy
      const allTs = new Set();
      positions.forEach(pos => {
        const hist = historyMap[pos.symOrig];
        if (!hist) return;
        hist.forEach(h => {
          if (h.ts >= pos.firstTs) allTs.add(h.ts);
        });
      });

      // Also add all transaction timestamps so buy/sell events are always chart points
      positions.forEach(pos => {
        pos.txHistory.forEach(tx => allTs.add(tx.ts));
        // Add a point just AFTER each transaction too (same day end) to show the step
        pos.txHistory.forEach(tx => allTs.add(tx.ts + 60));
      });

      const sortedTs = [...allTs].sort((a, b) => a - b);

      // Period cutoff: later of (period start, global first buy)
      const cutoffDays = typeof currentPeriod.cgDays === 'number' ? currentPeriod.cgDays : 36500;
      const periodCutoff = period === 'Max'
        ? globalFirstTs
        : Math.max(globalFirstTs, Math.floor(Date.now()/1000) - cutoffDays * 86400);

      const curve = sortedTs
        .filter(ts => ts >= periodCutoff)
        .map(ts => {
          let value = 0;
          positions.forEach(pos => {
            if (ts < pos.firstTs) return; // position not yet bought

            const hist = historyMap[pos.symOrig];
            if (!hist || hist.length === 0) return;

            // Time-accurate amount: replay transactions up to this point
            const held = pos.txHistory.length > 0 ? amountAt(pos, ts) : pos.amount;
            if (held <= 0) return;

            // Forward-fill price: last known price at or before this ts
            let price = null;
            for (let i = hist.length - 1; i >= 0; i--) {
              if (hist[i].ts <= ts + 3600) { price = hist[i].price; break; }
            }
            if (price === null) price = hist[0]?.price ?? 0;
            value += held * price;
          });
          return { ts, value, date: new Date(ts * 1000).toISOString().split('T')[0] };
        })
        .filter(d => d.value > 0);

      // Downsample to 400 points max
      let final = curve;
      if (curve.length > 400) {
        const step = Math.ceil(curve.length / 400);
        final = curve.filter((_, i) => i % step === 0 || i === curve.length - 1);
      }

      setChartData(final);
    } catch(e) {
      console.error('[CHART] Fatal:', e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [positions, period, workerUrl, avKey, usdToEur, prices, currentPeriod]);

  useEffect(() => { buildChart(); }, [buildChart]);

  // ── Chart math ────────────────────────────────────────────────────────────
  const W = 800, H = 175;
  const PAD = { t: 16, r: 0, b: 28, l: 0 };

  const computed = useMemo(() => {
    if (chartData.length < 2) return null;
    const vals  = chartData.map(d => d.value);
    const minV  = Math.min(...vals);
    const maxV  = Math.max(...vals);
    const range = (maxV - minV) || (maxV * 0.01) || 1;
    const toX   = i => PAD.l + (i / (chartData.length - 1)) * (W - PAD.l - PAD.r);
    const toY   = v => PAD.t + (1 - (v - minV) / range) * (H - PAD.t - PAD.b);
    const pts   = chartData.map((d, i) => `${toX(i)},${toY(d.value)}`).join(' ');
    const area  = [`${PAD.l},${H-PAD.b}`, ...chartData.map((d,i)=>`${toX(i)},${toY(d.value)}`), `${toX(chartData.length-1)},${H-PAD.b}`].join(' ');
    const firstV = vals[0], lastV = vals[vals.length-1];
    const change = lastV - firstV;
    const pct    = firstV > 0 ? (change/firstV)*100 : 0;
    const isUp   = change >= 0;
    // Y labels
    const yLabels = [0,1,2,3,4].map(i => ({ y: toY(minV + i/4*range), label: formatPrice(minV + i/4*range) }));
    // X labels
    const xCount = 6;
    const xStep  = Math.max(1, Math.floor((chartData.length-1)/(xCount-1)));
    const xLabels = Array.from({length: xCount}, (_,i) => {
      const idx = Math.min(i*xStep, chartData.length-1);
      const d = chartData[idx];
      let label = d.date;
      if (['1H','1D'].includes(period)) {
        const dt = new Date(d.ts*1000);
        label = dt.toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'});
      } else if (['1W','1M'].includes(period)) {
        const dt = new Date(d.date);
        label = dt.toLocaleDateString('en-GB', {day:'2-digit',month:'short'});
      } else {
        const dt = new Date(d.date);
        label = dt.toLocaleDateString('en-GB', {month:'short',year:'2-digit'});
      }
      return { idx, label, x: toX(idx) };
    });
    // V7 timeline markers: place buy / sell / dividend events on the value curve.
    // Transaction timestamps are already chart points (added when building the
    // curve), so we just snap each event to its nearest point.
    const evColor = { buy: '#22c55e', sell: '#ef4444', dividend: '#3b82f6' };
    const markers = [];
    (transactions || []).forEach(tx => {
      const type = tx.type || 'buy';
      if (!evColor[type] || !tx.date) return;
      const ts = Math.floor(new Date(tx.date).getTime() / 1000);
      if (isNaN(ts)) return;
      let bestI = -1, bestD = Infinity;
      for (let i = 0; i < chartData.length; i++) {
        const dd = Math.abs(chartData[i].ts - ts);
        if (dd < bestD) { bestD = dd; bestI = i; }
      }
      if (bestI < 0 || bestD > 4 * 86400) return; // only place near an actual point
      markers.push({ x: toX(bestI), y: toY(chartData[bestI].value), type, color: evColor[type], symbol: tx.symbol || '', date: tx.date });
    });
    return { vals, minV, maxV, range, toX, toY, pts, area, firstV, lastV, change, pct, isUp, yLabels, xLabels, markers };
  }, [chartData, period, formatPrice, transactions]);

  const hovered = hoveredIdx !== null ? chartData[hoveredIdx] : null;

  // ── Return % chart computation ─────────────────────────────────────────────
  const computedReturn = useMemo(() => {
    if (chartData.length < 2) return null;

    // ── Normalized return % curve ────────────────────────────────────────────
    // Problem: historical chart values may only include assets with data at that time
    // (e.g. only a €17 skin exists in 2018, stocks bought in 2024 add no history).
    // Using any historical base causes exploding % values.
    //
    // Solution: normalize the ENTIRE curve so the last point = true ROI (from header).
    // impliedBase = lastValue / (1 + trueROI/100)
    // retVal_t   = (value_t / impliedBase - 1) × 100
    //
    // This guarantees:
    //   • Last point always equals the header "Total Return" exactly
    //   • Shape of curve correctly reflects portfolio value movements
    //   • No exploding values regardless of period or portfolio history
    //   • 0% line represents "break-even on current invested capital"
    const lastV = chartData[chartData.length - 1]?.value;
    if (!lastV) return null;

    // impliedBase is what the portfolio would need to have started at
    // for the current value to represent trueROI
    const roiFactor = (typeof trueROI === 'number' && trueROI > -100)
      ? (1 + trueROI / 100)
      : 1;
    const impliedBase = lastV / roiFactor;

    // Skip leading points where portfolio was negligible (<2% of implied base)
    // to avoid showing flat lines from before real investing began
    const threshold = impliedBase * 0.02;
    let startIdx = 0;
    for (let i = 0; i < chartData.length; i++) {
      if (chartData[i].value >= threshold) { startIdx = i; break; }
    }
    const meaningfulData = chartData.slice(startIdx);
    if (meaningfulData.length < 2) return null;

    const firstV = impliedBase; // used only for EUR amount in hover tooltip

    // Normalize: each point = (value / impliedBase - 1) × 100
    const retVals = meaningfulData.map(d => (d.value / impliedBase - 1) * 100);
    const minR    = Math.min(...retVals);
    const maxR    = Math.max(...retVals);
    // SYMMETRIC axis: 0% is always in the exact vertical center.
    // This makes the chart visually distinct from the value chart —
    // the line oscillates around a fixed middle baseline.
    const extent  = Math.max(Math.abs(minR), Math.abs(maxR), 1) * 1.15; // 15% padding
    const lo      = -extent;
    const hi      =  extent;
    const range   = hi - lo;

    const toX  = i => PAD.l + (i / (meaningfulData.length - 1)) * (W - PAD.l - PAD.r);
    const toY  = v => PAD.t + (1 - (v - lo) / range) * (H - PAD.t - PAD.b);
    const y0   = toY(0); // pixel position of the 0% baseline

    // Build SVG polyline string for the return curve
    const pts = retVals.map((r, i) => `${toX(i)},${toY(r)}`).join(' ');

    // Build proper closed area paths for positive (green) and negative (red) regions.
    // We walk through the points and interpolate exact crossing X positions where
    // the line crosses y0. Each closed segment is a valid non-self-intersecting polygon.
    // This is the ONLY correct way — single polygon + clipPath creates stripe artifacts
    // when the line oscillates above/below zero.
    const buildSignedPaths = () => {
      const posPath = []; // D string segments for above-zero (green)
      const negPath = []; // D string segments for below-zero (red)

      let segPos = null; // current open positive segment points
      let segNeg = null; // current open negative segment points

      const closeSegment = (seg, container) => {
        if (seg && seg.length >= 2) {
          // Close back to y0 at the last and first x
          const first = seg[0];
          const last  = seg[seg.length - 1];
          container.push(`M ${first.x},${y0} ` +
            seg.map(p => `L ${p.x},${p.y}`).join(' ') +
            ` L ${last.x},${y0} Z`);
        }
      };

      for (let i = 0; i < retVals.length; i++) {
        const r = retVals[i];
        const x = toX(i);
        const y = toY(r);
        const above = r >= 0;

        // Check for crossing between previous point and this one
        if (i > 0) {
          const prevR = retVals[i-1];
          const prevX = toX(i-1);
          const prevAbove = prevR >= 0;

          if (above !== prevAbove) {
            // Interpolate exact crossing X
            const crossFrac = Math.abs(prevR) / (Math.abs(prevR) + Math.abs(r));
            const crossX    = prevX + crossFrac * (x - prevX);

            // Close the outgoing segment at the crossing
            if (prevAbove) {
              if (segPos) { segPos.push({ x: crossX, y: y0 }); closeSegment(segPos, posPath); segPos = null; }
            } else {
              if (segNeg) { segNeg.push({ x: crossX, y: y0 }); closeSegment(segNeg, negPath); segNeg = null; }
            }
            // Start the new segment from the crossing
            if (above) { segPos = [{ x: crossX, y: y0 }]; }
            else        { segNeg = [{ x: crossX, y: y0 }]; }
          }
        }

        // Add point to active segment
        if (above) {
          if (!segPos) segPos = [];
          segPos.push({ x, y });
        } else {
          if (!segNeg) segNeg = [];
          segNeg.push({ x, y });
        }
      }

      // Close any open segments
      closeSegment(segPos, posPath);
      closeSegment(segNeg, negPath);

      return { posPath: posPath.join(' '), negPath: negPath.join(' ') };
    };

    const { posPath, negPath } = buildSignedPaths();

    // Y labels — use clean rounded % steps
    const stepSize = extent > 20 ? 10 : extent > 10 ? 5 : extent > 5 ? 2 : 1;
    const yLabels = [];
    for (let v = Math.ceil(lo / stepSize) * stepSize; v <= hi + 0.001; v += stepSize) {
      yLabels.push({ y: toY(v), label: `${v > 0 ? '+' : ''}${v.toFixed(v % 1 === 0 ? 0 : 1)}%`, isZero: v === 0 });
    }

    const xCount = 6;
    const xStep  = Math.max(1, Math.floor((meaningfulData.length-1)/(xCount-1)));
    const xLabels = Array.from({length: xCount}, (_,i) => {
      const idx = Math.min(i*xStep, meaningfulData.length-1);
      const d   = meaningfulData[idx];
      let label = d.date;
      if (['1H','1D'].includes(period)) {
        label = new Date(d.ts*1000).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'});
      } else if (['1W','1M'].includes(period)) {
        label = new Date(d.date).toLocaleDateString('en-GB', {day:'2-digit',month:'short'});
      } else {
        label = new Date(d.date).toLocaleDateString('en-GB', {month:'short',year:'2-digit'});
      }
      return { idx, label, x: toX(idx) };
    });

    const lastR = retVals[retVals.length - 1];
    return { retVals, meaningfulData, startIdx, lo, hi, range, toX, toY, y0, pts, posPath, negPath, yLabels, xLabels, lastR, firstV };
  }, [chartData, period, trueROI]);

  const handleMouseMove = e => {
    if (!svgRef.current || chartData.length < 2) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mx   = (e.clientX - rect.left) / rect.width * W;
    const frac = Math.max(0, Math.min(1, (mx - PAD.l) / (W - PAD.l - PAD.r)));
    setHoveredIdx(Math.round(frac * (chartData.length - 1)));
  };

  const dataSources = [
    positions.some(p => p.cat === 'crypto')      && 'CoinGecko',
    positions.some(p => p.cat === 'stocks')      && (hasWorker ? 'Yahoo Finance' : avKey ? 'Alpha Vantage' : null),
    positions.some(p => p.cat === 'commodities') && (hasWorker ? 'Yahoo Finance' : null),
    positions.some(p => p.cat === 'skins')       && (hasWorker ? 'Steam Market' : null),
  ].filter(Boolean);

  // ── Colour constants ──────────────────────────────────────────────────────
  // Theme-aware palette: the old constants were white-based rgba values that
  // disappeared on the light theme. PALETTE derives everything from the theme.
  const PALETTE = chartPalette(theme);
  const GREEN  = PALETTE.up;
  const RED    = PALETTE.down;
  const GREY   = PALETTE.axisText;
  const GREY2  = PALETTE.grid;
  // Mockup hero uses the gold accent for the value chart (not up/down green/red).
  const lineColor = theme.accent || (computed?.isUp ? GREEN : RED);

  // ── Shared X-label formatter ──────────────────────────────────────────────
  const fmtX = d => {
    if (['1H','1D'].includes(period)) return new Date(d.ts*1000).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    if (['1W','1M'].includes(period)) return new Date(d.date).toLocaleDateString('en-GB',{day:'2-digit',month:'short'});
    return new Date(d.date).toLocaleDateString('en-GB',{month:'short',year:'2-digit'});
  };

  // ── Header stat pill (same in both modes = real ROI) ──────────────────────
  const roiPill = () => {
    const pct = trueROI;
    const eur = trueProfit;
    const up  = isROIup;
    const sign = up ? '+' : '';
    const deltaCol = up ? GREEN : RED;
    // Mockup hero: lead with the big € portfolio value, return as a chip beside it.
    const valNum = (typeof currentValue === 'number') ? currentValue : 0;
    const full   = `${formatPrice(valNum)}`;
    const dot    = full.lastIndexOf('.');
    const intPart = dot > -1 ? full.slice(0, dot) : full;
    const decPart = dot > -1 ? full.slice(dot) : '';
    return React.createElement('div', { style: { marginTop: '0.15rem' } },
      // Big portfolio value
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.05rem', fontFamily: "'Space Grotesk', 'Hanken Grotesk', sans-serif", lineHeight: 1 }
      },
        React.createElement('span', { style: { fontSize: 'clamp(2rem, 4.2vw, 2.9rem)', fontWeight: '700', letterSpacing: '-0.03em', color: theme.text } }, intPart),
        decPart && React.createElement('span', { style: { fontSize: 'clamp(1.2rem, 2.6vw, 1.7rem)', fontWeight: '600', letterSpacing: '-0.02em', color: GREY } }, decPart),
        React.createElement('span', { style: { fontSize: '1.2rem', fontWeight: '600', color: GREY, marginLeft: '0.4rem' } }, getCurrencySymbol())
      ),
      // Return chip + pct + "all time"
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginTop: '0.6rem' }
      },
        React.createElement('span', {
          style: { display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.28rem 0.6rem', borderRadius: '8px', background: `${deltaCol}22`, color: deltaCol, fontWeight: '700', fontSize: '0.92rem' }
        },
          React.createElement('span', { style: { fontSize: '0.65rem' } }, up ? '▲' : '▼'),
          `${sign}${formatPrice(Math.abs(eur))} ${getCurrencySymbol()}`
        ),
        React.createElement('span', { style: { color: deltaCol, fontWeight: '700', fontSize: '0.92rem' } }, `${sign}${pct.toFixed(2)}%`),
        React.createElement('span', { style: { color: GREY, fontSize: '0.8rem' } }, 'all time')
      )
    );
  };

  // ── Hover value display ──────────────────────────────────────────────────
  const hoverDisplay = () => {
    if (!hovered) return null;
    if (chartMode === 'value') {
      return React.createElement('div', { style: { display:'flex', alignItems:'baseline', gap:'0.5rem', marginTop:'0.25rem' } },
        React.createElement('span', { style: { fontSize:'1.85rem', fontWeight:'800', letterSpacing:'-0.03em', color: theme.text } },
          `${formatPrice(hovered.value)} ${getCurrencySymbol()}`),
        React.createElement('span', { style: { fontSize:'0.78rem', color: GREY } }, hovered.date)
      );
    }
    // return mode — show % relative to chart base, EUR vs totalInvested
    if (!computedReturn) return null;
    const mI   = hoveredIdx - (computedReturn.startIdx || 0);
    const r    = (mI >= 0 && mI < computedReturn.retVals.length) ? computedReturn.retVals[mI] : 0;
    const col  = r >= 0 ? GREEN : RED;
    const base = (typeof totalInvested === 'number' && totalInvested > 0) ? totalInvested : (computedReturn.firstV || 0);
    const eur  = (r / 100) * base;
    return React.createElement('div', { style: { display:'flex', alignItems:'baseline', gap:'0.5rem', flexWrap:'wrap', marginTop:'0.25rem' } },
      React.createElement('span', { style: { fontSize:'1.85rem', fontWeight:'800', letterSpacing:'-0.03em', color: col } },
        `${r >= 0 ? '+' : ''}${r.toFixed(2)}%`),
      React.createElement('span', { style: { fontSize:'0.9rem', fontWeight:'700', color: col } },
        `${eur >= 0 ? '+' : ''}${formatPrice(eur)} ${getCurrencySymbol()}`),
      React.createElement('span', { style: { fontSize:'0.78rem', color: GREY } }, hovered.date)
    );
  };

  // ── SVG grid helper ───────────────────────────────────────────────────────
  const gridLine = (y, dashed = true) =>
    React.createElement('line', { x1:PAD.l, y1:y, x2:W-PAD.r, y2:y,
      stroke: GREY2, strokeWidth:1, strokeDasharray: dashed ? '4,6' : '0' });

  // ── Value chart SVG ───────────────────────────────────────────────────────
  const renderValueChart = () => {
    if (!computed || error) return null;
    const xCount = 5;
    const xStep  = Math.max(1, Math.floor((chartData.length-1) / (xCount-1)));
    const xLabels = Array.from({length: xCount}, (_,i) => {
      const idx = Math.min(i*xStep, chartData.length-1);
      return { idx, x: computed.toX(idx), label: fmtX(chartData[idx]) };
    });

    // Smooth geometry: the line and its gradient fill share the same
    // Catmull-Rom path, so they always agree. Visual change only - the data
    // points and hover/marker positions are untouched.
    const ptArr = chartData.map((d, i) => ({ x: computed.toX(i), y: computed.toY(d.value) }));
    const linePath = smoothPath(ptArr);
    const areaP = smoothAreaPath(ptArr, H - PAD.b);
    const lastPt = ptArr[ptArr.length - 1];

    // Collect all SVG children into a flat array — avoids spread-into-args stack overflow
    const children = [
      React.createElement('defs', {key:'defs'},
        React.createElement('linearGradient', { id:'valGrad', x1:'0', y1:'0', x2:'0', y2:'1' },
          React.createElement('stop', { offset:'0%',   stopColor: lineColor, stopOpacity: PALETTE.dark ? 0.26 : 0.18 }),
          React.createElement('stop', { offset:'55%',  stopColor: lineColor, stopOpacity: 0.07 }),
          React.createElement('stop', { offset:'100%', stopColor: lineColor, stopOpacity: 0 })
        )
      ),
      // Y-axis labels & grid removed — clean full-bleed hero chart (mockup parity).
      // X labels
      ...xLabels.map((xl,i) =>
        React.createElement('text', { key:`xl${i}`, x:xl.x, y:H-PAD.b+16, textAnchor: i === 0 ? 'start' : (i === xLabels.length - 1 ? 'end' : 'middle'), fill:GREY, fontSize:10 }, xl.label)
      ),
      React.createElement('path', { key:'area', d: areaP, fill:'url(#valGrad)' }),
      React.createElement('path', { key:'line', d: linePath, fill:'none', stroke: lineColor, strokeWidth:2.2, strokeLinejoin:'round', strokeLinecap:'round' }),
      // Endpoint dot anchors the eye on the latest value.
      lastPt && React.createElement('circle', { key:'end', cx:lastPt.x, cy:lastPt.y, r:3.4, fill:lineColor, stroke:theme.card, strokeWidth:1.6 }),
      // Timeline event markers (buy/sell/dividend) with native tooltips
      (computed.markers || []).map((m, i) =>
        React.createElement('circle', { key:'mk'+i, cx:m.x, cy:m.y, r:3.4, fill:m.color, stroke:theme.card, strokeWidth:1.6, opacity:0.95 },
          React.createElement('title', null, `${m.type.toUpperCase()}${m.symbol ? ' ' + m.symbol : ''} · ${m.date}`))),
    ];
    if (hovered) {
      children.push(
        React.createElement('line', { key:'hx', x1:computed.toX(hoveredIdx), y1:PAD.t, x2:computed.toX(hoveredIdx), y2:H-PAD.b, stroke:PALETTE.gridStrong, strokeWidth:1, strokeDasharray:'3,3' }),
        React.createElement('circle', { key:'hc', cx:computed.toX(hoveredIdx), cy:computed.toY(hovered.value), r:4.5, fill:lineColor, stroke:theme.card, strokeWidth:2 }),
        React.createElement('g', { key:'ht', transform:`translate(${Math.min(computed.toX(hoveredIdx)+10, W-150)},${Math.max(computed.toY(hovered.value)-44, PAD.t)})` },
          React.createElement('rect', { width:140, height:46, rx:8, fill:theme.card, stroke:PALETTE.gridStrong, strokeWidth:1, opacity:0.97 }),
          React.createElement('text', { x:10, y:17, fill:GREY, fontSize:10 }, hovered.date),
          React.createElement('text', { x:10, y:34, fill:lineColor, fontSize:13, fontWeight:700, style:{fontVariantNumeric:'tabular-nums'} },
            `${formatPrice(hovered.value)} ${getCurrencySymbol()}`)
        )
      );
    }
    return React.createElement('svg', {
      ref: svgRef, viewBox: `0 0 ${W} ${H}`, width:'100%',
      style: { display:'block', overflow:'visible', cursor:'crosshair' },
      onMouseMove: handleMouseMove, onMouseLeave: () => setHoveredIdx(null)
    }, children);
  };

  // ── Return % chart SVG ────────────────────────────────────────────────────
  const renderReturnChart = () => {
    if (!computedReturn || error) return null;
    const xCount = 5;
    const xStep  = Math.max(1, Math.floor((chartData.length-1) / (xCount-1)));
    const xLabels = Array.from({length: xCount}, (_,i) => {
      const idx = Math.min(i*xStep, chartData.length-1);
      return { idx, x: computedReturn.toX(idx), label: fmtX(chartData[idx]) };
    });

    const { y0, posPath, negPath, pts, lastR, toX, toY, retVals, meaningfulData: mData, startIdx } = computedReturn;
    // Correct fill approach: separate closed path segments per sign region.
    // One area polygon is drawn twice — once clipped above y0, once below y0.
    // This avoids the zig-zag artifact of the clamping/split-polygon approach.
    const children = [
      React.createElement('defs', {key:'defs'},
        React.createElement('linearGradient', { id:'retGreen', x1:'0', y1:'0', x2:'0', y2:'1' },
          React.createElement('stop', { offset:'0%',   stopColor: GREEN, stopOpacity: PALETTE.dark ? 0.34 : 0.24 }),
          React.createElement('stop', { offset:'100%', stopColor: GREEN, stopOpacity: 0.02 })
        ),
        React.createElement('linearGradient', { id:'retRed', x1:'0', y1:'0', x2:'0', y2:'1' },
          React.createElement('stop', { offset:'0%',   stopColor: RED, stopOpacity: 0.02 }),
          React.createElement('stop', { offset:'100%', stopColor: RED, stopOpacity: PALETTE.dark ? 0.34 : 0.24 })
        )
      ),
      // Grid + Y labels: the 0% baseline is the strong anchor line.
      ...computedReturn.yLabels.map((yl,i) => [
        React.createElement('line', { key:`gl${i}`, x1:PAD.l, y1:yl.y, x2:W-PAD.r, y2:yl.y,
          stroke: yl.isZero ? PALETTE.gridStrong : GREY2,
          strokeWidth: yl.isZero ? 1.5 : 1
        }),
        React.createElement('text', { key:`gt${i}`, x:PAD.l-8, y:yl.y+3.5, textAnchor:'end',
          fill: yl.isZero ? PALETTE.axisText : GREY,
          fontSize:10, fontWeight: yl.isZero ? 700 : 400, style:{fontVariantNumeric:'tabular-nums'}
        }, yl.label)
      ]).flat(),
      // X labels
      ...xLabels.map((xl,i) =>
        React.createElement('text', { key:`xl${i}`, x:xl.x, y:H-PAD.b+14, textAnchor:'middle', fill:GREY, fontSize:10 }, xl.label)
      ),
      // Green fill — each above-zero segment as its own closed path (no self-intersection)
      posPath && React.createElement('path', { key:'ag', d: posPath, fill:'url(#retGreen)' }),
      // Red fill — each below-zero segment as its own closed path
      negPath && React.createElement('path', { key:'ar', d: negPath, fill:'url(#retRed)' }),
      // The line on top — smoothed to match the value chart's curve style.
      React.createElement('path', { key:'line', d: smoothPath(retVals.map((r, i) => ({ x: toX(i), y: toY(r) }))), fill:'none',
        stroke: lastR >= 0 ? GREEN : RED,
        strokeWidth: 2.2, strokeLinejoin:'round', strokeLinecap:'round'
      }),
    ];

    // Map global hoveredIdx to meaningfulData index
    const mIdx = hoveredIdx - startIdx;
    const mHovered = (mIdx >= 0 && mIdx < (mData?.length || 0)) ? mData[mIdx] : null;
    if (mHovered && retVals[mIdx] !== undefined) {
      const r   = retVals[mIdx];
      const col = r >= 0 ? GREEN : RED;
      const hx  = toX(mIdx);
      const hy  = toY(r);
      children.push(
        React.createElement('line', { key:'hx', x1:hx, y1:PAD.t, x2:hx, y2:H-PAD.b, stroke:PALETTE.gridStrong, strokeWidth:1, strokeDasharray:'3,3' }),
        React.createElement('circle', { key:'hc', cx:hx, cy:hy, r:4.5, fill:col, stroke:theme.card, strokeWidth:2 }),
        React.createElement('g', { key:'ht', transform:`translate(${Math.min(hx+10, W-150)},${Math.max(hy-48, PAD.t)})` },
          React.createElement('rect', { width:142, height:52, rx:8, fill:theme.card, stroke:col, strokeWidth:1, opacity:0.97 }),
          React.createElement('text', { x:10, y:16, fill:GREY, fontSize:10 }, mHovered.date),
          React.createElement('text', { x:10, y:33, fill:col, fontSize:13, fontWeight:700, style:{fontVariantNumeric:'tabular-nums'} },
            `${r >= 0 ? '+' : ''}${r.toFixed(2)}%`),
          React.createElement('text', { x:10, y:46, fill:GREY, fontSize:10, style:{fontVariantNumeric:'tabular-nums'} },
            `${formatPrice(mHovered.value)} ${getCurrencySymbol()}`)
        )
      );
    }

    return React.createElement('svg', {
      ref: svgRefReturn, viewBox: `0 0 ${W} ${H}`, width:'100%',
      style: { display:'block', overflow:'visible', cursor:'crosshair' },
      onMouseMove: handleMouseMove, onMouseLeave: () => setHoveredIdx(null)
    }, children);
  };

  // ── Full component render ─────────────────────────────────────────────────
  return React.createElement('div', {
    style: {
      background: theme.card, border: `1px solid ${theme.cardBorder}`,
      borderRadius: '16px', overflow: 'hidden', marginBottom: '1.5rem'
    }
  },

    // ── TOP HEADER: ROI + mode toggle + period selector ────────────────────
    React.createElement('div', {
      style: {
        padding: '1.25rem 1.5rem 0.5rem',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        flexWrap: 'wrap', gap: '1rem'
      }
    },
      // Left: title + ROI or hover value
      React.createElement('div', null,
        // Source tags row
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.1rem', flexWrap: 'wrap' }
        },
          React.createElement('span', { style: { fontSize:'0.68rem', fontWeight:'700', color: theme.textSecondary, textTransform:'uppercase', letterSpacing:'0.06em' } },
            'Total Portfolio Value'
          ),
          ...dataSources.map((src, i) =>
            React.createElement('span', { key:i, style:{
              fontSize:'0.58rem', padding:'0.12rem 0.35rem', borderRadius:'3px',
              background:'rgba(255,255,255,0.06)', color: theme.textSecondary, letterSpacing:'0.04em'
            }}, src)
          )
        ),
        // Hover shows chart value; otherwise show ROI pill
        hovered ? hoverDisplay() : roiPill()
      ),

      // Right: period selector
      React.createElement('div', {
        style: { display:'flex', gap:'0.15rem', background: theme.inputBg, borderRadius:'10px', padding:'0.2rem', alignSelf:'flex-start' }
      },
        PERIODS.map(p => {
          const active = period === p.id;
          return React.createElement('button', {
            key: p.id,
            onClick: () => { setPeriod(p.id); setHoveredIdx(null); },
            disabled: loading,
            style: {
              padding: '0.3rem 0.55rem', border:'none', borderRadius:'7px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '0.72rem', fontWeight: active ? '700' : '400',
              background: active ? (computed ? lineColor : theme.accent) : 'transparent',
              color: active ? '#fff' : theme.textSecondary,
              transition: 'all 0.1s', opacity: loading ? 0.5 : 1, whiteSpace: 'nowrap'
            }
          }, p.label);
        })
      )
    ),

    // ── CHART AREA ─────────────────────────────────────────────────────────
    React.createElement('div', { style: { position:'relative' } },
      loading && React.createElement('div', {
        style: { position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,0.22)', zIndex:2, borderRadius:'0 0 16px 16px' }
      }, React.createElement('span', { style: { color: theme.textSecondary, fontSize:'0.875rem' } }, '◎ Loading...')),

      error && !loading && React.createElement('div', {
        style: { padding:'2rem', textAlign:'center', color: theme.textSecondary, fontSize:'0.875rem' }
      }, `Chart error: ${error}`),

      !error && !computed && !loading && React.createElement('div', {
        style: { padding:'3rem 2rem', textAlign:'center', color: theme.textSecondary, fontSize:'0.875rem' }
      },
        React.createElement('div', { style: { fontSize:'2rem', opacity:0.15, marginBottom:'0.5rem' } }, '↗'),
        hasWorker ? 'Chart loads automatically — select a period above'
          : React.createElement('span', null,
              'Add a ', React.createElement('strong', null, 'Cloudflare Worker URL'),
              ' in Settings for stocks & CS2. Crypto loads automatically.'
            )
      ),

      // Only value chart — return tab removed
      renderValueChart()
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: flat line at current price (used when history unavailable)
// ─────────────────────────────────────────────────────────────────────────────
function flatLine(price, firstTs) {
  const now   = Math.floor(Date.now()/1000);
  const start = firstTs || (now - 86400 * 5);
  return [
    { ts: start, date: new Date(start * 1000).toISOString().split('T')[0], price },
    { ts: now,   date: new Date(now   * 1000).toISOString().split('T')[0], price },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
var api = { PortfolioHistoryChart: PortfolioHistoryChart,
  // Pure chart-style helpers (Node-tested in test/chart-helpers.test.js).
  colorLuminance: colorLuminance, isDarkTheme: isDarkTheme, chartPalette: chartPalette,
  smoothPath: smoothPath, smoothAreaPath: smoothAreaPath };
if (typeof window !== 'undefined') window.MaerminFeatures6 = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;

if (typeof console !== 'undefined') console.log('[OK] MAERMIN Features6 v9.0 — Yahoo Finance Historical Chart (1H/1D/1W/1M/1Y/3Y/5Y/Max)');

})();
