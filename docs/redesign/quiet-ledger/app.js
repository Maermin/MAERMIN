// PROTOTYPE — Direction A "Quiet Ledger". Static mockup over demo figures; throw away after the pick.
(function () {
  'use strict';
  var K = KIT.K, m = KIT.m, I = KIT.icon, D = window.DEMO;
  var screen = document.body.dataset.screen;
  var adv = KIT.state.mode === 'advanced';
  var TYPE = { BUY: ['buy', 'Buy'], SELL: ['sell', 'Sale'], DIVIDEND: ['div', 'Dividend'], TAX: ['tax', 'Tax'] };

  function topbar(active) {
    var items = [['overview', 'Overview'], ['transactions', 'Transactions'], ['div', 'Dividends'], ['tax', 'Taxes'], ['returns', 'Analysis']];
    return '<header class="topbar"><div class="topbar-in">' +
      '<span class="brand"><i></i>MAERMIN</span>' +
      '<nav class="nav" aria-label="Main">' + items.map(function (x) { return '<a href="' + (x[0] === 'div' || x[0] === 'tax' ? '#' : x[0] + '.html' + location.search) + '"' + (x[0] === active ? ' aria-current="page"' : '') + '>' + x[1] + '</a>'; }).join('') + '</nav>' +
      '<div class="top-actions">' +
      '<button class="btn">' + I('search', 18) + 'Search <span class="kbd">⌘K</span></button>' +
      '<button class="btn icon" aria-label="Hide amounts" aria-pressed="' + KIT.state.mask + '">' + I('eye', 18) + '</button>' +
      '<button class="btn icon" aria-label="Settings">' + I('settings', 18) + '</button>' +
      '<button class="btn primary">' + I('plus', 18) + 'Add</button>' +
      '</div></div></header>';
  }

  function chart(h) {
    var w = 1000;
    return '<div class="chart" style="height:' + h + 'px"><svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" role="img" aria-label="Portfolio value, last 12 months">' +
      '<path d="' + KIT.areaPath(D.series, w, h, 8) + '" fill="var(--chart-soft)"/>' +
      '<path d="' + KIT.linePath(D.series, w, h, 8) + '" fill="none" stroke="var(--chart)" stroke-width="1.75" vector-effect="non-scaling-stroke"/></svg></div>' +
      '<div class="axis"><span>Oct 2025</span><span>Jan 2026</span><span>Apr</span><span>Jul</span><span>Oct 2026</span></div>';
  }

  function overview() {
    var pos = D.pos.slice(0, 8);
    return topbar('overview') + '<main class="page">' +
      '<div class="hero"><div>' +
      '<div class="eyebrow">Net worth · both portfolios and cash</div>' +
      '<div class="hero-value num">' + m('178,556<small>.70 €</small>') + '</div>' +
      '<div class="delta"><span class="gain">' + I('up', 16) + ' <b class="num">' + m('+5,740.17 €') + '</b> · <b class="num">+3.67%</b></span><span class="dim">this month</span></div>' +
      '</div><div class="seg" role="group" aria-label="Period">' + ['1M', '6M', 'YTD', '1Y', 'All'].map(function (p) { return '<button aria-pressed="' + (p === '1Y') + '">' + p + '</button>'; }).join('') + '</div></div>' +
      chart(260) +
      '<section class="section"><div class="answers">' +
      '<article class="card answer"><div class="q">How is my money growing?</div><div class="a gain num">+19.63% <span class="dim" style="font-size:16px">a year</span></div><div class="why">Money-weighted return since Jan 2023. Unrealised gain <b class="num">' + m('+68,759.65 €') + '</b> on a cost basis of <span class="num">' + m('107,997.01 €') + '</span>.</div></article>' +
      '<article class="card answer"><div class="q">What does it pay me?</div><div class="a num">' + m('1,404.15 €') + ' <span class="dim" style="font-size:16px">next 12 months</span></div><div class="why">About <b class="num">' + m('117 €') + '</b> a month. Received so far: <span class="num income">' + m('4,964.83 €') + '</span> net.</div></article>' +
      '<article class="card answer"><div class="q">What did it cost?</div><div class="a num">' + m('2,181.56 €') + '</div><div class="why">Taxes <span class="num">' + m('2,128.96 €') + '</span> and fees <span class="num">' + m('52.60 €') + '</span>, all time. Net return after both: <b class="num gain">' + m('+80,248.09 €') + '</b>.</div></article>' +
      '</div>' +
      '<div class="more adv">' +
      '<div><span>TWR</span><b class="num gain">+87.22%</b> <span>18.20% p.a.</span></div>' +
      '<div><span>Realised gains</span><b class="num">' + m('8,181.74 €') + '</b></div>' +
      '<div><span>Cash (clearing account)</span><b class="num">' + m('1,800.04 €') + '</b></div>' +
      '<div><span>Health score</span><b class="num">80</b> <span>Grade B</span></div>' +
      '<div><span>Positions</span><b class="num">31</b> <span>in 2 portfolios</span></div>' +
      '</div></section>' +
      '<section class="section"><div class="section-head"><h2>Where it is</h2><a href="#">Allocation details →</a></div>' +
      '<div class="stack" role="img" aria-label="Stocks and ETFs 77.0 %, crypto 20.7 %, commodities 2.2 %, CS2 skins under 0.1 %">' + K.alloc.map(function (a) { return '<i class="c-' + a.k + '" style="flex:' + Math.max(a.pct, 0.4) + '"></i>'; }).join('') + '</div>' +
      '<div class="legend">' + K.alloc.map(function (a) { return '<span><i class="c-' + a.k + '"></i>' + a.en + ' <b class="num">' + (a.pct < 0.1 ? '<0.1' : a.pct.toFixed(1)) + '%</b> <span class="dim num">' + m(KIT.eur(a.v)) + '</span></span>'; }).join('') + '</div></section>' +
      '<section class="section"><div class="section-head"><h2>Largest holdings</h2><a href="#">All 31 holdings →</a></div>' +
      '<ul class="list card">' + pos.map(function (p) {
        var plp = KIT.num(p.plp), w = KIT.num(p.weight);
        return '<li class="row"><div class="name"><b>' + p.name + '</b><span>' + p.sym + ' · ' + p.qty + ' × <span class="num">' + m(p.price) + '</span></span></div>' +
          '<div><span class="num dim" style="font-size:14px">' + p.weight + ' of portfolio</span><div class="wbar"><i style="width:' + (w * 5) + '%"></i></div></div>' +
          '<div class="r num">' + m(p.value) + '</div>' +
          '<div class="r num ' + KIT.tone(plp) + '">' + (plp >= 0 ? '▲ ' : '▼ ') + p.plp.replace('-', '−') + '</div></li>';
      }).join('') + '</ul></section></main>';
  }

  function transactions() {
    var groups = {}, order = [];
    D.tx.slice(0, 60).forEach(function (t) { var k = t.date.slice(0, 7); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(t); });
    var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return topbar('transactions') + '<main class="page">' +
      '<div class="hero"><div><div class="eyebrow">224 bookings · 2 portfolios</div><h1>Transactions</h1></div><button class="btn primary">' + I('plus', 18) + 'Add transaction</button></div>' +
      '<div class="toolbar"><input class="search" placeholder="Search symbol, name or note" aria-label="Search transactions">' +
      '<div class="seg" role="group" aria-label="Type">' + ['All', 'Buys', 'Sales', 'Dividends', 'Cash & tax'].map(function (p, i) { return '<button aria-pressed="' + (i === 0) + '">' + p + '</button>'; }).join('') + '</div>' +
      '<button class="btn">' + I('filter', 16) + 'More filters</button><button class="btn" style="margin-left:auto">Import statement</button></div>' +
      order.slice(0, 5).map(function (k) {
        var rows = groups[k], inc = 0, out = 0;
        rows.forEach(function (t) { var v = KIT.txEUR(t); if (t.type === 'BUY' || v < 0) out += Math.abs(v); else inc += v; });
        var y = k.slice(0, 4), mo = MONTHS[+k.slice(5) - 1];
        return '<section class="month"><div class="month-head"><h2>' + mo + ' ' + y + '</h2><span class="num">' + rows.length + (rows.length === 1 ? ' booking' : ' bookings') + ' · in ' + m(KIT.eur(inc)) + ' · out ' + m(KIT.eur(out)) + '</span></div><div class="card">' +
          rows.map(function (t) {
            var ty = TYPE[t.type] || ['tx', t.type], v = KIT.txEUR(t);
            var amount = t.type === 'DIVIDEND' ? '<span class="income">' + m(KIT.signed(v)) + '</span>' : t.type === 'BUY' ? m(KIT.eur(v)) : m(KIT.signed(v));
            var ic = { buy: I('buy', 16), sell: I('sell', 16), div: I('div', 16), tax: I('tax', 16) }[ty[0]] || '';
            var pos = KIT.posFor(t.sym);
            return '<div class="tx"><div class="day num">' + t.date.slice(8) + '.' + t.date.slice(5, 7) + '.</div><div class="ic">' + ic + '</div>' +
              '<div class="what"><b>' + (pos ? pos.name : t.sym) + '</b><span>' + ty[1] + (t.qty ? ' · ' + t.qty + ' × ' + t.price + ' ' + t.cur : '') + ' · Main depot</span></div>' +
              '<div class="dim" style="font-size:14px">' + t.cls + '</div>' +
              '<div class="r num">' + amount + (t.cur === 'USD' ? '<span class="sub">' + m(t.total) + '</span>' : '') + '</div></div>';
          }).join('') + '</div></section>';
      }).join('') +
      '<p class="dim" style="text-align:center">Older months load as you scroll · USD amounts in EUR at each booking’s rate (mockup: 0.920)</p></main>';
  }

  function heatCell(v) {
    if (v == null) return '<td class="dim">—</td>';
    var a = Math.min(Math.abs(v) / 8, 1), col = v >= 0 ? 'var(--gain)' : 'var(--loss)';
    return '<td style="background:color-mix(in srgb, ' + col + ' ' + Math.round(8 + a * 30) + '%, transparent)">' + (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '</td>';
  }

  function returns() {
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return topbar('returns') + '<main class="page">' +
      '<div class="eyebrow">Returns · since 16 Jan 2023 · after fees and taxes</div>' +
      '<p class="statement">Your money grew <b class="gain">19.63% a year</b>. The portfolio itself rose <b>87.22%</b> since you started, or 18.20% a year.</p>' +
      '<p class="dim" style="max-width:720px">The first figure (XIRR) counts when you paid money in. The second (TWR) ignores your deposits, so you can compare it with an index. Inflation in the same time: 11.85%.</p>' +
      '<div class="pair">' +
      '<div class="card answer"><div class="q">Money in, all time</div><div class="a num">' + m('98,701.72 €') + '</div><div class="why">Purchases incl. fees. Proceeds paid out: <span class="num">' + m('16,451.24 €') + '</span>.</div></div>' +
      '<div class="card answer"><div class="q">Net return</div><div class="a num gain">' + m('+80,248.09 €') + '</div><div class="why">+72.10% on what you put in · realised <span class="num">' + m('8,181.74 €') + '</span> · dividends <span class="num">' + m('4,964.83 €') + '</span></div></div></div>' +
      '<section class="section"><div class="section-head"><h2>Month by month</h2><div class="seg">' + ['Months', 'Quarters'].map(function (p, i) { return '<button aria-pressed="' + (i === 0) + '">' + p + '</button>'; }).join('') + '</div></div>' +
      '<div class="card" style="padding:16px"><table class="heat"><thead><tr><th></th>' + MON.map(function (x) { return '<th>' + x + '</th>'; }).join('') + '<th>Year</th></tr></thead><tbody>' +
      [2026, 2025, 2024, 2023].map(function (y) { var r = K.heat[y]; return '<tr><th>' + y + '</th>' + r.slice(0, 12).map(heatCell).join('') + heatCell(r[16]).replace('<td', '<td class="y"') + '</tr>'; }).join('') +
      '</tbody></table><p class="dim" style="font-size:12px;margin:8px 4px 0">Shade = size of the month’s return; the sign is always printed. 2023 and 2026 are part-years.</p></div></section>' +
      '<section class="section"><div class="section-head"><h2>Per holding</h2><a href="#">All holdings →</a></div><div class="card"><table class="tbl"><thead><tr><th>Holding</th><th class="r">Return p.a.</th><th class="r">Invested</th><th class="r">Paid out</th><th class="r">Value now</th></tr></thead><tbody>' +
      K.irr.map(function (r) { return '<tr><td>' + r[0] + '</td><td class="r num gain">+' + r[1].toFixed(1) + '%</td><td class="r num">' + m(KIT.eur(r[2])) + '</td><td class="r num">' + m(KIT.eur(r[3])) + '</td><td class="r num">' + (r[4] == null ? '<span class="dim">sold</span>' : m(KIT.eur(r[4]))) + '</td></tr>'; }).join('') +
      '</tbody></table></div></section></main>';
  }

  function phone() {
    var de = 'de';
    var tabs = [['overview', 'Übersicht'], ['tx', 'Buchungen'], ['div', 'Dividenden'], ['tax', 'Steuern'], ['analysis', 'Analyse']];
    return '<main class="phone">' +
      '<div class="p-head"><span class="brand"><i></i>MAERMIN</span><div style="display:flex;gap:4px"><button class="btn icon" aria-label="Suchen">' + I('search', 20) + '</button><button class="btn icon" aria-label="Beträge ausblenden">' + I('eye', 20) + '</button></div></div>' +
      '<div class="p-hero"><div class="eyebrow">Nettovermögen · beide Depots und Guthaben</div>' +
      '<div class="hero-value num">' + m('178.556<small>,70 €</small>') + '</div>' +
      '<div class="delta"><span class="gain">' + I('up', 16) + ' <b class="num">' + m('+5.740,17 €') + '</b> · <b class="num">+3,67 %</b></span><span class="dim">diesen Monat</span></div></div>' +
      chart(150).replace('Oct 2025', 'Okt. 25').replace('Jan 2026', 'Jan.').replace('Apr', 'Apr.').replace('Jul', 'Juli').replace('Oct 2026', 'Okt. 26') +
      '<div class="seg" role="group" aria-label="Zeitraum" style="margin-top:16px;display:flex">' + ['1M', '6M', 'lfd. J.', '1J', 'Alles'].map(function (p) { return '<button style="flex:1" aria-pressed="' + (p === '1J') + '">' + p + '</button>'; }).join('') + '</div>' +
      '<div class="p-answers">' +
      '<div class="card answer"><div><div class="q">Rendite pro Jahr</div><div class="why">geldgewichtet, seit Jan. 2023</div></div><div class="a gain num">+19,63 %</div></div>' +
      '<div class="card answer"><div><div class="q">Dividenden, nächste 12 Monate</div><div class="why">etwa ' + m('117 €') + ' im Monat</div></div><div class="a num">' + m('1.404,15 €') + '</div></div>' +
      '<div class="card answer"><div><div class="q">Steuern und Gebühren</div><div class="why">seit Beginn</div></div><div class="a num">' + m('2.181,56 €') + '</div></div></div>' +
      '<div class="section" style="margin-top:32px"><div class="section-head"><h2>Größte Positionen</h2><a href="#">Alle 31 →</a></div><div class="card">' +
      D.pos.slice(0, 6).map(function (p) { var plp = KIT.num(p.plp); return '<div class="p-row"><div><b style="font-weight:500">' + p.name + '</b><div class="dim" style="font-size:13px">' + KIT.fmt(KIT.num(p.weight), 1, de) + ' % · ' + p.sym + '</div></div><div style="text-align:right"><div class="num">' + m(KIT.eur(KIT.num(p.value), de)) + '</div><div class="num ' + KIT.tone(plp) + '" style="font-size:13px">' + (plp >= 0 ? '▲ ' : '▼ ') + KIT.pct(plp, de) + '</div></div></div>'; }).join('') +
      '</div></div></main>' +
      '<nav class="tabbar" aria-label="Hauptnavigation"><div class="tabbar-in">' + tabs.map(function (t, i) { return '<a href="#"' + (i === 0 ? ' aria-current="page"' : '') + '>' + I(t[0], 22) + t[1] + '</a>'; }).join('') + '</div></nav>';
  }

  document.getElementById('app').innerHTML = { overview: overview, transactions: transactions, returns: returns, 'phone-overview': phone }[screen]();
})();
