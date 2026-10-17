// PROTOTYPE — Direction B "Trading Desk". Static mockup over demo figures; throw away after the pick.
(function () {
  'use strict';
  var K = KIT.K, m = KIT.m, I = KIT.icon, D = window.DEMO;
  var screen = document.body.dataset.screen;
  var simple = KIT.state.mode === 'simple';
  function sgn(v, d) { return KIT.signed(v, 'en', d == null ? 2 : d, ''); }

  function side(active) {
    var areas = [
      ['Portfolio', [['overview', 'Overview', 'overview', 'g o'], ['', 'Portfolios', 'wallet', 'g p'], ['', 'Net worth', 'analysis', 'g n'], ['', 'Watchlist', 'eye', 'g w'], ['', 'Events', 'calendar', 'g e'], ['', 'Budget', 'wallet', '', 1], ['', 'Rebalancing', 'analysis', '', 1]]],
      ['Activity', [['transactions', 'Transactions', 'tx', 'g t'], ['', 'Savings plans', 'calendar', 'g s'], ['', 'Import / Export', 'tx', 'g i'], ['', 'Cash flow', 'analysis', '', 1], ['', 'Journal', 'tax', '', 1]]],
      ['Income & tax', [['', 'Dividends', 'div', 'g d'], ['', 'Tax & FIFO', 'tax', 'g x']]],
      ['Analysis', [['returns', 'Returns', 'analysis', 'g r'], ['', 'Health & risk', 'analysis', 'g h'], ['', 'Research', 'search', '', 1], ['', 'Strategy', 'analysis', '', 1], ['', 'Fees', 'tax', '', 1], ['', 'Discovery', 'search', '', 1], ['', 'News', 'tax', '', 1]]]
    ];
    return '<aside class="side"><div class="brand"><i></i>MAERMIN</div>' +
      '<div class="pf"><span><span class="faint">Portfolio</span> All (2)</span>' + I('down', 14) + '</div>' +
      areas.map(function (a) {
        return '<h6>' + a[0] + '<span>' + a[1].filter(function (x) { return !(simple && x[4]); }).length + '</span></h6>' +
          a[1].map(function (x) { return '<a href="' + (x[0] ? x[0] + '.html' + location.search : '#') + '"' + (x[0] === active ? ' aria-current="page"' : '') + (x[4] ? ' class="adv"' : '') + '>' + I(x[2], 16) + x[1] + '<span class="k">' + x[3] + '</span></a>'; }).join('');
      }).join('') +
      '<h6>Settings</h6><a href="#">' + I('settings', 16) + 'Settings<span class="k">g ,</span></a></aside>';
  }
  function top(crumb, page) {
    return '<div class="top"><span class="crumbs">' + crumb + ' / <b>' + page + '</b></span>' +
      '<div class="cmd">' + I('search', 14) + '<span>Search or run a command…</span><span>⌘K</span></div>' +
      '<button class="b ghost" aria-pressed="' + KIT.state.mask + '">' + I('eye', 14) + 'Hide <span class="kb">H</span></button>' +
      '<button class="b">' + I('tx', 14) + 'Import</button>' +
      '<button class="b primary">' + I('plus', 14) + 'New <span class="kb">N</span></button></div>';
  }
  function spark(sym, up) {
    var s = KIT.spark(sym, up);
    return '<svg width="64" height="18" viewBox="0 0 64 18" aria-hidden="true"><path d="' + KIT.linePath(s, 64, 18, 2) + '" fill="none" stroke="var(--' + (up ? 'gain' : 'loss') + ')" stroke-width="1.25"/></svg>';
  }

  function overview() {
    var w = 1000, h = 240;
    var movers = D.pos.slice().sort(function (a, b) { return KIT.num(b.plp) - KIT.num(a.plp); });
    var up = movers.slice(0, 4), dn = movers.slice(-3).reverse();
    return '<div class="shell">' + side('overview') + '<div class="work">' + top('Portfolio', 'Overview') + '<div class="content">' +
      '<section class="panel strip">' +
      '<div><label>Net worth · incl. cash</label><div class="big n">' + m('178,556.70 €') + '</div><div class="s n gain">▲ ' + m('+5,740.17 €') + ' +3.67% <span class="faint">1M</span></div></div>' +
      '<div><label>Securities</label><div class="v n">' + m('176,756.66') + '</div><div class="s faint">31 positions</div></div>' +
      '<div><label>Unrealised</label><div class="v n gain">' + m('+68,759.65') + '</div><div class="s n gain">+63.67%</div></div>' +
      '<div><label>XIRR p.a.</label><div class="v n gain">+19.63%</div><div class="s faint">money-weighted</div></div>' +
      '<div class="adv"><label>TWR</label><div class="v n gain">+87.22%</div><div class="s n faint">+18.20% p.a.</div></div>' +
      '<div><label>Realised</label><div class="v n">' + m('8,181.74') + '</div><div class="s faint">FIFO, all time</div></div>' +
      '<div><label>Div. 12M</label><div class="v n income">' + m('1,404.15') + '</div><div class="s n faint">' + m('117.01') + '/mo · 1.0%</div></div>' +
      '<div class="adv"><label>Health</label><div class="v n">80 <span class="dim" style="font-size:12px">B</span></div><div class="s faint">fees ' + m('52.60') + '</div></div>' +
      '</section>' +
      '<div class="grid-main">' +
      '<section class="panel"><div class="ph"><h3>Value</h3><div class="tabs">' + ['1W', '1M', '3M', 'YTD', '1Y', '3Y', 'MAX'].map(function (p) { return '<button aria-pressed="' + (p === '1Y') + '">' + p + '</button>'; }).join('') + '</div>' +
      '<div class="tools"><button class="b ghost adv">vs MSCI World</button><button class="b ghost adv">Drawdown</button><button class="b ghost">Invested</button></div></div>' +
      '<div class="pb"><div class="chart"><svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" role="img" aria-label="Value, 12 months">' +
      [0.25, 0.5, 0.75].map(function (y) { return '<line x1="0" x2="' + w + '" y1="' + h * y + '" y2="' + h * y + '" stroke="var(--line)" stroke-dasharray="2 4"/>'; }).join('') +
      '<path d="' + KIT.areaPath(D.series, w, h, 10) + '" fill="var(--accent-soft)"/><path d="' + KIT.linePath(D.series, w, h, 10) + '" fill="none" stroke="var(--accent)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>' +
      '<line x1="999" x2="999" y1="0" y2="' + h + '" stroke="var(--dim)" stroke-dasharray="3 3"/></svg>' +
      '<div class="panel" style="position:absolute;right:12px;top:14px;padding:6px 8px;font-size:12px;background:var(--raise)"><div class="faint n">Oct 17, 2026</div><div class="n">' + m('176,756.66 €') + '</div><div class="faint">securities, both portfolios</div></div></div></div></section>' +
      '<div style="display:grid;gap:12px;align-content:start">' +
      '<section class="panel"><div class="ph"><h3>Allocation</h3><div class="tools tabs"><button aria-pressed="true">Class</button><button class="adv">Sector</button><button class="adv">Region</button><button class="adv">Ccy</button></div></div><div class="pb">' +
      K.alloc.map(function (a) { return '<div class="alloc-row"><span>' + a.en + '</span><span class="n r" style="text-align:right">' + (a.pct < 0.1 ? '<0.1' : a.pct.toFixed(1)) + '%</span><span class="n dim" style="text-align:right">' + m(KIT.fmt(a.v, 0)) + '</span><div class="bar"><i style="width:' + Math.max(a.pct, 0.5) + '%"></i></div></div>'; }).join('') + '</div></section>' +
      '<section class="panel"><div class="ph"><h3>Best &amp; worst since purchase</h3></div><div class="pb" style="padding-top:4px;padding-bottom:4px">' +
      up.concat(dn).map(function (p) { var v = KIT.num(p.plp); return '<div class="mv"><span class="n" style="font-weight:600">' + p.sym + '</span><span class="dim" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + p.name + '</span><span class="n" style="text-align:right">' + m(KIT.fmt(KIT.num(p.value), 0)) + '</span><span class="n pill ' + KIT.tone(v) + '">' + p.plp.replace('-', '−') + '</span></div>'; }).join('') +
      '</div></section></div></div>' +
      '<section class="panel"><div class="ph"><h3>Positions</h3><span class="faint n" style="font-size:12px">31 open · 1 closed</span><div class="tools"><div class="tabs"><button aria-pressed="true">Open</button><button>Closed</button></div><button class="b ghost">' + I('filter', 14) + 'Columns</button><button class="b ghost">CSV</button></div></div>' +
      '<table class="t"><thead><tr><th>Asset</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Value</th><th>Weight</th><th class="r">Unrealised</th><th class="r">%</th><th class="adv">12M</th></tr></thead><tbody>' +
      D.pos.slice(0, 16).map(function (p) {
        var v = KIT.num(p.plp), wt = KIT.num(p.weight);
        return '<tr><td><span class="sym">' + p.sym + '</span><span class="nm">' + p.name + '</span></td><td class="r n">' + p.qty + '</td><td class="r n">' + m(p.price.replace(' €', '')) + '</td><td class="r n">' + m(p.value.replace(' €', '')) + '</td>' +
          '<td class="n">' + p.weight + '<span class="wb"><i style="width:' + Math.min(wt * 6, 100) + '%"></i></span></td><td class="r n ' + KIT.tone(v) + '">' + m(p.pl.replace(' €', '').replace('-', '−')) + '</td><td class="r"><span class="n pill ' + KIT.tone(v) + '">' + p.plp.replace('-', '−') + '</span></td><td class="adv">' + spark(p.sym, v >= 0) + '</td></tr>';
      }).join('') + '</tbody></table></section>' +
      '</div></div></div>';
  }

  function transactions() {
    var count = { BUY: 0, SELL: 0, DIVIDEND: 0, TAX: 0 };
    D.tx.forEach(function (t) { count[t.type] = (count[t.type] || 0) + 1; });
    var groups = {}, order = [];
    D.tx.slice(0, 48).forEach(function (t) { var k = t.date.slice(0, 7); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(t); });
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var chip = { BUY: 'buy', SELL: 'sell', DIVIDEND: 'div', TAX: 'tax' };
    var rowN = 0;
    return '<div class="shell">' + side('transactions') + '<div class="work">' + top('Activity', 'Transactions') + '<div class="content">' +
      '<section class="panel"><div class="facets">' +
      '<button class="facet" aria-pressed="true">All <span class="n">224</span></button>' +
      [['BUY', 'Buy'], ['SELL', 'Sell'], ['DIVIDEND', 'Dividend'], ['TAX', 'Tax']].map(function (x) { return '<button class="facet" aria-pressed="false">' + x[1] + ' <span class="n">' + count[x[0]] + '</span></button>'; }).join('') +
      '<span class="faint" style="margin:0 4px">|</span><button class="facet">Portfolio: All</button><button class="facet">Class: All</button><button class="facet">2023-01-16 → today</button>' +
      '<span style="margin-left:auto" class="faint">Sort</span><button class="facet">Date ↓</button><button class="b">CSV</button><button class="b primary">' + I('plus', 14) + 'Add <span class="kb">N</span></button></div>' +
      '<div class="bulk"><b>2 selected</b><button class="b">Move to portfolio…</button><button class="b">Tag…</button><button class="b">Delete</button><span class="faint" style="margin-left:auto">Shift+click selects a range · E edits · Del moves to trash</span></div>' +
      '<table class="t"><thead><tr><th style="width:28px"><input type="checkbox" aria-label="Select all"></th><th>Date</th><th>Type</th><th>Asset</th><th>Portfolio</th><th class="r">Qty</th><th class="r">Price</th><th>Ccy</th><th class="r">Amount</th><th class="r">EUR</th><th></th></tr></thead><tbody>' +
      order.map(function (k) {
        var rows = groups[k], net = 0; rows.forEach(function (t) { var v = KIT.txEUR(t); net += t.type === 'BUY' ? -v : v; });
        return '<tr class="month-row"><td></td><td colspan="8"><b>' + MON[+k.slice(5) - 1] + ' ' + k.slice(0, 4) + '</b> · ' + rows.length + (rows.length === 1 ? ' booking' : ' bookings') + '</td><td class="r n" colspan="2">net cash ' + m(sgn(net)) + ' €</td></tr>' +
          rows.map(function (t) {
            var v = KIT.txEUR(t), p = KIT.posFor(t.sym), sel = (rowN++ === 1 || rowN === 3);
            var eurTxt = t.type === 'BUY' ? '−' + KIT.fmt(v, 2) : sgn(v);
            return '<tr><td><input type="checkbox" aria-label="Select"' + (sel ? ' checked' : '') + '></td><td class="n dim">' + MON[+t.date.slice(5, 7) - 1] + ' ' + t.date.slice(8) + '</td><td><span class="chip ' + chip[t.type] + '">' + t.type + '</span></td>' +
              '<td><span class="sym">' + (t.cls === 'Account' ? 'TAX' : t.sym) + '</span><span class="nm">' + (p ? p.name : t.sym) + '</span></td><td class="dim">Main depot</td>' +
              '<td class="r n">' + (t.qty || '') + '</td><td class="r n">' + m(t.price) + '</td><td class="n faint">' + t.cur + '</td><td class="r n">' + m(t.total.replace(/ (USD|EUR)/, '')) + '</td>' +
              '<td class="r n ' + (t.type === 'DIVIDEND' ? 'income' : '') + '">' + m(eurTxt) + '</td><td class="r"><button class="b ghost act" aria-label="Actions">' + I('more', 14) + '</button></td></tr>';
          }).join('');
      }).join('') + '</tbody></table>' +
      '<div class="faint" style="padding:8px 12px;font-size:12px">Showing 48 of 224 · EUR = amount at the booking’s FX rate (mockup: 0.920) · tax and fee rows are cash, not losses</div></section>' +
      '</div></div></div>';
  }

  function hcell(v) {
    if (v == null) return '<td class="faint">·</td>';
    var a = Math.min(Math.abs(v) / 8, 1);
    var bg = 'color-mix(in srgb, var(--' + (v >= 0 ? 'gain' : 'loss') + ') ' + Math.round(10 + a * 45) + '%, transparent)';
    return '<td style="background:' + bg + '">' + (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '</td>';
  }

  function returns() {
    var parts = [['Unrealised gain', 68759.65, 'gain'], ['Realised gain', 8181.74, 'gain'], ['Dividends (net)', 4964.83, 'income'], ['Other / not split', 523.43, 'flat'], ['Taxes', -2128.96, 'loss'], ['Fees', -52.60, 'loss']];
    var max = 82429.65, x = 0;
    return '<div class="shell">' + side('returns') + '<div class="work">' + top('Analysis', 'Returns') + '<div class="content">' +
      '<div style="display:flex;gap:8px;align-items:center"><div class="tabs"><button aria-pressed="true">Returns</button><button>Performance</button><button class="adv">Attribution</button></div>' +
      '<span style="margin-left:auto" class="faint">Basis</span><div class="tabs"><button aria-pressed="true">Net</button><button>Gross</button></div><span class="faint">Period</span><div class="tabs">' + ['YTD', '1Y', '3Y', 'MAX'].map(function (p) { return '<button aria-pressed="' + (p === 'MAX') + '">' + p + '</button>'; }).join('') + '</div></div>' +
      '<section class="panel kgrid" style="border-top:0">' +
      [['XIRR p.a.', '+19.63%', 'money-weighted', 'gain'], ['TWR', '+87.22%', '+18.20% p.a. since 2023-01-16', 'gain'], ['Net return', m('+80,248.09'), '+72.10% on money in', 'gain'], ['Inflation', '+11.85%', 'Euro area HICP · 3.03% p.a.', ''],
        ['Money in', m('98,701.72'), 'purchases incl. fees', ''], ['Value now', m('176,756.66'), 'securities, both portfolios', ''], ['Proceeds', m('16,451.24'), 'sales + dividends + interest', ''], ['Holding period', '1,370 d', 'since first transaction', '']]
        .map(function (k) { return '<div><label>' + k[0] + '</label><div class="v n ' + k[3] + '">' + k[1] + '</div><div class="s">' + k[2] + '</div></div>'; }).join('') + '</section>' +
      '<div class="grid-main">' +
      '<section class="panel"><div class="ph"><h3>Monthly returns (TWR)</h3><div class="tools"><button class="b ghost">Whole portfolio ▾</button></div></div><div class="pb"><table class="hm"><thead><tr><th></th>' +
      ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D', 'Q1', 'Q2', 'Q3', 'Q4', 'Y'].map(function (x) { return '<th>' + x + '</th>'; }).join('') + '</tr></thead><tbody>' +
      [2026, 2025, 2024, 2023].map(function (y) { return '<tr><th>' + y + '</th>' + K.heat[y].map(hcell).join('') + '</tr>'; }).join('') +
      '</tbody></table><div class="faint" style="font-size:11px;margin-top:6px">Click a cell for flows and trades in that period · 2023 and 2026 are part-years</div></div></section>' +
      '<section class="panel"><div class="ph"><h3>Where the return came from</h3></div><div class="pb">' +
      parts.map(function (p) {
        var wpx = Math.abs(p[1]) / max * 100, left = p[1] >= 0 ? x : x - wpx; x = p[1] >= 0 ? x + wpx : x - wpx;
        return '<div class="wf"><span class="dim">' + p[0] + '</span><span class="track"><i style="left:' + left + '%;width:' + Math.max(wpx, 0.6) + '%;background:var(--' + p[2] + ')"></i></span><span class="n ' + p[2] + '" style="text-align:right">' + m(sgn(p[1])) + '</span></div>';
      }).join('') + '<div class="wf" style="border-top:1px solid var(--line-2);margin-top:4px"><b>Net return</b><span></span><b class="n gain" style="text-align:right">' + m('+80,248.09') + '</b></div></div></section></div>' +
      '<section class="panel"><div class="ph"><h3>Per holding</h3><div class="tools tabs"><button aria-pressed="true">Holdings</button><button>Classes</button><button class="adv">Tags</button></div></div>' +
      '<table class="t"><thead><tr><th>Holding</th><th class="r">IRR p.a.</th><th class="r">Invested</th><th class="r">Paid out</th><th class="r">Value now</th><th class="r">Multiple</th></tr></thead><tbody>' +
      K.irr.map(function (r) { var mult = ((r[3] + (r[4] || 0)) / r[2]); return '<tr><td><span class="sym">' + r[0] + '</span></td><td class="r"><span class="n pill gain">+' + r[1].toFixed(1) + '%</span></td><td class="r n">' + m(KIT.fmt(r[2], 2)) + '</td><td class="r n">' + m(KIT.fmt(r[3], 2)) + '</td><td class="r n">' + (r[4] == null ? '<span class="faint">closed</span>' : m(KIT.fmt(r[4], 2))) + '</td><td class="r n">' + mult.toFixed(2) + '×</td></tr>'; }).join('') +
      '</tbody></table></section></div></div></div>';
  }

  function phone() {
    return '<div class="ph-wrap">' +
      '<div class="p-top"><span class="crumbs"><b>Übersicht</b></span><span class="faint" style="font-size:12px">Alle (2) ▾</span><span style="margin-left:auto"></span><button class="b ghost" aria-label="Suchen">' + I('search', 18) + '</button><button class="b ghost" aria-label="Beträge ausblenden">' + I('eye', 18) + '</button></div>' +
      '<div class="p-sum"><div class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:600">Nettovermögen inkl. Guthaben</div><div class="n" style="font-size:30px;line-height:1.15">' + m('178.556,70 €') + '</div>' +
      '<div class="n gain" style="font-size:13px">▲ ' + m('+5.740,17 €') + ' · +3,67 % <span class="faint">1M</span></div>' +
      '<div class="chart" style="height:96px;margin-top:8px"><svg viewBox="0 0 390 96" preserveAspectRatio="none" aria-label="Wert, 12 Monate" role="img"><path d="' + KIT.areaPath(D.series, 390, 96, 4) + '" fill="var(--accent-soft)"/><path d="' + KIT.linePath(D.series, 390, 96, 4) + '" fill="none" stroke="var(--accent)" stroke-width="1.5"/></svg></div>' +
      '<div class="tabs" style="justify-content:space-between;margin-top:6px">' + ['1W', '1M', '3M', 'YTD', '1J', '3J', 'MAX'].map(function (p) { return '<button style="height:36px;min-width:44px" aria-pressed="' + (p === '1J') + '">' + p + '</button>'; }).join('') + '</div></div>' +
      '<div class="p-kpis">' + [['Nicht realisiert', m('+68.759,65 €'), 'gain'], ['XIRR p. a.', '+19,63 %', 'gain'], ['Dividenden 12 M.', m('1.404,15 €'), 'income'], ['Realisiert', m('8.181,74 €'), ''], ['TWR', '+87,22 %', 'gain']].map(function (k) { return '<div><label>' + k[0] + '</label><div class="n ' + k[2] + '" style="font-size:15px;margin-top:2px">' + k[1] + '</div></div>'; }).join('') + '</div>' +
      '<div style="display:flex;gap:6px;padding:0 12px 8px"><div class="tabs"><button aria-pressed="true" style="height:36px">Positionen 31</button><button style="height:36px">Aktivität</button></div><span style="margin-left:auto" class="faint" style="font-size:12px"></span><button class="b ghost" style="height:36px">Wert ↓</button></div>' +
      '<div class="p-list">' + D.pos.slice(0, 9).map(function (p) {
        var v = KIT.num(p.plp);
        return '<div class="it"><span class="a">' + p.sym + ' <span class="dim" style="font-family:var(--font);font-weight:400;font-size:12px">' + p.name + '</span></span><span class="n" style="text-align:right">' + m(KIT.eur(KIT.num(p.value), 'de')) + '</span>' +
          '<span class="faint n" style="font-size:12px">' + KIT.fmt(KIT.num(p.weight), 1, 'de') + ' % · ' + p.qty.replace('.', ',') + ' Stk.</span><span style="text-align:right"><span class="n pill ' + KIT.tone(v) + '" style="font-size:12px">' + KIT.pct(v, 'de') + '</span></span></div>';
      }).join('') + '</div></div>' +
      '<nav class="p-dock" aria-label="Hauptnavigation"><div>' + [['overview', 'Portfolio'], ['tx', 'Aktivität'], ['div', 'Einkommen'], ['analysis', 'Analyse'], ['more', 'Mehr']].map(function (t, i) { return '<a href="#"' + (i === 0 ? ' aria-current="page"' : '') + '>' + I(t[0], 20) + t[1] + '</a>'; }).join('') + '</div></nav>';
  }

  document.getElementById('app').innerHTML = { overview: overview, transactions: transactions, returns: returns, 'phone-overview': phone }[screen]();
})();
