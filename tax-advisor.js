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
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }
  function I18N() { return (typeof window !== 'undefined' && window.MaerminI18n) || require('./i18n.js'); }
  function EUR(v) { return I18N().money(Math.round(v || 0), 'EUR', 0); }
  function D8(iso) { return I18N().date(iso); }

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
  // First TAX-FREE sale date under §23 EStG: the one-year period ends on the
  // anniversary (29 Feb -> 28 Feb, §188 BGB), so a sale is tax-free from the
  // FOLLOWING day. (Selling on the anniversary itself is still taxable.)
  // A custom holdDays other than the statutory 365 keeps the plain day count.
  function cryptoFreeDate(acquiredISO, holdDays) {
    var iso = ymd(acquiredISO);
    if (holdDays != null && holdDays !== DEFAULTS.cryptoHoldDays) return addDays(iso, holdDays);
    var y = parseInt(iso.slice(0, 4), 10), m = parseInt(iso.slice(5, 7), 10), d = parseInt(iso.slice(8, 10), 10);
    if (!(y > 0 && m > 0 && d > 0)) return addDays(iso, DEFAULTS.cryptoHoldDays + 1);
    var last = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
    var ann = (y + 1) + '-' + String(m).padStart(2, '0') + '-' + String(Math.min(d, last)).padStart(2, '0');
    return addDays(ann, 1);
  }

  // Build open crypto lots (FIFO) from the transaction list. Returns one entry
  // per remaining buy lot: { symbol, acquiredDate, quantity, costBasisEUR,
  // currentValueEUR }. `priceEUR(symbol)` resolves a current EUR unit price;
  // when missing the lot's current value falls back to its cost basis.
  function ledger() {
    if (typeof window !== 'undefined' && window.MaerminLedger) return window.MaerminLedger;
    return require('./ledger.js');
  }
  function buildCryptoLots(transactions, priceEUR, opts) {
    opts = opts || {};
    var rate = opts.usdToEur || 1;
    // Open crypto lots from the ONE ledger (ledger.js): fees in the cost
    // basis, per-date FX when opts.fxAt is given, splits applied.
    var L = ledger().build(Array.isArray(transactions) ? transactions : [], { exchangeRate: rate, fxAt: opts.fxAt, categories: ['crypto'] });
    var lots = [];
    L.list.forEach(function (g) {
      var sym = str(g.symbol).toUpperCase();
      if (!sym) return;
      g.openLots.forEach(function (lot) {
        if (lot.qty <= 1e-12) return;
        var px = priceEUR ? priceEUR(sym) : null;
        var cur = (px != null && isFinite(px)) ? px * lot.qty : lot.unitCostEUR * lot.qty;
        lots.push({
          symbol: sym, acquiredDate: ymd(lot.date), quantity: lot.qty,
          costBasisEUR: lot.unitCostEUR * lot.qty, currentValueEUR: cur
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
        __('taCdTitle', '{sym}: {n} {n:day|days} until tax-free', { sym: lot.symbol, n: lot._daysLeft }),
        __('taCdDetail', 'This crypto lot (acquired {acq}) reaches the 1-year §23 EStG holding period on {free}. An unrealised gain of about {gain} would then be tax-free.', { acq: D8(lot.acquiredDate), free: D8(lot._freeDate), gain: EUR(lot._gain) }),
        __('taCdAction', 'Consider waiting until {free} before selling this lot to realise the gain tax-free.', { free: D8(lot._freeDate) }),
        { symbol: lot.symbol, daysLeft: lot._daysLeft, freeDate: lot._freeDate, gain: lot._gain }));
    });

    // ---- crypto 1.000 EUR Freigrenze (hard limit) ----
    var cryptoUsed = num(input.realizedCryptoGainsYTD);
    var cryptoLimit = o.cryptoFreigrenze;
    var cryptoRemaining = cryptoLimit - cryptoUsed;
    if (cryptoUsed >= cryptoLimit) {
      findings.push(finding('cryptoFreigrenze', 'critical',
        __('taFgExceeded', 'Crypto Freigrenze exceeded'),
        __('taFgExceededDetail', 'Realised private sale gains of {used} this year reach the {limit} Freigrenze (only gains of less than {limit} are tax-free). Because it is a Freigrenze (not an allowance), the ENTIRE amount is taxable, not just the excess.', { used: EUR(cryptoUsed), limit: EUR(cryptoLimit) }),
        __('taFgExceededAction', 'Avoid further short-term crypto sales this year; defer additional realisations into next year if possible.'),
        { used: cryptoUsed, limit: cryptoLimit, remaining: cryptoRemaining }));
    } else if (cryptoUsed >= cryptoLimit * o.nearLimitPct) {
      findings.push(finding('cryptoFreigrenze', 'important',
        __('taFgNear', 'Crypto Freigrenze nearly used'),
        __('taFgNearDetail', 'Realised private sale gains of {used} are close to the {limit} Freigrenze; only {left} of headroom remains.', { used: EUR(cryptoUsed), limit: EUR(cryptoLimit), left: EUR(cryptoRemaining) }),
        __('taFgNearAction', 'Any sale that brings total gains to {limit} or more makes the whole sum taxable — keep further short-term realisations under {left}.', { limit: EUR(cryptoLimit), left: EUR(cryptoRemaining) }),
        { used: cryptoUsed, limit: cryptoLimit, remaining: cryptoRemaining }));
    }

    // ---- Sparerpauschbetrag headroom ----
    // An explicit 0 (allowance used up at another bank) is a real limit.
    var spbLimit = (input.sparerpauschbetrag != null && isFinite(parseFloat(input.sparerpauschbetrag)))
      ? num(input.sparerpauschbetrag) : o.sparerpauschbetrag;
    var spbUsed = num(input.sparerpauschbetragUsed);
    var spbRemaining = spbLimit - spbUsed;
    if (spbRemaining > 0 && spbRemaining < spbLimit) {
      findings.push(finding('sparerHeadroom', 'optimization',
        __('taSpbHeadroom', 'Sparerpauschbetrag headroom'),
        __('taSpbHeadroomDetail', '{used} of your {limit} Sparerpauschbetrag is used; {left} remains tax-free this year.', { used: EUR(spbUsed), limit: EUR(spbLimit), left: EUR(spbRemaining) }),
        __('taSpbHeadroomAction', 'You can still realise about {left} of capital income (gains, dividends, interest) tax-free this year.', { left: EUR(spbRemaining) }),
        { used: spbUsed, limit: spbLimit, remaining: spbRemaining }));
    } else if (spbRemaining <= 0) {
      findings.push(finding('sparerHeadroom', 'optimization',
        __('taSpbExhausted', 'Sparerpauschbetrag exhausted'),
        __('taSpbExhaustedDetail', 'Your {limit} Sparerpauschbetrag is fully used this year.', { limit: EUR(spbLimit) }),
        __('taSpbExhaustedAction', 'Further capital income this year is taxable at the Abgeltungsteuer rate; consider deferring optional realisations into next year.'),
        { used: spbUsed, limit: spbLimit, remaining: 0 }));
    }

    // ---- loss harvesting in the three German loss pots ----
    //   stocks : direct shares only (sec. 20 (6) S.4 EStG Aktienverlusttopf)
    //   other  : funds/ETFs and all other capital income (sec. 20)
    //   crypto : private sales (sec. 23) - only lots NOT yet held > 1 year,
    //            offsettable only against sec. 23 gains, never capital income.
    // ETFs are NOT shares for the stock pot, so a fund position needs
    // p.isFund (or p.taxPot) to land in 'other'.
    var positions = Array.isArray(input.positions) ? input.positions : [];
    var pots = { stocks: { loss: 0, names: [] }, other: { loss: 0, names: [] }, crypto: { loss: 0, names: [] } };
    function potOf(p) {
      if (p.taxPot && pots[p.taxPot]) return p.taxPot;
      var cls = str(p.assetClass || p.category);
      if (cls === 'crypto') return 'crypto';
      if (cls === 'stocks' && !p.isFund) return 'stocks';
      return 'other';
    }
    positions.forEach(function (p) {
      var pot = potOf(p);
      if (pot === 'crypto') return; // crypto is evaluated per lot below
      var unreal = num(p.currentValueEUR) - num(p.costBasisEUR);
      if (unreal >= 0) return;
      pots[pot].loss += unreal; // negative
      pots[pot].names.push(str(p.symbol));
    });
    lots.forEach(function (l) {
      var free = cryptoFreeDate(l.acquiredDate);
      if (free && today >= free) return; // tax-free already: a loss there is irrelevant
      var unreal = num(l.currentValueEUR) - num(l.costBasisEUR);
      if (unreal >= 0) return;
      pots.crypto.loss += unreal;
      if (pots.crypto.names.indexOf(str(l.symbol)) === -1) pots.crypto.names.push(str(l.symbol));
    });
    var realizedByPot = {
      stocks: num(input.realizedStockGainsYTD),
      other: num(input.realizedOtherGainsYTD),
      crypto: num(input.realizedCryptoGainsYTD)
    };
    var POT_LABEL = { stocks: __('taPotStocks', 'stock (direct shares)'), other: __('taPotOther', 'other capital income (funds/ETFs, bonds)'), crypto: __('taPotCrypto', 'private sales (crypto, sec. 23)') };
    ['stocks', 'other', 'crypto'].forEach(function (potKey) {
      var pot = pots[potKey];
      var harvestable = -pot.loss; // positive
      var realizedGains = realizedByPot[potKey];
      if (harvestable <= 0 || realizedGains <= 0) return;
      var offset = Math.min(harvestable, realizedGains);
      var label = POT_LABEL[potKey];
      findings.push(finding('lossHarvest', 'important',
        __('taLhTitle', 'Loss-harvesting opportunity ({pot} pot)', { pot: label }),
        __('taLhDetail', 'You have about {loss} of unrealised losses in the {pot} pot ({names}) against {gains} of realised gains in the same pot this year.', { loss: EUR(harvestable), pot: label, names: pot.names.slice(0, 4).join(', '), gains: EUR(realizedGains) }),
        __('taLhAction', 'Realising up to {offset} of these losses before year-end could offset those gains. Losses only offset gains of the same pot: share losses only share gains, crypto losses only other private-sale gains.', { offset: EUR(offset) }),
        { pot: potKey, harvestable: harvestable, realizedGains: realizedGains, offset: offset }));
    });

    findings.sort(function (a, b) { return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]; });

    return {
      findings: findings,
      summary: {
        cryptoFreigrenze: { limit: cryptoLimit, used: cryptoUsed, remaining: cryptoRemaining, exceeded: cryptoUsed >= cryptoLimit },
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

  // The advisor's taxData from a built MaerminTaxReport: realised gains per
  // German loss pot (direct shares / funds + other capital income / sec. 23)
  // and the Sparerpauschbetrag the report applied - limit AND usage, so the
  // headroom follows the user's Freistellungsauftrag setting. isFund(symbol)
  // separates funds from direct shares among stock disposals.
  function taxDataFromReport(report, isFund) {
    var stockG = 0, otherG = 0;
    if (report) {
      (report.realizedGains || []).concat(report.realizedLosses || []).forEach(function (d) {
        if (d.category !== 'stocks') return;
        if (isFund && isFund(d.symbol)) otherG += d.gain; else stockG += d.gain;
      });
      otherG += num(report.summary && report.summary.dividendIncome) + num(report.summary && report.summary.interestIncome);
    }
    var g = report && report.summary && report.summary.germanDetail;
    return {
      realizedStockGainsYTD: stockG,
      realizedOtherGainsYTD: otherG,
      realizedCryptoGainsYTD: g && g.crypto ? g.crypto.netShortTermGains : 0,
      sparerpauschbetrag: g ? num(g.sparerpauschbetrag) : null,
      sparerpauschbetragUsed: g ? g.sparerpauschbetragUsed : 0
    };
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
      if (p == null) p = prices[String(sym).toLowerCase()];
      if (p == null) return null;
      // price maps are stored in their native currency; crypto on this app is EUR
      return num(p);
    }
    var cryptoLots = buildCryptoLots(transactions, priceEUR, { usdToEur: rate, fxAt: opts.fxAt });
    var taxData = opts.taxData || {};
    return {
      today: (typeof window !== 'undefined' && window.MaerminUtils) ? window.MaerminUtils.todayISO() : new Date().toISOString().slice(0, 10),
      cryptoLots: cryptoLots,
      realizedCryptoGainsYTD: num(taxData.realizedCryptoGainsYTD),
      realizedStockGainsYTD: num(taxData.realizedStockGainsYTD),
      realizedOtherGainsYTD: num(taxData.realizedOtherGainsYTD),
      sparerpauschbetrag: (taxData.sparerpauschbetrag != null && isFinite(parseFloat(taxData.sparerpauschbetrag)))
        ? num(taxData.sparerpauschbetrag) : sparerLimitFor(taxOwner),
      sparerpauschbetragUsed: num(taxData.sparerpauschbetragUsed),
      positions: opts.positions || []
    };
  }

  var api = {
    PRIORITY_RANK: PRIORITY_RANK, DEFAULTS: DEFAULTS,
    daysBetween: daysBetween, addDays: addDays, cryptoFreeDate: cryptoFreeDate,
    buildCryptoLots: buildCryptoLots, sparerLimitFor: sparerLimitFor, taxDataFromReport: taxDataFromReport,
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
        var t = props.t || ((typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n.dict() : {});
        var text = theme.text || '#e9edf4', dim = theme.textSecondary || '#8b94a7';
        var border = theme.cardBorder || 'rgba(255,255,255,0.08)';
        var card = theme.card || '#10151f';
        var COLORS = { critical: theme.danger || '#ef4444', important: theme.warning || '#f59e0b', optimization: theme.success || '#22c55e' };
        var LABELS = { critical: t.taPriCritical || 'Critical', important: t.taPriImportant || 'Important', optimization: t.taPriOptimize || 'Optimization' };

        var input = API.gather({
          transactions: props.transactions || [],
          prices: props.prices || {},
          usdToEur: props.exchangeRate || props.usdToEur || 1,
          fxAt: props.fxAt,
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
        return e('div', { style: { padding: '0.75rem', color: (props.theme && props.theme.danger) || '#ef4444' } }, __('taError', 'Tax advisor error: {msg}', { msg: err && err.message }));
      }
    };
  }
})();
