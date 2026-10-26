// The local MCP server must not convert at an invented exchange rate. Before:
// without --usd-eur every USD amount was converted at a fixed 0.92 (the backup
// holds no exchange-rate history). Now a vault with non-EUR amounts needs
// --usd-eur for every tool that reports values; an all-EUR vault needs none.
// Run: node test/mcp-usd-rate.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, info) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (info !== undefined ? ' -> ' + JSON.stringify(info).slice(0, 300) : ''))); }

const MCP = require('../mcp/lib/index.js');
const T = (o) => Object.assign({ currency: 'EUR', portfolioId: 'default', category: 'stocks' }, o);
const vaultOf = (txs) => ({ data: { transactions: txs, maermin_portfolios: [{ id: 'default', name: 'Main' }],
  priceHistory: { SAP: [{ timestamp: '2026-10-13T16:00:00Z', price: 200 }], AAPL: [{ timestamp: '2026-10-13T16:00:00Z', price: 250 }] } }, strings: {} });
const call = async (srv, name, args) => (await srv.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args || {} } })).result;

(async function main() {
  console.log('mcp without --usd-eur:');
  const usd = vaultOf([T({ id: 'a', type: 'buy', symbol: 'SAP', quantity: 1, price: 100, date: '2026-01-02' }), T({ id: 'b', type: 'buy', symbol: 'AAPL', quantity: 1, price: 100, currency: 'USD', date: '2026-01-02' })]);
  const srv = MCP.createServer(usd, { today: '2026-10-14', amounts: true });
  for (const tool of ['overview', 'positions', 'performance', 'allocation']) {
    const r = await call(srv, tool);
    ok(tool + ': refused with a pointer to --usd-eur (no guessed rate)', r.isError === true && /--usd-eur/.test(r.content[0].text), r);
  }
  const tx = await call(srv, 'transactions');
  ok('transactions: still listed (original currency, nothing converted)', !tx.isError && tx.structuredContent.total === 2, tx);

  const eur = vaultOf([T({ id: 'a', type: 'buy', symbol: 'SAP', quantity: 1, price: 100, date: '2026-01-02' })]);
  const pos = await call(MCP.createServer(eur, { today: '2026-10-14', amounts: true }), 'positions');
  ok('an all-EUR vault needs no rate', !pos.isError && pos.structuredContent.positions[0].valueEUR === 200, pos);
  ok('its note does not name a rate', !/0\.92|converted at/.test(pos.structuredContent.note || ''), pos.structuredContent.note);

  console.log('with --usd-eur:');
  const given = await call(MCP.createServer(usd, { today: '2026-10-14', amounts: true, usdEur: 0.9 }), 'positions');
  const aapl = given.structuredContent && given.structuredContent.positions.find((p) => p.symbol === 'AAPL');
  ok('the given rate is used', !given.isError && aapl && aapl.valueEUR === 225 && /0\.9 EUR per USD/.test(given.structuredContent.note), given);

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
