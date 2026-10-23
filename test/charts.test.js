// CH-3a: the Charts view's pure helpers (charts.js) - the timeframe table
// against the Worker's limits, chart types, scales, the per-viewer settings
// (maermin_chart_prefs), the request URL, bars for the chart library, the
// change over the shown range, quick picks and the library theme.
// Run: node test/charts.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info).slice(0, 400) : '')); }
}

(async function run() {
  const C = require('../charts.js');
  const W = await import('../cf-worker/worker.js');

  console.log('timeframes:');
  ok('eight timeframes in order', C.TIMEFRAMES.map((t) => t.id).join() === '1m,5m,15m,1h,4h,1D,1W,1M', C.TIMEFRAMES.map((t) => t.id));
  ok('every interval / range pair is one the Worker serves (CH-1 limits)', C.TIMEFRAMES.every((t) => (W.YF_ALLOWED_RANGES[t.interval] || []).indexOf(t.range) !== -1),
    C.TIMEFRAMES.filter((t) => (W.YF_ALLOWED_RANGES[t.interval] || []).indexOf(t.range) === -1));
  ok('4h is 1h bars combined four to one', C.timeframe('4h').interval === '60m' && C.timeframe('4h').resample === 4 && C.timeframe('4h').period.type === 'hour' && C.timeframe('4h').period.span === 4);
  ok('1D asks for 10 years (Yahoo answers max with monthly bars)', C.timeframe('1D').interval === '1d' && C.timeframe('1D').range === '10y');
  ok('intraday flags', C.timeframe('1m').intraday && C.timeframe('4h').intraday && !C.timeframe('1D').intraday);
  ok('an unknown id falls back to 1D', C.timeframe('7x').id === '1D');

  console.log('\ntypes and scales:');
  ok('five chart types; line and area work without candles', C.TYPES.map((t) => t.id).join() === 'candles,ohlc,heikin,line,area' && C.TYPES.filter((t) => !t.needsOhlc).map((t) => t.id).join() === 'line,area');
  ok('types offered: all with candles, line / area with closes only', C.availableTypes(true).length === 5 && C.availableTypes(false).map((t) => t.id).join() === 'line,area');
  ok('a type the data cannot show falls back to line', C.usableType('candles', false) === 'line' && C.usableType('ohlc', true) === 'ohlc' && C.usableType('nope', true) === 'candles');
  ok('library candle types', C.type('candles').candle === 'candle_solid' && C.type('ohlc').candle === 'ohlc' && C.type('heikin').candle === 'candle_solid' && C.type('line').candle === 'area' && C.type('area').candle === 'area');
  ok('scales map to the library\'s axes', C.SCALES.map((s) => s.id + '=' + s.axis).join() === 'linear=normal,log=logarithm,percent=percentage');

  console.log('\nsettings (maermin_chart_prefs):');
  ok('the key', C.PREFS_KEY === 'maermin_chart_prefs');
  const def = C.normalizePrefs(null);
  ok('defaults: no symbol, candles, 1D, linear, listing currency, volume on', JSON.stringify(def) === JSON.stringify({ symbol: '', type: 'candles', timeframe: '1D', scale: 'linear', eur: false, volume: true }), def);
  const good = { symbol: ' sap.de ', type: 'heikin', timeframe: '4h', scale: 'log', eur: true, volume: false };
  ok('valid values kept, symbol trimmed and upper case', JSON.stringify(C.normalizePrefs(good)) === JSON.stringify({ symbol: 'SAP.DE', type: 'heikin', timeframe: '4h', scale: 'log', eur: true, volume: false }));
  const bad = C.normalizePrefs({ symbol: 'AK-47 | Redline', type: 'pie', timeframe: '2h', scale: 'x', eur: 'yes', volume: 0, extra: 1 });
  ok('invalid values dropped to the defaults, unknown fields left out', JSON.stringify(bad) === JSON.stringify(def), bad);
  ok('a string is parsed; broken JSON gives the defaults', C.normalizePrefs(JSON.stringify(good)).symbol === 'SAP.DE' && JSON.stringify(C.normalizePrefs('{oops')) === JSON.stringify(def));
  const mem = {}; const store = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  C.savePrefs(store, good);
  ok('save → load round trip', JSON.stringify(C.loadPrefs(store)) === JSON.stringify(C.normalizePrefs(good)) && typeof mem.maermin_chart_prefs === 'string');
  ok('the key is in backups and encrypted at rest (it names a symbol)', require('../backup-engine.js').KEYS.indexOf(C.PREFS_KEY) !== -1 && require('../storage.js').isSensitive(C.PREFS_KEY));
  ok('storage that throws: defaults, no crash', JSON.stringify(C.loadPrefs({ getItem() { throw new Error('x'); } })) === JSON.stringify(def) && C.savePrefs({ setItem() { throw new Error('x'); } }, good) === false);

  console.log('\nrequests and bars:');
  ok('request URL: symbol encoded, the timeframe\'s pair, the bars marker', C.requestUrl('https://w.example.dev/', 'BRK-B', C.timeframe('5m')) === 'https://w.example.dev/?action=yf&symbol=BRK-B&interval=5m&range=1mo&bars=1');
  ok('request URL encodes symbols like ^GDAXI', C.requestUrl('https://w', '^GDAXI', C.timeframe('1D')).indexOf('symbol=%5EGDAXI') !== -1);
  const kl = C.toKLine([{ t: 100, o: 1, h: 2, l: 0.5, c: 1.5, v: null }, { t: 200, o: 1.5, h: 3, l: 1, c: 2, v: 7 }]);
  ok('bars → library data (ms timestamps; volume 0 when unknown)', JSON.stringify(kl) === JSON.stringify([{ timestamp: 100000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 0 }, { timestamp: 200000, open: 1.5, high: 3, low: 1, close: 2, volume: 7 }]), kl);
  const ch = C.rangeChange([{ c: 10 }, { c: 12 }, { c: 15 }]);
  ok('change over the shown range: last 15, +50 %', ch.last === 15 && ch.first === 10 && Math.abs(ch.pct - 0.5) < 1e-12, ch);
  ok('no bars: nulls', C.rangeChange([]).last === null && C.rangeChange([]).pct === null);
  ok('price precision: 2 from 1 up, 4 below, 6 below 0.01', C.precision(182.4) === 2 && C.precision(0.5) === 4 && C.precision(0.004) === 6);

  console.log('\nquick picks:');
  const txs = [{ category: 'stocks', symbol: 'sap.de' }, { category: 'stocks', symbol: 'AAPL' }, { category: 'crypto', symbol: 'BTC' }, { category: 'bonds', symbol: 'DE0001' }, { category: 'skins', symbol: 'AK-47 | Redline' }, { category: 'stocks', symbol: 'AAPL' }];
  const qp = C.quickPicks(txs, [{ symbol: 'msft' }, { symbol: 'AAPL' }, null]);
  ok('stocks and bonds you hold plus the watchlist, once each, sorted; no crypto or skins', qp.join() === 'AAPL,DE0001,MSFT,SAP.DE', qp);

  console.log('\nlibrary theme from the design tokens:');
  const tokens = { '--gain': '#0a0', '--loss': '#a00', '--text': '#111', '--text-dim': '#555', '--border': '#ccc', '--surface': '#fff', '--accent': '#60f' };
  const resolve = (v) => { const m = /^var\((--[a-z0-9-]+)\)$/.exec(v); return m ? tokens[m[1]] : v; };
  const alpha = (c, a) => c + '@' + a;
  const st = C.chartStyles(resolve, 'candles', alpha);
  ok('up and down candles in gain and loss', st.candle.bar.upColor === '#0a0' && st.candle.bar.downColor === '#a00' && st.candle.bar.upWickColor === '#0a0' && st.candle.bar.downBorderColor === '#a00' && st.indicator.ohlc.upColor === '#0a0' && st.indicator.ohlc.downColor === '#a00');
  ok('grid, axes and crosshair from border and text', st.grid.horizontal.color === '#ccc' && st.xAxis.tickText.color === '#555' && st.yAxis.axisLine.color === '#ccc' && st.crosshair.horizontal.line.color === '#555');
  const fam = C.chartStyles(resolve, 'candles', alpha, { family: 'Inter, sans-serif' });
  ok('the app\'s font on axes, tooltips and crosshair labels; no library title (the header names the symbol)', fam.xAxis.tickText.family === 'Inter, sans-serif' && fam.candle.tooltip.legend.family === 'Inter, sans-serif' && fam.crosshair.vertical.text.family === 'Inter, sans-serif' && fam.candle.tooltip.title.show === false && st.xAxis.tickText.family === undefined);
  ok('candle type in the styles', st.candle.type === 'candle_solid' && C.chartStyles(resolve, 'ohlc', alpha).candle.type === 'ohlc');
  const line = C.chartStyles(resolve, 'line', alpha), area = C.chartStyles(resolve, 'area', alpha);
  ok('line: area type without a fill; area: a filled area in the accent', line.candle.type === 'area' && line.candle.area.lineColor === '#60f' && line.candle.area.backgroundColor === 'transparent' && area.candle.area.backgroundColor === '#60f@0.18' && area.candle.area.lineColor === '#60f', [line.candle.area, area.candle.area]);
  ok('the last-price dot in the accent; it does not pulse with reduced motion', area.candle.area.point.color === '#60f' && area.candle.area.point.animation === true && C.chartStyles(resolve, 'area', alpha, { still: true }).candle.area.point.animation === false);
  ok('the price tooltip stays on at desktop width, follows the crosshair on phones', st.candle.tooltip.showRule === 'always' && C.chartStyles(resolve, 'candles', alpha, { narrow: true }).candle.tooltip.showRule === 'follow_cross');
  ok('no hex or rgb() colour written into charts.js', !/#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d/.test(require('fs').readFileSync(require('path').join(__dirname, '../charts.js'), 'utf8')));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
