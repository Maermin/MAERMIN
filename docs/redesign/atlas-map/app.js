// PROTOTYPE — Direction C "Atlas Map". Static mockup over demo figures; throw away after the pick.
(function () {
  'use strict';
  var K = KIT.K, m = KIT.m, I = KIT.icon, D = window.DEMO;
  var screen = document.body.dataset.screen;
  var CRYPTO = ['BTC', 'ETH', 'SOL'];
  function clsOf(p) { return CRYPTO.indexOf(p.sym) > -1 ? 'crypto' : p.sym === 'XAU' ? 'commod' : p.sym === 'AK47' ? 'skins' : 'stocks'; }

  function rail(active, de) {
    var items = de
      ? [['overview', 'Übersicht'], ['tx', 'Aktivität'], ['div', 'Einkommen'], ['tax', 'Steuern'], ['analysis', 'Einblick']]
      : [['overview', 'Home'], ['tx', 'Activity'], ['div', 'Income'], ['tax', 'Tax'], ['analysis', 'Insight']];
    var href = { overview: 'overview.html', tx: 'transactions.html', analysis: 'returns.html' };
    return '<nav class="rail" aria-label="Main"><div class="logo" aria-hidden="true"></div>' +
      items.map(function (x) { return '<a href="' + (href[x[0]] ? href[x[0]] + location.search : '#') + '"' + (x[0] === active ? ' aria-current="page"' : '') + '>' + I(x[0], 22) + x[1] + '</a>'; }).join('') +
      '<span class="sp"></span><a href="#">' + I('settings', 22) + 'Settings</a></nav>';
  }
  function header(title, tabs, activeTab, extra) {
    return '<header class="ph"><div class="ph-row"><h1>' + title + '</h1><span class="scope"><i></i>All portfolios · 2 ' + I('down', 14) + '</span>' +
      '<div class="ph-actions"><button class="btn quiet">' + I('search', 16) + 'Search <span class="faint mono" style="font-size:11px">⌘K</span></button>' +
      '<button class="btn icon" aria-label="Hide amounts" aria-pressed="' + KIT.state.mask + '">' + I('eye', 18) + '</button>' + (extra || '') +
      '<button class="btn primary">' + I('plus', 16) + 'Add</button></div></div>' +
      '<nav class="subnav" aria-label="' + title + ' views">' + tabs.map(function (t) { return '<a href="#"' + (t[0] === activeTab ? ' aria-current="page"' : '') + (t[1] ? ' class="adv"' : '') + '>' + t[0] + '</a>'; }).join('') + '</nav></header>';
  }
  // diverging tile colour: intensity grows with the size of the return; the sign is always printed
  function tileBg(plp) {
    var a = Math.min(Math.log10(1 + Math.abs(plp)) / 3, 1);
    return 'color-mix(in srgb, var(--' + (plp >= 0 ? 'gain' : 'loss') + ') ' + Math.round(14 + a * 46) + '%, var(--surface))';
  }
  function treemap(h) {
    var groups = { stocks: [], crypto: [], commod: [], skins: [] };
    D.pos.forEach(function (p) { groups[clsOf(p)].push(p); });
    var stocks = groups.stocks, cols = [[], [], []], sums = [0, 0, 0];
    stocks.forEach(function (p) { var i = sums.indexOf(Math.min.apply(null, sums)); cols[i].push(p); sums[i] += KIT.num(p.value); });
    function col(list, grow, label) {
      return '<div class="col" style="flex:' + grow + '">' + (label ? '<div class="cls-label">' + label + '</div>' : '') +
        list.map(function (p) { var v = KIT.num(p.value), r = KIT.num(p.plp); return '<div class="tile" style="flex:' + v + ';background:' + tileBg(r) + '" title="' + p.name + '"><b>' + p.sym + '</b><span class="n">' + (r >= 0 ? '▲ ' : '▼ ') + p.plp.replace('-', '−') + '</span></div>'; }).join('') + '</div>';
    }
    var crypto = groups.crypto.concat(groups.commod);
    return '<div class="map" style="height:' + h + 'px">' + cols.map(function (c, i) { return col(c, sums[i], i === 0 ? 'Stocks & ETFs · 77.0%' : ' '); }).join('') +
      col(crypto, 36630 + 3930, 'Crypto · Gold') + '</div>' +
      '<div class="map-legend"><span>Area = value · colour = return since purchase</span><span style="margin-left:auto">−10%</span><i style="background:' + tileBg(-10) + '"></i><i style="background:' + tileBg(0) + '"></i><i style="background:' + tileBg(50) + '"></i><i style="background:' + tileBg(1000) + '"></i><span>+1,000%</span></div>';
  }
  var NEXT = [['Oct', '28', 'Fed rate decision (FOMC)', 'central bank', ''], ['Oct', '29', 'ECB rate decision', 'central bank', ''], ['Oct', '29', 'PG dividend', 'expected', '≈ ' + m('24.44 $')], ['Oct', '29', 'JPM dividend', 'expected', '≈ ' + m('21.85 $')], ['Oct', '29', 'O dividend', 'expected', '≈ ' + m('16.17 $')]];

  function overview() {
    var w = 600, h = 84;
    return '<div class="shell">' + rail('overview') + '<div class="main">' +
      header('Home', [['Overview'], ['Portfolios'], ['Net worth'], ['Watchlist'], ['Events'], ['Budget', 1], ['Rebalancing', 1]], 'Overview') +
      '<div class="content">' +
      '<section class="card hero"><div>' +
      '<div class="label">Net worth · 2 portfolios + cash</div>' +
      '<div class="big n">' + m('178,556<small>.70 €</small>') + '</div>' +
      '<span class="chg gain n">' + I('up', 14) + m('+5,740.17 €') + ' · +3.67% <span class="dim" style="font-weight:500">this month</span></span>' +
      '<div class="mini"><svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" role="img" aria-label="Value, 12 months"><path d="' + KIT.areaPath(D.series, w, h, 4) + '" fill="var(--accent-soft)"/><path d="' + KIT.linePath(D.series, w, h, 4) + '" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg></div>' +
      '<div class="periods">' + ['1M', '6M', 'YTD', '1Y', '3Y', 'All'].map(function (p) { return '<button aria-pressed="' + (p === '1Y') + '">' + p + '</button>'; }).join('') + '</div>' +
      '</div><div>' +
      '<div class="label">What your net worth is made of</div>' +
      '<div class="made" role="img" aria-label="Money still invested 107,997.01 euros, unrealised gain 68,759.65 euros, cash 1,800.04 euros"><i class="c" style="flex:107997">' + m('Invested 107,997 €') + '</i><i class="g" style="flex:68760">' + m('Gain +68,760 €') + '</i><i class="k" style="flex:1800"></i></div>' +
      '<div class="made-legend"><span><span class="dot" style="background:var(--s-cost)"></span>Still invested <b class="n">' + m('107,997.01 €') + '</b></span><span><span class="dot" style="background:var(--s-gain)"></span>Unrealised gain <b class="n gain">' + m('+68,759.65 €') + '</b></span><span><span class="dot" style="background:var(--s-cash)"></span>Cash <b class="n">' + m('1,800.04 €') + '</b></span></div>' +
      '<div class="eq"><span class="dim">Securities ' + m('176,756.66 €') + ' + cash ' + m('1,800.04 €') + '</span><b class="n">= ' + m('178,556.70 €') + '</b></div>' +
      '<div class="facts"><div>Already taken out<b class="n">' + m('16,451.24 €') + '</b>sales, dividends, interest</div><div>Realised gains<b class="n">' + m('8,181.74 €') + '</b>FIFO, all time</div><div>Taxes paid<b class="n">' + m('2,128.96 €') + '</b>withholding + bookings</div><div class="adv">Fees<b class="n">' + m('52.60 €') + '</b>0.053% of money in</div></div>' +
      '</div></section>' +
      '<div class="row3">' +
      '<section class="card ans"><div class="card-b"><div class="label">Return per year</div><div class="v n gain">+19.63%</div><div class="sub">Money-weighted, since Jan 2023</div><div class="split adv"><div>Time-weighted<b class="n gain">+18.20% p.a.</b></div><div>Inflation<b class="n">3.03% p.a.</b></div></div></div></section>' +
      '<section class="card ans"><div class="card-b"><div class="label">Income, next 12 months</div><div class="v n income">' + m('1,404.15 €') + '</div><div class="sub">≈ ' + m('117 €') + ' a month · 1.0% yield</div><div class="split"><div>Received so far<b class="n">' + m('4,964.83 €') + '</b></div><div>Gross<b class="n">' + m('5,435.65 €') + '</b></div></div></div></section>' +
      '<section class="card ans"><div class="card-b"><div class="label">Health</div><div class="v n">80 <span class="dim" style="font-size:16px;font-weight:500">/ 100 · B</span></div><div class="sub">Largest position BTC 15.1%</div><div class="split"><div>Diversification<b class="n">88</b></div><div>Risk<b class="n">46</b></div><div>Tax eff.<b class="n">85</b></div></div></div></section>' +
      '<section class="card next"><div class="card-h"><h2>Next up</h2><a class="more" href="#">Events →</a></div><div class="card-b" style="padding-top:8px"><ul>' +
      NEXT.map(function (e) { return '<li><span class="date">' + e[0] + '<b>' + e[1] + '</b></span><span>' + e[2] + '<span class="faint" style="display:block;font-size:12px">' + e[3] + '</span></span><span class="n income">' + e[4] + '</span></li>'; }).join('') + '</ul></div></section></div>' +
      '<section class="card"><div class="card-h"><h2>Holdings map</h2><span class="faint" style="font-size:13px">31 positions · CS2 skins (82 €) not shown</span><a class="more" href="#">Allocation →</a></div><div class="card-b">' + treemap(300) + '</div></section>' +
      '<section class="card"><div class="card-h"><h2>Positions</h2><a class="more" href="#">All 31 →</a></div><div class="card-b" style="padding:8px 0 0"><table class="tbl"><thead><tr><th>Holding</th><th class="r">Value</th><th class="r">Weight</th><th class="r">Unrealised</th><th class="r">Return</th></tr></thead><tbody>' +
      D.pos.slice(0, 8).map(function (p) { var r = KIT.num(p.plp); return '<tr><td><span class="av">' + p.sym.slice(0, 4) + '</span>' + p.name + ' <span class="faint" style="font-size:12px">' + p.qty + ' × ' + m(p.price) + '</span></td><td class="r n">' + m(p.value) + '</td><td class="r n dim">' + p.weight + '</td><td class="r n ' + KIT.tone(r) + '">' + m(p.pl.replace('-', '−')) + '</td><td class="r"><span class="chip n ' + KIT.tone(r) + '">' + (r >= 0 ? '▲ ' : '▼ ') + p.plp.replace('-', '−') + '</span></td></tr>'; }).join('') +
      '</tbody></table></div></section></div></div></div>';
  }

  function transactions() {
    var groups = {}, order = [];
    D.tx.slice(0, 40).forEach(function (t) { var k = t.date.slice(0, 7); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(t); });
    var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var ty = { BUY: ['buy', 'Buy', 'buy'], SELL: ['sell', 'Sale', 'sell'], DIVIDEND: ['div', 'Dividend', 'div'], TAX: ['tax', 'Tax', 'tax'] };
    var count = { BUY: 0, SELL: 0, DIVIDEND: 0, TAX: 0 }; D.tx.forEach(function (t) { count[t.type]++; });
    return '<div class="shell">' + rail('tx') + '<div class="main">' +
      header('Activity', [['Transactions'], ['Savings plans'], ['Import & export'], ['Cash flow', 1], ['Journal', 1]], 'Transactions', '<button class="btn">' + I('tx', 16) + 'Import statement</button>') +
      '<div class="content"><div class="md">' +
      '<section class="card"><div class="filters"><input class="search" placeholder="Search name, symbol, note" aria-label="Search">' +
      '<button class="fchip" aria-pressed="true">All <span class="c">224</span></button><button class="fchip">Buys <span class="c">' + count.BUY + '</span></button><button class="fchip">Sales <span class="c">' + count.SELL + '</span></button><button class="fchip">Income <span class="c">' + count.DIVIDEND + '</span></button><button class="fchip">Tax &amp; fees <span class="c">' + count.TAX + '</span></button><button class="fchip">' + I('filter', 14) + 'Portfolio, date…</button></div>' +
      order.slice(0, 3).map(function (k) {
        var rows = groups[k], inc = 0; rows.forEach(function (t) { if (t.type === 'DIVIDEND') inc += KIT.txEUR(t); });
        return '<div class="mhead"><b>' + MONTHS[+k.slice(5) - 1] + ' ' + k.slice(0, 4) + '</b><span class="n">income ' + m(KIT.eur(inc)) + ' · ' + rows.length + (rows.length === 1 ? ' booking' : ' bookings') + '</span></div>' +
          rows.map(function (t) {
            var x = ty[t.type], v = KIT.txEUR(t), p = KIT.posFor(t.sym), sel = t.type === 'SELL' && t.sym === 'NVDA';
            var amt = t.type === 'DIVIDEND' ? '<span class="income">' + m(KIT.signed(v)) + '</span>' : t.type === 'BUY' ? m(KIT.eur(v)) : m(KIT.signed(v));
            return '<div class="li" role="option" aria-selected="' + sel + '"><span class="ic ' + x[2] + '">' + I(x[0], 18) + '</span><span class="t"><b>' + (p ? p.name : t.sym) + '</b><span>' + x[1] + ' · ' + MONTHS[+t.date.slice(5, 7) - 1].slice(0, 3) + ' ' + (+t.date.slice(8)) + (t.qty ? ' · ' + t.qty + ' × ' + t.price + ' ' + t.cur : '') + '</span></span><span class="a n">' + amt + (t.cur === 'USD' ? '<span class="sub">' + m(t.total) + '</span>' : '') + '</span></div>';
          }).join('');
      }).join('') + '<div class="li" style="justify-content:center;display:flex;color:var(--dim);font-size:13px">Earlier months load as you scroll</div></section>' +
      '<aside class="card detail"><div class="card-h"><span class="li" style="padding:0;border:0;min-height:0;grid-template-columns:40px 1fr"><span class="ic sell">' + I('sell', 18) + '</span><span class="t"><b>NVIDIA Corp. · Sale</b><span>14 May 2026 · Main depot</span></span></span></div>' +
      '<div class="card-b"><div style="font-size:28px;font-weight:600;letter-spacing:-.02em" class="n">' + m('+8,161.32 €') + '</div><div class="dim n" style="font-size:13px">' + m('8,871.00 $') + ' at the mockup rate 0.920 · 60 shares × 147.85 $</div>' +
      '<div style="margin-top:14px"><div class="kv"><span>Quantity</span><span class="n">60</span></div><div class="kv"><span>Price</span><span class="n">' + m('147.85 $') + '</span></div><div class="kv"><span>Category</span><span>Stocks</span></div></div>' +
      '<div class="effect"><div class="label">What this sale did</div><div class="kv"><span>Realised gain (FIFO, 1 lot)</span><span class="n gain">' + m('+6,985.92 €') + '</span></div><div class="kv"><span>Tax booked the same day</span><span class="n">' + m('1,658.14 €') + '</span></div><div class="kv"><span>NVDA still held</span><span class="n">112 shares</span></div></div>' +
      '<div style="display:flex;gap:8px;margin-top:16px"><button class="btn" style="flex:1">Edit</button><button class="btn" style="flex:1">Duplicate</button><button class="btn icon" aria-label="Move to trash">' + I('more', 18) + '</button></div></div></aside>' +
      '</div></div></div></div>';
  }

  function heatCell(v) {
    if (v == null) return '<td class="faint">—</td>';
    var a = Math.min(Math.abs(v) / 8, 1);
    return '<td style="background:color-mix(in srgb, var(--' + (v >= 0 ? 'gain' : 'loss') + ') ' + Math.round(12 + a * 40) + '%, var(--surface))">' + (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '</td>';
  }

  function returns() {
    var steps = [['Unrealised', 68759.65, 'gain'], ['Realised', 8181.74, 'gain'], ['Dividends', 4964.83, 'income'], ['Other', 523.43, 'flat'], ['Taxes', -2128.96, 'loss'], ['Fees', -52.60, 'loss'], ['Net return', 80248.09, 'accent']];
    var max = 82429.65, run = 0;
    return '<div class="shell">' + rail('analysis') + '<div class="main">' +
      header('Insight', [['Returns'], ['Performance'], ['Attribution', 1], ['Health & risk'], ['Research', 1], ['Strategy', 1], ['Fees', 1]], 'Returns') +
      '<div class="content">' +
      '<div style="display:flex;gap:10px;align-items:center"><div class="periods" style="margin:0">' + ['YTD', '1Y', '3Y', 'Since start'].map(function (p) { return '<button aria-pressed="' + (p === 'Since start') + '">' + p + '</button>'; }).join('') + '</div><span class="faint" style="margin-left:auto;font-size:13px">After taxes and fees</span><div class="periods" style="margin:0"><button aria-pressed="true">Net</button><button>Gross</button></div></div>' +
      '<section class="card"><div class="card-h"><h2>How fast your money grew</h2><span class="faint" style="font-size:13px">per year, since 16 Jan 2023</span></div><div class="card-b">' +
      [['Your money (XIRR)', 19.63, 'gain', 'counts when you paid in'], ['The portfolio (TWR)', 18.20, 'accent', 'comparable with an index'], ['Inflation, euro area', 3.03, 'flat', 'Eurostat HICP']].map(function (r) { return '<div class="cmp-row"><span>' + r[0] + '<span class="faint" style="display:block;font-size:12px">' + r[3] + '</span></span><span class="track"><i style="width:' + (r[1] / 22 * 100) + '%;background:var(--' + r[2] + ')"></i></span><b class="n" style="text-align:right">' + (r[2] === 'flat' ? '' : '+') + r[1].toFixed(2) + '%</b></div>'; }).join('') +
      '</div></section>' +
      '<div style="display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:20px">' +
      '<section class="card"><div class="card-h"><h2>Where the ' + m('+80,248.09 €') + ' came from</h2></div><div class="card-b"><div class="wf">' +
      steps.map(function (s) {
        var hgt = Math.abs(s[1]) / max * 100, bottom;
        if (s[2] === 'accent') { bottom = 0; } else if (s[1] >= 0) { bottom = run / max * 100; run += s[1]; } else { run += s[1]; bottom = run / max * 100; }
        return '<div class="col"><span class="bar" style="bottom:' + bottom + '%;height:' + Math.max(hgt, 0.8) + '%;background:var(--' + (s[2] === 'accent' ? 'accent' : s[2]) + ')"></span><span class="lab n ' + (s[2] === 'accent' ? '' : s[2]) + '" style="bottom:calc(' + (bottom + hgt) + '% + 4px)">' + m(KIT.signed(s[1], 'en', 0, '')) + '</span></div>';
      }).join('') + '</div><div class="wf-x">' + steps.map(function (s) { return '<span>' + s[0] + '</span>'; }).join('') + '</div>' +
      '<p class="faint" style="font-size:12px;margin:10px 0 0">“Other” = interest and currency effects the figures do not split further.</p></div></section>' +
      '<section class="card"><div class="card-h"><h2>Best holdings, return per year</h2><a class="more" href="#">All →</a></div><div class="card-b">' +
      K.irr.map(function (r) { return '<div class="irr"><span>' + r[0] + '</span><span class="track"><i style="width:' + (r[1] / 100 * 100) + '%"></i></span><b class="n gain" style="text-align:right">+' + r[1].toFixed(1) + '%</b></div>'; }).join('') + '</div></section></div>' +
      '<section class="card"><div class="card-h"><h2>Month by month</h2><span class="faint" style="font-size:13px">select a month for its flows and trades</span></div><div class="card-b"><table class="heat"><thead><tr><th></th>' +
      ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Year'].map(function (x) { return '<th>' + x + '</th>'; }).join('') + '</tr></thead><tbody>' +
      [2026, 2025, 2024, 2023].map(function (y) { var r = K.heat[y]; return '<tr><th>' + y + '</th>' + r.slice(0, 12).map(heatCell).join('') + heatCell(r[16]) + '</tr>'; }).join('') + '</tbody></table></div></section>' +
      '</div></div></div>';
  }

  function phone() {
    return '<main class="phone"><div class="p-top"><span class="logo" style="width:30px;height:30px;margin:0"></span><span class="scope" style="height:36px">Alle Depots · 2 ' + I('down', 14) + '</span><span style="margin-left:auto"></span><button class="btn icon quiet" aria-label="Suchen">' + I('search', 20) + '</button><button class="btn icon quiet" aria-label="Beträge ausblenden">' + I('eye', 20) + '</button></div>' +
      '<section class="card p-hero"><div class="label">Nettovermögen · 2 Depots + Guthaben</div><div class="big n">' + m('178.556<small>,70 €</small>') + '</div>' +
      '<span class="chg gain n">' + I('up', 14) + m('+5.740,17 €') + ' · +3,67 % <span class="dim" style="font-weight:500">diesen Monat</span></span>' +
      '<div class="mini" style="height:70px"><svg viewBox="0 0 360 70" preserveAspectRatio="none" role="img" aria-label="Wert, 12 Monate"><path d="' + KIT.areaPath(D.series, 360, 70, 4) + '" fill="var(--accent-soft)"/><path d="' + KIT.linePath(D.series, 360, 70, 4) + '" fill="none" stroke="var(--accent)" stroke-width="2"/></svg></div>' +
      '<div class="label" style="margin-top:16px">Woraus es besteht</div><div class="made" style="height:36px"><i class="c" style="flex:107997">' + m('Investiert') + '</i><i class="g" style="flex:68760">' + m('Gewinn') + '</i><i class="k" style="flex:1800"></i></div>' +
      '<div style="display:grid;gap:6px;font-size:13px"><div style="display:flex;justify-content:space-between"><span class="dim">Noch investiert</span><b class="n">' + m('107.997,01 €') + '</b></div><div style="display:flex;justify-content:space-between"><span class="dim">Nicht realisierter Gewinn</span><b class="n gain">' + m('+68.759,65 €') + '</b></div><div style="display:flex;justify-content:space-between"><span class="dim">Guthaben</span><b class="n">' + m('1.800,04 €') + '</b></div></div></section>' +
      '<div class="p-grid" style="margin-top:10px">' +
      '<div class="card"><div class="label">Rendite p. a.</div><div class="v n gain">+19,63 %</div><div class="faint" style="font-size:12px">geldgewichtet</div></div>' +
      '<div class="card"><div class="label">Einkommen 12 M.</div><div class="v n income">' + m('1.404,15 €') + '</div><div class="faint" style="font-size:12px">≈ ' + m('117 €') + ' / Monat</div></div>' +
      '<div class="card"><div class="label">Gesundheit</div><div class="v n">80 <span class="dim" style="font-size:13px">B</span></div><div class="faint" style="font-size:12px">größte Pos. 15,1 %</div></div>' +
      '<div class="card"><div class="label">Steuern gezahlt</div><div class="v n">' + m('2.128,96 €') + '</div><div class="faint" style="font-size:12px">seit Beginn</div></div></div>' +
      '<section class="card next" style="margin-top:10px"><div class="card-h"><h2>Als Nächstes</h2><a class="more" href="#">Termine →</a></div><div class="card-b" style="padding-top:6px"><ul>' +
      [['Okt.', '28', 'Fed-Zinsentscheid', 'Notenbank', ''], ['Okt.', '29', 'PG-Dividende', 'erwartet', '≈ ' + m('24,44 $')], ['Okt.', '29', 'JPM-Dividende', 'erwartet', '≈ ' + m('21,85 $')]].map(function (e) { return '<li><span class="date">' + e[0] + '<b>' + e[1] + '</b></span><span>' + e[2] + '<span class="faint" style="display:block;font-size:12px">' + e[3] + '</span></span><span class="n income">' + e[4] + '</span></li>'; }).join('') + '</ul></div></section>' +
      '<section class="card" style="margin-top:10px"><div class="card-h"><h2>Positionen</h2><a class="more" href="#">Alle 31 →</a></div><div class="card-b" style="padding:6px 0 4px">' +
      D.pos.slice(0, 5).map(function (p) { var r = KIT.num(p.plp); return '<div class="li" style="grid-template-columns:40px 1fr auto;cursor:default"><span class="av" style="margin:0">' + p.sym.slice(0, 4) + '</span><span class="t"><b>' + p.name + '</b><span>' + KIT.fmt(KIT.num(p.weight), 1, 'de') + ' % des Depots</span></span><span class="a n">' + m(KIT.eur(KIT.num(p.value), 'de')) + '<span class="sub ' + KIT.tone(r) + '">' + (r >= 0 ? '▲ ' : '▼ ') + KIT.pct(r, 'de') + '</span></span></div>'; }).join('') + '</div></section></main>' +
      '<nav class="dock" aria-label="Hauptnavigation"><a href="#" aria-current="page">' + I('overview', 22) + 'Übersicht</a><a href="#">' + I('tx', 22) + 'Aktivität</a><a href="#" class="fab" aria-label="Hinzufügen">' + I('plus', 26) + '</a><a href="#">' + I('div', 22) + 'Einkommen</a><a href="#">' + I('more', 22) + 'Mehr</a></nav>';
  }

  document.getElementById('app').innerHTML = { overview: overview, transactions: transactions, returns: returns, 'phone-overview': phone }[screen]();
})();
