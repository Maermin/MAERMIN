// Node harness for P5-3.5 aggregators.js: GoCardless Bank Account Data and
// SnapTrade with the user's own keys, through the REAL Worker relay
// (brokerproxy) to synthetic upstreams (made-up data). SnapTrade requests must
// carry a valid signature; the relay must refuse anything off its list.
// Run: node test/aggregators.test.js
'use strict';
let passed = 0, failed = 0;
function ok(name, cond, detail) { cond ? (passed++, console.log('  ✓ ' + name)) : (failed++, console.error('  ✗ ' + name + (detail !== undefined ? '  — ' + JSON.stringify(detail) : ''))); }
const approx = (a, b) => Math.abs(a - b) < 1e-9;

const AG = require('../aggregators.js');

const { GC_KEYS, ST_KEYS, REQ, ACC, STACC, seen, upstream } = require('./aggregator-sim.js');

(async function run() {
  const W = await import('../cf-worker/worker.js');
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  globalThis.fetch = (url, init) => upstream(String(url && url.url ? url.url : url), init || {});
  let ip = 0;
  const viaWorker = async (url, init) => W.default.fetch(new Request(url, Object.assign({}, init, { headers: Object.assign({ Origin: 'https://maermin.github.io', 'CF-Connecting-IP': '10.2.0.' + (++ip) }, init.headers) })), {}, { waitUntil() {} });
  const relay = AG.makeRelay('https://w.example.workers.dev', viaWorker);

  console.log('relay policy:');
  const allowed = (u, m) => W.brokerRelayAllowed(new URL(u), m).ok;
  ok('GoCardless: token, institutions, requisitions, account data', allowed('https://bankaccountdata.gocardless.com/api/v2/token/new/', 'POST') && allowed('https://bankaccountdata.gocardless.com/api/v2/institutions/?country=DE', 'GET') && allowed('https://bankaccountdata.gocardless.com/api/v2/accounts/' + ACC + '/transactions/', 'GET'));
  ok('GoCardless: no deleting, no other account paths', !allowed('https://bankaccountdata.gocardless.com/api/v2/requisitions/' + REQ + '/', 'DELETE') && !allowed('https://bankaccountdata.gocardless.com/api/v2/accounts/' + ACC + '/premium/transactions/', 'GET') && !allowed('https://bankaccountdata.gocardless.com/api/v2/accounts/x/details/', 'GET'));
  ok('SnapTrade: read endpoints and the read-only portal only, no trading', allowed('https://api.snaptrade.com/api/v1/accounts/' + STACC + '/positions?clientId=x', 'GET') && allowed('https://api.snaptrade.com/api/v1/snapTrade/login', 'POST') && !allowed('https://api.snaptrade.com/api/v1/trade/place', 'POST') && !allowed('https://api.snaptrade.com/api/v1/accounts/' + STACC + '/orders', 'GET'));

  console.log('\nGoCardless:');
  let bad = null;
  try { await AG.gcToken({ secretId: 'x', secretKey: 'y' }, relay); } catch (e) { bad = e; }
  ok('wrong keys: an auth error with the provider\'s reason', bad && bad.code === 'auth' && /credentials/.test(bad.message), bad && bad.message);
  const tok = await AG.gcToken(GC_KEYS, relay);
  ok('token', tok === 'ACCESS');
  const insts = await AG.gcInstitutions(tok, 'DE', relay);
  ok('banks of a country', insts.length === 2 && insts[1].name === 'DKB');
  const link = await AG.gcLink(tok, 'DKB_BYLADEM1', 'https://maermin.github.io/MAERMIN/', relay);
  ok('a requisition with the bank\'s approval link', link.requisitionId === REQ && /DKB_BYLADEM1$/.test(link.link), link);
  const stat = await AG.gcStatus(tok, REQ, relay);
  ok('linked (LN) with one account', stat.status === 'LN' && stat.accounts[0] === ACC);
  const accs = await AG.gcFetch(tok, stat.accounts, relay);
  const a = accs[0];
  ok('details and the booked balance (closingBooked wins over expected)', a.iban === 'DE89370400440532013000' && a.balance.amount === 1500 && a.balance.date === '2025-03-01', a);
  ok('booked transactions only (pending left out)', a.rows.length === 4);
  const BS = require('../bank-sync.js');
  const book = BS.toBookings({ iban: a.iban, accountNo: a.id }, a.rows, { source: 'gocardless' });
  ok('as cash bookings: rent, salary, account fee; the securities purchase left out', book.rows.map((r) => r.type).join() === 'withdrawal,deposit,fee' && book.skipped === 1, book);
  ok('source gocardless, ids from the provider (stable)', book.rows.every((r) => r.source === 'gocardless') && BS.toBookings({ iban: a.iban }, a.rows.slice().reverse(), { source: 'gocardless' }).rows.map((r) => r.externalId).sort().join() === book.rows.map((r) => r.externalId).sort().join());
  ok('array remittance text joined', /Kontoführungsentgelt Februar/.test(book.rows[2].notes), book.rows[2].notes);

  console.log('\nSnapTrade:');
  const canon = AG.canonical({ query: 'a=1', path: '/p', content: { b: 1, a: [2, { d: 1, c: 2 }] } });
  ok('canonical JSON: sorted keys, no spaces', canon === '{"content":{"a":[2,{"c":2,"d":1}],"b":1},"path":"/p","query":"a=1"}', canon);
  const spec = await AG.stRequest(ST_KEYS, 'GET', '/accounts', null, null, Date.UTC(2025, 0, 1));
  ok('signed request: client id and timestamp in the query, signature header, no consumer key anywhere', /clientId=MAERMIN-TEST&timestamp=1735689600$/.test(spec.url) && spec.headers.Signature && JSON.stringify(spec).indexOf(ST_KEYS.consumerKey) < 0, spec);
  const user = await AG.stRegister(ST_KEYS, relay, 'maermin-u1');
  ok('register a SnapTrade user', user.userId === 'maermin-u1' && user.userSecret === 'user-secret-1');
  const creds = Object.assign({}, ST_KEYS, user);
  const portal = await AG.stLoginLink(creds, relay);
  ok('read-only connection portal link', /^https:\/\/app\.snaptrade\.com\//.test(portal));
  const res = await AG.stFetch(creds, relay, { startDate: '2020-01-01', endDate: '2025-03-01' });
  ok('accounts with balance and positions', res.accounts.length === 1 && res.accounts[0].balance.amount === 10250.5 && res.accounts[0].positions.length === 2 && res.accounts[0].number === '4567', res.accounts[0]);
  ok('every request was signed correctly', seen.badSig === 0 && seen.st.length >= 5, seen);
  const m = AG.mapActivities(res.activities, { portfolioId: 'p1' });
  const types = m.transactions.map((t) => t.type).join();
  ok('activities: buy, dividend, deposit, fee, sell; interest left out and counted', types === 'buy,dividend,deposit,fee,sell' && m.skipped.INTEREST === 1, { types, skipped: m.skipped });
  const buy = m.transactions[0], div = m.transactions[1], sell = m.transactions[4];
  ok('buy: 10 AAPL at 180 USD, fee 1, date', buy.symbol === 'AAPL' && buy.quantity === 10 && buy.price === 180 && buy.fees === 1 && buy.currency === 'USD' && buy.date === '2025-01-10', buy);
  ok('dividend without a share count: 1 × 2.50', div.quantity === 1 && approx(div.price, 2.5), div);
  ok('sell: negative units become a positive quantity', sell.type === 'sell' && sell.quantity === 1 && sell.price === 285, sell);
  ok('ids "st-<activity>", source snaptrade; nothing twice', m.transactions.every((t) => t.source === 'snaptrade' && /^st-a\d$/.test(t.externalId)) && BS.newOnly(m.transactions, m.transactions.slice(0, 3)).length === 2);
  const d = AG.positionsDiff(res.accounts[0].positions, [buy, { type: 'buy', symbol: 'aapl', quantity: 0 }]);
  ok('positions vs MAERMIN: AAPL matches (10, symbol case ignored), VTI not held -> missing', d[0].status === 'match' && d[1].status === 'missing', d);
  const d2 = AG.positionsDiff(res.accounts[0].positions, [buy, sell]);
  ok('positions vs MAERMIN: VTI sold in MAERMIN but held at the broker -> differs', d2[1].status === 'differs' && d2[1].diff === 6, d2[1]);

  console.log('\nstate:');
  const n = AG.normalize({ gocardless: { requisitionId: REQ, accounts: [{ id: ACC, iban: 'DE89', balance: { amount: 1, currency: 'EUR' }, rows: [1], secretKey: 'x' }], token: 'ACCESS' }, snaptrade: { userSecret: 'u', accounts: [] } });
  const s = JSON.stringify(n);
  ok('stored metadata holds no key, token or transactions', s.indexOf('ACCESS') < 0 && s.indexOf('secretKey') < 0 && s.indexOf('userSecret') < 0 && s.indexOf('rows') < 0 && n.gocardless.accounts[0].iban === 'DE89', s);
  ok('a malformed requisition id is dropped', AG.normalize({ gocardless: { requisitionId: '../x' } }).gocardless.requisitionId === '');

  console.log('\n  ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
