// Steam inventory import (P2-7): profile parsing, inventory JSON -> items,
// re-import offers only new asset ids, rows -> buy transactions, and the
// Worker route against a fake Steam (custom URL, pages, private, rate limit).
// Run: node test/steam-import.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}
const S = require('../steam-import.js');
const ID = '76561197960287930';
const page = (assets, more, last) => ({
  assets: assets.map(([assetid, classid, amount]) => ({ appid: 730, contextid: '2', assetid, classid, instanceid: '0', amount: String(amount || 1) })),
  descriptions: [
    { classid: 'c1', instanceid: '0', market_hash_name: 'AK-47 | Redline (Field-Tested)', marketable: 1 },
    { classid: 'c2', instanceid: '0', market_hash_name: 'Fracture Case', marketable: 1 },
    { classid: 'c3', instanceid: '0', market_hash_name: 'Service Medal', marketable: 0 }],
  more_items: more ? 1 : undefined, last_assetid: last, total_inventory_count: 5, success: 1 });

(async function run() {
  console.log('steam import (app):');
  ok('SteamID64 from an id or a profiles/ URL', S.steamId64(ID) === ID && S.steamId64('https://steamcommunity.com/profiles/' + ID + '/') === ID && S.steamId64('gaben') === null);
  const items = S.itemsFrom(JSON.stringify(page([['1', 'c1'], ['2', 'c1'], ['3', 'c2', 2], ['4', 'c3'], ['5', 'cX']])));
  ok('inventory JSON -> one item per asset (stacks split, unknown classes dropped)', items.length === 5 && items.filter((i) => i.name === 'Fracture Case').length === 2 && !items.some((i) => i.assetid === '5'));
  ok('marketable flag kept', items.find((i) => i.assetid === '4').marketable === false);
  ok('the Worker shape { items } is accepted as is', S.itemsFrom({ items: [{ assetid: '9', name: 'X' }] }).length === 1);
  ok('anything else is not an inventory', S.itemsFrom('{"foo":1}') === null && S.itemsFrom('not json') === null);
  const rows = S.newRows(items, {});
  ok('rows: one per name with count, sorted', rows.map((r) => r.name + ':' + r.qty).join() === 'AK-47 | Redline (Field-Tested):2,Fracture Case:2,Service Medal:1');
  const txs = S.toTransactions(rows.map((r) => Object.assign({}, r, { price: 12.345, date: '2026-10-01', include: r.name !== 'Service Medal' })), { now: 1000, portfolioId: 'p1' });
  ok('only ticked rows become buys (skins, EUR, price rounded, date, portfolio)', txs.length === 2 && txs.every((t) => t.type === 'buy' && t.category === 'skins' && t.currency === 'EUR' && t.price === 12.35 && t.date === '2026-10-01' && t.portfolioId === 'p1'));
  ok('each buy keeps the asset ids it covers', txs[0].steamAssetIds.join() === '1,2' && txs[0].quantity === 2);
  const again = S.newRows(items, S.importedIds(txs));
  ok('re-import offers only items not imported before', again.map((r) => r.name).join() === 'Service Medal');
  const more = S.newRows(items.concat([{ assetid: '7', name: 'AK-47 | Redline (Field-Tested)', marketable: true }]), S.importedIds(txs));
  ok('a newly received copy of an imported item is offered on its own', more.find((r) => r.name.startsWith('AK-47')).qty === 1);

  console.log('steam inventory (Worker route):');
  const W = await import('../cf-worker/worker.js');
  ok('profile parsing: id, profiles/ URL, id/ URL, custom name; junk rejected', W.parseSteamProfile(ID).steamid === ID && W.parseSteamProfile('steamcommunity.com/profiles/' + ID).steamid === ID
    && W.parseSteamProfile('https://steamcommunity.com/id/gaben').vanity === 'gaben' && W.parseSteamProfile('gaben').vanity === 'gaben'
    && W.parseSteamProfile('https://evil.example/id/x') === null && W.parseSteamProfile('a b') === null);
  const calls = [];
  let mode = 'ok';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => {
    u = String(u); calls.push(u);
    if (/\/id\/gaben\/\?xml=1/.test(u)) return new Response('<profile><steamID64>' + ID + '</steamID64></profile>', { status: 200 });
    if (/\/inventory\//.test(u)) {
      if (mode === 'private') return new Response('null', { status: 403 });
      if (mode === 'limited') return new Response('null', { status: 429 });
      if (!/start_assetid/.test(u)) return new Response(JSON.stringify(page([['1', 'c1'], ['2', 'c2']], true, '2')), { status: 200 });
      return new Response(JSON.stringify(page([['3', 'c3']])), { status: 200 });
    }
    return new Response('', { status: 404 });
  };
  const call = async (profile) => { const r = await W.default.fetch(new Request('https://w.example.dev/?action=steaminv&profile=' + encodeURIComponent(profile), { headers: { 'CF-Connecting-IP': '10.0.0.' + Math.floor(Math.random() * 200) } }), {}, {}); return { status: r.status, body: await r.json() }; };
  try {
    const a = await call('gaben');
    ok('custom URL name resolved, both pages joined', a.status === 200 && a.body.steamid === ID && a.body.items.map((i) => i.assetid).join() === '1,2,3', JSON.stringify(a));
    ok('only steamcommunity.com was asked', calls.every((u) => u.startsWith('https://steamcommunity.com/')));
    ok('second page asked with start_assetid', calls.some((u) => /start_assetid=2$/.test(u)));
    mode = 'private';
    ok('private inventory -> 403 with a reason', (await call(ID)).status === 403);
    mode = 'limited';
    ok('Steam rate limit -> 429 passed on', (await call(ID)).status === 429);
    ok('junk profile -> 400 without a request', (calls.length, (await call('a b')).status === 400));
    ok('the inventory has its own rate-limit budget', W.rateBucket(null, 'steaminv') === 'steam');
  } finally { globalThis.fetch = realFetch; }

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
