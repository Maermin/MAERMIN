// Node harness for P5-5.5: one dated event feed for held and watched symbols
// (ex-dates, pay dates, earnings, splits, savings-plan dates, tax dates,
// central-bank decisions) and its ICS export (RFC 5545).
// Run: node test/event-feed.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond, info) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info).slice(0, 400) : '')); }
}
const EF = require('../event-feed.js');

(function main() {
  console.log('event feed:');
  const today = '2026-10-14';
  const base = {
    today,
    held: ['AAPL', 'SAP.DE'],
    watched: ['MSFT'],
    earnings: [
      { symbol: 'AAPL', earningsDate: '2026-10-29', earningsDateEnd: null, isEstimate: false, epsEstimate: 1.75, exDividendDate: '2026-11-09', dividendDate: '2026-11-13' },
      { symbol: 'MSFT', earningsDate: '2026-10-21', earningsDateEnd: '2026-10-27', isEstimate: true, epsEstimate: 3.1, exDividendDate: null, dividendDate: null },
      { symbol: 'OLD', earningsDate: '2026-09-01' }
    ],
    dividends: [
      { symbol: 'AAPL', date: '2026-11-29', amount: 2.6, currency: 'USD' },  // the estimate the confirmed 13 Nov replaces (16 days off)
      { symbol: 'SAP.DE', date: '2026-12-02', amount: 23.5, currency: 'EUR' },
      { symbol: 'SAP.DE', date: '2027-06-01', amount: 23.5, currency: 'EUR' } // beyond 120 days
    ],
    splits: [{ symbol: 'AAPL', date: '2026-11-02', num: 4, den: 1 }, { symbol: 'AAPL', date: '2020-08-31', num: 4, den: 1 }],
    plans: [
      { id: 'p1', symbol: 'VWCE.DE', amount: 200, currency: 'EUR', frequency: 'monthly', startDate: '2026-01-15', active: true },
      { id: 'p2', symbol: 'EUNL.DE', amount: 50, currency: 'EUR', frequency: 'monthly', startDate: '2026-01-01', active: false }
    ],
    vap: { year: 2026, tax: 12.4 },
    crypto: [{ symbol: 'BTC', date: '2026-12-24', quantity: 0.05 }],
    jurisdiction: 'de'
  };
  const ev = EF.build(base);
  const of = (kind, sym) => ev.filter((e) => e.kind === kind && (sym === undefined || e.symbol === sym));

  // ---- symbols ---------------------------------------------------------------------
  const ea = of('earnings', 'AAPL');
  ok('earnings for a held symbol, with the consensus EPS in the detail', ea.length === 1 && ea[0].date === '2026-10-29' && !ea[0].watched && !ea[0].estimated && /1[.,]75/.test(ea[0].detail), ea);
  const dated = EF.build(base, { date: (d) => d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4) });
  ok('dates inside the text use the date formatter', dated.some((e) => /21.10.2026 and 27.10.2026/.test(e.detail)), dated.filter((e) => e.symbol === 'MSFT').map((e) => e.detail));
  const em = of('earnings', 'MSFT');
  ok('a watched symbol: marked as watched, an unconfirmed range is an estimate', em.length === 1 && em[0].watched === true && em[0].estimated === true && em[0].date === '2026-10-21', em);
  ok('past earnings are left out', of('earnings', 'OLD').length === 0);
  ok('ex-date from the Worker row', of('exdiv', 'AAPL').length === 1 && of('exdiv', 'AAPL')[0].date === '2026-11-09');
  const pa = of('pay', 'AAPL');
  ok('a confirmed pay date replaces the schedule estimate within 30 days of it', pa.length === 1 && pa[0].date === '2026-11-13' && !pa[0].estimated, pa);
  const ps = of('pay', 'SAP.DE');
  ok('a schedule pay date stays as an estimate with its amount; beyond 120 days is left out', ps.length === 1 && ps[0].date === '2026-12-02' && ps[0].estimated && /23[.,]50/.test(ps[0].detail), ps);
  const sp = of('split', 'AAPL');
  ok('an upcoming split with its ratio; an old one is left out', sp.length === 1 && sp[0].date === '2026-11-02' && /4\s*:\s*1/.test(sp[0].title + sp[0].detail), sp);

  // ---- savings plans ---------------------------------------------------------------
  const pl = of('plan');
  ok('an active monthly plan: 15 Oct, Nov, Dec and Jan inside 120 days; a paused plan none', pl.map((e) => e.date).join() === '2026-10-15,2026-11-15,2026-12-15,2027-01-15' && pl.every((e) => e.symbol === 'VWCE.DE'), pl.map((e) => e.date + ' ' + e.symbol));

  // ---- tax dates -------------------------------------------------------------------
  const vap = ev.filter((e) => e.kind === 'tax' && /vap/.test(e.uid));
  ok('Vorabpauschale 2026 is debited on the first working day of 2027 (Sat 2 Jan -> Mon 4 Jan)', vap.length === 1 && vap[0].date === '2027-01-04' && /12[.,]40/.test(vap[0].detail), vap);
  ok('crypto lot becomes tax-free', ev.some((e) => e.kind === 'tax' && e.symbol === 'BTC' && e.date === '2026-12-24'));
  const long = EF.build(Object.assign({}, base, { today: '2026-10-14' }), { days: 400 });
  const ret = long.filter((e) => e.kind === 'tax' && /return/.test(e.uid));
  ok('DE tax return for 2026: 31 July 2027 is a Saturday -> Monday 2 Aug 2027', ret.length === 1 && ret[0].date === '2027-08-02', ret.map((e) => e.date));
  const us = EF.build({ today, jurisdiction: 'us', ira: { year: 2026, remaining: 3000 } }, { days: 200, kinds: { macro: false } });
  ok('US: IRA deadline and tax day on 15 April 2027', us.filter((e) => e.date === '2027-04-15').length === 2 && us.every((e) => e.kind === 'tax'), us.map((e) => e.uid));
  const at = EF.build({ today: '2027-05-01', jurisdiction: 'at' }, { kinds: { macro: false } });
  ok('AT: FinanzOnline return due 30 June', at.length === 1 && at[0].date === '2027-06-30', at.map((e) => e.date));

  // ---- macro -----------------------------------------------------------------------
  ok('ECB and Fed decisions in the window', ev.some((e) => e.kind === 'macro' && e.date === '2026-10-29' && /ECB/.test(e.title)) && ev.some((e) => e.kind === 'macro' && e.date === '2026-10-28' && /Fed/.test(e.title)));
  ok('the 2027 decision days are listed (ECB 4 Feb, Fed 27 Jan)', EF.MACRO.ecb.indexOf('2027-02-04') >= 0 && EF.MACRO.fomc.indexOf('2027-01-27') >= 0 && EF.MACRO.ecb.length === 16 && EF.MACRO.fomc.length === 16);
  const noMacro = EF.build(base, { kinds: { macro: false, plan: false } });
  ok('kinds switch event types off', !noMacro.some((e) => e.kind === 'macro' || e.kind === 'plan') && noMacro.some((e) => e.kind === 'earnings'));

  // ---- order, ids, privacy ---------------------------------------------------------
  ok('sorted by date', ev.every((e, i) => i === 0 || ev[i - 1].date <= e.date));
  ok('ids are unique and stable', new Set(ev.map((e) => e.uid)).size === ev.length && EF.build(base).map((e) => e.uid).join() === ev.map((e) => e.uid).join());
  const bare = EF.build(base, { amounts: false });
  ok('amounts: false leaves every amount out', !bare.some((e) => /\d[.,]\d\d/.test(e.title + ' ' + e.detail)) && bare.length === ev.length, bare.filter((e) => /\d[.,]\d\d/.test(e.detail)).map((e) => e.detail));
  ok('back: 30 keeps recent events (none older than 30 days)', EF.build(base, { back: 30 }).some((e) => e.symbol === 'OLD') === false && EF.build(Object.assign({}, base, { earnings: [{ symbol: 'AAPL', earningsDate: '2026-10-01' }] }), { back: 30 }).some((e) => e.kind === 'earnings'));

  // ---- ICS -------------------------------------------------------------------------
  const ics = EF.toICS([
    { uid: 'earnings-AAPL-2026-10-29', date: '2026-10-29', kind: 'earnings', symbol: 'AAPL', title: 'AAPL earnings, Q4; est.', detail: 'Line one\nLine two' },
    { uid: 'tax-x-2026-10-31', date: '2026-10-31', kind: 'tax', symbol: null, title: 'Steuererklärung ' + 'ä'.repeat(60), detail: '' }
  ], { now: '2026-10-14T08:30:00Z', name: 'MAERMIN' });
  const lines = ics.split('\r\n');
  ok('ICS: CRLF line ends only, calendar wrapper and version', !/[^\r]\n/.test(ics) && lines[0] === 'BEGIN:VCALENDAR' && lines.includes('VERSION:2.0') && lines.includes('END:VCALENDAR') && /^PRODID:/m.test(ics.replace(/\r/g, '')), lines.slice(0, 4));
  ok('ICS: all-day dates, DTEND the next day (across a month end)', ics.includes('DTSTART;VALUE=DATE:20261029\r\nDTEND;VALUE=DATE:20261030') && ics.includes('DTSTART;VALUE=DATE:20261031\r\nDTEND;VALUE=DATE:20261101'));
  ok('ICS: stable UID and a UTC DTSTAMP', ics.includes('UID:earnings-AAPL-2026-10-29@maermin') && ics.includes('DTSTAMP:20261014T083000Z'));
  ok('ICS: commas, semicolons and newlines are escaped', ics.includes('SUMMARY:AAPL earnings\\, Q4\\; est.') && ics.includes('DESCRIPTION:Line one\\nLine two'));
  const octets = (s) => Buffer.byteLength(s, 'utf8');
  const unfolded = ics.replace(/\r\n /g, '');
  ok('ICS: lines fold at 75 octets without splitting a character, and unfold to the original', lines.every((l) => octets(l) <= 75) && unfolded.includes('SUMMARY:Steuererklärung ' + 'ä'.repeat(60)) && !/�/.test(Buffer.from(ics, 'utf8').toString('utf8')), lines.filter((l) => octets(l) > 75));
  ok('ICS: one VEVENT per event, empty description left out', (ics.match(/BEGIN:VEVENT/g) || []).length === 2 && (ics.match(/DESCRIPTION:/g) || []).length === 1);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exit(1);
})();
