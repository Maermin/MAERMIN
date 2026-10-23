// CH-3b: chart-indicators.js - the indicator list of the Charts view (every
// value from chart-engine.js, so the chart, Research and the rating agree),
// parameter checks, the limits (each once, at most three oscillator panes),
// and compare mode (alignment by date or time, common start, rebasing).
// Run: node test/chart-indicators.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info).slice(0, 400) : '')); }
}
const CI = require('../chart-indicators.js');
const CE = require('../chart-engine.js');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 260 made-up daily bars
let seed = 7, p = 100;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const bars = Array.from({ length: 260 }, (_, i) => {
  const o = p, c = o * (1 + (rnd() - 0.48) * 0.03), h = Math.max(o, c) * (1 + rnd() * 0.01), l = Math.min(o, c) * (1 - rnd() * 0.01);
  p = c;
  return { t: 1700000000 + i * 86400, o, h, l, c, v: Math.round(1000 + rnd() * 9000) };
});
const kl = bars.map((b) => ({ timestamp: b.t * 1000, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }));
const closes = bars.map((b) => b.c);
const col = (rows, key) => rows.map((r) => (r && r[key] != null ? r[key] : null));

console.log('the list:');
const ids = CI.CATALOGUE.map((d) => d.id);
ok('twelve indicators', ids.join() === 'sma,ema,bb,vwap,ichimoku,donchian,rsi,macd,stoch,atr,obv,vol', ids);
ok('overlays on the price pane, the rest in their own pane', CI.CATALOGUE.filter((d) => d.kind === 'overlay').map((d) => d.id).join() === 'sma,ema,bb,vwap,ichimoku,donchian');
ok('library names are our own (MRM_…), never a built-in', CI.CATALOGUE.every((d) => CI.libName(d.id) === 'MRM_' + d.id.toUpperCase()));
ok('fromKLine turns library data back into engine bars', same(CI.fromKLine(kl.slice(0, 2)), bars.slice(0, 2)));

console.log('\nvalues equal chart-engine.js:');
const sma = CI.calc('sma', bars, [20, 50, 0]);
ok('SMA 20 / 50 (third line off)', sma.length === 260 && same(col(sma, 'l1'), CE.sma(closes, 20)) && same(col(sma, 'l2'), CE.sma(closes, 50)) && col(sma, 'l3').every((x) => x === null));
ok('EMA', same(col(CI.calc('ema', bars, [12, 0, 0]), 'l1'), CE.ema(closes, 12)));
const bb = CE.bollinger(closes, 20, 2), bbc = CI.calc('bb', bars, [20, 2]);
ok('Bollinger', same(col(bbc, 'mid'), bb.mid) && same(col(bbc, 'upper'), bb.upper) && same(col(bbc, 'lower'), bb.lower));
const ich = CE.ichimoku(bars, 9, 26, 52, 26), ichc = CI.calc('ichimoku', bars, [9, 26, 52]);
ok('Ichimoku (five lines, spans shifted 26)', ['tenkan', 'kijun', 'spanA', 'spanB', 'chikou'].every((k) => same(col(ichc, k), ich[k])));
const dc = CE.donchian(bars, 20), dcc = CI.calc('donchian', bars, [20]);
ok('Donchian', same(col(dcc, 'upper'), dc.upper) && same(col(dcc, 'mid'), dc.mid) && same(col(dcc, 'lower'), dc.lower));
const rs = CI.calc('rsi', bars, [14]);
ok('RSI with its 30 / 70 lines', same(col(rs, 'rsi'), CE.rsi(closes, 14)) && rs.every((r) => r.lo === 30 && r.hi === 70));
const md = CE.macd(closes, 12, 26, 9), mdc = CI.calc('macd', bars, [12, 26, 9]);
ok('MACD line, signal, histogram', same(col(mdc, 'macd'), md.macd) && same(col(mdc, 'signal'), md.signal) && same(col(mdc, 'hist'), md.hist));
const st = CE.stochastic(bars, 14, 3, 3), stc = CI.calc('stoch', bars, [14, 3, 3]);
ok('Stochastic %K / %D with 20 / 80', same(col(stc, 'k'), st.k) && same(col(stc, 'd'), st.d) && stc[0].lo === 20 && stc[0].hi === 80);
ok('ATR', same(col(CI.calc('atr', bars, [14]), 'atr'), CE.atr(bars, 14)));
ok('OBV', same(col(CI.calc('obv', bars, []), 'obv'), CE.obv(bars)));
const vol = CI.calc('vol', bars, []);
ok('volume with up / down per bar', vol[5].volume === bars[5].v && vol[5].up === (bars[5].c >= bars[5].o));
const intra = Array.from({ length: 30 }, (_, i) => ({ t: 1700000000 + i * 300, o: 10, h: 11 + i % 3, l: 9, c: 10 + i % 2, v: 100 + i }));
ok('VWAP equals the engine on intraday bars', same(col(CI.calc('vwap', intra, [], { tz: 'UTC' }), 'vwap'), CE.vwap(intra, { tz: 'UTC' })));
ok('the library calc wrapper takes library data and params', same(CI.libCalc('rsi')(kl, { calcParams: [14] }), rs));

console.log('\nfigures and labels:');
ok('SMA draws only the lines that are on', CI.figures('sma', [20, 0, 200]).map((f) => f.key).join() === 'l1,l3');
ok('MACD histogram is a bar, the rest lines', same(CI.figures('macd', [12, 26, 9]).map((f) => f.key + ':' + f.type), ['macd:line', 'signal:line', 'hist:bar']));
ok('level lines are marked as such', CI.figures('rsi', [14]).filter((f) => f.tone === 'level').map((f) => f.key).join() === 'lo,hi');
ok('volume bars take gain / loss', CI.figures('vol', []).length === 1 && CI.figures('vol', [])[0].tone === 'updown');
ok('labels', CI.label('sma', [20, 0, 200]) === 'SMA 20 · 200' && CI.label('rsi', [14]) === 'RSI 14' && CI.label('macd', [12, 26, 9]) === 'MACD 12, 26, 9' && CI.label('obv', []) === 'OBV' && CI.label('bb', [20, 2]) === 'BB 20, 2');
ok('RSI and Stochastic panes are fixed to 0 … 100', CI.def('rsi').range.join() === '0,100' && CI.def('stoch').range.join() === '0,100' && !CI.def('atr').range);

console.log('\nparameters and limits:');
ok('defaults', same(CI.normalizeParams('sma', null), [20, 50, 200]) && same(CI.normalizeParams('ema', undefined), [20, 50, 0]) && same(CI.normalizeParams('macd'), [12, 26, 9]));
ok('periods are whole numbers in range', same(CI.normalizeParams('rsi', [1]), [2]) && same(CI.normalizeParams('rsi', [999]), [400]) && same(CI.normalizeParams('rsi', [14.6]), [15]) && same(CI.normalizeParams('rsi', ['x']), [14]));
ok('Bollinger width keeps one decimal', same(CI.normalizeParams('bb', [20, 2.25]), [20, 2.3]) && same(CI.normalizeParams('bb', [20, 99]), [20, 5]));
ok('an SMA / EMA line can be off (0); all off gives the defaults', same(CI.normalizeParams('sma', [0, 50, 0]), [0, 50, 0]) && same(CI.normalizeParams('sma', [0, 0, 0]), [20, 50, 200]));
const list = CI.normalizeList([{ id: 'rsi' }, { id: 'rsi', params: [7] }, { id: 'nope' }, { id: 'sma', params: [10, 0, 0] }, { id: 'macd' }, { id: 'stoch' }, { id: 'atr' }, { id: 'vol' }, null, 'x']);
ok('each once, unknown dropped, at most three oscillator panes (volume extra)', list.map((x) => x.id).join() === 'rsi,sma,macd,stoch,vol' && same(list[1].params, [10, 0, 0]) && same(list[0].params, [14]), list);
ok('a string is parsed; junk gives an empty list', CI.normalizeList(JSON.stringify([{ id: 'obv' }])).length === 1 && CI.normalizeList('{oops').length === 0 && CI.normalizeList(42).length === 0);
ok('canAdd: room for a fourth oscillator? no; overlays always', !CI.canAdd([{ id: 'rsi' }, { id: 'macd' }, { id: 'atr' }], 'obv') && CI.canAdd([{ id: 'rsi' }, { id: 'macd' }, { id: 'atr' }], 'ema') && !CI.canAdd([{ id: 'ema' }], 'ema'));
ok('VWAP only on intraday timeframes', CI.available('vwap', { intraday: true }) && !CI.available('vwap', { intraday: false }) && CI.available('rsi', { intraday: false }));

console.log('\ncompare:');
// daily: the main symbol trades at 14:30 UTC, the other at 08:00 UTC; the other misses one day
const day = (d, hh) => Math.floor(Date.parse('2026-03-0' + d + 'T' + hh + 'Z') / 1000);
const main = [2, 3, 4, 5, 6].map((d, i) => ({ t: day(d, '14:30:00'), c: 100 + i * 10 }));
const other = [[3, 50], [5, 55], [6, 60]].map(([d, c]) => ({ t: day(d, '08:00:00'), c }));
const al = CI.alignCompare(main, other, false);
ok('daily bars match by date, a missing day carries the last close, none before the first', same(al, [null, 50, 50, 55, 60]), al);
const intraMain = [0, 300, 600].map((s) => ({ t: 1700000000 + s, c: 1 }));
ok('intraday bars match by time', same(CI.alignCompare(intraMain, [{ t: 1700000300, c: 7 }, { t: 1700000600, c: 8 }], true), [null, 7, 8]));
ok('the common start is the first bar where every series has a value', CI.commonStart(main, [al]) === 1 && CI.commonStart(main, [al, [null, null, 1, 1, 1]]) === 2 && CI.commonStart(main, [[null, null, null, null, null]]) === -1);
const lines = CI.compareLines(main, [al], 1);
ok('rebased on the main symbol at the base bar: 110 · (other / 50)', same(lines.values[0], [null, 110, 110, 121, 132]), lines.values);
ok('the % change of each compared symbol from the base to the last bar', Math.abs(lines.pct[0] - 0.2) < 1e-12, lines.pct);
ok('the main symbol at the base, for the line it shares', lines.base === 110);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
