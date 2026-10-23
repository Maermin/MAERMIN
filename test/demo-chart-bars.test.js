// CH-3a: in demo mode the Charts view gets made-up candles for the demo
// holdings from demo-fixtures.js - only for requests marked `bars=1`, so the
// other demo views keep their answers. Daily bars end on the demo's own close
// of today; intraday bars end on it too; weekly / monthly bars group the days.
// Run: node test/demo-chart-bars.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info).slice(0, 400) : '')); }
}
const DFX = require('../demo-fixtures.js');
const DEMO = require('../demo-data.js');
const CE = require('../chart-engine.js');
const today = '2026-10-23';
const url = (q) => DFX.BASE + '/?' + q;
const last = DEMO.closeHistory(today).series['stocks|SAP.DE'];
const lastClose = last.p[last.p.length - 1];

console.log('demo candles (bars=1):');
const d = DFX.respond(url('action=yf&symbol=SAP.DE&interval=1d&range=10y&bars=1'), today);
const p = CE.parseBars(d.body);
ok('a demo stock: 200, sample, candles, its own currency', d.status === 200 && d.body.sample === true && p.ohlc === true && p.currency === 'EUR', [d.status, d.body.currency]);
ok('daily bars over 10 years, weekdays only', p.bars.length > 2400 && p.bars.every((b) => { const w = new Date(b.t * 1000).getUTCDay(); return w !== 0 && w !== 6; }), p.bars.length);
ok('the last daily close is the demo\'s close of today', Math.abs(p.bars[p.bars.length - 1].c - lastClose) < 1e-9, [p.bars[p.bars.length - 1].c, lastClose]);
ok('every bar is a valid candle (low ≤ open, close ≤ high), volume > 0', p.bars.every((b) => b.l <= Math.min(b.o, b.c) && b.h >= Math.max(b.o, b.c) && b.l > 0 && b.v > 0));
const again = DFX.respond(url('action=yf&symbol=SAP.DE&interval=1d&range=10y&bars=1'), today);
ok('deterministic', JSON.stringify(again.body) === JSON.stringify(d.body));

const m5 = CE.parseBars(DFX.respond(url('action=yf&symbol=AAPL&interval=5m&range=1mo&bars=1'), today).body);
const aapl = DEMO.closeHistory(today).series['stocks|AAPL'];
ok('5-minute bars in USD, several per day, ending on today\'s close', m5.currency === 'USD' && m5.bars.length > 1000 && Math.abs(m5.bars[m5.bars.length - 1].c - aapl.p[aapl.p.length - 1]) < 1e-9, m5.bars.length);
ok('intraday times are 5 minutes apart within a day', m5.bars.slice(1, 20).every((b, i) => b.t - m5.bars[i].t === 300));
ok('an exchange time zone for intraday labels', m5.exchangeTz === 'America/New_York');
const h1 = CE.parseBars(DFX.respond(url('action=yf&symbol=SAP.DE&interval=60m&range=2y&bars=1'), today).body);
ok('1h over 2 years (for 4h) is there', h1.bars.length > 3000, h1.bars.length);

const wk = CE.parseBars(DFX.respond(url('action=yf&symbol=SAP.DE&interval=1wk&range=max&bars=1'), today).body);
const mo = CE.parseBars(DFX.respond(url('action=yf&symbol=SAP.DE&interval=1mo&range=max&bars=1'), today).body);
ok('weekly and monthly bars group the days', wk.bars.length > 500 && wk.bars.length < 530 && mo.bars.length >= 120 && mo.bars.length <= 122, [wk.bars.length, mo.bars.length]);
ok('the last weekly close is today\'s close', Math.abs(wk.bars[wk.bars.length - 1].c - lastClose) < 1e-9);

console.log('\nother requests are unchanged:');
ok('without bars=1 a demo holding is still a local 404', DFX.respond(url('action=yf&symbol=SAP.DE&interval=1d&range=1y'), today).status === 404);
ok('monthly history for the dividend backtest unchanged (no candles)', DFX.respond(url('action=yf&symbol=KO&interval=1mo&range=10y'), today).body.prices[0].o === undefined);
ok('a symbol outside the demo: 404 even with bars=1', DFX.respond(url('action=yf&symbol=ZZZZ&interval=1d&range=1y&bars=1'), today).status === 404);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
