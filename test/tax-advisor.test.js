// Node harness for the Tax Advisor (WI-3). Pure, no browser.
// Run: node test/tax-advisor.test.js
'use strict';

let passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name); }
}

const A = require('../tax-advisor.js');

(function run() {
  console.log('tax-advisor:');

  // ---- cryptoFreeDate / boundary 364/365/366 ----
  ok('cryptoFreeDate is acquired + 365', A.cryptoFreeDate('2025-01-01') === '2026-01-01');
  // a lot acquired 2025-06-26, today 2026-06-25 -> 364 days held, 1 day left
  const today = '2026-06-25';
  function lot(date, qty, cost, cur) { return { symbol: 'BTC', acquiredDate: date, quantity: qty, costBasisEUR: cost, currentValueEUR: cur }; }
  let r = A.analyze({ today, cryptoLots: [lot('2025-06-26', 1, 1000, 1500)] });
  let cd = r.findings.filter(f => f.kind === 'cryptoCountdown');
  ok('364-day lot is flagged near tax-free', cd.length === 1 && cd[0].daysLeft === 1);
  // exactly 365 days held (acquired 2025-06-25) -> 0 days left, already free, not flagged
  r = A.analyze({ today, cryptoLots: [lot('2025-06-25', 1, 1000, 1500)] });
  ok('365-day lot is already tax-free (not flagged)', r.findings.filter(f => f.kind === 'cryptoCountdown').length === 0);
  // 30 days left is included, 31 days left is not
  r = A.analyze({ today, cryptoLots: [lot('2025-07-25', 1, 1000, 1500), lot('2025-07-24', 1, 1000, 1500)] });
  // 2025-07-25 +365 = 2026-07-25 -> 30 days left (in); 2025-07-24 -> 29 days left (in)
  ok('lots within 30 days are flagged', r.findings.filter(f => f.kind === 'cryptoCountdown').length === 2);
  // a loss-making lot is not flagged (no tax benefit to waiting)
  r = A.analyze({ today, cryptoLots: [lot('2025-06-26', 1, 2000, 1500)] });
  ok('loss lot not flagged for countdown', r.findings.filter(f => f.kind === 'cryptoCountdown').length === 0);

  // ---- crypto Freigrenze 1.000 EUR hard limit ----
  let f = A.analyze({ today, realizedCryptoGainsYTD: 1200 }).findings.find(x => x.kind === 'cryptoFreigrenze');
  ok('over-limit crypto gains are critical', f && f.priority === 'critical');
  f = A.analyze({ today, realizedCryptoGainsYTD: 850 }).findings.find(x => x.kind === 'cryptoFreigrenze');
  ok('near-limit (>=80%) crypto gains are important', f && f.priority === 'important');
  ok('near-limit remaining is correct', f && Math.round(f.remaining) === 150);
  f = A.analyze({ today, realizedCryptoGainsYTD: 100 }).findings.find(x => x.kind === 'cryptoFreigrenze');
  ok('well-under-limit crypto gains: no finding', !f);
  let summary = A.analyze({ today, realizedCryptoGainsYTD: 1200 }).summary;
  ok('summary marks exceeded', summary.cryptoFreigrenze.exceeded === true && Math.round(summary.cryptoFreigrenze.remaining) === -200);

  // ---- Sparerpauschbetrag headroom (single vs married) ----
  let res = A.analyze({ today, sparerpauschbetrag: 1000, sparerpauschbetragUsed: 600 });
  let sh = res.findings.find(x => x.kind === 'sparerHeadroom');
  ok('headroom finding present', sh && Math.round(sh.remaining) === 400);
  ok('summary spb remaining', Math.round(res.summary.sparerpauschbetrag.remaining) === 400);
  res = A.analyze({ today, sparerpauschbetrag: 1000, sparerpauschbetragUsed: 1000 });
  ok('exhausted SpB flagged', res.findings.some(x => x.kind === 'sparerHeadroom' && x.remaining === 0));
  ok('married doubles the limit', A.sparerLimitFor({ married: true }) === 2000 && A.sparerLimitFor({}) === 1000);

  // ---- loss harvesting, pots kept separate ----
  res = A.analyze({ today,
    positions: [
      { symbol: 'AAA', assetClass: 'stocks', costBasisEUR: 10000, currentValueEUR: 8000 }, // -2000 stock loss
      { symbol: 'BBB', assetClass: 'crypto', costBasisEUR: 5000, currentValueEUR: 4000 }    // -1000 other loss
    ],
    realizedStockGainsYTD: 1500, realizedOtherGainsYTD: 0 });
  let lh = res.findings.filter(x => x.kind === 'lossHarvest');
  ok('only the stock pot harvests (other has no realised gains)', lh.length === 1 && lh[0].pot === 'stocks');
  ok('offset capped at realised gains', Math.round(lh[0].offset) === 1500);
  // give the other pot realised gains too
  res = A.analyze({ today,
    positions: [
      { symbol: 'AAA', assetClass: 'stocks', costBasisEUR: 10000, currentValueEUR: 8000 },
      { symbol: 'BBB', assetClass: 'crypto', costBasisEUR: 5000, currentValueEUR: 4000 }
    ],
    realizedStockGainsYTD: 1500, realizedOtherGainsYTD: 500 });
  lh = res.findings.filter(x => x.kind === 'lossHarvest');
  ok('both pots harvest when each has realised gains', lh.length === 2);
  const other = lh.find(x => x.pot === 'other');
  ok('other-pot offset capped at its 500 realised gains', Math.round(other.offset) === 500);

  // ---- buildCryptoLots FIFO ----
  const txs = [
    { type: 'buy', category: 'crypto', symbol: 'btc', quantity: 1, price: 20000, currency: 'EUR', date: '2024-01-01' },
    { type: 'buy', category: 'crypto', symbol: 'BTC', quantity: 1, price: 30000, currency: 'EUR', date: '2025-01-01' },
    { type: 'sell', category: 'crypto', symbol: 'BTC', quantity: 1, price: 40000, currency: 'EUR', date: '2025-06-01' }, // consumes 2024 lot FIFO
    { type: 'buy', category: 'stocks', symbol: 'AAPL', quantity: 5, price: 100, currency: 'USD', date: '2025-01-01' }   // ignored
  ];
  const lots = A.buildCryptoLots(txs, () => 50000);
  ok('FIFO leaves the newest open lot', lots.length === 1 && lots[0].acquiredDate === '2025-01-01');
  ok('open lot cost basis', lots[0].costBasisEUR === 30000);
  ok('open lot current value from price fn', lots[0].currentValueEUR === 50000);
  ok('non-crypto ignored', lots.every(l => l.symbol === 'BTC'));

  // priority sort: critical before important before optimization
  res = A.analyze({ today, realizedCryptoGainsYTD: 1200, sparerpauschbetrag: 1000, sparerpauschbetragUsed: 600,
    cryptoLots: [lot('2025-06-26', 1, 1000, 1500)] });
  ok('findings sorted by priority', res.findings[0].priority === 'critical');

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
