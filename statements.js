// ============================================================================
// MAERMIN — Statements and audit exports  (window.MaerminStatements)
// ----------------------------------------------------------------------------
// P5-4.8. Four outputs, all from the ONE ledger (ledger.js) so they agree
// with the positions and the tax report:
//
//   assetStatement   statement of assets (Vermögensaufstellung) as of a date:
//                    per portfolio the holdings (quantity, price, value, cost)
//                    and the clearing-account balance where cash is tracked
//   rollForward      cost roll-forward per holding and year (audit): opening
//                    + purchases - cost of sales = closing, each row checked
//   datevRows/CSV    DATEV-style bookings (Buchungsstapel column order), one
//                    per cash movement, with the user's own accounts
//   sourceOfFunds    for a crypto sale: the FIFO lots it used and what paid
//                    for each (fiat in a named portfolio, or a swap from
//                    another coin, followed back up to 5 steps)
//
// The statement PDF can be protected with a password: AES-256 (PDF 2.0,
// revision 6) through MaerminPdfAes, never jsPDF's weak RC4. The DATEV
// accounts are the user's (maermin_datev_accounts, plain: account numbers
// only); unset ones stay empty and are reported, nothing is guessed. The
// pure part is Node-tested in test/statements.test.js; PDFs and the Panel are
// browser-only.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var NON_HOLDINGS = { options: true, cash: true, cashflow: true };
  var ACCOUNTS_KEY = 'maermin_datev_accounts';
  var ACCOUNT_KEYS = ['bank', 'securities', 'crypto', 'dividends', 'interest', 'fees', 'taxes', 'transfer'];
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function ymd(d) { return String(d || '').slice(0, 10); }
  function ledger() {
    if (typeof window !== 'undefined' && window.MaerminLedger) return window.MaerminLedger;
    return require('./ledger.js');
  }
  function fxh() {
    if (typeof window !== 'undefined' && window.MaerminFxHistory) return window.MaerminFxHistory;
    try { return require('./fx-history.js'); } catch (e) { return null; }
  }
  function I18N() { return (typeof window !== 'undefined' && window.MaerminI18n) || require('./i18n.js'); }
  // Amount of a transaction in EUR (the ledger's rule: USD at the rate of the
  // date, other fiat through the currency history).
  function eur(amount, tx, rate, fxAt) {
    var F = fxh();
    if (F && F.txToEUR) return F.txToEUR(amount, tx.currency, tx.date, rate, fxAt).value;
    return String(tx.currency || 'EUR').toUpperCase() === 'USD' && rate > 0 ? num(amount) * rate : num(amount);
  }
  function isFiat(cur) {
    var c = String(cur || 'EUR').toUpperCase();
    if (c === 'EUR' || c === 'USD') return true;
    var F = fxh();
    return !!(F && F.hasHistory && F.hasHistory(c));
  }
  // Current unit price in EUR: crypto prices are EUR in the app's price map,
  // others are in the currency of their latest trade.
  function priceEUR(prices, sym, category, currency, rate, date) {
    var p = prices || {};
    var v = parseFloat(p[sym] != null ? p[sym] : p[String(sym).toLowerCase()]);
    if (!(isFinite(v) && v > 0)) return null;
    if (category === 'crypto') return v;
    var c = String(currency || 'EUR').toUpperCase();
    if (c === 'EUR') return v;
    if (c === 'USD') return rate > 0 ? v * rate : null;
    var F = fxh();
    if (F && F.txToEUR) { var r = F.txToEUR(v, c, date, rate, null); return r && r.status !== 'unknown' ? r.value : null; }
    return null;
  }

  // ---- statement of assets ------------------------------------------------------
  function assetStatement(transactions, opts) {
    opts = opts || {};
    var asOf = ymd(opts.asOf) || (typeof window !== 'undefined' && window.MaerminUtils ? window.MaerminUtils : require('./utils.js')).todayISO();
    var rate = num(opts.exchangeRate) || 1;
    var txs = (transactions || []).filter(function (tx) { return tx && ymd(tx.date) && ymd(tx.date) <= asOf; });
    var names = {}, order = [];
    (opts.portfolios || []).forEach(function (p) { if (p && p.id != null) { names[p.id] = p.name || p.id; order.push(String(p.id)); } });
    txs.forEach(function (tx) { var id = String(tx.portfolioId || 'default'); if (order.indexOf(id) === -1) order.push(id); });
    var L = ledger(), missing = [];
    var out = order.map(function (id) {
      var own = txs.filter(function (tx) { return String(tx.portfolioId || 'default') === id; });
      var cur = {};
      own.forEach(function (tx) { if (tx.type === 'buy' || tx.type === 'sell') cur[(tx.category || 'crypto') + '|' + String(tx.symbol || '').toUpperCase()] = tx.currency || 'EUR'; });
      var holdings = [];
      L.build(own.filter(function (tx) { return !NON_HOLDINGS[tx.category]; }), { exchangeRate: rate, fxAt: opts.fxAt }).list.forEach(function (g) {
        if (!(g.openQty > 1e-9)) return;
        var sym = String(g.symbol || '').toUpperCase();
        var price = priceEUR(opts.prices, sym, g.category, cur[g.category + '|' + sym], rate, asOf);
        if (price == null && missing.indexOf(sym) === -1) missing.push(sym);
        holdings.push({ category: g.category, symbol: sym, name: g.symbolName || sym, quantity: g.openQty, price: price,
          value: price != null ? g.openQty * price : null, cost: g.openCostEUR });
      });
      holdings.sort(function (a, b) { return (b.value || 0) - (a.value || 0) || (a.symbol < b.symbol ? -1 : 1); });
      var tracked = own.some(function (tx) { return L.isCash && L.isCash(tx); });
      var cash = tracked ? r2(L.clearingBalance(own, id, { exchangeRate: rate, fxAt: opts.fxAt }).balanceEUR) : null;
      var total = holdings.reduce(function (s, h) { return s + (h.value || 0); }, 0) + (cash || 0);
      return { id: id, name: names[id] || id, holdings: holdings, cash: cash, total: total };
    }).filter(function (p) { return p.holdings.length || p.cash != null; });
    return { asOf: asOf, portfolios: out, total: out.reduce(function (s, p) { return s + p.total; }, 0), missingPrices: missing };
  }

  // ---- cost roll-forward (audit) -----------------------------------------------------
  function rollForward(transactions, opts) {
    opts = opts || {};
    var year = parseInt(opts.year, 10) || new Date().getFullYear();
    var rate = num(opts.exchangeRate) || 1;
    var start = year + '-01-01', end = year + '-12-31';
    var txs = (transactions || []).filter(function (tx) { return tx && !NON_HOLDINGS[tx.category] && (tx.type === 'buy' || tx.type === 'sell'); });
    var L = ledger(), lo = { exchangeRate: rate, fxAt: opts.fxAt };
    var open = L.build(txs.filter(function (tx) { return ymd(tx.date) < start; }), lo).groups;
    var close = L.build(txs.filter(function (tx) { return ymd(tx.date) <= end; }), lo).groups;
    var bought = L.build(txs.filter(function (tx) { return tx.type === 'buy' && ymd(tx.date) >= start && ymd(tx.date) <= end; }), lo).groups;
    var keys = {};
    [open, close].forEach(function (g) { Object.keys(g).forEach(function (k) { keys[k] = true; }); });
    var rows = Object.keys(keys).sort().map(function (k) {
      var o = open[k], c = close[k], b = bought[k];
      var g = c || o;
      var sold = (c ? c.disposals : []).filter(function (d) { return d.disposalDate >= start && d.disposalDate <= end; });
      var row = {
        category: g.category, symbol: String(g.symbol || '').toUpperCase(),
        openingQty: o ? o.openQty : 0, openingCost: o ? o.openCostEUR : 0,
        boughtQty: b ? b.openQty : 0, boughtCost: b ? b.openCostEUR : 0,
        soldQty: sold.reduce(function (s, d) { return s + d.qty; }, 0),
        soldCost: sold.reduce(function (s, d) { return s + d.costBasis; }, 0),
        proceeds: sold.reduce(function (s, d) { return s + d.proceeds; }, 0),
        realized: sold.reduce(function (s, d) { return s + d.gain; }, 0),
        closingQty: c ? c.openQty : 0, closingCost: c ? c.openCostEUR : 0,
        oversold: Math.max(0, (c ? c.oversold : 0) - (o ? o.oversold : 0))
      };
      row.difference = r2(row.openingCost + row.boughtCost - row.soldCost - row.closingCost);
      row.ok = Math.abs(row.difference) < 0.01 && Math.abs(row.openingQty + row.boughtQty - row.soldQty - row.closingQty) < 1e-6 && row.oversold < 1e-9;
      return row;
    }).filter(function (r) { return r.openingQty > 1e-9 || r.boughtQty > 1e-9 || r.soldQty > 1e-9 || r.closingQty > 1e-9 || r.oversold > 1e-9; });
    return { year: year, rows: rows, ok: rows.every(function (r) { return r.ok; }) };
  }
  function deNum(v, dec) { return (Math.round(num(v) * Math.pow(10, dec)) / Math.pow(10, dec)).toFixed(dec).replace('.', ','); }
  // Text that a spreadsheet would read as a formula (= + - @, tab, CR) gets a
  // leading apostrophe; numbers in German format ("-1,23") stay numbers.
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (!/^-?\d+(,\d+)?$/.test(s) && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function rollForwardCSV(rf) {
    var head = [__('stmCategory', 'Category'), __('stmSymbol', 'Symbol'), __('stmOpenQty', 'Opening quantity'), __('stmOpenCost', 'Opening cost'),
      __('stmBoughtQty', 'Bought quantity'), __('stmBoughtCost', 'Purchases'), __('stmSoldQty', 'Sold quantity'), __('stmSoldCost', 'Cost of sales'),
      __('stmProceeds', 'Proceeds'), __('stmRealized', 'Realised'), __('stmCloseQty', 'Closing quantity'), __('stmCloseCost', 'Closing cost'), __('stmCheck', 'Check')];
    return [head.join(';')].concat((rf.rows || []).map(function (r) {
      return [r.category, r.symbol, deNum(r.openingQty, 8), deNum(r.openingCost, 2), deNum(r.boughtQty, 8), deNum(r.boughtCost, 2), deNum(r.soldQty, 8),
        deNum(r.soldCost, 2), deNum(r.proceeds, 2), deNum(r.realized, 2), deNum(r.closingQty, 8), deNum(r.closingCost, 2),
        r.ok ? 'OK' : (r.oversold > 1e-9 ? __('stmOversold', 'oversold {q}', { q: deNum(r.oversold, 8) }) : __('stmOff', 'off by {v}', { v: deNum(r.difference, 2) }))].map(csvCell).join(';');
    })).join('\n');
  }

  // ---- DATEV-style bookings -------------------------------------------------------------
  function bookingText(type) {
    switch (type) {
      case 'fee': return __('stmBkFee', 'Fee');
      case 'fee_refund': return __('stmBkFeeRefund', 'Fee refund');
      case 'tax': return __('stmBkTax', 'Tax');
      case 'tax_refund': return __('stmBkTaxRefund', 'Tax refund');
      case 'interest_charge': return __('stmBkInterestCharge', 'Interest charged');
      case 'deposit': return __('stmBkDeposit', 'Deposit');
      case 'transfer_in': return __('stmBkTransferIn', 'Transfer in');
      case 'withdrawal': return __('stmBkWithdrawal', 'Withdrawal');
      default: return __('stmBkTransferOut', 'Transfer out');
    }
  }
  function datevRows(transactions, opts) {
    opts = opts || {};
    var year = parseInt(opts.year, 10) || new Date().getFullYear();
    var rate = num(opts.exchangeRate) || 1;
    var a = opts.accounts || {};
    var used = {};
    function acc(k) { used[k] = true; return a[k] ? String(a[k]) : ''; }
    var rows = [];
    (transactions || []).forEach(function (tx) {
      if (!tx || parseInt(ymd(tx.date).slice(0, 4), 10) !== year || tx.category === 'options') return;
      var d = ymd(tx.date), fees = Math.max(0, num(tx.fees)), q = num(tx.quantity), sym = String(tx.symbol || '').toUpperCase();
      var asset = tx.category === 'crypto' ? 'crypto' : 'securities';
      var row = null;
      if (tx.type === 'buy' && q > 0) row = { amount: eur(q * num(tx.price) + fees, tx, rate, opts.fxAt), konto: acc(asset), gegenkonto: acc('bank'), text: __('stmBkBuy', 'Buy {q} {s}', { q: deNum(q, 8).replace(/,?0+$/, ''), s: sym }) };
      else if (tx.type === 'sell' && q > 0) row = { amount: eur(q * num(tx.price) - fees, tx, rate, opts.fxAt), konto: acc('bank'), gegenkonto: acc(asset), text: __('stmBkSell', 'Sale {q} {s}', { q: deNum(q, 8).replace(/,?0+$/, ''), s: sym }) };
      else if (tx.type === 'dividend' || tx.type === 'interest') {
        var gross = q * num(tx.price) || num(tx.amount);
        var net = gross - Math.max(0, num(tx.withholdingTax)) - fees;
        if (tx.source === 'interest-accrual') return;
        row = { amount: eur(net, tx, rate, opts.fxAt), konto: acc('bank'), gegenkonto: acc(tx.type === 'dividend' ? 'dividends' : 'interest'),
          text: tx.type === 'dividend' ? __('stmBkDividend', 'Dividend {s}', { s: sym }) : __('stmBkInterest', 'Interest {s}', { s: sym || '' }) };
      } else {
        var amt = eur(num(tx.amount), tx, rate, opts.fxAt);
        var map = { fee: ['fees', 'bank'], fee_refund: ['bank', 'fees'], tax: ['taxes', 'bank'], tax_refund: ['bank', 'taxes'], interest_charge: ['fees', 'bank'],
          deposit: ['bank', 'transfer'], transfer_in: ['bank', 'transfer'], withdrawal: ['transfer', 'bank'], transfer_out: ['transfer', 'bank'] }[tx.type];
        if (!map || !(amt > 0)) return;
        row = { amount: amt, konto: acc(map[0]), gegenkonto: acc(map[1]), text: bookingText(tx.type) };
      }
      if (!row || !(row.amount > 0)) return;
      rows.push({ amount: r2(row.amount), sh: 'S', currency: 'EUR', konto: row.konto, gegenkonto: row.gegenkonto,
        date: d.slice(8, 10) + d.slice(5, 7), iso: d, beleg: tx.id != null ? String(tx.id).slice(0, 36) : '', text: String(row.text).slice(0, 60) });
    });
    rows.sort(function (x, y) { return x.iso < y.iso ? -1 : x.iso > y.iso ? 1 : 0; });
    rows.missingAccounts = Object.keys(used).filter(function (k) { return !a[k]; });
    return rows;
  }
  function datevCSV(rows) {
    // The DATEV format's own column names: never translated (i18n baseline 1).
    var head = 'Umsatz (ohne Soll/Haben-Kz);Soll/Haben-Kennzeichen;WKZ Umsatz;Konto;Gegenkonto (ohne BU-Schlüssel);Belegdatum;Belegfeld 1;Buchungstext';
    return [head].concat((rows || []).map(function (r) {
      return [deNum(r.amount, 2), r.sh, r.currency, r.konto, r.gegenkonto, r.date, r.beleg, r.text].map(csvCell).join(';');
    })).join('\n');
  }
  function loadAccounts() { try { var v = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || 'null'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } }
  function saveAccounts(a) {
    var out = {};
    ACCOUNT_KEYS.forEach(function (k) { var v = String((a || {})[k] || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 9); if (v) out[k] = v; });
    try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(out)); } catch (e) { /* non-fatal */ }
    return out;
  }

  // ---- source of funds (crypto) -------------------------------------------------------------
  function cryptoSales(transactions) {
    return (transactions || []).filter(function (tx) { return tx && tx.category === 'crypto' && tx.type === 'sell' && tx.id != null && num(tx.quantity) > 0; })
      .map(function (tx) { return { txId: tx.id, symbol: String(tx.symbol || '').toUpperCase(), date: ymd(tx.date), quantity: num(tx.quantity), portfolioId: tx.portfolioId || 'default' }; })
      .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
  }
  function sourceOfFunds(transactions, saleTxId, opts, depth) {
    opts = opts || {}; depth = depth || 0;
    var txs = transactions || [];
    var sale = txs.filter(function (tx) { return tx && tx.id === saleTxId && tx.type === 'sell' && tx.category === 'crypto'; })[0];
    if (!sale) return null;
    var sym = String(sale.symbol || '').toUpperCase();
    var names = {}; (opts.portfolios || []).forEach(function (p) { if (p) names[p.id] = p.name; });
    var coinTxs = txs.filter(function (tx) { return tx && tx.category === 'crypto' && String(tx.symbol || '').toUpperCase() === sym; });
    var built = ledger().build(coinTxs, { exchangeRate: num(opts.exchangeRate) || 1, fxAt: opts.fxAt, perWallet: opts.perWallet ? ['crypto'] : undefined });
    var lots = [];
    built.list.forEach(function (g) {
      g.disposals.forEach(function (d) {
        if (d.disposalTxId !== saleTxId) return;
        var buy = txs.filter(function (tx) { return tx && tx.id === d.acquisitionTxId; })[0] || null;
        var funding = { kind: 'unknown' };
        if (buy) {
          var cur = String(buy.currency || 'EUR').toUpperCase(), pid = buy.portfolioId || 'default';
          if (isFiat(cur)) funding = { kind: 'fiat', currency: cur, portfolioId: pid, portfolioName: names[pid] || pid };
          else if (txs.some(function (tx) { return tx && tx.category === 'crypto' && String(tx.symbol || '').toUpperCase() === cur; })) {
            // A swap: the paying coin was sold the same day (same portfolio first).
            var paid = txs.filter(function (tx) { return tx && tx.category === 'crypto' && tx.type === 'sell' && String(tx.symbol || '').toUpperCase() === cur && ymd(tx.date) === ymd(buy.date); })
              .sort(function (x, y) { return (String(x.portfolioId || 'default') === pid ? 0 : 1) - (String(y.portfolioId || 'default') === pid ? 0 : 1); })[0];
            funding = { kind: 'swap', from: cur, portfolioId: pid, portfolioName: names[pid] || pid,
              trace: paid && depth < 5 ? sourceOfFunds(txs, paid.id, opts, depth + 1) : null, truncated: !!(paid && depth >= 5) };
          } else funding = { kind: 'unknown', currency: cur };
        }
        lots.push({ acquisitionDate: d.acquisitionDate, quantity: d.qty, costEUR: d.costBasis, txId: d.acquisitionTxId, portfolioId: buy ? (buy.portfolioId || 'default') : null, funding: funding });
      });
    });
    return { sale: { txId: sale.id, symbol: sym, date: ymd(sale.date), quantity: num(sale.quantity), price: num(sale.price), currency: sale.currency || 'EUR',
      portfolioId: sale.portfolioId || 'default', portfolioName: names[sale.portfolioId || 'default'] || sale.portfolioId || 'default' }, lots: lots };
  }
  function sourceOfFundsLines(tr, indent) {
    indent = indent || '';
    if (!tr) return [];
    var I = I18N(), q = function (v) { return I.num ? I.num(v, { min: 0, max: 8 }) : String(v); };
    var lines = [indent + __('stmSofSale', 'Sale of {q} {s} on {d} ({p})', { q: q(tr.sale.quantity), s: tr.sale.symbol, d: I.date ? I.date(tr.sale.date) : tr.sale.date, p: tr.sale.portfolioName })];
    tr.lots.forEach(function (l) {
      var f = l.funding || {};
      var how = f.kind === 'fiat' ? __('stmSofFiat', 'paid in {c} from {p}', { c: f.currency, p: f.portfolioName })
        : f.kind === 'swap' ? __('stmSofSwap', 'swapped from {c} in {p}', { c: f.from, p: f.portfolioName })
        : __('stmSofUnknown', 'source not recorded');
      lines.push(indent + '  • ' + __('stmSofLot', '{q} {s} bought on {d}: {how}', { q: q(l.quantity), s: tr.sale.symbol, d: I.date ? I.date(l.acquisitionDate) : l.acquisitionDate, how: how }));
      if (f.kind === 'swap') {
        if (f.trace) lines = lines.concat(sourceOfFundsLines(f.trace, indent + '    '));
        else lines.push(indent + '    ' + (f.truncated ? __('stmSofDeep', '(traced 5 steps; stopped here)') : __('stmSofNoSale', '(no sale of {c} recorded on that day)', { c: f.from })));
      }
    });
    return lines;
  }

  // ---- PDFs (browser) ---------------------------------------------------------------------------
  function newDoc() {
    var R = window.MaerminTaxReport;
    return (R && R.loadJsPdf ? R.loadJsPdf() : Promise.reject(new Error('PDF library not loaded'))).then(function (JsPDF) { return new JsPDF(); });
  }
  function saveDoc(doc, filename, password) {
    var bytes = new Uint8Array(doc.output('arraybuffer'));
    var p = password ? window.MaerminPdfAes.encryptPdf(bytes, { userPassword: password }) : Promise.resolve(bytes);
    return p.then(function (out) {
      var blob = new Blob([out], { type: 'application/pdf' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      return true;
    });
  }
  function header(doc, title, sub) {
    var W = doc.internal.pageSize.getWidth();
    doc.setFillColor(126, 34, 206); doc.rect(0, 0, W, 30, 'F');
    doc.setTextColor(255, 255, 255); doc.setFontSize(18); doc.setFont('helvetica', 'bold'); doc.text(title, 14, 18);
    doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.text(sub, 14, 25);
    doc.setTextColor(30, 41, 59);
    return 40;
  }
  function statementPdf(st, rf, o) {
    o = o || {};
    var I = I18N(), money = function (v) { return v == null ? '–' : I.money(v, 'EUR'); }, qty = function (v) { return I.num(v, { min: 0, max: 8 }); };
    return newDoc().then(function (doc) {
      var y = header(doc, __('stmTitle', 'Statement of assets'), __('stmAsOf', 'As of {d}', { d: I.date(st.asOf) }) + ' · ' + 'MAERMIN');
      if (o.owner) { doc.setFontSize(10); doc.text(o.owner, 14, y); y += 8; }
      st.portfolios.forEach(function (p) {
        var body = p.holdings.map(function (h) { return [h.symbol, qty(h.quantity), money(h.price), money(h.value), money(h.cost)]; });
        if (p.cash != null) body.push([__('stmCash', 'Clearing account'), '', '', money(p.cash), '']);
        body.push([{ content: __('stmPfTotal', 'Total {p}', { p: p.name }), styles: { fontStyle: 'bold' } }, '', '', { content: money(p.total), styles: { fontStyle: 'bold' } }, '']);
        doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.text(p.name, 14, y);
        doc.autoTable({ head: [[__('stmHolding', 'Holding'), __('stmQty', 'Quantity'), __('stmPrice', 'Price'), __('stmValue', 'Value'), __('stmCost', 'Cost')]], body: body, startY: y + 3,
          styles: { fontSize: 8 }, headStyles: { fillColor: [126, 34, 206] }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } }, margin: { left: 14, right: 14 } });
        y = doc.lastAutoTable.finalY + 8;
      });
      doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.text(__('stmGrandTotal', 'Total assets: {v}', { v: money(st.total) }), 14, y); y += 7;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      if (st.missingPrices.length) { doc.text(__('stmMissing', 'Without a current price (not in the total): {list}', { list: st.missingPrices.join(', ') }), 14, y); y += 5; }
      doc.text(__('stmPdfNote', 'Values at the last known prices in EUR; cost incl. purchase fees (FIFO). Compiled by MAERMIN from your own records, not a bank statement.'), 14, y, { maxWidth: doc.internal.pageSize.getWidth() - 28 });
      if (rf && rf.rows.length) {
        doc.addPage();
        var y2 = header(doc, __('stmRfTitle', 'Cost roll-forward {y}', { y: rf.year }), rf.ok ? __('stmRfOk', 'Every holding adds up') : __('stmRfNotOk', 'Some holdings do not add up: see the last column'));
        doc.autoTable({ head: [[__('stmSymbol', 'Symbol'), __('stmOpenCost', 'Opening cost'), __('stmBoughtCost', 'Purchases'), __('stmSoldCost', 'Cost of sales'), __('stmCloseCost', 'Closing cost'), __('stmRealized', 'Realised'), __('stmCheck', 'Check')]],
          body: rf.rows.map(function (r) { return [r.symbol, money(r.openingCost), money(r.boughtCost), money(r.soldCost), money(r.closingCost), money(r.realized), r.ok ? 'OK' : (r.oversold > 1e-9 ? __('stmOversold', 'oversold {q}', { q: qty(r.oversold) }) : money(r.difference))]; }),
          startY: y2, styles: { fontSize: 8 }, headStyles: { fillColor: [126, 34, 206] }, margin: { left: 14, right: 14 } });
      }
      return saveDoc(doc, 'maermin-statement-' + st.asOf + '.pdf', o.password);
    });
  }
  function sourceOfFundsPdf(tr, o) {
    o = o || {};
    return newDoc().then(function (doc) {
      var y = header(doc, __('stmSofTitle', 'Source of funds'), tr.sale.symbol + ' · ' + tr.sale.date + ' · ' + 'MAERMIN');
      doc.setFontSize(9);
      var W = doc.internal.pageSize.getWidth() - 28;
      sourceOfFundsLines(tr).forEach(function (line) {
        var parts = doc.splitTextToSize(line, W);
        if (y + parts.length * 5 > doc.internal.pageSize.getHeight() - 15) { doc.addPage(); y = 20; }
        doc.text(parts, 14, y); y += parts.length * 5;
      });
      y += 4; doc.setFontSize(8);
      doc.text(__('stmSofNote', 'Compiled from your own records with FIFO lots; attach the exchange and bank statements behind each step.'), 14, y, { maxWidth: W });
      return saveDoc(doc, 'maermin-source-of-funds-' + tr.sale.symbol + '-' + tr.sale.date + '.pdf', o.password);
    });
  }
  function downloadText(text, filename) {
    var blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  // ---- panel ---------------------------------------------------------------------------------------
  // props: { theme, transactions, portfolios, prices, exchangeRate, fxAt, year, owner }
  function Panel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement, useState = React.useState, useMemo = React.useMemo;
    var I = window.MaerminI18n;
    var year = props.year || new Date().getFullYear();
    var today = window.MaerminUtils.todayISO();
    var txs = props.transactions || [];
    var s0 = useState(today); var asOf = s0[0], setAsOf = s0[1];
    var s1 = useState(true); var withRf = s1[0], setWithRf = s1[1];
    var s2 = useState(''); var pw = s2[0], setPw = s2[1];
    var s3 = useState(''); var pw2 = s3[0], setPw2 = s3[1];
    var s4 = useState(''); var msg = s4[0], setMsg = s4[1];
    var s5 = useState(loadAccounts); var accounts = s5[0], setAccounts = s5[1];
    var s6 = useState(''); var saleId = s6[0], setSaleId = s6[1];
    var sales = useMemo(function () { return cryptoSales(txs); }, [txs]);
    var perWallet = false;
    try { perWallet = !!(window.MaerminTaxSettings && window.MaerminTaxSettings.load().cryptoPerWallet); } catch (err) { perWallet = false; }
    var trace = useMemo(function () {
      if (!saleId) return null;
      var sel = sales.filter(function (x) { return String(x.txId) === saleId; })[0];
      return sel ? sourceOfFunds(txs, sel.txId, { exchangeRate: props.exchangeRate, fxAt: props.fxAt, portfolios: props.portfolios, perWallet: perWallet }) : null;
    }, [saleId, txs, props.exchangeRate, perWallet]);
    var pwBad = pw && pw !== pw2;
    var base = { exchangeRate: props.exchangeRate, fxAt: props.fxAt };

    function fail(err) { setMsg(__('stmFailed', 'The export failed: {e}', { e: (err && err.message) || String(err) })); }
    function onStatement() {
      if (pwBad) return;
      setMsg(__('stmWorking', 'Creating the PDF…'));
      var st = assetStatement(txs, Object.assign({ asOf: asOf, prices: props.prices, portfolios: props.portfolios }, base));
      var rf = withRf ? rollForward(txs, Object.assign({ year: year }, base)) : null;
      statementPdf(st, rf, { password: pw || null, owner: props.owner }).then(function () {
        setMsg(pw ? __('stmDoneProtected', 'Downloaded, protected with AES-256.') : __('stmDone', 'Downloaded.'));
      }, fail);
    }
    // R4.6: Card, sections, shared Input / Select / Button, a checkbox row
    var UIC = window.MaerminComponents;
    var datev = datevRows(txs, Object.assign({ year: year, accounts: accounts }, base));
    var ACC_LABELS = { bank: __('stmAccBank', 'Bank / clearing account'), securities: __('stmAccSecurities', 'Securities'), crypto: __('stmAccCrypto', 'Crypto'),
      dividends: __('stmAccDividends', 'Dividend income'), interest: __('stmAccInterest', 'Interest income'), fees: __('stmAccFees', 'Fees and charges'),
      taxes: __('stmAccTaxes', 'Taxes'), transfer: __('stmAccTransfer', 'Deposits / withdrawals (transit)') };

    return e(UIC.Card, { 'data-testid': 'statements-panel', className: 'ui-taxp', headingLevel: 'h3', title: __('stmPanelTitle', 'Statements and exports'),
      subtitle: __('stmPanelIntro', 'Documents for a bank, an accountant or an auditor, made on this device from your records.') },

      e('div', { className: 'ui-taxp__sec' },
        e('h4', { className: 'ui-dlg-sec__title' }, __('stmTitle', 'Statement of assets')),
        e('div', { className: 'ui-form-grid' },
          e(UIC.Input, { id: 'st-asof', 'data-testid': 'st-asof', type: 'date', label: __('stmAsOfLabel', 'As of'), value: asOf, max: today, onChange: function (ev) { setAsOf(ev.target.value || today); } }),
          e(UIC.Input, { id: 'st-pw', 'data-testid': 'st-pw', type: 'password', autoComplete: 'new-password', label: __('stmPassword', 'Password (optional)'), value: pw, onChange: function (ev) { setPw(ev.target.value); } }),
          e(UIC.Input, { id: 'st-pw2', 'data-testid': 'st-pw2', type: 'password', autoComplete: 'new-password', label: __('stmPassword2', 'Repeat the password'), value: pw2,
            error: pwBad ? __('stmPwMismatch', 'The passwords differ.') : null, onChange: function (ev) { setPw2(ev.target.value); } })),
        e('label', { className: 'ui-check' },
          e('input', { type: 'checkbox', 'data-testid': 'st-rf', checked: withRf, onChange: function () { setWithRf(!withRf); } }), __('stmWithRf', 'Add the cost roll-forward for {y}', { y: year })),
        e('div', { className: 'ui-actions' },
          e(UIC.Button, { variant: 'primary', 'data-testid': 'st-pdf', disabled: !!pwBad, onClick: onStatement }, __('stmDownloadPdf', 'Download PDF')),
          e(UIC.Button, { 'data-testid': 'st-rf-csv', onClick: function () { downloadText(rollForwardCSV(rollForward(txs, Object.assign({ year: year }, base))), 'maermin-roll-forward-' + year + '.csv'); } }, __('stmRfCsv', 'Roll-forward {y} (CSV)', { y: year }))),
        pwBad ? null : e('p', { className: 'ui-note' }, __('stmPwNote', 'With a password the PDF is encrypted with AES-256 and opens only with it. Keep the password: it cannot be recovered.'))),

      e('div', { className: 'ui-taxp__sec' },
        e('h4', { className: 'ui-dlg-sec__title' }, __('stmDatevTitle', 'DATEV-style bookings {y}', { y: year })),
        e('div', { className: 'ui-form-grid' },
          ACCOUNT_KEYS.map(function (k) {
            return e(UIC.Input, { key: k, id: 'st-acc-' + k, 'data-testid': 'st-acc-' + k, inputMode: 'numeric', label: ACC_LABELS[k], value: accounts[k] || '',
              onChange: function (ev) { var n = Object.assign({}, accounts); n[k] = ev.target.value; setAccounts(saveAccounts(n)); } });
          })),
        e('div', { className: 'ui-actions' },
          e(UIC.Button, { 'data-testid': 'st-datev', disabled: !datev.length, onClick: function () { downloadText(datevCSV(datev), 'maermin-datev-' + year + '.csv'); } },
            __('stmDatevCsv', 'Download {n} bookings (CSV)', { n: datev.length }))),
        datev.missingAccounts.length ? e('p', { 'data-testid': 'st-datev-missing', className: ['ui-callout', 'ui-callout--warn'].join(' ') },
          __('stmDatevMissing', 'Accounts not set: {list}. Ask your accountant which accounts of your chart (e.g. SKR03 or SKR04) to use.', { list: datev.missingAccounts.map(function (k) { return ACC_LABELS[k]; }).join(', ') })) : null,
        e('p', { className: 'ui-note' },
          __('stmDatevNote', 'One booking per cash movement in the column order of the DATEV Buchungsstapel (amount, debit/credit, currency, account, contra account, date DDMM, document, text). A sale is booked at its proceeds; split the gain in your bookkeeping if needed.'))),

      e('div', { className: 'ui-taxp__sec' },
        e('h4', { className: 'ui-dlg-sec__title' }, __('stmSofTitle', 'Source of funds')),
        !sales.length ? e('p', { className: 'ui-muted' }, __('stmSofNone', 'No crypto sales recorded.')) :
        e('div', null,
          e('div', { className: 'ui-form-grid' },
            e(UIC.Select, { id: 'st-sale', 'data-testid': 'st-sale', label: __('stmSofPick', 'Crypto sale'), value: saleId, onChange: function (ev) { setSaleId(ev.target.value); },
              options: [{ value: '', label: __('ssPick', 'Choose…') }].concat(sales.map(function (s) { return { value: String(s.txId), label: s.date + ' · ' + I.num(s.quantity, { min: 0, max: 8 }) + ' ' + s.symbol }; })) })),
          trace ? e('div', { 'data-testid': 'st-sof', className: 'ui-stm-sof' }, sourceOfFundsLines(trace).join('\n')) : null,
          trace ? e('div', { className: 'ui-actions' }, e(UIC.Button, { 'data-testid': 'st-sof-pdf', disabled: !!pwBad,
            onClick: function () { setMsg(__('stmWorking', 'Creating the PDF…')); sourceOfFundsPdf(trace, { password: pw || null }).then(function () { setMsg(pw ? __('stmDoneProtected', 'Downloaded, protected with AES-256.') : __('stmDone', 'Downloaded.')); }, fail); } },
            __('stmSofPdf', 'Download as PDF (uses the password above, if set)'))) : null)),
      msg ? e('p', { 'data-testid': 'st-msg', role: 'status', className: 'ui-note' }, msg) : null);
  }

  var api = { ACCOUNT_KEYS: ACCOUNT_KEYS, ACCOUNTS_KEY: ACCOUNTS_KEY, assetStatement: assetStatement, rollForward: rollForward, rollForwardCSV: rollForwardCSV,
    datevRows: datevRows, datevCSV: datevCSV, loadAccounts: loadAccounts, saveAccounts: saveAccounts,
    cryptoSales: cryptoSales, sourceOfFunds: sourceOfFunds, sourceOfFundsLines: sourceOfFundsLines,
    statementPdf: statementPdf, sourceOfFundsPdf: sourceOfFundsPdf, Panel: Panel };
  if (typeof window !== 'undefined') window.MaerminStatements = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
