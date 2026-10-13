// P5-3.6: the Worker's public-address route against synthetic explorers
// (test/wallet-sim.js): address checks per chain, Bitcoin balance and
// transactions, EVM balance / ERC-20 tokens / transactions, an unused EVM
// address, Solana balance, caching, and the shared price Worker refusing it.
// Run: node test/worker-wallet.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }

(async function run() {
  const W = await import('../cf-worker/worker.js');
  const WL = await import('../cf-worker/wallets.js');
  const sim = require('./wallet-sim.js');
  const store = new Map();
  globalThis.caches = { default: { match: async (r) => (store.has(r.url) ? new Response(store.get(r.url)) : undefined), put: async (r, resp) => { store.set(r.url, await resp.text()); } } };
  globalThis.fetch = (url, init) => sim.upstream(String(url && url.url ? url.url : url), init || {});
  let ip = 0;
  const pending = [];
  const call = async (q, env) => {
    const r = await W.default.fetch(new Request('https://w.example.workers.dev/?' + q, { headers: { Origin: 'https://maermin.github.io', 'CF-Connecting-IP': '10.3.0.' + (++ip) } }), env || {}, { waitUntil(p) { pending.push(p); } });
    await Promise.all(pending.splice(0));
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  console.log('addresses:');
  ok('bitcoin bech32 and legacy', WL.validAddress('btc', sim.BTC) && WL.validAddress('btc', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa') && !WL.validAddress('btc', 'bc1Q-not'));
  ok('EVM 0x + 40 hex on every EVM chain', ['eth', 'arb', 'op', 'base', 'polygon'].every((c) => WL.validAddress(c, sim.EVM)) && !WL.validAddress('eth', '0x123'));
  ok('solana base58', WL.validAddress('sol', sim.SOL) && !WL.validAddress('sol', '0OIl'));
  ok('units: big integers with decimals', WL.units('1500000000000000000', 18) === 1.5 && WL.units('2500000000', 6) === 2500 && WL.units('7', 0) === 7 && WL.units('x', 6) === 0);
  const bad = await call('action=wallet&chain=eth&address=0x123');
  const badChain = await call('action=wallet&chain=doge&address=' + sim.EVM);
  ok('invalid address or unknown chain: 400, no explorer call', bad.status === 400 && badChain.status === 400 && sim.calls.length === 0, [bad.body, badChain.body]);

  console.log('\nexplorers:');
  const btc = await call('action=wallet&chain=btc&address=' + sim.BTC);
  ok('bitcoin: 1 BTC (funded - spent)', btc.status === 200 && btc.body.native.symbol === 'BTC' && btc.body.native.amount === 1, btc.body && btc.body.native);
  ok('bitcoin: an outgoing 0.5 (net of change) with its fee, an incoming 1.5', btc.body.txs[0].direction === 'out' && btc.body.txs[0].amount === 0.5 && btc.body.txs[0].fee === 0.0001 && btc.body.txs[1].direction === 'in' && btc.body.txs[1].amount === 1.5 && btc.body.txs[1].fee === 0, btc.body.txs);
  ok('bitcoin: dates from the block time', btc.body.txs[0].date === '2025-01-04' && btc.body.txs[1].date === '2023-11-14', btc.body.txs.map((t) => t.date));
  const eth = await call('action=wallet&chain=eth&address=' + sim.EVM);
  ok('ethereum: 1.5 ETH', eth.status === 200 && eth.body.native.amount === 1.5 && eth.body.native.symbol === 'ETH');
  ok('ethereum: ERC-20 only, no NFT, no zero balance, no non-ASCII spam symbol', eth.body.tokens.length === 1 && eth.body.tokens[0].symbol === 'USDC' && eth.body.tokens[0].amount === 2500, eth.body.tokens);
  ok('ethereum: an out with fee, an in without', eth.body.txs[0].direction === 'out' && eth.body.txs[0].amount === 0.5 && eth.body.txs[0].fee === 0.0021 && eth.body.txs[1].direction === 'in' && eth.body.txs[1].amount === 2 && eth.body.txs[1].fee === 0, eth.body.txs);
  const base = await call('action=wallet&chain=base&address=' + sim.EVM);
  ok('an address never used on Base: zero, not an error', base.status === 200 && base.body.native.amount === 0 && base.body.tokens.length === 0, base);
  const pol = await call('action=wallet&chain=polygon&address=' + sim.EVM);
  ok('polygon native symbol POL', pol.body.native.symbol === 'POL');
  const sol = await call('action=wallet&chain=sol&address=' + sim.SOL);
  ok('solana: 2.5 SOL', sol.status === 200 && sol.body.native.amount === 2.5, sol.body);
  const solBad = await call('action=wallet&chain=sol&address=8xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');
  ok('an RPC error is a 502 with the chain named', solBad.status === 502 && /Solana/.test(solBad.body.error), solBad.body);
  const before = sim.calls.length;
  const again = await call('action=wallet&chain=btc&address=' + sim.BTC);
  ok('a repeat within two minutes is served from the cache', again.status === 200 && again.body.native.amount === 1 && sim.calls.length === before);
  ok('version 2026.10.9 lists wallet', W.WORKER_VERSION === '2026.10.9' && W.WORKER_ACTIONS.indexOf('wallet') > -1);
  const po = await call('action=wallet&chain=btc&address=' + sim.BTC, { PRICE_ONLY: '1' });
  ok('the shared price Worker refuses it (403)', po.status === 403);

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
