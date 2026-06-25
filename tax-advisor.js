// ============================================================================
// MAERMIN — Tax-harvesting advisor & crypto Freigrenze countdown
//           (window.MaerminTaxAdvisor)
// ----------------------------------------------------------------------------
// Competitive-gap WI-3. MAERMIN already has the per-lot tax data (FIFO holding
// period, German crypto Freigrenze, Sparerpauschbetrag). This module is the
// FORWARD-LOOKING reader on top of it — no new tax math, just prioritised,
// actionable findings:
//
//   cryptoCountdown   per open crypto lot: the date the 1-year §23 EStG holding
//                     period is reached and "N days until tax-free"; lots close
//                     to the line are highlighted.
//   cryptoFreigrenze  realised private sale gains this year vs the 1.000 EUR
//                     Freigrenze (a HARD limit — one euro over makes ALL of it
//                     taxable); remaining buffer + warning near the edge.
//   sparerHeadroom    Sparerpauschbetrag used vs 1.000 EUR (2.000 EUR married,
//                     from maermin_tax_owner); remaining headroom.
//   lossHarvest       positions with an unrealised loss that could offset
//                     realised gains, keeping the stock vs other pots separate.
//
// Findings are ranked critical -> important -> optimization like
// portfolio-intelligence.js, each with a concrete recommendation. Pure layer
// (analyze / buildCryptoLots / helpers) is Node-tested in test/tax-advisor.test.js;
// it is a consumer only, so it persists nothing. UI is clearly labelled an
// estimate, not tax advice.
// ============================================================================
(function () {
  'use strict';

  var PRIORITY_RANK = { critical: 0, important: 1, optimization: 2 };
  var DEFAULTS = {
    cryptoHoldDays: 365,       // §23 EStG one-year speculation period
    cryptoFreigrenze: 1000,    // EUR hard limit on private sale gains
    sparerpauschbetrag: 1000,  // single; 2000 married
    nearFreeDays: 30,          // highlight crypto lots within N days of tax-free
    nearLimitPct: 0.8          // warn when a Freigrenze/headroom is >= 80% used
  };

  var DAY_MS = 86400000;
  function num(x) { var n = parseFloat(x); return isFinite(n) ? n : 0; }
  function str(x) { return String(x == null ? '' : x).trim(); }
  function ymd(d) { return str(d).slice(0, 10); }
  function uid() { return 'ta' + Math.random().toString(36).slice(2, 9); }

  function parseDate(iso) {
    var s = ymd(iso);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var d = new Date(s + 'T00:00:00Z');
    return isNaN(d.getTime()) ? null : d;
  }
  function daysBetween(aISO, bISO) {
    var a = parseDate(aISO), b = parseDate(bISO);
    if (!a || !b) return 0;
    return Math.round((b.getTime() - a.getTime()) / DAY_MS);
  }
  function addDays(iso, n) {
    var d = parseDate(iso);
    if (!d) return iso;
    return ymd(new Date(d.getTime() + n * DAY_MS).toISOString());
  }

  // The date a crypto lot becomes tax-free, and how many days remain from `today`.
  function cryptoFreeDate(acquiredISO, holdDays) {
    return addDays(ymd(acquiredISO), holdDays == null ? DEFAULTS.cryptoHoldDays : holdDays);
  }

  // Build open crypto lots (FIFO) from the transaction list. Returns one entry
  // per remaining buy lot: { symbol, acquiredDate, quantity, costBasisEUR,
  // currentValueEUR }. `priceEUR(symbol)` resolves a current EUR unit price;
  // when missing the lot's current value falls back to its cost basis.
  function buildCryptoLots(transactions, priceEUR, opts) {
    opts = opts || {};
    var rate = opts.usdToEur || 1;
    var bySym = {};
    (Array.isArray(transactions) ? transactions : []).forEach(function (tx) {
      if (!tx || str(tx.category) !== 'crypto') return;
      if (tx.type !== 'buy' && tx.type !== 'sell') return;
      var sym = str(tx.symbol).toUpperCase();
      if (!sym) return;
      (bySym[sym] = bySym[sym] || []).push(tx);
    });
    var lots = [];
    Object.keys(bySym).forEach(function (sym) {
      var txs = bySym[sym].slice().sort(function (a, b) { return ymd(a.date) < ymd(b.date) ? -1 : (ymd(a.date) > ymd(b.date) ? 1 : 0); });
      var open = [];
      txs.forEach(function (tx) {
        var qty = num(tx.quantity);
        var unitCost = (tx.currency === 'USD') ? num(tx.price) * rate : num(tx.price);
        if (tx.type === 'buy') {
          open.push({ symbol: sym, acquiredDate: ymd(tx.date), quantity: qty, unitCost: unitCost });
        } else { // sell consumes oldest lots FIFO
          var remaining = qty;
          while (remaining > 1e-12 && open.length) {
            var lot = open[0];
            var take = Math.min(lot.quantity, remaining);
            lot.quantity -= take;
            remaining -= take;
            if (lot.quantity <= 1e-12) open.shift();
          }
        }
      });
      open.forEach(function (lot) {
        if (lot.quantity <= 1e-12) return;
        var px = priceEUR ? priceEUR(sym) : null;
        var cur = (px != null && isFinite(px)) ? px * lot.quantity : lot.unitCost * lot.quantity;
        lots.push({
          symbol: sym, acquiredDate: lot.acquiredDate, quantity: lot.quantity,
          costBasisEUR: lot.unitCost * lot.quantity, currentValueEUR: cur
        });
      });
    });
    return lots;
  }

  function finding(kind, priority, title, detail, recommendation, extra) {
    return Object.assign({ id: uid(), kind: kind, priority: priority, title: title, detail: detail, recommendation: recommendation }, extra || {});
  }

  // Main analysis. All inputs explicit so it is fully Node-testable.
  //   input = { today, cryptoLots, realizedCryptoGainsYTD, sparerpauschbetrag,
  //             sparerpauschbetragUsed, positions, realizedStockGainsYTD,
  //             realizedOtherGainsYTD }
  function analyze(input, opts) {
    input = input || {};
    var o = Object.assign({}, DEFAULTS, opts || {});
    var today = ymd(input.today) || (typeof window !== 'undefined' && window.MaerminUtils ? window.MaerminUtils.todayISO() : new Date().toISOString().slice(0, 10));
    var findings = [];

    // ---- crypto Freigrenze countdown (per lot) ----
    var lots = Array.isArray(input.cryptoLots) ? input.cryptoLots : [];
    var nearFree = [];
    lots.forEach(function (lot) {
      var held = daysBetween(lot.acquiredDate, today);
      if (held < 0) return;
      var freeDate = cryptoFreeDate(lot.acquiredDate, o.cryptoHoldDays);
      var daysLeft = daysBetween(today, freeDate);
      var gain = num(lot.currentValueEUR) - num(lot.costBasisEUR);
      lot._held = held; lot._freeDate = freeDate; lot._daysLeft = daysLeft; lot._gain = gain;
      if (daysLeft > 0 && daysLeft <= o.nearFreeDays && gain > 0) nearFree.push(lot);
    });
    nearFree.sort(function (a, b) { return a._daysLeft - b._daysLeft; });
    nearFree.forEach(function (lot) {
      findings.push(finding('cryptoCountdown', 'important',
        lot.symbol + ': ' + lot._daysLeft + ' day(s) until tax-free',
        'This crypto lot (acquired ' + lot.acquiredDate + ') reaches the 1-year §23 EStG holding period on ' + lot._freeDate + '. An unrealised gain of about ' + Math.round(lot._gain) + ' EUR would then be tax-free.',
        'Consider waiting until ' + lot._freeDate + ' before selling this lot to realise the gain tax-free.',
        { symbol: lot.symbol, daysLeft: lot._daysLeft, freeDate: lot._freeDate, gain: lot._gain }));
    });

    // ---- crypto 1.000 EUR Freigrenze (hard limit) ----
    var cryptoUsed = num(input.realizedCryptoGainsYTD);
    var cryptoLimit = o.cryptoFreigrenze;
    var cryptoRemaining = cryptoLimit - cryptoUsed;
    if (cryptoUsed > cryptoLimit) {
      findings.push(finding('cryptoFreigrenze', 'critical',
        'Crypto Freigrenze exceeded',
        'Realised private sale gains of ' + Math.round(cryptoUsed) + ' EUR this year exceed the 1.000 EUR Freigrenze. Because it is a Freigrenze (not an allowance), the ENTIRE amount is taxable, not just the excess.',
        'Avoid further short-term crypto sales this year; defer additional realisations into next year if possible.',
        { used: cryptoUsed, limit: cryptoLimit, remaining: cryptoRemaining }));
    } else if (cryptoUsed >= cryptoLimit * o.nearLimitPct) {
      findings.push(finding('cryptoFreigrenze', 'important',
        'Crypto Freigrenze nearly used',
        'Realised private sale gains of ' + Math.round(cryptoUsed) + ' EUR are close to the 1.000 EUR Freigrenze; only ' + Math.round(cryptoRemaining) + ' EUR of headroom remains.',
        'Any sale that pushes total gains over 1.000 EUR makes the whole sum taxable — keep further short-term realisations under ' + Math.round(cryptoRemaining) + ' EUR.',
        { used: cryptoUsed, limit: cryptoLimit, remaining: cryptoRemaining }));
    }

    // ---- Sparerpauschbetrag headroom ----
    var spbLimit = num(input.sparerpauschbetrag) || o.sparerpauschbetrag;
    var spbUsed = num(input.sparerpauschbetragUsed);
    var spbRemaining = spbLimit - spbUsed;
    if (spbRemaining > 0 && spbRemaining < spbLimit) {
      findings.push(finding('sparerHeadroom', 'optimization',
        'Sparerpauschbetrag headroom',
        Math.round(spbUsed) + ' EUR of your ' + Math.round(spbLimit) + ' EUR Sparerpauschbetrag is used; ' + Math.round(spbRemaining) + ' EUR remains tax-free this year.',
        'You can still realise about ' + Math.round(spbRemaining) + ' EUR of capital income (gains, dividends, interest) tax-free this year.',
        { used: spbUsed, limit: spbLimit, remaining: spbRemaining }));
    } else if (spbRemaining <= 0) {
      findings.push(finding('sparerHeadroom', 'optimization',
        'Sparerpauschbetrag exhausted',
        'Your ' + Math.round(spbLimit) + ' EUR Sparerpauschbetrag is fully used this year.',
        'Further capital income this year is taxable at the Abgeltungsteuer rate; consider deferring optional realisations into next year.',
        { used: spbUsed, limit: spbLimit, remaining: 0 }));
    }

    // ---- loss harvesting, stock vs other pots kept separate ----
    var positions = Array.isArray(input.positions) ? input.positions : [];
    var pots = { stocks: { loss: 0, names: [] }, other: { loss: 0, names: [] } };
    positions.forEach(function (p) {
      var unreal = num(p.currentValueEUR) - num(p.costBasisEUR);
      if (unreal >= 0) return;
      var pot = (str(p.assetClass || p.category) === 'stocks') ? 'stocks' : 'other';
      pots[pot].loss += unreal; // negative
      pots[pot].names.push(str(p.symbol));
    });
    var realizedByPot = {
      stocks: num(input.realizedStockGainsYTD),
      other: num(input.realizedOtherGainsYTD)
    };
    ['stocks', 'other'].forEach(function (potKey) {
      var pot = pots[potKey];
      var harvestable = -pot.loss; // positive
      var realizedGains = realizedByPot[potKey];
      if (harvestable <= 0 || realizedGains <= 0) return;
      var offset = Math.min(harvestable, realizedGains);
      var label = potKey === 'stocks' ? 'stock' : 'other (crypto/funds)';
      findings.push(finding('lossHarvest', 'important',
        'Loss-harvesting opportunity (' + label + ' pot)',
        'You have about ' + Math.round(harvestable) + ' EUR of unrealised losses in the ' + label + ' pot (' + pot.names.slice(0, 4).join(', ') + ') against ' + Math.round(realizedGains) + ' EUR of realised gains in the same pot.',
        'Realising up to ' + Math.round(offset) + ' EUR of these losses before year-end could offset the same-pot gains (German loss pots: stock losses only offset stock gains).',
        { pot: potKey, harvestable: harvestable, realizedGains: realizedGains, offset: offset }));
    });

    findings.sort(function (a, b) { return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]; });

    return {
      findings: findings,
      summary: {
        cryptoFreigrenze: { limit: cryptoLimit, used: cryptoUsed, remaining: cryptoRemaining, exceeded: cryptoUsed > cryptoLimit },
        sparerpauschbetrag: { limit: spbLimit, used: spbUsed, remaining: spbRemaining },
        cryptoLotsTracked: lots.length, cryptoLotsNearFree: nearFree.length
      }
    };
  }

  // Married joint assessment doubles the Sparerpauschbetrag.
  function sparerLimitFor(taxOwner) {
    var married = taxOwner && (taxOwner.married === true || taxOwner.jointAssessment === true || taxOwner.filingStatus === 'married');
    return married ? DEFAULTS.sparerpauschbetrag * 2 : DEFAULTS.sparerpauschbetrag;
  }

  // Browser gather: build the analyze() input from the live transaction list +
  // prices + the German tax summary (best-effort; defensive everywhere).
  function gather(opts) {
    opts = opts || {};
    var transactions = opts.transactions || [];
    var prices = opts.prices || {};
    var rate = opts.usdToEur || 1;
    var taxOwner = opts.taxOwner || {};
    function priceEUR(sym) {
      var p = prices[sym];
      if (p == null) return null;
      // price maps are stored in their native currency; crypto on this app is EUR
      return num(p);
    }
    var cryptoLots = buildCryptoLots(transactions, priceEUR, { usdToEur: rate });
    var taxData = opts.taxData || {};
    return {
      today: (typeof window !== 'undefined' && window.MaerminUtils) ? window.MaerminUtils.todayISO() : new Date().toISOString().slice(0, 10),
      cryptoLots: cryptoLots,
      realizedCryptoGainsYTD: num(taxData.realizedCryptoGainsYTD),
      realizedStockGainsYTD: num(taxData.realizedStockGainsYTD),
      realizedOtherGainsYTD: num(taxData.realizedOtherGainsYTD),
      sparerpauschbetrag: num(taxData.sparerpauschbetrag) || sparerLimitFor(taxOwner),
      sparerpauschbetragUsed: num(taxData.sparerpauschbetragUsed),
      positions: opts.positions || []
    };
  }

  var api = {
    PRIORITY_RANK: PRIORITY_RANK, DEFAULTS: DEFAULTS,
    daysBetween: daysBetween, addDays: addDays, cryptoFreeDate: cryptoFreeDate,
    buildCryptoLots: buildCryptoLots, sparerLimitFor: sparerLimitFor,
    analyze: analyze, gather: gather
  };

  api.Panel = makePanel(api);

  if (typeof window !== 'undefined') window.MaerminTaxAdvisor = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // --------------------------------------------------------------------------
  // React view — cards folded into the Tax view (no new tab). Labelled estimate.
  // --------------------------------------------------------------------------
  function makePanel(API) {
    return function Panel(props) {
      var React = (typeof window !== 'undefined') ? window.React : null;
      if (!React) return null;
      var e = React.createElement;
      try {
        var theme = props.theme || {};
        var t = props.t || {};
        var text = theme.text || '#e9edf4', dim = theme.textSecondary || '#8b94a7';
        var border = theme.cardBorder || 'rgba(255,255,255,0.08)';
        var card = theme.card || '#10151f';
        var COLORS = { critical: theme.danger || '#ef4444', important: theme.warning || '#f59e0b', optimization: theme.success || '#22c55e' };
        var LABELS = { critical: t.taPriCritical || 'Critical', important: t.taPriImportant || 'Important', optimization: t.taPriOptimize || 'Optimization' };

        var input = API.gather({
          transactions: props.transactions || [],
          prices: props.prices || {},
          usdToEur: props.exchangeRate || props.usdToEur || 1,
          taxOwner: props.taxOwner || (function () { try { return JSON.parse(localStorage.getItem('maermin_tax_owner') || '{}'); } catch (e) { return {}; } })(),
          taxData: props.taxData || {},
          positions: props.positions || []
        });
        var res = API.analyze(input);
        var s = res.summary;

        function chip(p) {
          return e('span', { style: { display: 'inline-block', padding: '0.1rem 0.5rem', borderRadius: '999px', fontSize: '0.68rem', fontWeight: 800, color: '#0b0e14', background: COLORS[p] } }, LABELS[p]);
        }
        var cards = res.findings.map(function (f) {
          return e('div', { key: f.id, style: { border: '1px solid ' + border, borderLeft: '3px solid ' + COLORS[f.priority], borderRadius: '10px', background: card, padding: '0.8rem 0.9rem', marginBottom: '0.6rem' } },
            e('div', { style: { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' } }, chip(f.priority),
              e('span', { style: { color: text, fontWeight: 700, fontSize: '0.9rem' } }, f.title)),
            e('div', { style: { color: dim, fontSize: '0.8rem', lineHeight: 1.45, marginBottom: '0.35rem' } }, f.detail),
            e('div', { style: { color: text, fontSize: '0.8rem', lineHeight: 1.45 } }, '→ ' + f.recommendation));
        });

        return e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.1rem', marginBottom: '1.5rem' } },
          e('div', { style: { color: text, fontWeight: 800, fontSize: '1.05rem', marginBottom: '0.2rem' } }, t.taTitle || 'Tax Advisor'),
          e('div', { style: { color: dim, fontSize: '0.78rem', marginBottom: '0.9rem' } },
            (t.taSubtitle || 'Forward-looking tax findings from your lots — an estimate, not tax advice.')),
          e('div', { style: { display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.9rem' } },
            e('div', { style: { flex: '1 1 180px', background: theme.inputBg || '#0c1018', borderRadius: '10px', padding: '0.7rem' } },
              e('div', { style: { color: dim, fontSize: '0.72rem' } }, t.taCryptoFreigrenze || 'Crypto Freigrenze (1.000 EUR)'),
              e('div', { style: { color: s.cryptoFreigrenze.exceeded ? COLORS.critical : text, fontWeight: 800, fontSize: '1.05rem' } }, Math.round(s.cryptoFreigrenze.remaining) + ' EUR ' + (t.taLeft || 'left'))),
            e('div', { style: { flex: '1 1 180px', background: theme.inputBg || '#0c1018', borderRadius: '10px', padding: '0.7rem' } },
              e('div', { style: { color: dim, fontSize: '0.72rem' } }, t.taSparer || 'Sparerpauschbetrag'),
              e('div', { style: { color: text, fontWeight: 800, fontSize: '1.05rem' } }, Math.round(s.sparerpauschbetrag.remaining) + ' / ' + Math.round(s.sparerpauschbetrag.limit) + ' EUR')),
            e('div', { style: { flex: '1 1 180px', background: theme.inputBg || '#0c1018', borderRadius: '10px', padding: '0.7rem' } },
              e('div', { style: { color: dim, fontSize: '0.72rem' } }, t.taCryptoLots || 'Crypto lots near tax-free'),
              e('div', { style: { color: text, fontWeight: 800, fontSize: '1.05rem' } }, s.cryptoLotsNearFree + ' / ' + s.cryptoLotsTracked))),
          cards.length ? cards : e('div', { style: { color: dim, fontSize: '0.84rem' } }, t.taNone || 'No tax actions flagged right now.'));
      } catch (err) {
        return e('div', { style: { padding: '0.75rem', color: (props.theme && props.theme.danger) || '#ef4444' } }, 'Tax advisor error: ' + (err && err.message));
      }
    };
  }
})();
