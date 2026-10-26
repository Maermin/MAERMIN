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
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var CATEGORY = 'options';
  var DEFAULT_CONTRACT_SIZE = 100;

  function num(x) {
    var n = typeof x === 'number' ? x : parseFloat(x);
    return (typeof n === 'number' && isFinite(n)) ? n : null;
  }
  function toEUR(amount, currency, rate) {
    var U = (typeof window !== 'undefined' && window.MaerminUtils) || null;
    if (!U && typeof require === 'function') { try { U = require('./utils.js'); } catch (e) { U = null; } }
    if (U && U.toEUR) return U.toEUR(amount, currency, rate);
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
    if (!String(tx.underlying || '').trim()) errors.push(__('opUnderlyingReq', 'Underlying symbol is required.'));
    if (tx.optionType !== 'call' && tx.optionType !== 'put') errors.push(__('opTypeReq', 'Option type must be call or put.'));
    var k = num(tx.strike);
    if (k == null || k <= 0) errors.push(__('opStrikeReq', 'Strike must be a number greater than 0.'));
    var ex = String(tx.expiry || '');
    if (!/^\d{4}-\d{2}-\d{2}/.test(ex) || isNaN(new Date(ex).getTime())) errors.push(__('opExpiryReq', 'Expiry must be a valid date (YYYY-MM-DD).'));
    var cs = num(tx.contractSize);
    if (tx.contractSize != null && tx.contractSize !== '' && (cs == null || cs <= 0)) errors.push(__('opSizeReq', 'Contract size must be a number greater than 0.'));
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
    var t = props.t || ((typeof window !== 'undefined' && window.MaerminI18n) ? window.MaerminI18n.dict() : {});
    // R4.6: a Card with Stat tiles and the shared Table (phone rows)
    var UIC = window.MaerminComponents;
    var fmt = props.formatPrice || function (v) { return window.MaerminI18n.num(v, 2); };
    var sym = (props.getCurrencySymbol && props.getCurrencySymbol()) || '€';
    var rate = props.exchangeRate || 0;

    var positions = buildOptionPositions(transactions, { exchangeRate: rate });
    var stats = computeStats(positions, props.prices || {}, { exchangeRate: rate });

    var signed = function (v) { return v == null ? '-' : ((v >= 0 ? '+' : '−') + fmt(Math.abs(v)) + ' ' + sym); };
    var tone = function (v) { return v == null ? null : UIC.toneOf(v); };

    function kpi(label, value, tn) {
      return e(UIC.Stat, { key: label, className: 'ui-tile', label: label, value: value, tone: tn || null });
    }
    var sideLabel = function (p) { return ({ long: 'Long', short: 'Short', flat: __('opFlat', 'flat') })[p.side] || p.side; };
    var expiry = function (r) {
      var p = r.position, m = r.metrics;
      if (m.status === 'closed') return e(UIC.Badge, null, __('opClosed', 'closed'));
      if (m.status === 'expired') return e(UIC.Badge, null, __('opExpired', 'expired'));
      var txt = window.MaerminI18n.date(p.expiry) + ' (' + __('retDays', '{n} d', { n: m.daysToExpiry }) + ')';
      return m.daysToExpiry <= 30 ? e(UIC.Badge, { tone: 'warning' }, txt) : txt;
    };
    var pnl = function (v) { return e('span', { className: v == null ? '' : 'tone-' + UIC.toneOf(v) }, signed(v)); };
    var columns = [
      { key: 'contract', label: __('opContract', 'Contract'), phone: 'title', render: function (r) { return e('b', null, r.position.symbol); } },
      { key: 'side', label: __('opSide', 'Side'), phone: 'meta', render: function (r) { return e(UIC.Badge, null, sideLabel(r.position)); } },
      { key: 'contracts', label: __('opContracts', 'Contracts'), align: 'right', phone: 'meta', render: function (r) { return String(Math.abs(r.position.netContracts)) + ' × ' + r.position.contractSize; } },
      { key: 'premium', label: __('opNetPremium', 'Net premium'), align: 'right', priority: 2, render: function (r) { return pnl(r.position.netPremiumEUR); } },
      { key: 'expiry', label: __('opExpiry', 'Expiry'), align: 'right', phone: 'meta', render: expiry },
      { key: 'money', label: __('opMoneyness', 'Moneyness'), align: 'right', priority: 2, render: function (r) { return r.metrics.moneyness || '-'; } },
      { key: 'intrinsic', label: __('opIntrinsic', 'Intrinsic'), align: 'right', priority: 3, render: function (r) { return r.metrics.intrinsicValueEUR != null ? fmt(r.metrics.intrinsicValueEUR) + ' ' + sym : '-'; } },
      { key: 'pnl', label: __('opEstPnl', 'Est. P&L'), align: 'right', phone: 'value', render: function (r) { return e('b', null, pnl(r.metrics.estPnlEUR)); } }
    ];

    return e(UIC.Card, { className: 'ui-options', headingLevel: 'h3', title: t.optionsTitle || 'Options', 'data-testid': 'options-panel' },
      e('div', { className: 'ui-tiles' },
        kpi(__('retOpenPositions', 'Open positions'), String(stats.openCount) + ' (' + __('opNContracts', '{n} {n:contract|contracts}', { n: stats.openContracts }) + ')'),
        kpi(__('opNetPremium', 'Net premium'), signed(stats.netPremiumEUR), tone(stats.netPremiumEUR)),
        kpi(__('opIntrinsicValue', 'Intrinsic value'), fmt(stats.intrinsicValueEUR) + ' ' + sym),
        kpi(__('opEstPnl', 'Est. P&L'), signed(stats.estPnlEUR), tone(stats.estPnlEUR)),
        stats.expiringSoon.length ? kpi(__('opExpiring30', 'Expiring in 30d'), String(stats.expiringSoon.length), 'warning') : null),
      e(UIC.Table, { columns: columns, rows: stats.rows, rowKey: function (r) { return r.position.key; }, caption: t.optionsTitle || 'Options' }),
      e('p', { className: 'ui-note' },
        __('opFootnote', 'Valuation is intrinsic-only (no time value, no Greeks): an estimate from the current underlying price, not a market quote. Options are tracked separately and are not part of the portfolio value or tax figures. Not investment advice.')));
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
