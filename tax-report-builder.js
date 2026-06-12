// ============================================================================
// MAERMIN — Tax Report Builder  (window.MaerminTaxReport)
// ----------------------------------------------------------------------------
// Produces a filing-grade tax report: a single structured object covering all
// the sections a tax advisor / authority expects, plus PDF and Excel exporters.
//
//   build(transactions, opts) -> report   (pure, currency-correct FIFO)
//   exportPDF(report)                      (jsPDF + autotable)
//   exportExcel(report)                    (HTML-table .xls — opens in Excel,
//                                           no extra dependency)
//
// Sections: Tax-Year Summary · Realized Gains · Realized Losses · Dividend
// Income · Interest Income · Withholding Tax · Foreign Tax · Currency
// Conversion · Transaction Summary · Open Positions · Corporate Actions.
//
// All monetary figures are converted to a single base currency (default EUR)
// using the supplied USD→base rate, so the report is internally consistent.
// FIFO matching records acquisition date, disposal date and holding period per
// lot. Pure core is unit-tested in test/tax-report.test.js.
// ============================================================================
(function () {
  'use strict';

  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function ymd(d) { try { return new Date(d).toISOString().split('T')[0]; } catch (e) { return ''; } }
  function days(a, b) { return Math.floor((new Date(b) - new Date(a)) / 86400000); }

  // Convert a per-unit price (or amount) in `cur` into the base currency.
  function toBase(amount, cur, rate) {
    var a = num(amount);
    if (cur === 'USD' && rate > 0) return a * rate; // rate = USD→base (EUR)
    return a; // already base, or unknown → treated as base
  }

  // Currency-correct FIFO. Returns realized disposals (one row per sell lot
  // match aggregated per sell) with acquisition/disposal dates + holding period.
  function fifo(transactions, year, rate) {
    var bySymbol = {};
    (transactions || []).forEach(function (tx) {
      if (tx.type !== 'buy' && tx.type !== 'sell') return;
      var key = (tx.category || 'crypto') + '|' + (tx.symbol || tx.name || '').toUpperCase();
      (bySymbol[key] || (bySymbol[key] = [])).push(tx);
    });

    var disposals = [];
    Object.keys(bySymbol).forEach(function (key) {
      var parts = key.split('|');
      var category = parts[0];
      var symbol = parts[1];
      var lots = []; // open buy lots: { qty, priceBase, date }
      bySymbol[key].slice().sort(function (a, b) { return new Date(a.date) - new Date(b.date); }).forEach(function (tx) {
        var qty = num(tx.quantity);
        var priceBase = toBase(tx.price, tx.currency, rate);
        if (tx.type === 'buy') {
          lots.push({ qty: qty, priceBase: priceBase, date: tx.date });
          return;
        }
        // sell — match against open lots FIFO. Emit ONE disposal per matched
        // lot (tax authorities classify each lot's holding period separately).
        var sellDate = tx.date;
        var sellPriceBase = toBase(tx.price, tx.currency, rate);
        var totalFeeBase = toBase(tx.fees, tx.currency, rate);
        var remaining = qty;
        var matches = [];
        while (remaining > 1e-9 && lots.length) {
          var lot = lots[0];
          var used = Math.min(remaining, lot.qty);
          matches.push({ used: used, lotPrice: lot.priceBase, lotDate: lot.date });
          lot.qty -= used;
          remaining -= used;
          if (lot.qty <= 1e-9) lots.shift();
        }
        var matchedTotal = matches.reduce(function (s, m) { return s + m.used; }, 0);
        if (matchedTotal <= 0) return;
        var sellYear = new Date(sellDate).getFullYear();
        if (year && sellYear !== year) return; // only disposals in the tax year
        matches.forEach(function (m) {
          var proceeds = m.used * sellPriceBase - totalFeeBase * (m.used / matchedTotal); // fee pro-rated
          var costBasis = m.used * m.lotPrice;
          var hold = days(m.lotDate, sellDate);
          disposals.push({
            symbol: symbol, category: category,
            quantity: m.used,
            acquisitionDate: ymd(m.lotDate), disposalDate: ymd(sellDate),
            holdingPeriodDays: hold, longTerm: hold >= 365,
            proceeds: proceeds, costBasis: costBasis, gain: proceeds - costBasis
          });
        });
      });
    });
    disposals.sort(function (a, b) { return new Date(a.disposalDate) - new Date(b.disposalDate); });
    return disposals;
  }

  // ---- main builder --------------------------------------------------------
  function build(transactions, opts) {
    opts = opts || {};
    var year = opts.year || new Date().getFullYear();
    var rate = num(opts.exchangeRate) || 0; // USD→base
    var base = opts.baseCurrency || 'EUR';
    var jurisdiction = opts.jurisdiction || 'de';
    var txs = transactions || [];
    var inYear = function (d) { return new Date(d).getFullYear() === year; };

    var disposals = fifo(txs, year, rate);
    var realizedGains = disposals.filter(function (d) { return d.gain >= 0; });
    var realizedLosses = disposals.filter(function (d) { return d.gain < 0; });
    var totalGains = realizedGains.reduce(function (s, d) { return s + d.gain; }, 0);
    var totalLosses = realizedLosses.reduce(function (s, d) { return s + d.gain; }, 0);

    // Dividend income — explicit dividend transactions, plus manual divevents.
    var dividends = [];
    txs.forEach(function (tx) {
      var isDiv = tx.type === 'dividend' || (tx.notes || '').toLowerCase().indexOf('dividend') > -1;
      if (isDiv && inYear(tx.date)) {
        var gross = toBase(num(tx.quantity) * num(tx.price) || num(tx.amount), tx.currency, rate);
        dividends.push({ symbol: (tx.symbol || '').toUpperCase(), date: ymd(tx.date), gross: gross,
          withholding: toBase(tx.withholdingTax, tx.currency, rate), currency: tx.currency || base });
      }
    });
    try {
      var events = (opts.dividendEvents) || JSON.parse((typeof localStorage !== 'undefined' && localStorage.getItem('maermin_divevents')) || '[]');
      (events || []).forEach(function (e) {
        if (inYear(e.date)) dividends.push({ symbol: (e.symbol || '').toUpperCase(), date: ymd(e.date),
          gross: toBase(e.amount, e.currency, rate), withholding: toBase(e.withholding, e.currency, rate), currency: e.currency || base });
      });
    } catch (e) {}
    var dividendIncome = dividends.reduce(function (s, d) { return s + d.gross; }, 0);
    var withholdingTax = dividends.reduce(function (s, d) { return s + (d.withholding || 0); }, 0);

    // Interest income — explicit interest transactions.
    var interest = [];
    txs.forEach(function (tx) {
      if ((tx.type === 'interest' || (tx.notes || '').toLowerCase().indexOf('interest') > -1) && inYear(tx.date)) {
        interest.push({ source: tx.symbol || tx.notes || 'Interest', date: ymd(tx.date),
          amount: toBase(num(tx.amount) || num(tx.quantity) * num(tx.price), tx.currency, rate) });
      }
    });
    var interestIncome = interest.reduce(function (s, i) { return s + i.amount; }, 0);

    // Foreign tax — dividends/income in a non-base currency carry foreign tax
    // (withholding on foreign payers). We surface the withholding on USD payers.
    var foreignTax = dividends.filter(function (d) { return d.currency && d.currency !== base; })
      .reduce(function (s, d) { return s + (d.withholding || 0); }, 0);

    // Currency conversion details — every non-base transaction in the year.
    var currencyConversions = txs.filter(function (tx) { return tx.currency && tx.currency !== base && inYear(tx.date); })
      .map(function (tx) {
        var orig = num(tx.quantity) * num(tx.price);
        return { date: ymd(tx.date), symbol: (tx.symbol || '').toUpperCase(), currency: tx.currency,
          originalAmount: orig, rate: rate, baseAmount: toBase(orig, tx.currency, rate) };
      });

    // Transaction summary — counts by type in the year.
    var txSummary = {};
    txs.filter(function (tx) { return inYear(tx.date); }).forEach(function (tx) {
      var k = tx.type || 'other'; txSummary[k] = (txSummary[k] || 0) + 1;
    });

    // Open positions overview — unrealized snapshot from the supplied portfolio.
    var openPositions = [];
    var portfolio = opts.portfolio || {};
    var prices = opts.prices || {};
    ['crypto', 'stocks', 'skins', 'commodities'].forEach(function (cls) {
      (portfolio[cls] || []).forEach(function (p) {
        var amt = num(p.amount); if (amt <= 0) return;
        var s = p.symbol || p.name || '';
        var price = prices[s] || prices[s.toLowerCase()] || prices[s.toUpperCase()] || num(p.purchasePrice);
        var cost = num(p.purchasePrice) * amt;
        var value = price * amt;
        openPositions.push({ symbol: s, category: cls, quantity: amt, costBasis: cost, marketValue: value, unrealized: value - cost });
      });
    });

    // Corporate actions — splits / reinvestments flagged on transactions.
    var corporateActions = txs.filter(function (tx) {
      return inYear(tx.date) && (tx.type === 'split' || tx.type === 'reinvest' || (tx.notes || '').toLowerCase().indexOf('split') > -1);
    }).map(function (tx) { return { date: ymd(tx.date), symbol: (tx.symbol || '').toUpperCase(), type: tx.type, detail: tx.notes || '' }; });

    // Tax liability estimate via the existing jurisdiction engines (consistency).
    var taxLiability = 0, summaryExtra = {};
    try {
      if (typeof window !== 'undefined') {
        if (jurisdiction === 'de' && window.calculateGermanTax) { var de = window.calculateGermanTax(txs, year); taxLiability = de.totalTax; summaryExtra = de; }
        else if (jurisdiction === 'us' && window.calculateUSTax) { var us = window.calculateUSTax(txs, year); taxLiability = us.totalTax; summaryExtra = us; }
      }
    } catch (e) {}

    // ---- German fund taxation detail (Vorabpauschale + Teilfreistellung) ----
    // Statutory order via TaxCalculationEngine.GermanTax: Teilfreistellung ->
    // Verrechnung -> Sparerpauschbetrag -> Abgeltungsteuer/Soli/Kirchensteuer.
    // GermanTax is injectable (opts.germanTax) so this stays Node-testable
    // without the browser global. Inputs the view gathers (fund types, recorded
    // Vorabpauschalen, current-year Vorabpauschalen, church-tax rate) arrive
    // through opts; browser callers fall back to the locally stored settings.
    var germanDetail = null;
    var GT = opts.germanTax || (typeof window !== 'undefined' && window.TaxCalculationEngine && window.TaxCalculationEngine.GermanTax);
    if (jurisdiction === 'de' && GT && typeof GT.computeGermanTaxDetailed === 'function') {
      try {
        var fundTypes = opts.fundTypes || (GT.loadFundTypes ? GT.loadFundTypes() : {});
        var vapRecords = opts.vapRecords || (GT.loadVapRecords ? GT.loadVapRecords() : {});
        // Current-year Vorabpauschalen: explicit, or derived from the records
        // the Tax view saved for the report year (one store, no extra plumbing).
        var vorabpauschalen = opts.vorabpauschalen;
        if (!vorabpauschalen) {
          vorabpauschalen = [];
          Object.keys(vapRecords).forEach(function (sym) {
            var amt = vapRecords[sym] && parseFloat(vapRecords[sym][year]);
            if (isFinite(amt) && amt > 0) vorabpauschalen.push({ symbol: sym, amount: amt });
          });
        }
        var kirchensteuerRate = opts.kirchensteuerRate != null ? opts.kirchensteuerRate
          : (GT.loadKirchensteuerRate ? GT.loadKirchensteuerRate() : 0);
        // Capital income block: every non-crypto disposal (crypto follows the
        // private-sale rules below). Prior-year Vorabpauschalen recorded for a
        // symbol are credited against its disposals, oldest first.
        var creditPool = {};
        var capitalDisposals = disposals.filter(function (d) { return d.category !== 'crypto'; }).map(function (d) {
          var sym = d.symbol;
          if (creditPool[sym] == null) creditPool[sym] = GT.vapCreditForSale(vapRecords, sym, year, 1);
          var credit = Math.min(creditPool[sym], Math.max(0, d.gain));
          creditPool[sym] -= credit;
          return { symbol: sym, gain: d.gain, vapCredit: credit };
        });
        var capital = GT.computeGermanTaxDetailed({
          disposals: capitalDisposals,
          dividends: dividends.map(function (d) { return { symbol: d.symbol, gross: d.gross }; }),
          interestIncome: interestIncome,
          vorabpauschalen: vorabpauschalen,
          fundTypes: fundTypes,
          sparerpauschbetrag: opts.sparerpauschbetrag,
          kirchensteuerRate: kirchensteuerRate
        });
        // Crypto: private sale rules (sec. 23 EStG) - > 1y exempt; otherwise a
        // Freigrenze applies (1000 EUR from 2024, 600 before): at or under it
        // the whole net gain is tax-free, above it the WHOLE amount is taxable.
        // The personal income-tax rate is unknown here; 25% is the documented
        // flat estimate, consistent with the legacy engine.
        var cryptoShort = 0, cryptoExempt = 0;
        disposals.forEach(function (d) {
          if (d.category !== 'crypto') return;
          if (d.longTerm) cryptoExempt += d.gain; else cryptoShort += d.gain;
        });
        var freigrenze = year >= 2024 ? 1000 : 600;
        var cryptoTaxable = cryptoShort > freigrenze ? cryptoShort : 0;
        var cryptoTax = cryptoTaxable * 0.25;
        germanDetail = Object.assign({}, capital, {
          crypto: { netShortTermGains: cryptoShort, exemptLongTermGains: cryptoExempt, freigrenze: freigrenze, taxable: cryptoTaxable, estimatedTax: cryptoTax },
          totalTax: capital.totalTax + cryptoTax
        });
        taxLiability = germanDetail.totalTax;
      } catch (e) { germanDetail = null; }
    }

    return {
      meta: {
        generatedAt: new Date().toISOString(),
        year: year, jurisdiction: jurisdiction, baseCurrency: base,
        method: 'FIFO',
        owner: opts.owner || {}
      },
      summary: {
        realizedGains: totalGains,
        realizedLosses: totalLosses,
        netRealized: totalGains + totalLosses,
        dividendIncome: dividendIncome,
        interestIncome: interestIncome,
        withholdingTax: withholdingTax,
        foreignTax: foreignTax,
        totalTaxableIncome: totalGains + totalLosses + dividendIncome + interestIncome,
        estimatedTaxLiability: taxLiability,
        jurisdictionDetail: summaryExtra,
        germanDetail: germanDetail
      },
      realizedGains: realizedGains,
      realizedLosses: realizedLosses,
      dividends: dividends,
      interest: interest,
      currencyConversions: currencyConversions,
      transactionSummary: txSummary,
      openPositions: openPositions,
      corporateActions: corporateActions
    };
  }

  // ---- formatting ----------------------------------------------------------
  function money(v, cur) {
    return (num(v)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + (cur || '');
  }

  // Shared row set for the German fund-taxation section (PDF + Excel).
  function germanDetailRows(g, cur) {
    return [
      ['Taxable gains after Teilfreistellung', money(g.gainsTaxable, cur)],
      ['Deductible losses after Teilfreistellung', money(g.lossesTaxable, cur)],
      ['Taxable fund distributions', money(g.dividendsTaxable, cur)],
      ['Vorabpauschale (current year, taxable)', money(g.vorabpauschaleTaxable, cur)],
      ['Credited prior Vorabpauschalen', money(-g.vapCreditTotal, cur)],
      ['Teilfreistellung exempt total', money(g.teilfreistellungExempt, cur)],
      ['Net capital income', money(g.nettedIncome, cur)],
      ['Sparerpauschbetrag used', money(g.sparerpauschbetragUsed, cur)],
      ['Taxable capital income', money(g.taxableIncome, cur)],
      ['Abgeltungsteuer', money(g.abgeltungsteuer, cur)],
      ['Solidaritaetszuschlag', money(g.soli, cur)],
      ['Kirchensteuer', money(g.kirchensteuer, cur)],
      ['Crypto net short-term gains (Freigrenze ' + g.crypto.freigrenze + ')', money(g.crypto.netShortTermGains, cur)],
      ['Crypto tax-exempt long-term gains', money(g.crypto.exemptLongTermGains, cur)],
      ['Crypto estimated tax (flat-rate estimate)', money(g.crypto.estimatedTax, cur)],
      ['Total estimated tax', money(g.totalTax, cur)]
    ];
  }

  // ---- PDF export ----------------------------------------------------------
  function exportPDF(report) {
    if (typeof jspdf === 'undefined' && typeof jsPDF === 'undefined') { alert('PDF library not loaded.'); return; }
    var JsPDF = (typeof jsPDF !== 'undefined') ? jsPDF : jspdf.jsPDF;
    var doc = new JsPDF();
    var cur = report.meta.baseCurrency;
    var W = doc.internal.pageSize.getWidth();

    // Cover header
    doc.setFillColor(126, 34, 206); doc.rect(0, 0, W, 38, 'F');
    doc.setTextColor(255, 255, 255); doc.setFontSize(22); doc.setFont('helvetica', 'bold');
    doc.text('Tax Report ' + report.meta.year, 14, 22);
    doc.setFontSize(11); doc.setFont('helvetica', 'normal');
    doc.text('MAERMIN Portfolio Tracker · ' + (report.meta.jurisdiction === 'de' ? 'Germany' : 'USA') + ' · FIFO', 14, 31);

    var owner = report.meta.owner || {};
    doc.setTextColor(30, 41, 59); doc.setFontSize(10);
    var oy = 48;
    if (owner.name) { doc.text('Taxpayer: ' + owner.name, 14, oy); oy += 6; }
    if (owner.taxId) { doc.text('Tax ID: ' + owner.taxId, 14, oy); oy += 6; }
    doc.text('Generated: ' + new Date(report.meta.generatedAt).toLocaleString('en-US'), 14, oy); oy += 8;

    var s = report.summary;
    var autoTable = doc.autoTable ? doc.autoTable.bind(doc) : (typeof doc.autoTable === 'function' ? doc.autoTable : null);
    function table(title, head, body, startY) {
      doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 41, 59);
      doc.text(title, 14, startY);
      doc.autoTable({ head: [head], body: body, startY: startY + 3, styles: { fontSize: 8 }, headStyles: { fillColor: [126, 34, 206] }, margin: { left: 14, right: 14 } });
      return doc.lastAutoTable.finalY + 8;
    }

    var y = oy + 2;
    // 1. Summary
    y = table('1. Tax-Year Summary', ['Item', 'Amount'], [
      ['Realized Gains', money(s.realizedGains, cur)],
      ['Realized Losses', money(s.realizedLosses, cur)],
      ['Net Realized', money(s.netRealized, cur)],
      ['Dividend Income', money(s.dividendIncome, cur)],
      ['Interest Income', money(s.interestIncome, cur)],
      ['Withholding Tax Paid', money(s.withholdingTax, cur)],
      ['Foreign Tax Paid', money(s.foreignTax, cur)],
      ['Total Taxable Income', money(s.totalTaxableIncome, cur)],
      ['Estimated Tax Liability', money(s.estimatedTaxLiability, cur)]
    ], y);

    // German fund taxation detail (when computed for jurisdiction 'de').
    if (s.germanDetail) {
      y = table('1a. German Fund Taxation (Vorabpauschale + Teilfreistellung)', ['Item', 'Amount'],
        germanDetailRows(s.germanDetail, cur), y);
      doc.setFontSize(8); doc.setTextColor(120, 120, 120);
      doc.text('Helper computation under InvStG/EStG rules (simplified loss netting; crypto at flat-rate estimate). Not tax advice.', 14, y - 4);
    }

    function lots(rows) {
      return rows.map(function (d) { return [d.symbol, d.category, d.quantity.toFixed(4), d.acquisitionDate, d.disposalDate, d.holdingPeriodDays + 'd' + (d.longTerm ? ' (LT)' : ''), money(d.proceeds, ''), money(d.costBasis, ''), money(d.gain, '')]; });
    }
    var lotHead = ['Symbol', 'Class', 'Qty', 'Acquired', 'Disposed', 'Held', 'Proceeds', 'Cost', 'Gain/Loss'];

    if (report.realizedGains.length) { doc.addPage(); y = table('2. Realized Capital Gains', lotHead, lots(report.realizedGains), 20); }
    if (report.realizedLosses.length) { y = table('3. Realized Capital Losses', lotHead, lots(report.realizedLosses), y); }
    if (report.dividends.length) { doc.addPage(); y = table('4. Dividend Income', ['Symbol', 'Date', 'Gross', 'Withholding', 'Cur'], report.dividends.map(function (d) { return [d.symbol, d.date, money(d.gross, ''), money(d.withholding, ''), d.currency]; }), 20); }
    if (report.interest.length) { y = table('5. Interest Income', ['Source', 'Date', 'Amount'], report.interest.map(function (i) { return [i.source, i.date, money(i.amount, '')]; }), y); }
    if (report.currencyConversions.length) { doc.addPage(); y = table('8. Currency Conversion Details', ['Date', 'Symbol', 'Cur', 'Original', 'Rate', 'Base'], report.currencyConversions.map(function (c) { return [c.date, c.symbol, c.currency, c.originalAmount.toFixed(2), c.rate.toFixed(4), money(c.baseAmount, '')]; }), 20); }
    var txRows = Object.keys(report.transactionSummary).map(function (k) { return [k, String(report.transactionSummary[k])]; });
    if (txRows.length) { y = table('9. Transaction Summary', ['Type', 'Count'], txRows, y); }
    if (report.openPositions.length) { doc.addPage(); y = table('10. Open Positions Overview', ['Symbol', 'Class', 'Qty', 'Cost', 'Value', 'Unrealized'], report.openPositions.map(function (p) { return [p.symbol, p.category, p.quantity.toFixed(4), money(p.costBasis, ''), money(p.marketValue, ''), money(p.unrealized, '')]; }), 20); }
    if (report.corporateActions.length) { y = table('11. Tax-Relevant Corporate Actions', ['Date', 'Symbol', 'Type', 'Detail'], report.corporateActions.map(function (a) { return [a.date, a.symbol, a.type, a.detail]; }), y); }

    // Page numbers + footer on every page
    var pages = doc.internal.getNumberOfPages();
    for (var i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(8); doc.setTextColor(120, 120, 120);
      doc.text('Page ' + i + ' of ' + pages, W - 14, doc.internal.pageSize.getHeight() - 8, { align: 'right' });
      doc.text('For informational purposes only — consult a tax advisor.', 14, doc.internal.pageSize.getHeight() - 8);
    }
    doc.save('maermin-tax-report-' + report.meta.year + '.pdf');
  }

  // ---- Excel export (HTML-table .xls; opens natively in Excel) --------------
  function exportExcel(report) {
    var cur = report.meta.baseCurrency;
    var s = report.summary;
    function tbl(title, head, rows) {
      var h = '<tr>' + head.map(function (x) { return '<th style="background:#7e22ce;color:#fff">' + x + '</th>'; }).join('') + '</tr>';
      var b = rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + (c == null ? '' : String(c)) + '</td>'; }).join('') + '</tr>'; }).join('');
      return '<h3>' + title + '</h3><table border="1" cellspacing="0" cellpadding="4">' + h + b + '</table><br/>';
    }
    var owner = report.meta.owner || {};
    var html = '<html><head><meta charset="utf-8"></head><body>' +
      '<h1>Tax Report ' + report.meta.year + '</h1>' +
      '<p>Jurisdiction: ' + (report.meta.jurisdiction === 'de' ? 'Germany' : 'USA') + ' · Method: FIFO · Base: ' + cur +
      (owner.name ? ' · Taxpayer: ' + owner.name : '') + (owner.taxId ? ' · Tax ID: ' + owner.taxId : '') +
      '<br/>Generated: ' + new Date(report.meta.generatedAt).toLocaleString('en-US') + '</p>';

    html += tbl('1. Tax-Year Summary', ['Item', 'Amount (' + cur + ')'], [
      ['Realized Gains', num(s.realizedGains).toFixed(2)], ['Realized Losses', num(s.realizedLosses).toFixed(2)],
      ['Net Realized', num(s.netRealized).toFixed(2)], ['Dividend Income', num(s.dividendIncome).toFixed(2)],
      ['Interest Income', num(s.interestIncome).toFixed(2)], ['Withholding Tax', num(s.withholdingTax).toFixed(2)],
      ['Foreign Tax', num(s.foreignTax).toFixed(2)], ['Total Taxable Income', num(s.totalTaxableIncome).toFixed(2)],
      ['Estimated Tax Liability', num(s.estimatedTaxLiability).toFixed(2)]
    ]);
    if (s.germanDetail) {
      html += tbl('1a. German Fund Taxation (Vorabpauschale + Teilfreistellung)', ['Item', 'Amount'],
        germanDetailRows(s.germanDetail, cur));
    }
    var lotHead = ['Symbol', 'Class', 'Qty', 'Acquired', 'Disposed', 'Holding (days)', 'Long-term', 'Proceeds', 'Cost Basis', 'Gain/Loss'];
    function lotRows(rows) { return rows.map(function (d) { return [d.symbol, d.category, d.quantity.toFixed(4), d.acquisitionDate, d.disposalDate, d.holdingPeriodDays, d.longTerm ? 'Yes' : 'No', d.proceeds.toFixed(2), d.costBasis.toFixed(2), d.gain.toFixed(2)]; }); }
    html += tbl('2. Realized Capital Gains', lotHead, lotRows(report.realizedGains));
    html += tbl('3. Realized Capital Losses', lotHead, lotRows(report.realizedLosses));
    html += tbl('4. Dividend Income', ['Symbol', 'Date', 'Gross', 'Withholding', 'Currency'], report.dividends.map(function (d) { return [d.symbol, d.date, d.gross.toFixed(2), num(d.withholding).toFixed(2), d.currency]; }));
    html += tbl('5. Interest Income', ['Source', 'Date', 'Amount'], report.interest.map(function (i) { return [i.source, i.date, i.amount.toFixed(2)]; }));
    html += tbl('8. Currency Conversion Details', ['Date', 'Symbol', 'Currency', 'Original', 'Rate (USD→' + cur + ')', 'Base'], report.currencyConversions.map(function (c) { return [c.date, c.symbol, c.currency, c.originalAmount.toFixed(2), c.rate.toFixed(4), c.baseAmount.toFixed(2)]; }));
    html += tbl('9. Transaction Summary', ['Type', 'Count'], Object.keys(report.transactionSummary).map(function (k) { return [k, report.transactionSummary[k]]; }));
    html += tbl('10. Open Positions Overview', ['Symbol', 'Class', 'Qty', 'Cost Basis', 'Market Value', 'Unrealized'], report.openPositions.map(function (p) { return [p.symbol, p.category, p.quantity.toFixed(4), p.costBasis.toFixed(2), p.marketValue.toFixed(2), p.unrealized.toFixed(2)]; }));
    html += tbl('11. Tax-Relevant Corporate Actions', ['Date', 'Symbol', 'Type', 'Detail'], report.corporateActions.map(function (a) { return [a.date, a.symbol, a.type, a.detail]; }));
    html += '</body></html>';

    var blob = new Blob([html], { type: 'application/vnd.ms-excel' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'maermin-tax-report-' + report.meta.year + '.xls';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  var api = { build: build, fifo: fifo, exportPDF: exportPDF, exportExcel: exportExcel, _toBase: toBase };
  if (typeof window !== 'undefined') window.MaerminTaxReport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
