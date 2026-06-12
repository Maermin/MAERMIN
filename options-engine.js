// ============================================================================
// MAERMIN — Options / derivatives tracking  (window.MaerminOptions)
// ----------------------------------------------------------------------------
// Feature: track listed option contracts (long and short calls/puts) inside
// the EXISTING transaction model — a premium feature competitors gate behind
// their top tier. The fit is deliberately additive:
//
//   transaction = { type: buy|sell, category: 'options', quantity (contracts),
//                   price (premium per share), currency, fees, date, ... } plus
//   the option fields { underlying, optionType: call|put, strike, expiry,
//                       contractSize (default 100) }.
//
// MaerminMetrics.buildPositions ignores unknown categories BY DESIGN, so the
// 'options' category never bends the shared positions/stats engine: this
// module is a separate, pure reader over the same transaction list. Positions
// here use a signed-contract model (buys +, sells -): a positive net is long,
// a negative net is short, zero is closed (the net premium is the realised
// result). Valuation is INTRINSIC-ONLY (no time value, no Greeks) and the UI
// says so — this is tracking, not pricing.
//
// EUR stays canonical: premiums convert at ingestion exactly like
// buildPositions (USD x rate); the strike converts at the CURRENT rate when
// intrinsic value is computed, because intrinsic is current-market math.
//
// Same split as the other feature modules: everything below the React Panel is
// pure and dual-exported (test/options-engine.test.js); the Panel folds into
// the Overview (no new tab) and renders nothing when no option transactions
// exist. Nothing is persisted beyond the transactions the user already owns.
// ============================================================================
(function () {
  'use strict';

  var CATEGORY = 'options';
  var DEFAULT_CONTRACT_SIZE = 100;

  function num(x) {
    var n = typeof x === 'number' ? x : parseFloat(x);
    return (typeof n === 'number' && isFinite(n)) ? n : null;
  }
  function toEUR(amount, currency, rate) {
    var U = (typeof window !== 'undefined') && window.MaerminUtils;
    if (U && U.toEUR) return U.toEUR(amount, currency, rate);
    // Mirror of MaerminUtils.toEUR for the Node tests.
    var a = parseFloat(amount) || 0;
    return (currency === 'USD' && rate > 0) ? a * rate : a;
  }

  // ---- contract identity -----------------------------------------------------
  // Human-readable contract symbol, also stored as tx.symbol so the existing
  // transaction list / CSV export show something meaningful:
  //   "AAPL 2026-12-18 C 150"
  function contractSymbol(fields) {
    fields = fields || {};
    var u = String(fields.underlying || '').trim().toUpperCase();
    var t = fields.optionType === 'put' ? 'P' : 'C';
    var k = num(fields.strike);
    var ex = String(fields.expiry || '').slice(0, 10);
    if (!u || k == null) return '';
    return u + ' ' + ex + ' ' + t + ' ' + String(k);
  }

  function contractKey(tx) {
    return [
      String(tx.underlying || '').trim().toUpperCase(),
      tx.optionType === 'put' ? 'put' : 'call',
      String(num(tx.strike)),
      String(tx.expiry || '').slice(0, 10)
    ].join('|');
  }

  // ---- validation ---------------------------------------------------------------
  // Hard gate before an option tx enters the store: a malformed contract would
  // silently corrupt the grouping above.
  function validateOptionTx(tx) {
    tx = tx || {};
    var errors = [];
    if (!String(tx.underlying || '').trim()) errors.push('Underlying symbol is required.');
    if (tx.optionType !== 'call' && tx.optionType !== 'put') errors.push('Option type must be call or put.');
    var k = num(tx.strike);
    if (k == null || k <= 0) errors.push('Strike must be a number greater than 0.');
    var ex = String(tx.expiry || '');
    if (!/^\d{4}-\d{2}-\d{2}/.test(ex) || isNaN(new Date(ex).getTime())) errors.push('Expiry must be a valid date (YYYY-MM-DD).');
    var cs = num(tx.contractSize);
    if (tx.contractSize != null && tx.contractSize !== '' && (cs == null || cs <= 0)) errors.push('Contract size must be a number greater than 0.');
    return { ok: errors.length === 0, errors: errors };
  }

  // ---- position building (PURE) ----------------------------------------------------
  // Signed-contract model per contract key. opts.exchangeRate converts USD
  // premiums to EUR at ingestion (same rule as MaerminMetrics.buildPositions).
  function buildOptionPositions(transactions, opts) {
    opts = opts || {};
    var rate = parseFloat(opts.exchangeRate) || 0;
    var map = {};
    (transactions || []).forEach(function (tx) {
      if (!tx || tx.category !== CATEGORY) return;
      if (tx.type !== 'buy' && tx.type !== 'sell') return;
      var v = validateOptionTx(tx);
      if (!v.ok) return; // malformed legacy rows never poison the book
      var key = contractKey(tx);
      if (!map[key]) {
        map[key] = {
          key: key,
          symbol: contractSymbol(tx),
          underlying: String(tx.underlying).trim().toUpperCase(),
          optionType: tx.optionType === 'put' ? 'put' : 'call',
          strike: num(tx.strike),
          strikeCurrency: tx.currency === 'USD' ? 'USD' : 'EUR',
          expiry: String(tx.expiry).slice(0, 10),
          contractSize: num(tx.contractSize) || DEFAULT_CONTRACT_SIZE,
          netContracts: 0,
          premiumPaidEUR: 0,
          premiumReceivedEUR: 0,
          feesEUR: 0,
          txCount: 0
        };
      }
      var pos = map[key];
      var contracts = num(tx.quantity) || 0;
      if (contracts <= 0) return;
      var premiumEUR = toEUR(num(tx.price) || 0, tx.currency, rate) * contracts * pos.contractSize;
      pos.feesEUR += toEUR(num(tx.fees) || 0, tx.currency, rate);
      if (tx.type === 'buy') {
        pos.netContracts += contracts;
        pos.premiumPaidEUR += premiumEUR;
      } else {
        pos.netContracts -= contracts;
        pos.premiumReceivedEUR += premiumEUR;
      }
      pos.txCount++;
    });

    return Object.keys(map).map(function (k) {
      var p = map[k];
      p.netPremiumEUR = p.premiumReceivedEUR - p.premiumPaidEUR - p.feesEUR;
      p.side = p.netContracts > 0 ? 'long' : (p.netContracts < 0 ? 'short' : 'closed');
      return p;
    }).sort(function (a, b) { return a.expiry < b.expiry ? -1 : (a.expiry > b.expiry ? 1 : 0); });
  }

  // ---- per-position market metrics (PURE) ----------------------------------------------
  // underlyingPriceEUR: current price of the underlying in EUR (the app's
  // canonical price map), or null when unknown. opts.exchangeRate converts the
  // strike's currency to EUR for the comparison; opts.now is injectable for
  // tests. Valuation is intrinsic-only and signed (long +, short -).
  function positionMetrics(pos, underlyingPriceEUR, opts) {
    opts = opts || {};
    var now = opts.now ? new Date(opts.now) : new Date();
    var expiryDate = new Date(pos.expiry + 'T23:59:59Z');
    var daysToExpiry = Math.ceil((expiryDate.getTime() - now.getTime()) / 86400000);
    var expired = daysToExpiry < 0;
    var status = pos.side === 'closed' ? 'closed' : (expired ? 'expired' : 'open');

    var strikeEUR = toEUR(pos.strike, pos.strikeCurrency, parseFloat(opts.exchangeRate) || 0);
    var S = num(underlyingPriceEUR);
    var intrinsicPerShare = null, moneyness = null, intrinsicValueEUR = null, estPnlEUR = null;
    if (S != null && S > 0 && strikeEUR > 0) {
      intrinsicPerShare = pos.optionType === 'call' ? Math.max(0, S - strikeEUR) : Math.max(0, strikeEUR - S);
      var rel = pos.optionType === 'call' ? (S - strikeEUR) / strikeEUR : (strikeEUR - S) / strikeEUR;
      moneyness = rel > 0.005 ? 'ITM' : (rel < -0.005 ? 'OTM' : 'ATM');
      // Signed position value: long contracts hold intrinsic value, short owe it.
      intrinsicValueEUR = pos.netContracts * intrinsicPerShare * pos.contractSize;
      estPnlEUR = intrinsicValueEUR + pos.netPremiumEUR;
    } else if (pos.side === 'closed') {
      estPnlEUR = pos.netPremiumEUR; // realised: no market input needed
    } else if (status === 'expired') {
      // Expired without a price: worthless expiry is the conservative estimate
      // for longs and the favourable one for shorts — label it estimated.
      estPnlEUR = pos.netPremiumEUR;
    }
    if (pos.side === 'closed') { intrinsicValueEUR = 0; estPnlEUR = pos.netPremiumEUR; }

    return {
      status: status,
      daysToExpiry: daysToExpiry,
      strikeEUR: strikeEUR,
      intrinsicPerShare: intrinsicPerShare,
      intrinsicValueEUR: intrinsicValueEUR,
      moneyness: moneyness,
      notionalEUR: Math.abs(pos.netContracts) * pos.contractSize * strikeEUR,
      estPnlEUR: estPnlEUR
    };
  }

  // ---- book-level stats (PURE) ----------------------------------------------------------
  // prices: the app's EUR-canonical price map (underlying symbols). Returns the
  // positions enriched with metrics plus the aggregate book numbers.
  function computeStats(positions, prices, opts) {
    opts = opts || {};
    prices = prices || {};
    var rows = (positions || []).map(function (p) {
      var s = p.underlying;
      var priceEUR = num(prices[s] != null ? prices[s] : (prices[s.toLowerCase()] != null ? prices[s.toLowerCase()] : prices[s.toUpperCase()]));
      var m = positionMetrics(p, priceEUR, opts);
      return { position: p, metrics: m, underlyingPriceEUR: priceEUR };
    });

    var open = rows.filter(function (r) { return r.metrics.status === 'open'; });
    var sum = function (list, fn) { return list.reduce(function (s, r) { return s + (fn(r) || 0); }, 0); };
    return {
      rows: rows,
      openCount: open.length,
      openContracts: sum(open, function (r) { return Math.abs(r.position.netContracts); }),
      netPremiumEUR: sum(rows, function (r) { return r.position.netPremiumEUR; }),
      intrinsicValueEUR: sum(open, function (r) { return r.metrics.intrinsicValueEUR; }),
      estPnlEUR: sum(rows, function (r) { return r.metrics.estPnlEUR; }),
      expiringSoon: open.filter(function (r) { return r.metrics.daysToExpiry <= 30; })
        .sort(function (a, b) { return a.metrics.daysToExpiry - b.metrics.daysToExpiry; })
    };
  }

  // Does the transaction list contain option transactions at all? The Overview
  // panel gates on this so non-options users never see the section.
  function hasOptionTransactions(transactions) {
    return (transactions || []).some(function (tx) { return tx && tx.category === CATEGORY; });
  }

  // ---- React Panel (browser only; folds into the Overview) -----------------------
  function Panel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var transactions = props.transactions || [];
    if (!hasOptionTransactions(transactions)) return null;
    var e = React.createElement;
    var theme = props.theme || {};
    var t = props.t || {};
    var text = theme.text || '#e6edf3', dim = theme.textSecondary || '#9aa4b2';
    var border = theme.cardBorder || 'rgba(255,255,255,0.1)';
    var inputBg = theme.inputBg || '#0f172a', card = theme.card || theme.cardBg || '#10151f';
    var good = theme.success || '#22c55e', warn = theme.warning || '#f59e0b', bad = theme.danger || theme.negative || '#ef4444';
    var fmt = props.formatPrice || function (v) { return Number(v || 0).toFixed(2); };
    var sym = (props.getCurrencySymbol && props.getCurrencySymbol()) || '€';
    var rate = props.exchangeRate || 0;

    var positions = buildOptionPositions(transactions, { exchangeRate: rate });
    var stats = computeStats(positions, props.prices || {}, { exchangeRate: rate });

    var pnlColor = function (v) { return v == null ? dim : (v >= 0 ? good : bad); };
    var signed = function (v) { return v == null ? '-' : ((v >= 0 ? '+' : '-') + sym + fmt(Math.abs(v))); };

    function kpi(label, value, color) {
      return e('div', { key: label, style: { background: inputBg, border: '1px solid ' + border, borderRadius: '10px', padding: '0.7rem 0.9rem', minWidth: '120px' } },
        e('div', { style: { color: dim, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em' } }, label),
        e('div', { style: { color: color || text, fontSize: '1.1rem', fontWeight: '700', marginTop: '0.15rem' } }, value));
    }

    var header = ['Contract', 'Side', 'Contracts', 'Net premium', 'Expiry', 'Moneyness', 'Intrinsic', 'Est. P&L'];
    var bodyRows = stats.rows.map(function (r) {
      var p = r.position, m = r.metrics;
      var sideColor = p.side === 'long' ? good : (p.side === 'short' ? warn : dim);
      var expiryTxt = m.status === 'closed' ? 'closed'
        : (m.status === 'expired' ? 'expired' : (p.expiry + ' (' + m.daysToExpiry + 'd)'));
      return e('tr', { key: p.key, style: { borderTop: '1px solid ' + border, opacity: m.status === 'open' ? 1 : 0.65 } },
        e('td', { style: { padding: '0.45rem 0.5rem', color: text, fontSize: '0.8rem', fontWeight: 600 } }, p.symbol),
        e('td', { style: { padding: '0.45rem 0.5rem', color: sideColor, fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase' } }, p.side),
        e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: text, fontSize: '0.78rem' } }, String(Math.abs(p.netContracts)) + ' x ' + p.contractSize),
        e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: pnlColor(p.netPremiumEUR), fontSize: '0.78rem' } }, signed(p.netPremiumEUR)),
        e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: m.status === 'open' && m.daysToExpiry <= 30 ? warn : dim, fontSize: '0.78rem', whiteSpace: 'nowrap' } }, expiryTxt),
        e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: m.moneyness === 'ITM' ? good : dim, fontSize: '0.78rem' } }, m.moneyness || '-'),
        e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: dim, fontSize: '0.78rem' } }, m.intrinsicValueEUR != null ? sym + fmt(m.intrinsicValueEUR) : '-'),
        e('td', { style: { padding: '0.45rem 0.5rem', textAlign: 'right', color: pnlColor(m.estPnlEUR), fontSize: '0.78rem', fontWeight: 700 } }, signed(m.estPnlEUR)));
    });

    return e('div', { style: { background: card, border: '1px solid ' + border, borderRadius: '14px', padding: '1.25rem', marginBottom: '1.5rem' } },
      e('h3', { style: { color: text, fontSize: '1rem', fontWeight: 700, margin: '0 0 0.9rem' } }, t.optionsTitle || 'Options'),
      e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '0.9rem' } },
        kpi('Open positions', String(stats.openCount) + ' (' + stats.openContracts + ' contracts)'),
        kpi('Net premium', signed(stats.netPremiumEUR), pnlColor(stats.netPremiumEUR)),
        kpi('Intrinsic value', sym + fmt(stats.intrinsicValueEUR)),
        kpi('Est. P&L', signed(stats.estPnlEUR), pnlColor(stats.estPnlEUR)),
        stats.expiringSoon.length ? kpi('Expiring in 30d', String(stats.expiringSoon.length), warn) : null),
      e('div', { style: { overflowX: 'auto' } },
        e('table', { style: { width: '100%', borderCollapse: 'collapse' } },
          e('thead', null, e('tr', null, header.map(function (h, i) {
            return e('th', { key: h, style: { textAlign: i < 2 ? 'left' : 'right', padding: '0.4rem 0.5rem', color: dim, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.04em' } }, h);
          }))),
          e('tbody', null, bodyRows))),
      e('div', { style: { color: dim, fontSize: '0.7rem', marginTop: '0.7rem', lineHeight: 1.5 } },
        'Valuation is intrinsic-only (no time value, no Greeks): an estimate from the current underlying price, not a market quote. Options are tracked separately and are not part of the portfolio value or tax figures. Not investment advice.'));
  }

  var api = {
    CATEGORY: CATEGORY,
    DEFAULT_CONTRACT_SIZE: DEFAULT_CONTRACT_SIZE,
    contractSymbol: contractSymbol,
    contractKey: contractKey,
    validateOptionTx: validateOptionTx,
    buildOptionPositions: buildOptionPositions,
    positionMetrics: positionMetrics,
    computeStats: computeStats,
    hasOptionTransactions: hasOptionTransactions,
    Panel: Panel
  };
  if (typeof window !== 'undefined') window.MaerminOptions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
