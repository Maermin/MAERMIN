// Synthetic GoCardless Bank Account Data and SnapTrade upstreams (made-up
// data) for test/aggregators.test.js and the e2e run of P5-3.5. SnapTrade
// requests must carry a valid signature (aggregators.js stSign).
'use strict';
const AG = require('../aggregators.js');

const GC_KEYS = { secretId: 'sid-123', secretKey: 'skey-456' };
const ST_KEYS = { clientId: 'MAERMIN-TEST', consumerKey: 'ck-secret-789' };
const REQ = '8126e9fb-93c9-4228-937c-68f0383c2df7', ACC = '3fa85f64-5717-4562-b3fc-2c963f66afa6', STACC = '9c1b2a3d-1111-4222-8333-444455556666';
const seen = { gc: [], st: [], badSig: 0 };

async function stVerify(url, init) {
  const u = new URL(url);
  const body = init.body ? JSON.parse(init.body) : null;
  const want = await AG.stSign(ST_KEYS.consumerKey, u.pathname, u.search.slice(1), body);
  const got = init.headers && (init.headers.Signature || init.headers.signature);
  if (got !== want) { seen.badSig++; return false; }
  return true;
}
const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
async function upstream(url, init) {
  const u = new URL(url);
  if (u.hostname === 'bankaccountdata.gocardless.com') {
    seen.gc.push(init.method + ' ' + u.pathname);
    const auth = init.headers && init.headers.Authorization;
    if (u.pathname === '/api/v2/token/new/') { const b = JSON.parse(init.body); return b.secret_id === GC_KEYS.secretId && b.secret_key === GC_KEYS.secretKey ? json({ access: 'ACCESS', access_expires: 86400 }) : json({ summary: 'Authentication failed', detail: 'No active account found with the given credentials' }, 401); }
    if (auth !== 'Bearer ACCESS') return json({ detail: 'Invalid token' }, 401);
    if (u.pathname === '/api/v2/institutions/') return json([{ id: 'SANDBOXFINANCE_SFIN0000', name: 'Sandbox Finance' }, { id: 'DKB_BYLADEM1', name: 'DKB' }]);
    if (u.pathname === '/api/v2/requisitions/' && init.method === 'POST') { const b = JSON.parse(init.body); return json({ id: REQ, link: 'https://ob.gocardless.com/psd2/start/' + REQ + '/' + b.institution_id, status: 'CR' }); }
    if (u.pathname === '/api/v2/requisitions/' + REQ + '/') return json({ id: REQ, status: 'LN', accounts: [ACC] });
    if (u.pathname === '/api/v2/accounts/' + ACC + '/details/') return json({ account: { iban: 'DE89370400440532013000', currency: 'EUR', name: 'Girokonto' } });
    if (u.pathname === '/api/v2/accounts/' + ACC + '/balances/') return json({ balances: [{ balanceAmount: { amount: '1520.40', currency: 'EUR' }, balanceType: 'expected' }, { balanceAmount: { amount: '1500.00', currency: 'EUR' }, balanceType: 'closingBooked', referenceDate: '2025-03-01' }] });
    if (u.pathname === '/api/v2/accounts/' + ACC + '/transactions/') return json({ transactions: { booked: [
      { transactionId: 't1', bookingDate: '2025-02-01', transactionAmount: { amount: '-850.00', currency: 'EUR' }, creditorName: 'Vermieter GmbH', remittanceInformationUnstructured: 'Miete Februar' },
      { transactionId: 't2', bookingDate: '2025-02-25', transactionAmount: { amount: '3200.00', currency: 'EUR' }, debtorName: 'Arbeitgeber AG', remittanceInformationUnstructured: 'Gehalt' },
      { transactionId: 't3', bookingDate: '2025-02-28', transactionAmount: { amount: '-500.00', currency: 'EUR' }, creditorName: 'Broker', remittanceInformationUnstructured: 'Wertpapierkauf IE00B4L5Y983' },
      { internalTransactionId: 'i4', bookingDate: '2025-02-28', transactionAmount: { amount: '-6.90', currency: 'EUR' }, remittanceInformationUnstructuredArray: ['Kontoführungsentgelt', 'Februar'] }
    ], pending: [{ transactionAmount: { amount: '-10', currency: 'EUR' } }] } });
    return json({ detail: 'not found' }, 404);
  }
  if (u.hostname === 'api.snaptrade.com') {
    seen.st.push(init.method + ' ' + u.pathname);
    if (!(await stVerify(url, init))) return json({ detail: 'Invalid signature' }, 401);
    const q = u.searchParams;
    if (q.get('clientId') !== ST_KEYS.clientId) return json({ detail: 'bad client' }, 401);
    if (u.pathname === '/api/v1/snapTrade/registerUser') return json({ userId: JSON.parse(init.body).userId, userSecret: 'user-secret-1' });
    if (q.get('userSecret') !== 'user-secret-1') return json({ detail: 'bad user' }, 401);
    if (u.pathname === '/api/v1/snapTrade/login') return json({ redirectURI: 'https://app.snaptrade.com/snapTrade/redeemToken?token=abc', sessionId: 's1' });
    if (u.pathname === '/api/v1/accounts') return json([{ id: STACC, name: 'Depot', number: '1234567', institution_name: 'Interactive Brokers', balance: { total: { amount: 10250.5, currency: 'USD' } } }]);
    if (u.pathname === '/api/v1/accounts/' + STACC + '/positions') return json([
      { symbol: { symbol: { symbol: 'AAPL', description: 'Apple Inc.', currency: { code: 'USD' } } }, units: 10, price: 210.5 },
      { symbol: { symbol: { symbol: 'VTI', description: 'Vanguard Total Stock Market ETF', currency: { code: 'USD' } } }, units: 5, price: 280 }]);
    if (u.pathname === '/api/v1/activities') return json([
      { id: 'a1', type: 'BUY', symbol: { symbol: 'AAPL', description: 'Apple Inc.', currency: { code: 'USD' } }, units: 10, price: 180, amount: -1800, fee: 1, currency: { code: 'USD' }, trade_date: '2025-01-10T00:00:00Z' },
      { id: 'a2', type: 'DIVIDEND', symbol: { symbol: 'AAPL', description: 'Apple Inc.', currency: { code: 'USD' } }, units: 0, price: 0, amount: 2.5, fee: 0, currency: { code: 'USD' }, trade_date: '2025-02-13T00:00:00Z' },
      { id: 'a3', type: 'CONTRIBUTION', symbol: null, units: 0, price: 0, amount: 2000, fee: 0, currency: { code: 'USD' }, trade_date: '2025-01-05T00:00:00Z' },
      { id: 'a4', type: 'FEE', symbol: null, amount: -3, currency: { code: 'USD' }, trade_date: '2025-02-01T00:00:00Z' },
      { id: 'a5', type: 'INTEREST', symbol: null, amount: 0.4, currency: { code: 'USD' }, trade_date: '2025-02-01T00:00:00Z' },
      { id: 'a6', type: 'SELL', symbol: { symbol: 'VTI', description: 'Vanguard Total Stock Market ETF', currency: { code: 'USD' } }, units: -1, price: 285, amount: 285, fee: 0, currency: { code: 'USD' }, trade_date: '2025-02-20T00:00:00Z' }]);
    return json({ detail: 'not found' }, 404);
  }
  return new Response('', { status: 500 });
}

module.exports = { GC_KEYS, ST_KEYS, REQ, ACC, STACC, seen, upstream };
