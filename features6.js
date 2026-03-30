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
function PortfolioHistoryChart({ portfolio, prices, transactions, apiKeys, theme, formatPrice, getCurrencySymbol, exchangeRate, currentValue }) {
  const [period, setPeriod]       = useState('1M');
  const [chartMode, setChartMode] = useState('value'); // 'value' | 'return'
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [chartData, setChartData] = useState([]);
  const [hoveredIdx, setHoveredIdx] = useState(null);
  const svgRef       = useRef(null); // value chart
  const svgRefReturn = useRef(null); // return % chart
  const cacheRef = useRef({});

  const usdToEur = exchangeRate || 0.91;
  const workerUrl = (apiKeys?.cs2Worker || '').trim();
  const avKey     = apiKeys?.alphaVantage;
  const hasWorker = workerUrl.length > 5;

  const currentPeriod = PERIODS.find(p => p.id === period) || PERIODS[3];

  // Reset hover when switching chart mode
  useEffect(() => { setHoveredIdx(null); }, [chartMode]);

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
            const url  = `${base}?action=steamhistory&name=${encodeURIComponent(pos.symOrig)}`;
            const res  = await fetch(url, { signal: AbortSignal.timeout(15000) });
            if (!res.ok) throw new Error(`Steam history ${res.status}`);
            const data = await res.json();
            if (data.error || !data.prices?.length) throw new Error(data.error || 'No data');
            // Steam returns prices in USD — convert to EUR
            const hist = data.prices.map(h => ({ ...h, price: h.price * usdToEur }));
            cacheRef.current[ckey] = hist;
            historyMap[pos.symOrig] = hist;
            console.log(`[CHART] Steam history: ${pos.symOrig} → ${hist.length} points`);
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
  const W = 800, H = 220;
  const PAD = { t: 24, r: 16, b: 36, l: 72 };

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
    return { vals, minV, maxV, range, toX, toY, pts, area, firstV, lastV, change, pct, isUp, yLabels, xLabels };
  }, [chartData, period, formatPrice]);

  const hovered = hoveredIdx !== null ? chartData[hoveredIdx] : null;
  const lineColor = computed?.isUp ? '#22c55e' : '#ef4444';

  // ── Return % chart computation ─────────────────────────────────────────────
  const computedReturn = useMemo(() => {
    if (chartData.length < 2) return null;
    // Find the first data point with a positive value as the baseline
    const basePoint = chartData.find(d => d.value > 0);
    const firstV = basePoint?.value;
    if (!firstV) return null;

    // Convert each point to return % relative to period start
    const retVals = chartData.map(d => ((d.value - firstV) / firstV) * 100);
    const minR    = Math.min(...retVals);
    const maxR    = Math.max(...retVals);
    // SYMMETRIC axis: 0% is always in the exact vertical center.
    // This makes the chart visually distinct from the value chart —
    // the line oscillates around a fixed middle baseline.
    const extent  = Math.max(Math.abs(minR), Math.abs(maxR), 1) * 1.15; // 15% padding
    const lo      = -extent;
    const hi      =  extent;
    const range   = hi - lo;

    const toX  = i => PAD.l + (i / (chartData.length - 1)) * (W - PAD.l - PAD.r);
    const toY  = v => PAD.t + (1 - (v - lo) / range) * (H - PAD.t - PAD.b);
    const y0   = toY(0); // pixel position of the 0% baseline

    // Points for the full line
    const pts  = retVals.map((r, i) => `${toX(i)},${toY(r)}`).join(' ');

    // Split into above-zero (green) and below-zero (red) filled areas
    // We draw two filled polygons clipped at the 0% line
    const abovePoints = [];
    const belowPoints = [];
    retVals.forEach((r, i) => {
      const x = toX(i);
      const y = toY(r);
      abovePoints.push(`${x},${Math.min(y, y0)}`);
      belowPoints.push(`${x},${Math.max(y, y0)}`);
    });
    const areaAbove = [`${PAD.l},${y0}`, ...abovePoints, `${toX(retVals.length-1)},${y0}`].join(' ');
    const areaBelow = [`${PAD.l},${y0}`, ...belowPoints, `${toX(retVals.length-1)},${y0}`].join(' ');

    // Y labels — use clean rounded % steps
    const stepSize = extent > 20 ? 10 : extent > 10 ? 5 : extent > 5 ? 2 : 1;
    const yLabels = [];
    for (let v = Math.ceil(lo / stepSize) * stepSize; v <= hi + 0.001; v += stepSize) {
      yLabels.push({ y: toY(v), label: `${v > 0 ? '+' : ''}${v.toFixed(v % 1 === 0 ? 0 : 1)}%`, isZero: v === 0 });
    }

    const xCount = 6;
    const xStep  = Math.max(1, Math.floor((chartData.length-1)/(xCount-1)));
    const xLabels = Array.from({length: xCount}, (_,i) => {
      const idx = Math.min(i*xStep, chartData.length-1);
      const d   = chartData[idx];
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
    return { retVals, lo, hi, range, toX, toY, y0, pts, areaAbove, areaBelow, yLabels, xLabels, lastR, firstV };
  }, [chartData, period]);

  const handleMouseMove = e => {
    const ref = chartMode === 'return' ? svgRefReturn : svgRef;
    if (!ref.current || chartData.length < 2) return;
    const rect = ref.current.getBoundingClientRect();
    const mx   = (e.clientX - rect.left) / rect.width * W;
    const frac = Math.max(0, Math.min(1, (mx - PAD.l) / (W - PAD.l - PAD.r)));
    setHoveredIdx(Math.round(frac * (chartData.length-1)));
  };

  // Which data sources are active — shown as small tags, not in the main title
  const dataSources = [
    positions.some(p => p.cat === 'crypto')     && 'Crypto: CoinGecko',
    positions.some(p => p.cat === 'stocks')     && (hasWorker ? 'Stocks: Yahoo Finance' : avKey ? 'Stocks: Alpha Vantage' : null),
    positions.some(p => p.cat === 'commodities')&& (hasWorker ? 'Commodities: Yahoo Finance' : null),
    positions.some(p => p.cat === 'skins')      && (hasWorker ? 'CS2: Steam Market' : null),
  ].filter(Boolean);

  return React.createElement('div', {
    style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '16px', overflow: 'hidden', marginBottom: '1.5rem' }
  },
    // ── Header ────────────────────────────────────────────────────────────
    React.createElement('div', {
      style: { padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }
    },
      // Left: title + value/return display
      React.createElement('div', null,
        // Source tags + mode toggle row
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.375rem', flexWrap: 'wrap' } },
          // Mode toggle
          React.createElement('div', {
            style: { display: 'flex', background: theme.inputBg, borderRadius: '6px', padding: '0.15rem', gap: '0.1rem' }
          },
            ['value', 'return'].map(mode =>
              React.createElement('button', {
                key: mode,
                onClick: () => { setChartMode(mode); setHoveredIdx(null); },
                style: {
                  padding: '0.2rem 0.55rem', border: 'none', borderRadius: '5px', cursor: 'pointer',
                  fontSize: '0.68rem', fontWeight: chartMode === mode ? '700' : '400',
                  background: chartMode === mode ? theme.accent : 'transparent',
                  color: chartMode === mode ? '#fff' : theme.textSecondary,
                  transition: 'all 0.1s'
                }
              }, mode === 'value' ? 'Portfolio Value' : 'Total Return %')
            )
          ),
          ...dataSources.map((src, i) =>
            React.createElement('span', { key: i, style: { fontSize: '0.6rem', padding: '0.1rem 0.35rem', borderRadius: '3px', background: 'rgba(255,255,255,0.06)', color: theme.textSecondary, letterSpacing: '0.03em' } }, src)
          )
        ),

        // ── Value mode display ─────────────────────────────────────────
        chartMode === 'value' && (
          hovered && computed
            ? React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: '0.75rem' } },
                React.createElement('span', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em' } },
                  `${formatPrice(hovered.value)} ${getCurrencySymbol()}`),
                React.createElement('span', { style: { fontSize: '0.8rem', color: theme.textSecondary } }, hovered.date)
              )
            : computed
              ? React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' } },
                  React.createElement('span', {
                    style: { fontSize: '1.1rem', fontWeight: '800', padding: '0.2rem 0.6rem', borderRadius: '6px',
                      background: computed.isUp ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                      color: computed.isUp ? '#22c55e' : '#ef4444' }
                  }, `${computed.isUp?'+':''}${computed.pct.toFixed(2)}%  ${computed.isUp?'+':''}${formatPrice(computed.change)} ${getCurrencySymbol()}`),
                  React.createElement('span', { style: { fontSize: '0.75rem', color: theme.textSecondary } },
                    `in the last ${period === 'Max' ? 'period' : period}`)
                )
              : React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.875rem' } },
                  loading ? '◎ Loading...' : 'Add transactions and refresh prices')
        ),

        // ── Return mode display ────────────────────────────────────────
        chartMode === 'return' && (
          hovered && computedReturn
            ? React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: '0.75rem' } },
                React.createElement('span', {
                  style: { fontSize: '1.5rem', fontWeight: '800', letterSpacing: '-0.02em',
                    color: computedReturn.retVals[hoveredIdx] >= 0 ? '#22c55e' : '#ef4444' }
                }, `${computedReturn.retVals[hoveredIdx] >= 0 ? '+' : ''}${computedReturn.retVals[hoveredIdx].toFixed(2)}%`),
                React.createElement('span', { style: { fontSize: '0.85rem', color: theme.textSecondary } },
                  `${computedReturn.retVals[hoveredIdx] >= 0 ? '+' : ''}${formatPrice((computedReturn.retVals[hoveredIdx]/100) * computedReturn.firstV)} ${getCurrencySymbol()}`),
                React.createElement('span', { style: { fontSize: '0.8rem', color: theme.textSecondary } }, hovered.date)
              )
            : computedReturn
              ? React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' } },
                  React.createElement('span', {
                    style: { fontSize: '1.75rem', fontWeight: '800', letterSpacing: '-0.02em',
                      color: computedReturn.lastR >= 0 ? '#22c55e' : '#ef4444' }
                  }, `${computedReturn.lastR >= 0 ? '+' : ''}${computedReturn.lastR.toFixed(2)}%`),
                  React.createElement('span', { style: { fontSize: '0.85rem', color: computedReturn.lastR >= 0 ? '#22c55e' : '#ef4444' } },
                    `${computedReturn.lastR >= 0 ? '+' : ''}${formatPrice((computedReturn.lastR/100) * computedReturn.firstV)} ${getCurrencySymbol()}`),
                  React.createElement('span', { style: { fontSize: '0.75rem', color: theme.textSecondary } },
                    `total return ${period === 'Max' ? '' : 'last ' + period}`)
                )
              : React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.875rem' } },
                  loading ? '◎ Loading...' : 'No data')
        )
      ),

      // Period buttons
      React.createElement('div', { style: { display: 'flex', gap: '0.2rem', background: theme.inputBg, borderRadius: '10px', padding: '0.25rem' } },
        PERIODS.map(p => React.createElement('button', {
          key: p.id,
          onClick: () => { setPeriod(p.id); setHoveredIdx(null); },
          disabled: loading,
          style: {
            padding: '0.35rem 0.6rem', border: 'none', borderRadius: '7px',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '0.75rem', fontWeight: period === p.id ? '700' : '400',
            background: period === p.id ? (computed ? lineColor : theme.accent) : 'transparent',
            color: period === p.id ? '#fff' : theme.textSecondary,
            transition: 'all 0.1s', opacity: loading ? 0.5 : 1, whiteSpace: 'nowrap'
          }
        }, p.label))
      )
    ),

    // ── SVG ───────────────────────────────────────────────────────────────
    React.createElement('div', { style: { position: 'relative' } },
      loading && React.createElement('div', {
        style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.25)', zIndex: 2 }
      }, React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.875rem' } }, '◎ Loading historical data...')),

      error && !loading && React.createElement('div', { style: { padding: '2rem', textAlign: 'center', color: theme.textSecondary, fontSize: '0.875rem' } },
        `Error loading chart: ${error}`),

      !error && !computed && !loading && React.createElement('div', {
        style: { padding: '3rem', textAlign: 'center', color: theme.textSecondary, fontSize: '0.875rem' }
      },
        React.createElement('div', { style: { fontSize: '2rem', opacity: 0.2, marginBottom: '0.5rem' } }, '↗'),
        hasWorker
          ? 'Chart loads automatically — select a period above'
          : React.createElement('span', null,
              'Stocks, CS2 & commodities need a Worker URL in ',
              React.createElement('strong', null, '⚙ API Settings'),
              '. Crypto loads automatically.'
            )
      ),

      // ── VALUE CHART ──────────────────────────────────────────────────
      chartMode === 'value' && computed && !error && React.createElement('svg', {
        ref: svgRef, viewBox: `0 0 ${W} ${H}`, width: '100%',
        style: { display: 'block', overflow: 'visible', cursor: 'crosshair' },
        onMouseMove: handleMouseMove, onMouseLeave: () => setHoveredIdx(null)
      },
        React.createElement('defs', null,
          React.createElement('linearGradient', { id: 'portfolioGrad', x1:'0', y1:'0', x2:'0', y2:'1' },
            React.createElement('stop', { offset: '0%',   stopColor: lineColor, stopOpacity: 0.2 }),
            React.createElement('stop', { offset: '100%', stopColor: lineColor, stopOpacity: 0.01 })
          )
        ),
        ...computed.yLabels.map((yl,i) => React.createElement(React.Fragment, {key:i},
          React.createElement('line', { x1:PAD.l, y1:yl.y, x2:W-PAD.r, y2:yl.y, stroke:'rgba(255,255,255,0.05)', strokeWidth:1, strokeDasharray:'4,6' }),
          React.createElement('text', { x:PAD.l-8, y:yl.y+4, textAnchor:'end', fill:'rgba(255,255,255,0.25)', fontSize:10, fontFamily:'monospace' }, yl.label)
        )),
        ...computed.xLabels.map((xl,i) =>
          React.createElement('text', { key:i, x:xl.x, y:H-PAD.b+14, textAnchor:'middle', fill:'rgba(255,255,255,0.25)', fontSize:10 }, xl.label)
        ),
        React.createElement('polygon', { points: computed.area, fill: 'url(#portfolioGrad)' }),
        React.createElement('polyline', { points: computed.pts, fill:'none', stroke:lineColor, strokeWidth:2, strokeLinejoin:'round', strokeLinecap:'round' }),
        hovered && React.createElement(React.Fragment, null,
          React.createElement('line', { x1:computed.toX(hoveredIdx), y1:PAD.t, x2:computed.toX(hoveredIdx), y2:H-PAD.b, stroke:'rgba(255,255,255,0.12)', strokeWidth:1, strokeDasharray:'4,4' }),
          React.createElement('circle', { cx:computed.toX(hoveredIdx), cy:computed.toY(hovered.value), r:5, fill:lineColor, stroke:theme.card, strokeWidth:2 }),
          React.createElement('g', { transform:`translate(${Math.min(computed.toX(hoveredIdx)+10, W-135)},${Math.max(computed.toY(hovered.value)-34, PAD.t)})` },
            React.createElement('rect', { width:125, height:42, rx:7, fill:theme.card, stroke:lineColor, strokeWidth:1, opacity:0.97 }),
            React.createElement('text', { x:8, y:15, fill:theme.textSecondary, fontSize:9 }, hovered.date),
            React.createElement('text', { x:8, y:32, fill:lineColor, fontSize:12, fontWeight:700 }, `${formatPrice(hovered.value)} ${getCurrencySymbol()}`)
          )
        )
      ),

      // ── RETURN % CHART ────────────────────────────────────────────────
      chartMode === 'return' && computedReturn && !error && React.createElement('svg', {
        ref: svgRefReturn, viewBox: `0 0 ${W} ${H}`, width: '100%',
        style: { display: 'block', overflow: 'visible', cursor: 'crosshair' },
        onMouseMove: handleMouseMove, onMouseLeave: () => setHoveredIdx(null)
      },
        React.createElement('defs', null,
          React.createElement('linearGradient', { id: 'retGradGreen', x1:'0', y1:'0', x2:'0', y2:'1' },
            React.createElement('stop', { offset: '0%',   stopColor: '#22c55e', stopOpacity: 0.22 }),
            React.createElement('stop', { offset: '100%', stopColor: '#22c55e', stopOpacity: 0.01 })
          ),
          React.createElement('linearGradient', { id: 'retGradRed', x1:'0', y1:'0', x2:'0', y2:'1' },
            React.createElement('stop', { offset: '0%',   stopColor: '#ef4444', stopOpacity: 0.01 }),
            React.createElement('stop', { offset: '100%', stopColor: '#ef4444', stopOpacity: 0.22 })
          )
        ),
        // Y-axis grid + labels
        ...computedReturn.yLabels.map((yl,i) => React.createElement(React.Fragment, {key:i},
          React.createElement('line', {
            x1:PAD.l, y1:yl.y, x2:W-PAD.r, y2:yl.y,
            stroke: yl.isZero ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.05)',
            strokeWidth: yl.isZero ? 1.5 : 1,
            strokeDasharray: yl.isZero ? '0' : '4,6'
          }),
          React.createElement('text', { x:PAD.l-8, y:yl.y+4, textAnchor:'end',
            fill: yl.isZero ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.25)',
            fontSize: yl.isZero ? 11 : 10, fontFamily:'monospace',
            fontWeight: yl.isZero ? 'bold' : 'normal'
          }, yl.label)
        )),
        // Explicit 0% baseline label on right side too
        React.createElement('text', { x:W-PAD.r+6, y:computedReturn.y0+4, textAnchor:'start',
          fill:'rgba(255,255,255,0.4)', fontSize:10, fontFamily:'monospace' }, '0%'),
        // X labels
        ...computedReturn.xLabels.map((xl,i) =>
          React.createElement('text', { key:i, x:xl.x, y:H-PAD.b+14, textAnchor:'middle', fill:'rgba(255,255,255,0.25)', fontSize:10 }, xl.label)
        ),
        // Green area above 0%
        React.createElement('polygon', { points: computedReturn.areaAbove, fill: 'url(#retGradGreen)' }),
        // Red area below 0%
        React.createElement('polygon', { points: computedReturn.areaBelow, fill: 'url(#retGradRed)' }),
        // The line — colored green or red per segment
        React.createElement('polyline', { points: computedReturn.pts, fill:'none', stroke: computedReturn.lastR >= 0 ? '#22c55e' : '#ef4444', strokeWidth:2, strokeLinejoin:'round', strokeLinecap:'round' }),
        // Hover
        hovered && computedReturn.retVals[hoveredIdx] !== undefined && React.createElement(React.Fragment, null,
          React.createElement('line', { x1:computedReturn.toX(hoveredIdx), y1:PAD.t, x2:computedReturn.toX(hoveredIdx), y2:H-PAD.b, stroke:'rgba(255,255,255,0.12)', strokeWidth:1, strokeDasharray:'4,4' }),
          // Dot colored by whether positive or negative
          React.createElement('circle', {
            cx:computedReturn.toX(hoveredIdx), cy:computedReturn.toY(computedReturn.retVals[hoveredIdx]),
            r:5, fill: computedReturn.retVals[hoveredIdx] >= 0 ? '#22c55e' : '#ef4444', stroke:theme.card, strokeWidth:2
          }),
          // Tooltip
          React.createElement('g', { transform:`translate(${Math.min(computedReturn.toX(hoveredIdx)+10, W-140)},${Math.max(computedReturn.toY(computedReturn.retVals[hoveredIdx])-38, PAD.t)})` },
            React.createElement('rect', { width:132, height:48, rx:7, fill:theme.card,
              stroke: computedReturn.retVals[hoveredIdx] >= 0 ? '#22c55e' : '#ef4444', strokeWidth:1, opacity:0.97 }),
            React.createElement('text', { x:8, y:15, fill:theme.textSecondary, fontSize:9 }, hovered.date),
            React.createElement('text', { x:8, y:30, fill: computedReturn.retVals[hoveredIdx] >= 0 ? '#22c55e' : '#ef4444', fontSize:13, fontWeight:700 },
              `${computedReturn.retVals[hoveredIdx] >= 0 ? '+' : ''}${computedReturn.retVals[hoveredIdx].toFixed(2)}%`),
            React.createElement('text', { x:8, y:43, fill:theme.textSecondary, fontSize:9 },
              `${formatPrice(hovered.value)} ${getCurrencySymbol()}`)
          )
        )
      ),

      // Legend
      computed && !error && React.createElement('div', {
        style: { display:'flex', gap:'1.5rem', padding:'0.375rem 1.5rem 0.875rem', justifyContent:'flex-end', flexWrap:'wrap', alignItems:'center' }
      },
        chartMode === 'value'
          ? React.createElement('div', { style:{display:'flex',alignItems:'center',gap:'0.375rem',fontSize:'0.72rem',color:theme.textSecondary} },
              React.createElement('div', { style:{width:16,height:2,background:lineColor,borderRadius:1} }),
              `Period start: ${formatPrice(computed.firstV)} ${getCurrencySymbol()}`
            )
          : React.createElement(React.Fragment, null,
              React.createElement('div', { style:{display:'flex',alignItems:'center',gap:'0.375rem',fontSize:'0.72rem',color:'#22c55e'} },
                React.createElement('div', { style:{width:12,height:8,borderRadius:'2px',background:'rgba(34,197,94,0.25)',border:'1px solid #22c55e'} }),
                'Positive return'
              ),
              React.createElement('div', { style:{display:'flex',alignItems:'center',gap:'0.375rem',fontSize:'0.72rem',color:'#ef4444'} },
                React.createElement('div', { style:{width:12,height:8,borderRadius:'2px',background:'rgba(239,68,68,0.25)',border:'1px solid #ef4444'} }),
                'Negative return'
              ),
              React.createElement('div', { style:{fontSize:'0.72rem',color:'rgba(255,255,255,0.35)'} },
                '— 0% baseline'
              )
            ),
        !hasWorker && chartMode === 'value' && React.createElement('div', { style:{fontSize:'0.72rem',color:theme.accent,cursor:'pointer'} },
          '→ Add Worker URL for stocks & commodities'
        )
      )
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
window.MaerminFeatures6 = { PortfolioHistoryChart };

console.log('[OK] MAERMIN Features6 v9.0 — Yahoo Finance Historical Chart (1H/1D/1W/1M/1Y/3Y/5Y/Max)');

})();
