// ============================================================================
// MAERMIN v9.0 – Advanced Features
// 1. XIRR / Time-Weighted Return calculator
// 2. Rebalancing Tool
// 3. Broker Import Wizard UI
// 4. Mobile Responsive Nav
// 5. Position Notes / Trade Journal
// 6. Dividend Calendar
// ============================================================================
(function () {
'use strict';

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────

// Newton-Raphson XIRR (Money-Weighted Return)
function calcXIRR(cashflows) {
  // cashflows: [{date: 'YYYY-MM-DD', amount: number}]
  // amount < 0 = investment (outflow), amount > 0 = return (inflow)
  if (!cashflows || cashflows.length < 2) return null;
  const dates = cashflows.map(c => new Date(c.date));
  const t0 = dates[0];
  const years = dates.map(d => (d - t0) / (365.25 * 24 * 3600 * 1000));

  const npv = (rate) => cashflows.reduce((s, c, i) => s + c.amount / Math.pow(1 + rate, years[i]), 0);
  const dnpv = (rate) => cashflows.reduce((s, c, i) => s - years[i] * c.amount / Math.pow(1 + rate, years[i] + 1), 0);

  let rate = 0.1;
  for (let i = 0; i < 100; i++) {
    const f = npv(rate), df = dnpv(rate);
    if (Math.abs(f) < 1e-7) break;
    if (Math.abs(df) < 1e-10) break;
    rate -= f / df;
    if (rate < -0.9999) rate = -0.9999;
  }
  return isFinite(rate) ? rate : null;
}

// Simple TWR approximation from price history
function calcTWR(priceHistory, portfolio) {
  const allSymbols = [];
  ['crypto','stocks','skins','commodities'].forEach(cat => {
    (portfolio[cat] || []).forEach(pos => {
      allSymbols.push({ sym: (pos.symbol||pos.name||'').toLowerCase(), amount: pos.amount||1 });
    });
  });
  if (!allSymbols.length) return null;

  // Build timeline of combined portfolio value changes
  const tsMap = {};
  allSymbols.forEach(({ sym }) => {
    const hist = priceHistory[sym] || [];
    hist.forEach(({ timestamp, price }) => {
      if (!tsMap[timestamp]) tsMap[timestamp] = {};
      tsMap[timestamp][sym] = price;
    });
  });

  const ts = Object.keys(tsMap).sort();
  if (ts.length < 2) return null;

  const vals = ts.map(t => {
    return allSymbols.reduce((s, { sym, amount }) => {
      const p = tsMap[t][sym] || 0;
      return s + amount * p;
    }, 0);
  }).filter(v => v > 0);

  if (vals.length < 2) return null;
  return (vals[vals.length-1] / vals[0]) - 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. XIRR / TWR VIEW
// ─────────────────────────────────────────────────────────────────────────────
function ReturnsView({ transactions, portfolio, prices, priceHistory, theme, formatPrice, getCurrencySymbol, t }) {
  const xirrResult = useMemo(() => {
    if (!transactions.length) return null;
    // Build cashflows: buys = negative (outflow), sells = positive (inflow)
    const cfs = transactions.map(tx => ({
      date: tx.date,
      amount: tx.type === 'buy'
        ? -(tx.quantity * tx.price + (tx.fees || 0))
        :  (tx.quantity * tx.price - (tx.fees || 0))
    }));
    // Add current portfolio value as final positive cashflow (today)
    let currentValue = 0;
    ['crypto','stocks','skins','commodities'].forEach(cat => {
      (portfolio[cat] || []).forEach(pos => {
        const sym = (pos.symbol||pos.name||'').toLowerCase();
        const p = prices[sym] || prices[pos.symbol||''] || pos.purchasePrice || 0;
        currentValue += (pos.amount||1) * p;
      });
    });
    if (currentValue > 0) {
      cfs.push({ date: new Date().toISOString().split('T')[0], amount: currentValue });
    }
    return calcXIRR(cfs);
  }, [transactions, portfolio, prices]);

  const twrResult = useMemo(() => calcTWR(priceHistory, portfolio), [priceHistory, portfolio]);

  // Simple holding period stats
  const stats = useMemo(() => {
    if (!transactions.length) return null;
    const invested = transactions.filter(t=>t.type==='buy').reduce((s,t)=>s+t.quantity*t.price+(t.fees||0),0);
    const received = transactions.filter(t=>t.type==='sell').reduce((s,t)=>s+t.quantity*t.price-(t.fees||0),0);
    const totalFees = transactions.reduce((s,t)=>s+(t.fees||0),0);
    let currentValue = 0;
    ['crypto','stocks','skins','commodities'].forEach(cat => {
      (portfolio[cat] || []).forEach(pos => {
        const sym = (pos.symbol||pos.name||'').toLowerCase();
        const p = prices[sym] || prices[pos.symbol||''] || pos.purchasePrice || 0;
        currentValue += (pos.amount||1) * p;
      });
    });
    const totalReturn = currentValue + received - invested;
    const totalReturnPct = invested > 0 ? totalReturn / invested : 0;
    const dates = transactions.map(tx => new Date(tx.date)).sort((a,b)=>a-b);
    const holdingDays = dates.length > 0 ? Math.floor((new Date() - dates[0]) / (24*3600*1000)) : 0;
    return { invested, received, currentValue, totalReturn, totalReturnPct, totalFees, holdingDays };
  }, [transactions, portfolio, prices]);

  const card = (label, value, sub, color) =>
    React.createElement('div', {
      style: { background: theme.card, borderRadius: '12px', border: `1px solid ${theme.cardBorder}`, padding: '1.25rem' }
    },
      React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.8rem', marginBottom: '0.375rem', textTransform: 'uppercase', letterSpacing: '0.05em' } }, label),
      React.createElement('div', { style: { color: color || theme.text, fontSize: '1.75rem', fontWeight: '800', letterSpacing: '-0.02em' } }, value),
      sub && React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.8rem', marginTop: '0.25rem' } }, sub)
    );

  const fmtPct = v => v !== null ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%` : '—';
  const color  = v => v > 0 ? '#22c55e' : v < 0 ? '#ef4444' : theme.text;

  return React.createElement('div', { style: { padding: '1.5rem' } },
    React.createElement('h2', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '700', marginBottom: '0.5rem' } }, (t.returns || 'Return Analysis')),
    React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.875rem', marginBottom: '1.5rem', lineHeight: '1.6' } },
      t.returnsHint || 'XIRR (Money-Weighted Return) accounts for the timing and size of your cash flows. TWR shows portfolio performance independent of cash flows.'
    ),

    // Main KPIs
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '1rem', marginBottom: '1.5rem' } },
      card('XIRR (annualisiert)', xirrResult !== null ? fmtPct(xirrResult) : '—', 'Geldgewichtete Rendite p.a.', xirrResult !== null ? color(xirrResult) : theme.textSecondary),
      card('TWR', twrResult !== null ? fmtPct(twrResult) : '—', 'Zeitgewichtete Gesamtrendite', twrResult !== null ? color(twrResult) : theme.textSecondary),
      stats && card('Gesamtrendite', fmtPct(stats.totalReturnPct), `${formatPrice(stats.totalReturn)} ${getCurrencySymbol()}`, color(stats.totalReturnPct)),
      stats && card('Haltedauer', `${stats.holdingDays}d`, 'Seit erster Transaktion', theme.text)
    ),

    stats && React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '1rem', marginBottom: '1.5rem' } },
      card('Investiert', `${formatPrice(stats.invested)} ${getCurrencySymbol()}`, 'Gesamt eingezahlt', theme.text),
      card('Aktueller Wert', `${formatPrice(stats.currentValue)} ${getCurrencySymbol()}`, 'Offene Positionen', theme.text),
      card('Realisiert', `${formatPrice(stats.received)} ${getCurrencySymbol()}`, 'Aus Verkäufen', theme.text),
      card('Gesamtgebühren', `${formatPrice(stats.totalFees)} ${getCurrencySymbol()}`, 'Alle Transaktionen', '#ef4444')
    ),

    // Explanation
    React.createElement('div', {
      style: { background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '10px', padding: '1rem', fontSize: '0.8rem', color: theme.textSecondary, lineHeight: '1.7' }
    },
      React.createElement('strong', { style: { color: theme.text } }, 'Hinweis: '),
      'TWR und XIRR benötigen Preis-History-Daten. Klicke auf "Preise aktualisieren" mehrmals über mehrere Tage, um aussagekräftige Daten zu sammeln. XIRR benötigt mindestens einen Kauf und den aktuellen Portfoliowert.'
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. REBALANCING TOOL
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_TARGETS = { crypto: 35, stocks: 45, skins: 10, commodities: 10 };

function RebalancingView({ portfolio, prices, theme, formatPrice, getCurrencySymbol, t }) {
  const [targets, setTargets] = useState(() => {
    try { return JSON.parse(localStorage.getItem('maermin_targets') || JSON.stringify(DEFAULT_TARGETS)); }
    catch { return DEFAULT_TARGETS; }
  });
  const [investAmount, setInvestAmount] = useState('');

  useEffect(() => {
    localStorage.setItem('maermin_targets', JSON.stringify(targets));
  }, [targets]);

  const totalTarget = Object.values(targets).reduce((s, v) => s + v, 0);

  const positions = useMemo(() => {
    const result = {};
    ['crypto','stocks','skins','commodities'].forEach(cat => {
      let value = 0;
      (portfolio[cat] || []).forEach(pos => {
        const sym = (pos.symbol||pos.name||'').toLowerCase();
        const p = prices[sym] || prices[pos.symbol||''] || pos.purchasePrice || 0;
        value += (pos.amount||1) * p;
      });
      result[cat] = value;
    });
    return result;
  }, [portfolio, prices]);

  const totalValue = Object.values(positions).reduce((s, v) => s + v, 0);
  const invest = parseFloat(investAmount) || 0;
  const grandTotal = totalValue + invest;

  const catColors = { crypto: '#f59e0b', stocks: '#3b82f6', skins: '#06b6d4', commodities: '#d97706' };
  const catLabels = { crypto: 'Crypto', stocks: 'Stocks', skins: 'CS2 Skins', commodities: 'Commodities' };

  const rows = ['crypto','stocks','skins','commodities'].map(cat => {
    const current = positions[cat] || 0;
    const currentPct = totalValue > 0 ? (current / totalValue) * 100 : 0;
    const targetPct = targets[cat] || 0;
    const targetValue = grandTotal * targetPct / 100;
    const delta = targetValue - current;
    return { cat, current, currentPct, targetPct, targetValue, delta };
  });

  // V7: the AI copilot explains the drift/targets this view already computed.
  const aiCtx = {
    title: t.rebalancing || 'Rebalancing',
    data: {
      portfolioValue: Math.round(totalValue),
      plannedInvestment: Math.round(invest),
      allocations: rows.filter(r => r.targetPct > 0 || r.current > 0).map(r => ({
        class: r.cat,
        currentPct: +r.currentPct.toFixed(1),
        targetPct: r.targetPct,
        driftPct: +(r.currentPct - r.targetPct).toFixed(1),
        actionAmount: Math.round(r.delta),
      })),
    },
  };

  return React.createElement('div', { style: { padding: '1.5rem' } },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' } },
      React.createElement('h2', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '700', margin: 0 } }, (t.rebalancing || 'Rebalancing')),
      window.AICopilot ? React.createElement(window.AICopilot.Button, { theme: theme, t: t, context: aiCtx }) : null),

    // Target allocation sliders
    React.createElement('div', {
      style: { background: theme.card, borderRadius: '12px', border: `1px solid ${theme.cardBorder}`, padding: '1.5rem', marginBottom: '1rem' }
    },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' } },
        React.createElement('span', { style: { color: theme.text, fontWeight: '700' } }, t.targetAllocation || 'Ziel-Allokation'),
        React.createElement('span', {
          style: { fontSize: '0.8rem', color: totalTarget === 100 ? '#22c55e' : '#ef4444', fontWeight: '600' }
        }, `${totalTarget}% ${totalTarget === 100 ? '✓' : '≠ 100%'}`)
      ),
      ['crypto','stocks','skins','commodities'].map(cat =>
        React.createElement('div', { key: cat, style: { marginBottom: '1rem' } },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '0.375rem' } },
            React.createElement('span', { style: { color: catColors[cat], fontWeight: '600', fontSize: '0.875rem' } }, catLabels[cat]),
            React.createElement('span', { style: { color: theme.text, fontWeight: '700' } }, `${targets[cat]}%`)
          ),
          React.createElement('input', {
            type: 'range', min: 0, max: 100, value: targets[cat],
            onChange: e => setTargets(prev => ({ ...prev, [cat]: parseInt(e.target.value) })),
            style: { width: '100%', accentColor: catColors[cat] }
          })
        )
      ),

      // Invest additional amount
      React.createElement('div', { style: { marginTop: '1rem', paddingTop: '1rem', borderTop: `1px solid ${theme.cardBorder}` } },
        React.createElement('label', { style: { color: theme.textSecondary, fontSize: '0.8rem', display: 'block', marginBottom: '0.375rem' } },
          t.additionalInvestment || 'Zusätzlicher Betrag (optional)'
        ),
        React.createElement('input', {
          type: 'number', value: investAmount,
          onChange: e => setInvestAmount(e.target.value),
          placeholder: '0.00',
          style: { width: '200px', padding: '0.5rem 0.75rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.875rem' }
        })
      )
    ),

    // Results table
    totalValue > 0 && React.createElement('div', {
      style: { background: theme.card, borderRadius: '12px', border: `1px solid ${theme.cardBorder}`, overflow: 'hidden' }
    },
      React.createElement('div', { style: { padding: '1rem 1.25rem', borderBottom: `1px solid ${theme.cardBorder}` } },
        React.createElement('span', { style: { color: theme.text, fontWeight: '700', fontSize: '0.9rem' } }, t.rebalancingPlan || 'Rebalancing-Plan')
      ),
      React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse' } },
        React.createElement('thead', null,
          React.createElement('tr', null,
            ['Kategorie','Aktuell','Aktuell %','Ziel %','Zielwert','Aktion'].map((h, i) =>
              React.createElement('th', {
                key: i,
                style: { padding: '0.75rem 1rem', textAlign: i === 0 ? 'left' : 'right', color: theme.textSecondary, borderBottom: `1px solid ${theme.cardBorder}`, fontSize: '0.75rem', fontWeight: '600', textTransform: 'uppercase' }
              }, h)
            )
          )
        ),
        React.createElement('tbody', null,
          rows.map(row =>
            React.createElement('tr', { key: row.cat },
              React.createElement('td', { style: { padding: '1rem', fontWeight: '700', color: catColors[row.cat] } }, catLabels[row.cat]),
              React.createElement('td', { style: { padding: '1rem', color: theme.text, textAlign: 'right' } }, `${formatPrice(row.current)} ${getCurrencySymbol()}`),
              React.createElement('td', { style: { padding: '1rem', textAlign: 'right' } },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.5rem' } },
                  React.createElement('div', { style: { width: 40, height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' } },
                    React.createElement('div', { style: { height: '100%', width: `${Math.min(100,row.currentPct)}%`, background: catColors[row.cat], borderRadius: 2 } })
                  ),
                  React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.875rem', minWidth: '3rem', textAlign: 'right' } }, `${row.currentPct.toFixed(1)}%`)
                )
              ),
              React.createElement('td', { style: { padding: '1rem', color: theme.text, textAlign: 'right', fontWeight: '600' } }, `${row.targetPct}%`),
              React.createElement('td', { style: { padding: '1rem', color: theme.text, textAlign: 'right' } }, `${formatPrice(row.targetValue)} ${getCurrencySymbol()}`),
              React.createElement('td', { style: { padding: '1rem', textAlign: 'right' } },
                React.createElement('span', {
                  style: {
                    padding: '0.25rem 0.75rem', borderRadius: '6px', fontWeight: '700', fontSize: '0.8rem', whiteSpace: 'nowrap',
                    background: Math.abs(row.delta) < 1 ? 'rgba(34,197,94,0.1)' : row.delta > 0 ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                    color: Math.abs(row.delta) < 1 ? '#22c55e' : row.delta > 0 ? '#22c55e' : '#ef4444'
                  }
                }, Math.abs(row.delta) < 1 ? '✓ Im Gleichgewicht' : `${row.delta > 0 ? '+ Kaufen' : '− Verkaufen'} ${formatPrice(Math.abs(row.delta))} ${getCurrencySymbol()}`)
              )
            )
          )
        )
      )
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPORT PARSERS
// ─────────────────────────────────────────────────────────────────────────────

// Parse any CSV text → array of rows (objects keyed by header)
function parseCSVToRows(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  // Detect delimiter: semicolon or comma
  const delim = lines[0].split(';').length > lines[0].split(',').length ? ';' : ',';
  const parseRow = (line) => {
    const cols = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; continue; }
      if (c === delim && !inQ) { cols.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    cols.push(cur.trim());
    return cols;
  };
  const headers = parseRow(lines[0]).map(h => h.replace(/^"/, '').replace(/"$/, '').trim());
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = parseRow(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = (vals[i] || '').replace(/^"/, '').replace(/"$/, '').trim(); });
    return row;
  });
}

// Parse amount string: "1.234,56" or "1,234.56" or "1234.56" → number
function parseAmount(str) {
  if (!str) return 0;
  const s = String(str).replace(/[^0-9.,\-]/g, '');
  // If both . and , present: determine which is decimal separator
  if (s.includes(',') && s.includes('.')) {
    const lastComma = s.lastIndexOf(',');
    const lastDot   = s.lastIndexOf('.');
    // Whichever comes last is the decimal separator
    if (lastComma > lastDot) return parseFloat(s.replace(/\./g, '').replace(',', '.'));
    else return parseFloat(s.replace(/,/g, ''));
  }
  // Only comma → likely European decimal
  if (s.includes(',') && !s.includes('.')) return parseFloat(s.replace(',', '.'));
  return parseFloat(s) || 0;
}

// ── CoinTracking CSV Parser ──────────────────────────────────────────────────
// CoinTracking exports use shortened headers ("Buy" not "Buy Amount") and
// duplicate "Cur." headers — so we parse by COLUMN POSITION, not header name.
//
// Fixed column layout (EN + DE export):
//   0: Type / Typ
//   1: Buy amount / Kauf
//   2: Buy currency (first "Cur.")
//   3: Sell amount / Verkauf
//   4: Sell currency (second "Cur.")
//   5: Fee / Gebühr
//   6: Fee currency (third "Cur.")
//   7: Exchange / Börse
//   8: Group / Gruppe
//   9: Comment / Kommentar
//  10: Date / Datum
//
function parseCoinTracking(text) {
  // Strip BOM and normalize line endings
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines  = clean.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  // Detect delimiter
  const firstLine = lines[0];
  const delim = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';

  // CSV row parser (handles quoted fields)
  const parseRow = (line) => {
    const cols = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; continue; }
      if (c === delim && !inQ) { cols.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    cols.push(cur.trim());
    return cols;
  };

  const headerCols = parseRow(firstLine);
  const col0 = (headerCols[0] || '').toLowerCase();

  // Must look like a CoinTracking file — col 0 is "type" or "typ"
  if (col0 !== 'type' && col0 !== 'typ') return null;

  // Parse date: "DD.MM.YYYY HH:MM:SS" or "YYYY-MM-DD HH:MM:SS"
  const parseDate = (raw) => {
    const s = (raw || '').trim();
    if (/^\d{2}\.\d{2}\.\d{4}/.test(s)) {
      const [d, m, rest] = s.split('.');
      const y = rest.split(' ')[0];
      return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.split(' ')[0];
    return new Date().toISOString().split('T')[0];
  };

  // Type normalization — map DE + EN + extra types to canonical
  const normalizeType = (raw) => {
    const t = (raw || '').toLowerCase().trim();
    if (['trade','handel'].includes(t))                                        return 'trade';
    if (['deposit','einzahlung','income','einkommen','mining',
         'reward','gift/tip','geschenk','airdrop','staking'].includes(t))      return 'deposit';
    if (['withdrawal','auszahlung','spend','ausgabe',
         'donation','spende','lost','stolen'].includes(t))                     return 'withdrawal';
    // German Futures/extra types → skip (not portfolio transactions)
    return 'skip';
  };

  const transactions = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseRow(lines[i]);
    if (cols.length < 5) continue;

    try {
      const type    = normalizeType(cols[0]);
      const buyAmt  = parseAmount(cols[1] || '');
      const buyCur  = (cols[2] || '').trim().toUpperCase();
      const sellAmt = parseAmount(cols[3] || '');
      const sellCur = (cols[4] || '').trim().toUpperCase();
      const fee     = parseAmount(cols[5] || '');
      const exch    = (cols[7] || '').trim();
      const comment = (cols[9] || '').trim();
      const date    = parseDate(cols[10] || '');

      if (type === 'trade') {
        // Buy leg (what we received)
        if (buyCur && buyAmt > 0 && !isStablecoin(buyCur)) {
          const price = sellAmt > 0 && buyAmt > 0 ? sellAmt / buyAmt : 0;
          transactions.push({
            type: 'buy', symbol: buyCur, quantity: buyAmt, price,
            fees: fee, date, category: isCrypto(buyCur) ? 'crypto' : 'stocks',
            notes: [exch, comment].filter(Boolean).join(' · ') || 'CoinTracking'
          });
        }
        // Sell leg (what we paid with — only if it's a real asset, not stablecoin)
        if (sellCur && sellAmt > 0 && !isStablecoin(sellCur)) {
          const price = buyAmt > 0 && sellAmt > 0 ? buyAmt / sellAmt : 0;
          transactions.push({
            type: 'sell', symbol: sellCur, quantity: sellAmt, price,
            fees: 0, date, category: isCrypto(sellCur) ? 'crypto' : 'stocks',
            notes: [exch, comment].filter(Boolean).join(' · ') || 'CoinTracking'
          });
        }

      } else if (type === 'deposit') {
        if (buyCur && buyAmt > 0 && !isStablecoin(buyCur)) {
          transactions.push({
            type: 'buy', symbol: buyCur, quantity: buyAmt, price: 0,
            fees: fee, date, category: isCrypto(buyCur) ? 'crypto' : 'stocks',
            notes: [(cols[0]||'').trim(), comment].filter(Boolean).join(' · ')
          });
        }

      } else if (type === 'withdrawal') {
        if (sellCur && sellAmt > 0 && !isStablecoin(sellCur)) {
          transactions.push({
            type: 'sell', symbol: sellCur, quantity: sellAmt, price: 0,
            fees: fee, date, category: isCrypto(sellCur) ? 'crypto' : 'stocks',
            notes: [(cols[0]||'').trim(), comment].filter(Boolean).join(' · ')
          });
        }
      }
      // type === 'skip' → Futures losses, fees, other non-portfolio rows

    } catch(e) {
      console.warn('[IMPORT] CoinTracking row', i, 'skipped:', e.message);
    }
  }

  return transactions;
}

// Helper: is this symbol a crypto vs stock ticker?
function isCrypto(symbol) {
  // Stablecoins and common crypto — anything without a dot is likely crypto
  // Stocks often come as "AAPL" but also without dot on some exchanges
  // We keep it simple: known crypto list + anything that looks like a hash/long symbol
  const CRYPTO_SYMBOLS = new Set([
    'BTC','ETH','BNB','SOL','XRP','ADA','DOGE','AVAX','DOT','SHIB','MATIC','LTC',
    'LINK','UNI','ATOM','XLM','ALGO','VET','ICP','FIL','EGLD','THETA','EOS','TRX',
    'XMR','NEO','DASH','ZEC','BCH','ETC','AAVE','COMP','MKR','SNX','CRV','YFI',
    'SUSHI','1INCH','BAL','REN','KNC','ZRX','BAT','GRT','ENJ','MANA','SAND','AXS',
    'CHZ','GALA','IMX','APE','LRC','DYDX','OP','ARB','PEPE','WLD','SUI','SEI',
    'USDT','USDC','BUSD','DAI','TUSD','USDP','FDUSD','UST','FRAX',
  ]);
  return CRYPTO_SYMBOLS.has(symbol.toUpperCase()) || symbol.length > 5;
}

function isStablecoin(symbol) {
  return ['USDT','USDC','BUSD','DAI','TUSD','USDP','FDUSD','UST','FRAX','EUR','USD','GBP','CHF'].includes(symbol.toUpperCase());
}

// ── Broker parsers entry point ───────────────────────────────────────────────
function parseByBroker(text, brokerId) {
  if (brokerId === 'cointracking') return parseCoinTracking(text);
  // For other brokers, fall through to ImportExportEngine
  const engine = window.ImportExportEngine;
  if (!engine) return [];
  try {
    const result = engine.importData(text, 'csv', { broker: brokerId });
    return result?.transactions || [];
  } catch { return []; }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. BROKER IMPORT WIZARD
// ─────────────────────────────────────────────────────────────────────────────

// Inline SVG/PNG data-URIs der Broker-Logos — keine externe Abhängigkeit
const BROKER_LOGOS = {
  cointracking: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="#1a73e8"/><text x="50" y="68" font-size="52" font-weight="900" font-family="Arial,sans-serif" fill="white" text-anchor="middle">CT</text></svg>`,
  getquin:      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="#00c805"/><text x="50" y="68" font-size="52" font-weight="900" font-family="Arial,sans-serif" fill="white" text-anchor="middle">gq</text></svg>`,
  degiro:       `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="#ff6600"/><text x="50" y="68" font-size="42" font-weight="900" font-family="Arial,sans-serif" fill="white" text-anchor="middle">DE</text></svg>`,
  tradeRepublic:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="#111"/><text x="50" y="68" font-size="52" font-weight="900" font-family="Arial,sans-serif" fill="white" text-anchor="middle">TR</text></svg>`,
  interactiveBrokers:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="#d40000"/><text x="50" y="68" font-size="52" font-weight="900" font-family="Arial,sans-serif" fill="white" text-anchor="middle">IB</text></svg>`,
  coinbase:     `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="#0052ff"/><circle cx="50" cy="50" r="28" fill="white"/><circle cx="50" cy="50" r="18" fill="#0052ff"/></svg>`,
  binance:      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="#f0b90b"/><text x="50" y="68" font-size="46" font-weight="900" font-family="Arial,sans-serif" fill="#111" text-anchor="middle">BNB</text></svg>`,
  kraken:       `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="#5741d9"/><text x="50" y="68" font-size="46" font-weight="900" font-family="Arial,sans-serif" fill="white" text-anchor="middle">KRK</text></svg>`,
  generic:      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="18" fill="#334155"/><text x="50" y="65" font-size="42" font-family="Arial,sans-serif" fill="#94a3b8" text-anchor="middle">CSV</text></svg>`,
};

function svgToDataUri(svg) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function BrokerLogo({ brokerId, name, size = 36 }) {
  const svg = BROKER_LOGOS[brokerId];
  if (!svg) {
    return React.createElement('div', {
      style: {
        width: size, height: size, borderRadius: '8px', flexShrink: 0,
        background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: Math.round(size * 0.42) + 'px', fontWeight: '800', color: '#8b5cf6',
      }
    }, (name || '?')[0].toUpperCase());
  }
  return React.createElement('img', {
    src: svgToDataUri(svg),
    alt: name,
    style: { width: size, height: size, borderRadius: '8px', flexShrink: 0, display: 'block' }
  });
}

const BROKERS = [
  { id: 'cointracking',       name: 'CoinTracking',        hint: 'CSV Full Export',              category: 'Portfolio Tracker' },
  { id: 'getquin',            name: 'getquin',              hint: 'Kein CSV-Export möglich',      category: 'Portfolio Tracker', noExport: true },
  { id: 'degiro',             name: 'DEGIRO',               hint: 'Transaktionen.csv',            category: 'Broker' },
  { id: 'tradeRepublic',      name: 'Trade Republic',       hint: 'Transaktionshistorie CSV',     category: 'Broker' },
  { id: 'scalable',           name: 'Scalable Capital',     hint: 'Transaktionsreport CSV',       category: 'Broker' },
  { id: 'interactiveBrokers', name: 'Interactive Brokers',  hint: 'Activity Statement CSV',       category: 'Broker' },
  { id: 'coinbase',           name: 'Coinbase',             hint: 'Standard CSV-Export',          category: 'Krypto' },
  { id: 'binance',            name: 'Binance',              hint: 'Trade History CSV',            category: 'Krypto' },
  { id: 'kraken',             name: 'Kraken',               hint: 'Ledger CSV',                   category: 'Krypto' },
  { id: 'generic',            name: 'Andere / Manuell',     hint: 'MAERMIN Standard CSV / JSON',  category: 'Andere' },
];

function BrokerImportWizard({ theme, t, addToast, onImport }) {
  const [step, setStep]             = useState(0);
  const [selectedBroker, setBroker] = useState(null);
  const [rawData, setRawData]       = useState('');
  const [parsed, setParsed]         = useState([]);
  const [fileName, setFileName]     = useState('');
  const [apiCreds, setApiCreds]     = useState({});
  const [apiProxy, setApiProxy]     = useState(() => (window.BrokerConnectors ? window.BrokerConnectors.getProxy() : ''));
  const [apiBusy, setApiBusy]       = useState(false);
  const fileRef = useRef();

  const selectedBrokerObj = BROKERS.find(b => b.id === selectedBroker);
  const apiConn = window.BrokerConnectors ? window.BrokerConnectors.get(selectedBroker) : null;
  const apiSupported = !!(apiConn && apiConn.api);

  const handleFile = (file) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = e => { setRawData(e.target.result); setStep(2); };
    reader.readAsText(file, 'UTF-8');
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  useEffect(() => {
    if (!rawData || !selectedBroker || selectedBroker === 'getquin') return;
    try {
      const txs = parseByBroker(rawData, selectedBroker);
      if (Array.isArray(txs) && txs.length > 0) {
        setParsed(txs);
      } else {
        addToast && addToast('Keine Transaktionen erkannt — falsches Format?', 'warning');
      }
    } catch(e) {
      console.error('[IMPORT] Parse error:', e);
      addToast && addToast('Parsing-Fehler: ' + e.message, 'error');
    }
  }, [rawData, selectedBroker]);

  const doImport = () => {
    if (!parsed.length) return;
    onImport && onImport(parsed);
    setStep(3);
    addToast && addToast(`${parsed.length} Transaktionen importiert`, 'success');
  };

  const reset = () => { setStep(0); setBroker(null); setRawData(''); setParsed([]); setFileName(''); setApiCreds({}); };

  // API sync: pull trades straight from the exchange via window.BrokerConnectors
  // and feed them into the SAME preview/import flow the CSV path uses.
  const handleApiSync = async () => {
    const BC = window.BrokerConnectors;
    if (!BC) { addToast && addToast('Broker-Connectors nicht geladen', 'error'); return; }
    BC.setProxy(apiProxy);
    setApiBusy(true);
    try {
      const txs = await BC.fetchTransactions(selectedBroker, apiCreds);
      if (!txs.length) addToast && addToast('Keine Trades über die API gefunden', 'warning');
      setParsed(txs);
      setFileName((selectedBrokerObj ? selectedBrokerObj.name : 'Exchange') + ' API');
      setStep(2);
    } catch (e) {
      addToast && addToast('API-Sync fehlgeschlagen: ' + (e && e.message || e), 'error');
    } finally { setApiBusy(false); }
  };

  const btn = (label, onClick, primary=false, disabled=false) =>
    React.createElement('button', {
      onClick, disabled,
      style: {
        padding: '0.625rem 1.25rem', border: 'none', borderRadius: '8px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontWeight: '600', fontSize: '0.875rem', opacity: disabled ? 0.5 : 1,
        background: primary ? theme.accent : theme.inputBg,
        color: primary ? '#fff' : theme.text
      }
    }, label);

  const steps = ['Quelle wählen', 'Datei laden', 'Vorschau', 'Fertig'];

  // Group brokers by category
  const categories = [...new Set(BROKERS.map(b => b.category))];

  return React.createElement('div', { style: { padding: '1.5rem' } },
    React.createElement('h2', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '700', marginBottom: '1.25rem' } },
      (t.brokerImport || 'Import')
    ),

    // Step indicator
    React.createElement('div', { style: { display: 'flex', gap: '0', marginBottom: '2rem', borderRadius: '10px', overflow: 'hidden', border: `1px solid ${theme.cardBorder}` } },
      steps.map((s, i) =>
        React.createElement('div', { key: i, style: {
          flex: 1, padding: '0.625rem', textAlign: 'center', fontSize: '0.8rem',
          fontWeight: i === step ? '700' : '400',
          background: i === step ? theme.accent : i < step ? 'rgba(139,92,246,0.15)' : theme.card,
          color: i === step ? '#fff' : i < step ? theme.accent : theme.textSecondary,
          borderRight: i < steps.length-1 ? `1px solid ${theme.cardBorder}` : 'none'
        } }, `${i < step ? '✓ ' : ''}${s}`)
      )
    ),

    // ── Step 0: Source select ────────────────────────────────────────────────
    step === 0 && React.createElement('div', null,
      categories.map(cat =>
        React.createElement('div', { key: cat, style: { marginBottom: '1.25rem' } },
          React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.68rem', fontWeight: '700', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '0.5rem', paddingLeft: '0.25rem' } }, cat),
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: '0.625rem' } },
            BROKERS.filter(b => b.category === cat).map(b =>
              React.createElement('div', {
                key: b.id,
                onClick: () => { setBroker(b.id); setStep(1); },
                style: {
                  background: selectedBroker === b.id ? `${theme.accent}22` : theme.card,
                  border: `1px solid ${selectedBroker === b.id ? theme.accent : theme.cardBorder}`,
                  borderRadius: '10px', padding: '0.875rem', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '0.75rem', transition: 'all 0.15s',
                  opacity: b.noExport ? 0.75 : 1
                }
              },
                React.createElement(BrokerLogo, { brokerId: b.id, name: b.name, size: 36 }),
                React.createElement('div', null,
                  React.createElement('div', { style: { color: theme.text, fontWeight: '600', fontSize: '0.875rem' } }, b.name),
                  React.createElement('div', { style: { color: b.noExport ? theme.warning : theme.textSecondary, fontSize: '0.7rem', marginTop: '0.125rem' } }, b.hint)
                )
              )
            )
          )
        )
      )
    ),

    // ── Step 1: getquin info OR file upload ──────────────────────────────────
    step === 1 && selectedBroker === 'getquin' && React.createElement('div', null,
      React.createElement('div', {
        style: { background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '12px', padding: '1.5rem', marginBottom: '1.5rem' }
      },
        
        React.createElement('h3', { style: { color: theme.text, fontWeight: '700', marginBottom: '0.75rem' } }, 'getquin hat keinen CSV-Export'),
        React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.875rem', lineHeight: '1.7', marginBottom: '1rem' } },
          'getquin erlaubt es nicht, deine Transaktionen zu exportieren. Sobald die Daten dort sind, sind sie "eingesperrt" — das ist eine bewusste Design-Entscheidung der App.'
        ),
        React.createElement('div', { style: { color: theme.text, fontSize: '0.875rem', fontWeight: '600', marginBottom: '0.5rem' } }, 'Deine Optionen:'),
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.8rem', lineHeight: '2' } },
          React.createElement('div', null, '① Transaktionen manuell in MAERMIN eingeben (+ Symbol-Taste, oder Transaktion hinzufügen)'),
          React.createElement('div', null, '② Originalen Broker-CSV exportieren und hier importieren (z.B. DEGIRO, Trade Republic, Coinbase)'),
          React.createElement('div', null, '③ Screenshot deiner getquin-Positionen machen und manuell übertragen')
        )
      ),
      React.createElement('div', { style: { display: 'flex', gap: '0.5rem' } },
        btn('← Zurück', reset),
        btn('Manuell hinzufügen', () => { addToast && addToast('Nutze "+ Transaktion" um Positionen manuell einzugeben', 'info'); reset(); })
      )
    ),

    // ── Step 1: CoinTracking info + file upload ──────────────────────────────
    step === 1 && selectedBroker === 'cointracking' && React.createElement('div', null,
      React.createElement('div', {
        style: { background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '10px', padding: '1rem', marginBottom: '1rem', fontSize: '0.8rem', color: theme.textSecondary, lineHeight: '1.8' }
      },
        React.createElement('div', { style: { color: theme.text, fontWeight: '700', marginBottom: '0.375rem' } }, 'CoinTracking Export-Anleitung:'),
        React.createElement('div', null, '1. In CoinTracking: ', React.createElement('b', { style: { color: theme.text } }, 'Berichte → Alle Transaktionen')),
        React.createElement('div', null, '2. Oben rechts: ', React.createElement('b', { style: { color: theme.text } }, '"Export" → "CSV (Full Export)"')),
        React.createElement('div', null, '3. Die heruntergeladene Datei hier hochladen'),
        React.createElement('div', { style: { marginTop: '0.5rem', color: theme.accent, fontSize: '0.75rem' } }, '✓ Unterstützte Typen: Trade, Deposit, Withdrawal, Income, Mining, Gift/Tip, Spend')
      ),
      React.createElement('div', {
        onDrop: handleDrop, onDragOver: e => e.preventDefault(),
        onClick: () => fileRef.current?.click(),
        style: { border: `2px dashed ${theme.cardBorder}`, borderRadius: '12px', padding: '2.5rem', textAlign: 'center', cursor: 'pointer', marginBottom: '1rem' }
      },
        React.createElement('div', { style: { fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.4 } }, '↑'),
        React.createElement('div', { style: { color: theme.text, fontWeight: '600', marginBottom: '0.25rem' } }, 'CoinTracking CSV hier ablegen'),
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.8rem' } }, 'oder klicken zum Auswählen'),
        React.createElement('input', { type: 'file', accept: '.csv,.txt', ref: fileRef, style: { display: 'none' }, onChange: e => handleFile(e.target.files[0]) })
      ),
      React.createElement('div', { style: { display: 'flex', gap: '0.5rem' } },
        btn('← Zurück', () => setStep(0))
      )
    ),

    // ── Step 1: Generic file upload ──────────────────────────────────────────
    step === 1 && selectedBroker !== 'getquin' && selectedBroker !== 'cointracking' && React.createElement('div', null,
      // API sync (read-only) for exchanges that expose a signed REST API.
      apiSupported && React.createElement('div', {
        style: { background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: '12px', padding: '1.25rem', marginBottom: '1.25rem' }
      },
        React.createElement('div', { style: { color: theme.text, fontWeight: '700', marginBottom: '0.35rem' } }, '⚡ ' + (selectedBrokerObj ? selectedBrokerObj.name : '') + ' API-Sync'),
        React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.78rem', lineHeight: '1.6', marginBottom: '0.9rem' } },
          'Read-only API-Schlüssel verwenden (keine Trade-/Withdraw-Rechte). Der Secret-Key wird lokal zum Signieren genutzt und niemals übertragen — nur die fertige Signatur geht ggf. über deinen Proxy.'),
        apiConn.fields.map(f =>
          React.createElement('div', { key: f.key, style: { marginBottom: '0.6rem' } },
            React.createElement('label', { style: { display: 'block', color: theme.textSecondary, fontSize: '0.72rem', marginBottom: '0.25rem' } }, f.label),
            React.createElement('input', {
              type: f.secret ? 'password' : 'text',
              value: apiCreds[f.key] || '',
              placeholder: f.placeholder || '',
              autoComplete: 'off',
              onChange: e => { const v = e.target.value; setApiCreds(prev => Object.assign({}, prev, { [f.key]: v })); },
              style: { width: '100%', boxSizing: 'border-box', padding: '0.55rem 0.7rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.85rem' }
            })
          )
        ),
        React.createElement('div', { style: { marginBottom: '0.6rem' } },
          React.createElement('label', { style: { display: 'block', color: theme.textSecondary, fontSize: '0.72rem', marginBottom: '0.25rem' } }, 'Proxy-URL (optional, gegen CORS im Browser)'),
          React.createElement('input', {
            type: 'text', value: apiProxy, placeholder: 'https://your-worker.workers.dev', autoComplete: 'off',
            onChange: e => setApiProxy(e.target.value),
            style: { width: '100%', boxSizing: 'border-box', padding: '0.55rem 0.7rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.85rem' }
          })
        ),
        React.createElement('button', {
          onClick: handleApiSync, disabled: apiBusy || !apiCreds.key || !apiCreds.secret,
          style: { padding: '0.6rem 1.2rem', border: 'none', borderRadius: '8px', cursor: (apiBusy || !apiCreds.key || !apiCreds.secret) ? 'not-allowed' : 'pointer', fontWeight: '600', fontSize: '0.85rem', opacity: (apiBusy || !apiCreds.key || !apiCreds.secret) ? 0.5 : 1, background: theme.accent, color: '#fff' }
        }, apiBusy ? '◎ Synchronisiere…' : '⚡ Über API synchronisieren'),
        React.createElement('div', { style: { textAlign: 'center', color: theme.textSecondary, fontSize: '0.72rem', margin: '0.9rem 0 0' } }, '— oder CSV importieren —')
      ),
      React.createElement('div', {
        onDrop: handleDrop, onDragOver: e => e.preventDefault(),
        onClick: () => fileRef.current?.click(),
        style: { border: `2px dashed ${theme.cardBorder}`, borderRadius: '12px', padding: '3rem', textAlign: 'center', cursor: 'pointer', marginBottom: '1rem' }
      },
        React.createElement('div', { style: { fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.4 } }, '↑'),
        React.createElement('div', { style: { color: theme.text, fontWeight: '600', marginBottom: '0.25rem' } }, 'CSV-Datei hierher ziehen'),
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.875rem' } }, `Oder klicken · ${selectedBrokerObj?.name || ''} · ${selectedBrokerObj?.hint || ''}`),
        React.createElement('input', { type: 'file', accept: '.csv,.txt,.json', ref: fileRef, style: { display: 'none' }, onChange: e => handleFile(e.target.files[0]) })
      ),
      React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.8rem', lineHeight: '1.6' } }, 'Alle Daten bleiben lokal. Nichts wird hochgeladen.'),
      React.createElement('div', { style: { display: 'flex', gap: '0.5rem', marginTop: '1rem' } },
        btn('← Zurück', () => setStep(0)),
        btn('Text einfügen', () => { setRawData(' '); setStep(2); })
      )
    ),

    // ── Step 2: Preview ──────────────────────────────────────────────────────
    step === 2 && React.createElement('div', null,
      fileName && React.createElement('div', { style: { marginBottom: '1rem', color: theme.textSecondary, fontSize: '0.875rem' } }, `${fileName}`),
      parsed.length === 0 && React.createElement('div', null,
        React.createElement('p', { style: { color: theme.warning, marginBottom: '1rem' } }, 'Keine Transaktionen erkannt. CSV-Inhalt manuell einfügen:'),
        React.createElement('textarea', {
          value: rawData === ' ' ? '' : rawData,
          onChange: e => setRawData(e.target.value),
          placeholder: 'CSV Inhalt einfügen...',
          style: { width: '100%', height: '150px', padding: '0.75rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '8px', color: theme.text, fontFamily: 'monospace', fontSize: '0.8rem', resize: 'vertical', marginBottom: '0.75rem' }
        })
      ),
      parsed.length > 0 && React.createElement('div', null,
        React.createElement('div', { style: { color: '#22c55e', fontWeight: '600', marginBottom: '0.75rem', fontSize: '0.9rem' } }, `✓ ${parsed.length} Transaktionen erkannt`),
        React.createElement('div', { style: { background: theme.card, borderRadius: '10px', border: `1px solid ${theme.cardBorder}`, overflow: 'auto', maxHeight: '300px' } },
          React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', minWidth: '500px', fontSize: '0.8rem' } },
            React.createElement('thead', null,
              React.createElement('tr', null,
                ['Datum','Typ','Symbol','Menge','Preis','Gebühren'].map((h,i) =>
                  React.createElement('th', { key: i, style: { padding: '0.625rem 0.875rem', textAlign: i > 2 ? 'right' : 'left', color: theme.textSecondary, borderBottom: `1px solid ${theme.cardBorder}`, fontWeight: '600' } }, h)
                )
              )
            ),
            React.createElement('tbody', null,
              parsed.slice(0,20).map((tx, i) =>
                React.createElement('tr', { key: i },
                  React.createElement('td', { style: { padding: '0.5rem 0.875rem', color: theme.text } }, tx.date || '—'),
                  React.createElement('td', { style: { padding: '0.5rem 0.875rem' } },
                    React.createElement('span', { style: { padding: '0.125rem 0.375rem', borderRadius: '3px', fontSize: '0.7rem', fontWeight: '700', background: tx.type==='buy' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: tx.type==='buy' ? '#22c55e' : '#ef4444' } }, (tx.type||'').toUpperCase())
                  ),
                  React.createElement('td', { style: { padding: '0.5rem 0.875rem', color: theme.text, fontWeight: '600' } }, tx.symbol || '—'),
                  React.createElement('td', { style: { padding: '0.5rem 0.875rem', color: theme.text, textAlign: 'right' } }, tx.quantity?.toFixed?.(4) || '—'),
                  React.createElement('td', { style: { padding: '0.5rem 0.875rem', color: theme.text, textAlign: 'right' } }, tx.price?.toFixed?.(2) || '—'),
                  React.createElement('td', { style: { padding: '0.5rem 0.875rem', color: theme.textSecondary, textAlign: 'right' } }, tx.fees?.toFixed?.(2) || '0.00')
                )
              )
            )
          )
        ),
        parsed.length > 20 && React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.8rem', marginTop: '0.5rem' } }, `... und ${parsed.length-20} weitere`)
      ),
      React.createElement('div', { style: { display: 'flex', gap: '0.5rem', marginTop: '1rem' } },
        btn('← Zurück', () => setStep(1)),
        btn(`✓ ${parsed.length} importieren`, doImport, true, parsed.length === 0)
      )
    ),

    // ── Step 3: Done ─────────────────────────────────────────────────────────
    step === 3 && React.createElement('div', { style: { textAlign: 'center', padding: '3rem' } },
      React.createElement('div', { style: { fontSize: '2rem', marginBottom: '1rem', color: '#22c55e' } }, '✓'),
      React.createElement('h3', { style: { color: theme.text, fontSize: '1.25rem', fontWeight: '700', marginBottom: '0.5rem' } }, 'Import erfolgreich!'),
      React.createElement('p', { style: { color: theme.textSecondary, marginBottom: '1.5rem' } }, `${parsed.length} Transaktionen wurden hinzugefügt.`),
      btn('Neuen Import starten', reset, true)
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. POSITION NOTES / TRADE JOURNAL
// ─────────────────────────────────────────────────────────────────────────────
function PositionNotesView({ portfolio, theme, t }) {
  const [notes, setNotes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('maermin_notes') || '{}'); } catch { return {}; }
  });
  const [active, setActive] = useState(null);
  const [draft, setDraft]   = useState('');

  useEffect(() => { localStorage.setItem('maermin_notes', JSON.stringify(notes)); }, [notes]);

  const allPositions = useMemo(() => {
    const result = [];
    ['crypto','stocks','skins','commodities'].forEach(cat => {
      (portfolio[cat] || []).forEach(pos => {
        result.push({ key: `${cat}-${pos.symbol||pos.name}`, sym: pos.symbol||pos.name, cat });
      });
    });
    return result;
  }, [portfolio]);

  const save = () => {
    if (!active) return;
    setNotes(prev => ({ ...prev, [active]: { text: draft, updatedAt: new Date().toISOString() } }));
    setActive(null); setDraft('');
  };

  const noteCount = Object.keys(notes).filter(k => notes[k]?.text).length;

  return React.createElement('div', { style: { padding: '1.5rem' } },
    React.createElement('h2', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '700', marginBottom: '0.5rem' } }, (t.tradeJournal || 'Trade-Journal')),
    React.createElement('p', { style: { color: theme.textSecondary, fontSize: '0.875rem', marginBottom: '1.5rem' } }, `${noteCount} von ${allPositions.length} Positionen haben Notizen`),

    allPositions.length === 0
      ? React.createElement('div', { style: { padding: '3rem', textAlign: 'center', color: theme.textSecondary, background: theme.card, borderRadius: '12px', border: `1px solid ${theme.cardBorder}` } },
          'Füge zuerst Positionen hinzu'
        )
      : React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: '0.75rem' } },
          allPositions.map(p => {
            const note = notes[p.key];
            const isActive = active === p.key;
            return React.createElement('div', {
              key: p.key,
              style: {
                background: theme.card, borderRadius: '12px',
                border: `1px solid ${isActive ? theme.accent : note?.text ? 'rgba(139,92,246,0.3)' : theme.cardBorder}`,
                padding: '1rem', transition: 'all 0.15s'
              }
            },
              React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.625rem' } },
                React.createElement('div', null,
                  React.createElement('span', { style: { color: theme.text, fontWeight: '700', fontSize: '0.9rem' } }, p.sym),
                  React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.75rem', marginLeft: '0.5rem' } }, p.cat)
                ),
                note?.updatedAt && React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.7rem' } },
                  new Date(note.updatedAt).toLocaleDateString('de-DE')
                )
              ),
              isActive
                ? React.createElement('div', null,
                    React.createElement('textarea', {
                      value: draft, autoFocus: true,
                      onChange: e => setDraft(e.target.value),
                      placeholder: 'Investitionsthese, Zielkurs, Risiken, Strategie...',
                      style: { width: '100%', height: '120px', padding: '0.625rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem', resize: 'vertical', marginBottom: '0.5rem', lineHeight: '1.5' }
                    }),
                    React.createElement('div', { style: { display: 'flex', gap: '0.375rem' } },
                      React.createElement('button', { onClick: save, style: { padding: '0.375rem 0.875rem', background: theme.accent, color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' } }, 'Speichern'),
                      React.createElement('button', { onClick: () => { setActive(null); setDraft(''); }, style: { padding: '0.375rem 0.875rem', background: theme.inputBg, color: theme.text, border: `1px solid ${theme.cardBorder}`, borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' } }, 'Abbrechen')
                    )
                  )
                : React.createElement('div', {
                    onClick: () => { setActive(p.key); setDraft(note?.text || ''); },
                    style: { cursor: 'pointer', minHeight: '60px', padding: '0.5rem', background: theme.inputBg, borderRadius: '6px', fontSize: '0.8rem', color: note?.text ? theme.text : theme.textSecondary, lineHeight: '1.5', whiteSpace: 'pre-wrap' }
                  }, note?.text || '+ Notiz hinzufügen...')
            );
          })
        )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. DIVIDEND CALENDAR
// ─────────────────────────────────────────────────────────────────────────────
function DividendCalendarView({ portfolio, theme, t, addToast }) {
  const [events, setEvents] = useState(() => {
    try { return JSON.parse(localStorage.getItem('maermin_divevents') || '[]'); } catch { return []; }
  });
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ symbol: '', date: '', amount: '', currency: 'EUR', notes: '' });
  const [viewMonth, setViewMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });

  useEffect(() => { localStorage.setItem('maermin_divevents', JSON.stringify(events)); }, [events]);

  const addEvent = () => {
    if (!form.symbol || !form.date || !form.amount) return;
    setEvents(prev => [...prev, { id: Date.now().toString(), ...form, amount: parseFloat(form.amount) }]);
    setForm({ symbol: '', date: '', amount: '', currency: 'EUR', notes: '' });
    setShowAdd(false);
    addToast && addToast('Dividende hinzugefügt', 'success');
  };

  const { year, month } = viewMonth;
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1; // Mon-start
  const daysInMonth = lastDay.getDate();

  const monthEvents = events.filter(e => {
    const d = new Date(e.date);
    return d.getFullYear() === year && d.getMonth() === month;
  });

  const totalThisMonth = monthEvents.reduce((s, e) => s + (e.amount || 0), 0);
  const totalYear = events.filter(e => new Date(e.date).getFullYear() === year).reduce((s,e)=>s+e.amount,0);

  const days = [];
  for (let i = 0; i < startDow; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(d);

  const dayEvents = (d) => monthEvents.filter(e => new Date(e.date).getDate() === d);
  const today = new Date();

  const monthNames = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];

  const inp = (field, placeholder, type='text', opts) =>
    React.createElement('input', { type, value: form[field], placeholder, ...opts, onChange: e => setForm(p=>({...p,[field]:e.target.value})),
      style: { flex: 1, padding: '0.5rem 0.75rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '6px', color: theme.text, fontSize: '0.875rem' }
    });

  return React.createElement('div', { style: { padding: '1.5rem' } },
    // Header
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' } },
      React.createElement('div', null,
        React.createElement('h2', { style: { color: theme.text, fontSize: '1.5rem', fontWeight: '700' } }, (t.dividendCalendar || 'Dividend Calendar')),
        React.createElement('div', { style: { color: theme.textSecondary, fontSize: '0.85rem', marginTop: '0.25rem' } },
          `${monthNames[month]} ${year}: ${totalThisMonth.toFixed(2)} € · Jahr ${year}: ${totalYear.toFixed(2)} €`
        )
      ),
      React.createElement('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center' } },
        React.createElement('button', { onClick: () => setViewMonth(p => { const d = new Date(p.year, p.month - 1); return { year: d.getFullYear(), month: d.getMonth() }; }), style: { padding: '0.5rem 0.875rem', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '6px', color: theme.text, cursor: 'pointer' } }, '←'),
        React.createElement('span', { style: { color: theme.text, fontWeight: '700', minWidth: '100px', textAlign: 'center' } }, `${monthNames[month]} ${year}`),
        React.createElement('button', { onClick: () => setViewMonth(p => { const d = new Date(p.year, p.month + 1); return { year: d.getFullYear(), month: d.getMonth() }; }), style: { padding: '0.5rem 0.875rem', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '6px', color: theme.text, cursor: 'pointer' } }, '→'),
        React.createElement('button', { onClick: () => setShowAdd(p=>!p), style: { padding: '0.5rem 0.875rem', background: theme.accent, color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' } }, '+ Dividende')
      )
    ),

    // Add form
    showAdd && React.createElement('div', { style: { background: theme.card, border: `1px solid ${theme.cardBorder}`, borderRadius: '10px', padding: '1rem', marginBottom: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' } },
      inp('symbol', 'Symbol (z.B. AAPL)'),
      inp('date', 'Datum', 'date'),
      inp('amount', 'Betrag', 'number', { step: '0.01' }),
      React.createElement('select', { value: form.currency, onChange: e=>setForm(p=>({...p,currency:e.target.value})), style: { padding: '0.5rem', background: theme.inputBg, border: `1px solid ${theme.inputBorder}`, borderRadius: '6px', color: theme.text } },
        React.createElement('option', { value: 'EUR' }, '€'),
        React.createElement('option', { value: 'USD' }, '$')
      ),
      inp('notes', 'Notiz (opt.)'),
      React.createElement('button', { onClick: addEvent, style: { padding: '0.5rem 1rem', background: theme.accent, color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600', whiteSpace: 'nowrap' } }, 'Hinzufügen')
    ),

    // Calendar grid
    React.createElement('div', { style: { background: theme.card, borderRadius: '12px', border: `1px solid ${theme.cardBorder}`, overflow: 'hidden' } },
      // Weekdays header
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' } },
        ['Mo','Di','Mi','Do','Fr','Sa','So'].map(d =>
          React.createElement('div', { key: d, style: { padding: '0.625rem', textAlign: 'center', color: theme.textSecondary, fontSize: '0.75rem', fontWeight: '600', borderBottom: `1px solid ${theme.cardBorder}` } }, d)
        )
      ),
      // Days
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' } },
        days.map((d, i) => {
          const evs = d ? dayEvents(d) : [];
          const isToday = d && today.getDate()===d && today.getMonth()===month && today.getFullYear()===year;
          return React.createElement('div', {
            key: i,
            style: {
              minHeight: '70px', padding: '0.375rem', borderRight: i%7<6 ? `1px solid ${theme.cardBorder}` : 'none',
              borderBottom: `1px solid ${theme.cardBorder}`,
              background: isToday ? 'rgba(139,92,246,0.08)' : 'transparent'
            }
          },
            d && React.createElement('div', { style: { fontSize: '0.75rem', fontWeight: isToday ? '700' : '400', color: isToday ? theme.accent : theme.text, marginBottom: '0.25rem' } }, d),
            evs.map(e =>
              React.createElement('div', {
                key: e.id,
                title: `${e.symbol}: ${e.amount} ${e.currency}${e.notes ? ' · ' + e.notes : ''}`,
                style: { background: 'rgba(34,197,94,0.15)', color: '#22c55e', fontSize: '0.65rem', fontWeight: '600', padding: '0.15rem 0.3rem', borderRadius: '3px', marginBottom: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' },
                onClick: () => { if (window.confirm(`Dividende löschen? ${e.symbol} ${e.amount} ${e.currency}`)) setEvents(prev => prev.filter(ev => ev.id !== e.id)); }
              }, `${e.symbol} +${e.amount}${e.currency==='EUR'?'€':'$'}`)
            )
          );
        })
      )
    ),

    // Upcoming list
    events.filter(e => new Date(e.date) >= today).sort((a,b)=>new Date(a.date)-new Date(b.date)).slice(0,5).length > 0 &&
    React.createElement('div', { style: { marginTop: '1rem' } },
      React.createElement('div', { style: { color: theme.text, fontWeight: '700', fontSize: '0.9rem', marginBottom: '0.5rem' } }, 'Nächste Dividenden'),
      events.filter(e => new Date(e.date) >= today).sort((a,b)=>new Date(a.date)-new Date(b.date)).slice(0,5).map(e =>
        React.createElement('div', { key: e.id, style: { display: 'flex', justifyContent: 'space-between', padding: '0.625rem 0.75rem', background: theme.card, borderRadius: '6px', marginBottom: '0.375rem', border: `1px solid ${theme.cardBorder}` } },
          React.createElement('span', { style: { color: theme.text, fontWeight: '600', fontSize: '0.875rem' } }, e.symbol),
          React.createElement('span', { style: { color: theme.textSecondary, fontSize: '0.875rem' } }, new Date(e.date).toLocaleDateString('de-DE')),
          React.createElement('span', { style: { color: '#22c55e', fontWeight: '700', fontSize: '0.875rem' } }, `+${e.amount} ${e.currency==='EUR'?'€':'$'}`)
        )
      )
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. MOBILE NAV HOOK (CSS injected once)
// ─────────────────────────────────────────────────────────────────────────────
function injectMobileCSS() {
  if (document.getElementById('maermin-mobile-css')) return;
  const style = document.createElement('style');
  style.id = 'maermin-mobile-css';
  style.textContent = `
@media (max-width: 768px) {
  /* Hide desktop sidebar, show bottom nav */
  nav.maermin-sidebar { display: none !important; }
  main.maermin-main   { padding-bottom: 70px !important; }
  .maermin-bottom-nav { display: flex !important; }
  header.maermin-header { padding: 0.625rem 1rem !important; }
  header.maermin-header h1 { font-size: 1.2rem !important; }
}
@media (min-width: 769px) {
  .maermin-bottom-nav { display: none !important; }
}
.maermin-bottom-nav {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 500;
  background: var(--maermin-modal-bg, #1e293b);
  border-top: 1px solid rgba(255,255,255,0.1);
  padding: 0.375rem 0 env(safe-area-inset-bottom);
  justify-content: space-around; align-items: center;
  backdrop-filter: blur(12px);
}
.maermin-bottom-nav button {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  background: none; border: none; cursor: pointer; padding: 0.375rem 0.5rem;
  font-size: 0.6rem; letter-spacing: 0.02em; min-width: 52px;
  transition: opacity 0.15s;
}
.maermin-bottom-nav button:active { opacity: 0.7; }
.maermin-bottom-nav button span.icon { font-size: 1.3rem; line-height: 1; }
  `;
  document.head.appendChild(style);
}

function MobileBottomNav({ activeView, setActiveView, theme }) {
  useEffect(() => { injectMobileCSS(); }, []);

  const items = [
    { id: 'overview',     icon: '◈', label: 'Overview' },
    { id: 'portfolio',    icon: '◆', label: 'Portfolio' },
    { id: 'transactions', icon: '↕', label: 'Trades' },
    { id: 'watchlist',    icon: '○', label: 'Watch' },
    { id: 'analytics',   icon: '◇', label: 'Analytics' },
  ];

  return React.createElement('div', { className: 'maermin-bottom-nav' },
    items.map(item =>
      React.createElement('button', {
        key: item.id,
        onClick: () => setActiveView(item.id),
        style: { color: activeView === item.id ? (theme?.accent || '#8b5cf6') : 'rgba(255,255,255,0.5)' }
      },
        React.createElement('span', { className: 'icon' }, item.icon),
        item.label
      )
    )
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  window.MaerminFeatures2 = {
    ReturnsView,
    RebalancingView,
    BrokerImportWizard,
    PositionNotesView,
    DividendCalendarView,
    MobileBottomNav,
    calcXIRR,
    calcTWR
  };
}

})();
