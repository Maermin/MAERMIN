// CH-2: chart-engine.js - bars from the Worker, currency, Heikin Ashi,
// resampling, compare series, the indicator library, the technical rating
// and the user's own trades / average cost on the chart. Expected values are
// worked out by hand in the comments; all data is made up.
// Run: node test/chart-engine.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info).slice(0, 500) : '')); }
}
const approx = (a, b, e) => a != null && b != null && Math.abs(a - b) < (e || 1e-9);
const approxArr = (a, b, e) => Array.isArray(a) && a.length === b.length && a.every((x, i) => (b[i] === null ? x === null : approx(x, b[i], e)));
const CE = require('../chart-engine.js');
const CA = require('../corporate-actions.js');
const L = require('../ledger.js');
const sec = (iso) => Math.floor(Date.parse(iso) / 1000);
const B = (t, o, h, l, c, v) => ({ t, o, h, l, c, v: v === undefined ? null : v });

console.log('parseBars:');
{
  const p = CE.parseBars({ currency: 'USD', exchangeTz: 'America/New_York', prices: [
    { ts: 300, date: 'x', price: 3, o: 2.5, h: 3.2, l: 2.4, v: 10 },
    { ts: 100, date: 'x', price: 1, o: null, h: null, l: null, v: null },
    { ts: 200, date: 'x', price: 2, o: 1.5, h: 2.5, l: 1.4, v: 5 },
    { ts: 200, date: 'x', price: 2.1, o: 1.6, h: 2.6, l: 1.5, v: 6 },
    { ts: 400, date: 'x', price: null, o: 1, h: 1, l: 1, v: 1 },
    { ts: 500, date: 'x', price: 2, o: 1, h: null, l: 0.5, v: 0 },
  ] });
  ok('sorted by time, duplicate time keeps the last, no close dropped', JSON.stringify(p.bars.map((b) => b.t)) === '[100,200,300,500]', p.bars);
  ok('duplicate: the later entry wins', p.bars[1].c === 2.1 && p.bars[1].v === 6);
  ok('missing open / high / low fall back to the close, volume stays null', JSON.stringify(p.bars[0]) === JSON.stringify(B(100, 1, 1, 1, 1, null)), p.bars[0]);
  ok('a missing high is the higher of open and close; volume 0 kept', p.bars[3].h === 2 && p.bars[3].l === 0.5 && p.bars[3].v === 0, p.bars[3]);
  ok('ohlc true when the Worker sends candles; currency and time zone kept', p.ohlc === true && p.currency === 'USD' && p.exchangeTz === 'America/New_York');
  const old = CE.parseBars({ currency: 'EUR', prices: [{ ts: 1, date: 'x', price: 5 }, { ts: 2, date: 'x', price: 6 }] });
  ok('closes only (older Worker): o = h = l = c, ohlc false', old.ohlc === false && old.bars.every((b) => b.o === b.c && b.h === b.c && b.l === b.c), old);
  const noTs = CE.parseBars({ prices: [{ date: '2026-03-02', price: 5 }] });
  ok('an entry with a date but no ts gets midnight UTC of that date', noTs.bars.length === 1 && noTs.bars[0].t === sec('2026-03-02T00:00:00Z'), noTs.bars);
  ok('nonsense input: no bars', CE.parseBars(null).bars.length === 0 && CE.parseBars({ prices: 'x' }).bars.length === 0);
}

console.log('\ntoEUR:');
{
  const t1 = sec('2026-03-02T15:00:00Z'), t2 = sec('2026-03-03T15:00:00Z');
  const rate = { '2026-03-02': 0.9, '2026-03-03': 0.8 };
  const calls = [];
  const conv = (amount, cur, iso) => { calls.push([cur, iso]); return { value: amount * rate[iso] }; };
  const out = CE.toEUR([B(t1, 10, 12, 9, 11, 100), B(t2, 20, 22, 19, 21, 50)], 'USD', conv);
  ok('each bar at the rate of its own day', approxArr([out[0].o, out[0].h, out[0].l, out[0].c], [9, 10.8, 8.1, 9.9]) && approxArr([out[1].c], [16.8]), out);
  ok('volume unchanged, the input not modified', out[0].v === 100 && calls.every((c) => c[0] === 'USD') && calls.length === 2);
  const plain = CE.toEUR([B(t1, 10, 10, 10, 10)], 'USD', () => 0.5);
  ok('a converter that returns a plain number works too', plain[0].c === 5);
  const eur = [B(t1, 1, 2, 0.5, 1.5)];
  const same = CE.toEUR(eur, 'EUR', () => { throw new Error('not called'); });
  ok('EUR bars: a copy, no conversion', JSON.stringify(same) === JSON.stringify(eur) && same !== eur);
}

console.log('\nheikinAshi:');
{
  // HA1: c = (10+12+9+11)/4 = 10.5, o = (10+11)/2 = 10.5, h = 12, l = 9
  // HA2: c = (11+13+10+12)/4 = 11.5, o = (10.5+10.5)/2 = 10.5, h = 13, l = 10
  const ha = CE.heikinAshi([B(1, 10, 12, 9, 11, 5), B(2, 11, 13, 10, 12, 6)]);
  ok('first candle', JSON.stringify(ha[0]) === JSON.stringify(B(1, 10.5, 12, 9, 10.5, 5)), ha[0]);
  ok('second candle opens at the middle of the first', JSON.stringify(ha[1]) === JSON.stringify(B(2, 10.5, 13, 10, 11.5, 6)), ha[1]);
}

console.log('\nresample:');
{
  const H = (d, hh) => sec(d + 'T' + String(hh).padStart(2, '0') + ':00:00Z');
  const day1 = [9, 10, 12, 13, 14, 15, 16].map((h, i) => B(H('2026-03-02', h), 10 + i, 20 + i, 1 + i, 11 + i, 100));
  const day2 = [9, 10].map((h, i) => B(H('2026-03-03', h), 50 + i, 60 + i, 40 + i, 55 + i, null));
  const r = CE.resample(day1.concat(day2), 4, { tz: 'UTC', intervalSec: 3600 });
  ok('1h → 4h: groups 09-12 (11:00 missing), 13-16, next day 09-10', r.length === 3 && r[0].t === H('2026-03-02', 9) && r[1].t === H('2026-03-02', 13) && r[2].t === H('2026-03-03', 9), r.map((b) => b.t));
  ok('a group: first open, highest high, lowest low, last close, summed volume', JSON.stringify([r[0].o, r[0].h, r[0].l, r[0].c, r[0].v]) === JSON.stringify([10, 22, 1, 13, 300]), r[0]);
  ok('a gap inside a group is not "partial"; the last, unfinished group is', r[0].partial === false && r[1].partial === false && r[2].partial === true, r.map((b) => b.partial));
  ok('volume of a group with no volume is null', r[2].v === null);
  // 18:30 and 20:30 New York time on 2 March are two different UTC days
  const ny = [B(sec('2026-03-02T23:30:00Z'), 1, 2, 0.5, 1.5, 1), B(sec('2026-03-03T01:30:00Z'), 1.5, 3, 1, 2, 1)];
  ok('groups follow the exchange day, not the UTC day', CE.resample(ny, 4, { tz: 'America/New_York', intervalSec: 3600 }).length === 1 && CE.resample(ny, 4, { tz: 'UTC', intervalSec: 3600 }).length === 2);
  ok('the interval is inferred when not given', CE.resample(day1, 4, { tz: 'UTC' }).length === 2);
  ok('factor 1 or less: a copy of the bars', CE.resample(day1, 1, { tz: 'UTC' }).length === day1.length);
}

console.log('\npercentSeries:');
{
  const ps = CE.percentSeries([B(1, 0, 0, 0, 10), B(2, 0, 0, 0, 20), B(3, 0, 0, 0, 15)], 2);
  ok('percent change from the first bar on or after the start', JSON.stringify(ps) === JSON.stringify([{ t: 2, p: 0 }, { t: 3, p: -0.25 }]), ps);
  ok('no bar after the start: empty', CE.percentSeries([B(1, 0, 0, 0, 10)], 5).length === 0);
}

console.log('\nindicators:');
{
  // RSI (Wilder), n = 2 on 1,2,3,2,3: changes +1 +1 -1 +1
  // i=2: avg gain (1+1)/2 = 1, avg loss 0 → 100
  // i=3: gain (1·1 + 0)/2 = 0.5, loss (0·1 + 1)/2 = 0.5 → 50
  // i=4: gain (0.5 + 1)/2 = 0.75, loss 0.25 → RS 3 → 75
  ok('RSI 2: 100, 50, 75', approxArr(CE.rsi([1, 2, 3, 2, 3], 2), [null, null, 100, 50, 75]), CE.rsi([1, 2, 3, 2, 3], 2));
  ok('RSI skips a missing close', approxArr(CE.rsi([1, 2, null, 3, 2, 3], 2), [null, null, null, 100, 50, 75]));
  ok('RSI of a flat series is 50', CE.rsi([5, 5, 5, 5], 2)[3] === 50);
  ok('RSI default period 14: first value at the 15th close', CE.rsi(Array.from({ length: 20 }, (_, i) => i), undefined)[13] === null && CE.rsi(Array.from({ length: 20 }, (_, i) => i))[14] === 100);

  // Stochastic k = 3, %K smoothing 1, %D 2. Bars (h, l, c): (5,1,3) (6,2,5) (7,3,4) (8,4,8)
  // i=2: (4 - 1) / (7 - 1) = 50; i=3: (8 - 2) / (8 - 2) = 100; %D(3) = (50 + 100) / 2 = 75
  const sb = [B(1, 0, 5, 1, 3), B(2, 0, 6, 2, 5), B(3, 0, 7, 3, 4), B(4, 0, 8, 4, 8)];
  const st = CE.stochastic(sb, 3, 1, 2);
  ok('Stochastic (3, 1, 2): %K 50, 100; %D 75', approxArr(st.k, [null, null, 50, 100]) && approxArr(st.d, [null, null, null, 75]), st);
  ok('Stochastic with no range is 50', CE.stochastic([B(1, 0, 5, 5, 5), B(2, 0, 5, 5, 5)], 2, 1, 1).k[1] === 50);

  // ATR n = 2. Bars (h, l, c): (10,8,9) (11,9,10) (12,9,11) (10,7,8)
  // TR: 2, max(2, |11-9|, |9-9|) = 2, max(3, 2, 1) = 3, max(3, |10-11|, |7-11|) = 4
  // ATR: (2+2)/2 = 2, (2·1+3)/2 = 2.5, (2.5+4)/2 = 3.25
  const ab = [B(1, 0, 10, 8, 9), B(2, 0, 11, 9, 10), B(3, 0, 12, 9, 11), B(4, 0, 10, 7, 8)];
  ok('ATR (Wilder) 2: 2, 2.5, 3.25', approxArr(CE.atr(ab, 2), [null, 2, 2.5, 3.25]), CE.atr(ab, 2));

  // VWAP, intraday, reset each exchange day. Typical price (h+l+c)/3.
  // Day 1: 10·100 = 1000, 12·300 = 3600 → 4600 / 400 = 11.5; day 2 starts again: 20
  const vb = [B(sec('2026-03-02T15:00:00Z'), 0, 11, 9, 10, 100), B(sec('2026-03-02T15:05:00Z'), 0, 13, 11, 12, 300), B(sec('2026-03-03T15:00:00Z'), 0, 21, 19, 20, 50)];
  ok('VWAP: 10, 11.5, then reset to 20 the next day', approxArr(CE.vwap(vb, { tz: 'UTC' }), [10, 11.5, 20]), CE.vwap(vb, { tz: 'UTC' }));
  ok('VWAP is empty for daily bars', CE.vwap([B(sec('2026-03-02T15:00:00Z'), 0, 11, 9, 10, 100), B(sec('2026-03-03T15:00:00Z'), 0, 11, 9, 10, 100)], { tz: 'UTC' }).every((x) => x === null));
  ok('VWAP without volume so far is null', CE.vwap([B(sec('2026-03-02T15:00:00Z'), 0, 11, 9, 10, 0), B(sec('2026-03-02T15:05:00Z'), 0, 11, 9, 10, null)], { tz: 'UTC' }).every((x) => x === null));

  // OBV: closes 10, 11, 11, 9 with volumes 100, 200, 300, 400 → 0, +200, +0, -400
  ok('OBV: 0, 200, 200, -200', JSON.stringify(CE.obv([B(1, 0, 0, 0, 10, 100), B(2, 0, 0, 0, 11, 200), B(3, 0, 0, 0, 11, 300), B(4, 0, 0, 0, 9, 400)])) === '[0,200,200,-200]');

  // Donchian 2: highs 5, 6, 4; lows 1, 2, 3
  const dc = CE.donchian([B(1, 0, 5, 1, 0), B(2, 0, 6, 2, 0), B(3, 0, 4, 3, 0)], 2);
  ok('Donchian 2: upper 6, 6; lower 1, 2; middle 3.5, 4', approxArr(dc.upper, [null, 6, 6]) && approxArr(dc.lower, [null, 1, 2]) && approxArr(dc.mid, [null, 3.5, 4]), dc);

  // Ichimoku (2, 3, 4, shift 2) on bars h = i+2, l = i, c = i+1 (i = 0..5)
  // conversion(2) = ((i+2) + (i-1)) / 2 = i + 0.5 from i=1; base(3) = ((i+2) + (i-2)) / 2 = i from i=2
  // span A raw = i + 0.25 from i=2; span B raw (4) = ((i+2) + (i-3)) / 2 = i - 0.5 from i=3
  const ib = Array.from({ length: 6 }, (_, i) => B(i, 0, i + 2, i, i + 1));
  const ic = CE.ichimoku(ib, 2, 3, 4, 2);
  ok('Ichimoku conversion and base lines', approxArr(ic.tenkan, [null, 1.5, 2.5, 3.5, 4.5, 5.5]) && approxArr(ic.kijun, [null, null, 2, 3, 4, 5]), ic);
  ok('Ichimoku spans drawn 2 bars ahead', approxArr(ic.spanA, [null, null, null, null, 2.25, 3.25]) && approxArr(ic.spanB, [null, null, null, null, null, 2.5]), ic);
  ok('Ichimoku cloud beyond the last bar', approxArr(ic.ahead.spanA, [4.25, 5.25]) && approxArr(ic.ahead.spanB, [3.5, 4.5]), ic.ahead);
  ok('Ichimoku lagging line: the close 2 bars later', approxArr(ic.chikou, [3, 4, 5, 6, null, null]), ic.chikou);
}

console.log('\ntechnical rating:');
{
  ok('labels at the boundaries', ['strongSell', 'sell', 'sell', 'neutral', 'neutral', 'buy', 'buy', 'strongBuy'].join() ===
    [-0.6, -0.59, -0.2, -0.19, 0.19, 0.2, 0.59, 0.6].map(CE.ratingLabel).join(), [-0.6, -0.59, -0.2, -0.19, 0.19, 0.2, 0.59, 0.6].map(CE.ratingLabel));
  const line = (n, f) => Array.from({ length: n }, (_, i) => { const c = f(i); return B(i, c - 0.5, c + 1, c - 1, c); });
  // Steady rise: all 7 trend votes +1. Momentum: RSI 100 but not falling or
  // rising → 0; Stochastic ≈ 93 with %K = %D → 0; MACD = signal → 0; close
  // above the Donchian middle → +1. Score (1 + 1/4) / 2 = 0.625.
  const up = CE.rate(line(300, (i) => 100 + i));
  ok('steady rise: strong buy, 0.625', up && up.label === 'strongBuy' && approx(up.score, 0.625), up);
  ok('votes: 7 trend and 4 momentum, each named by a key', up && up.votes.filter((v) => v.group === 'trend').length === 7 && up.votes.filter((v) => v.group === 'momentum').length === 4 && up.votes.every((v) => v.name && [-1, 0, 1].indexOf(v.vote) !== -1), up && up.votes);
  const down = CE.rate(line(300, (i) => 400 - i));
  ok('steady fall: strong sell, -0.625', down && down.label === 'strongSell' && approx(down.score, -0.625), down);
  const flat = CE.rate(line(300, () => 100));
  ok('flat: neutral, 0', flat && flat.label === 'neutral' && flat.score === 0, flat);
  const short = CE.rate(line(30, (i) => 100 + i));
  ok('30 bars: votes without enough history are left out', short && !short.votes.some((v) => v.name === 'sma50' || v.name === 'sma200') && short.votes.some((v) => v.name === 'sma20'), short && short.votes.map((v) => v.name));
  ok('10 bars: no trend vote possible → null', CE.rate(line(10, (i) => 100 + i)) === null);
}

console.log('\nyour trades on the chart:');
{
  const T = (o) => Object.assign({ category: 'stocks', currency: 'EUR', portfolioId: 'default' }, o);
  const noCA = { corporateActions: null };
  const txs = [
    T({ id: 'a', type: 'buy', symbol: 'abc', quantity: 10, price: 100, date: '2024-01-10' }),
    T({ id: 'b', type: 'sell', symbol: 'ABC', quantity: 4, price: 120, date: '2024-03-01' }),
    T({ id: 'c', type: 'sell', symbol: 'ABC', quantity: 6, price: 110, date: '2024-05-01' }),
    T({ id: 'd', type: 'buy', symbol: 'ABC', quantity: 5, price: 90, date: '2024-07-01' }),
    T({ id: 'e', type: 'dividend', symbol: 'ABC', quantity: 5, price: 1.2, date: '2024-08-01' }),
    T({ id: 'x', type: 'buy', symbol: 'XYZ', quantity: 1, price: 1, date: '2024-02-01' }),
  ];
  const eurConv = (a) => a;
  const m = CE.tradeMarks(txs, 'ABC', Object.assign({ chartCurrency: 'EUR', convert: eurConv }, noCA));
  ok('buy → partial sell → full sell → rebuy → dividend, other symbols left out', m.map((x) => x.kind).join() === 'buy,sell,sell,buy,dividend', m);
  ok('a mark: time, date, quantity, price, price in EUR', JSON.stringify(m[0]) === JSON.stringify({ t: sec('2024-01-10T00:00:00Z'), date: '2024-01-10', kind: 'buy', qty: 10, price: 100, priceEUR: 100, splitAdjusted: false }), m[0]);
  ok('dividend mark: per share and in total, in EUR', m[4].price === 1.2 && approx(m[4].amountEUR, 6), m[4]);

  const steps = CE.avgCostLine(txs, 'ABC', noCA);
  ok('average cost steps: 100 (10), 100 (6), none (0), 90 (5)', JSON.stringify(steps.map((s) => [s.date, s.qty, s.avgEUR])) ===
    JSON.stringify([['2024-01-10', 10, 100], ['2024-03-01', 6, 100], ['2024-05-01', 0, null], ['2024-07-01', 5, 90]]), steps);
  const led = L.build(txs.filter((t) => t.symbol.toUpperCase() === 'ABC' && t.type !== 'dividend'), { applyCorporateActions: false }).list[0];
  ok('the last step is the ledger\'s own open cost / open quantity', approx(steps[3].avgEUR, led.openCostEUR / led.openQty) && steps[3].qty === led.openQty);
  const fee = CE.avgCostLine([T({ type: 'buy', symbol: 'ABC', quantity: 10, price: 100, fees: 10, date: '2024-01-10' })], 'ABC', noCA);
  ok('buy fees count as cost, as everywhere in the app (101)', approx(fee[0].avgEUR, 101), fee);

  // USD listing, bought in USD at 50 with 0.9 EUR per USD → 45 EUR
  const usd = [T({ type: 'buy', symbol: 'US1', quantity: 2, price: 50, currency: 'USD', date: '2024-01-10' })];
  const rate = { '2024-01-10': 0.9, '2024-02-01': 0.8 };
  const conv = (a, cur, iso) => (cur === 'EUR' ? a : a * rate[iso]);
  const um = CE.tradeMarks(usd, 'US1', Object.assign({ chartCurrency: 'USD', convert: conv }, noCA));
  ok('USD trade on a USD chart: price 50, 45 in EUR', um[0].price === 50 && approx(um[0].priceEUR, 45), um[0]);
  const xetra = [T({ type: 'buy', symbol: 'US1', quantity: 2, price: 45, currency: 'EUR', date: '2024-01-10' })];
  ok('EUR trade on a USD chart: placed at 45 / 0.9 = 50', approx(CE.tradeMarks(xetra, 'US1', Object.assign({ chartCurrency: 'USD', convert: conv }, noCA))[0].price, 50));
  const ust = CE.avgCostLine(usd, 'US1', Object.assign({ exchangeRate: 0.9 }, noCA));
  ok('average cost in EUR from the ledger: 45', approx(ust[0].avgEUR, 45), ust);
  const bars = [B(sec('2024-01-09T15:00:00Z'), 0, 0, 0, 50), B(sec('2024-01-10T15:00:00Z'), 0, 0, 0, 50), B(sec('2024-02-01T15:00:00Z'), 0, 0, 0, 50)];
  const ser = CE.avgCostSeries(ust, bars, 'USD', conv);
  ok('per bar in USD: none before the buy, 50, then 56.25 when the euro is stronger (EUR break-even)', approxArr(ser, [null, 50, 56.25]), ser);
  ok('per bar in EUR: flat 45', approxArr(CE.avgCostSeries(ust, bars, 'EUR', conv), [null, 45, 45]));

  // Splits: 4-for-1 on 2024-06-01. Buy 10 at 100 before it → 40 at 25.
  const sp = [T({ type: 'buy', symbol: 'SPL', quantity: 10, price: 100, date: '2024-01-10' }), T({ type: 'buy', symbol: 'SPL', quantity: 4, price: 30, date: '2024-07-01' })];
  const rec = { actions: [{ symbol: 'SPL', category: 'stocks', date: '2024-06-01', num: 4, den: 1 }] };
  const none = { events: [] };
  const chartSplit = [{ date: '2024-06-01', numerator: 4, denominator: 1 }];
  const viaRec = CE.tradeMarks(sp, 'SPL', { chartCurrency: 'EUR', convert: eurConv, corporateActions: CA, caState: rec, caEvents: none });
  ok('recorded split: the earlier buy shows as 40 at 25, split-adjusted', viaRec[0].qty === 40 && approx(viaRec[0].price, 25) && viaRec[0].splitAdjusted === true && viaRec[1].qty === 4 && viaRec[1].splitAdjusted === false, viaRec);
  const viaChart = CE.tradeMarks(sp, 'SPL', { chartCurrency: 'EUR', convert: eurConv, corporateActions: CA, caState: { actions: [] }, caEvents: none, chartSplits: chartSplit });
  ok('split known only from the price data: same 40 at 25 (display only)', viaChart[0].qty === 40 && approx(viaChart[0].price, 25) && viaChart[0].splitAdjusted === true && sp[0].quantity === 10, viaChart);
  const both = CE.tradeMarks(sp, 'SPL', { chartCurrency: 'EUR', convert: eurConv, corporateActions: CA, caState: { actions: [{ symbol: 'SPL', category: 'stocks', date: '2024-06-03', num: 4, den: 1 }] }, caEvents: none, chartSplits: chartSplit });
  ok('recorded (2 days off) and in the price data: applied once', both[0].qty === 40, both);
  const avgSplit = CE.avgCostLine(sp, 'SPL', { corporateActions: CA, caState: { actions: [] }, caEvents: none, chartSplits: chartSplit });
  ok('average cost after an unrecorded split: 25, then (1000 + 120) / 44', approx(avgSplit[0].avgEUR, 25) && avgSplit[0].qty === 40 && approx(avgSplit[1].avgEUR, 1120 / 44), avgSplit);
  ok('no trades: no marks and no line', CE.tradeMarks([], 'ABC', noCA).length === 0 && CE.avgCostLine(null, 'ABC', noCA).length === 0);
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
