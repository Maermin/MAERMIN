// Synthetic Bitvavo, Bybit, KuCoin and Bitget (made-up data) for P5-3.8: each
// request must carry a valid signature (recomputed here the way the exchange
// documents it). Used by test/exchange-more.test.js and the e2e run.
'use strict';
const crypto = require('crypto');
const KEYS = { apiKey: 'key-1', apiSecret: 'secret-1', passphrase: 'pass-1' };
const ms = (iso) => Date.parse(iso);
const state = { badSig: 0, calls: [], bybitReadOnly: 1 };
const hmac = (enc, msg) => crypto.createHmac('sha256', KEYS.apiSecret).update(msg).digest(enc);
const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
const H = (init, k) => { const h = (init && init.headers) || {}; const f = Object.keys(h).find((x) => x.toLowerCase() === k.toLowerCase()); return f ? h[f] : undefined; };

async function upstream(url, init) {
  const u = new URL(url);
  const pq = u.pathname + u.search;
  state.calls.push(u.hostname + pq);
  if (u.hostname === 'api.bitvavo.com') {
    if (H(init, 'Bitvavo-Access-Signature') !== hmac('hex', H(init, 'Bitvavo-Access-Timestamp') + 'GET' + pq) || H(init, 'Bitvavo-Access-Key') !== KEYS.apiKey) { state.badSig++; return json({ errorCode: 309, error: 'The signature is invalid.' }, 403); }
    if (u.pathname === '/v2/balance') return json([{ symbol: 'BTC', available: '0.5', inOrder: '0' }, { symbol: 'EUR', available: '100', inOrder: '0' }]);
    if (u.pathname === '/v2/trades' && u.searchParams.get('market') === 'BTC-EUR') return json([{ id: 'bv1', timestamp: ms('2025-03-01T10:00:00Z'), market: 'BTC-EUR', side: 'buy', amount: '0.5', price: '60000', fee: '15', feeCurrency: 'EUR' }]);
    return json({ errorCode: 205, error: 'market parameter is invalid.' }, 400);
  }
  if (u.hostname === 'api.bybit.com') {
    if (H(init, 'X-BAPI-SIGN') !== hmac('hex', H(init, 'X-BAPI-TIMESTAMP') + KEYS.apiKey + H(init, 'X-BAPI-RECV-WINDOW') + u.search.slice(1))) { state.badSig++; return json({ retCode: 10004, retMsg: 'error sign!' }); }
    if (u.pathname === '/v5/user/query-api') return json({ retCode: 0, retMsg: 'OK', result: { readOnly: state.bybitReadOnly } });
    if (u.pathname === '/v5/execution/list') {
      const s = Number(u.searchParams.get('startTime')), e = Number(u.searchParams.get('endTime')), t = ms('2025-03-05T12:00:00Z');
      return json({ retCode: 0, retMsg: 'OK', result: { list: s <= t && t <= e ? [{ symbol: 'ETHUSDT', side: 'Buy', execQty: '1', execPrice: '2000', execFee: '0.001', feeCurrency: 'ETH', execTime: String(t), execId: 'by1' }] : [] } });
    }
  }
  if (u.hostname === 'api.kucoin.com') {
    if (H(init, 'KC-API-SIGN') !== hmac('base64', H(init, 'KC-API-TIMESTAMP') + 'GET' + pq) || H(init, 'KC-API-PASSPHRASE') !== hmac('base64', KEYS.passphrase) || H(init, 'KC-API-KEY-VERSION') !== '2') { state.badSig++; return json({ code: '400005', msg: 'Invalid KC-API-SIGN' }); }
    const s = Number(u.searchParams.get('startAt')), e = Number(u.searchParams.get('endAt')), t = ms('2025-03-03T08:00:00Z');
    return json({ code: '200000', data: { currentPage: 1, items: s <= t && t <= e ? [{ symbol: 'SOL-USDT', side: 'sell', price: '150', size: '2', fee: '0.3', feeCurrency: 'USDT', createdAt: t, tradeId: 'ku1', orderId: 'o1' }] : [] } });
  }
  if (u.hostname === 'api.bitget.com') {
    if (H(init, 'ACCESS-SIGN') !== hmac('base64', H(init, 'ACCESS-TIMESTAMP') + 'GET' + pq) || H(init, 'ACCESS-PASSPHRASE') !== KEYS.passphrase) { state.badSig++; return json({ code: '40009', msg: 'sign signature error' }, 400); }
    if (u.pathname === '/api/v2/spot/account/assets') return json({ code: '00000', data: [{ coin: 'ADA', available: '100', frozen: '0', locked: '0' }, { coin: 'USDT', available: '50', frozen: '0', locked: '0' }] });
    if (u.pathname === '/api/v2/spot/trade/fills' && u.searchParams.get('symbol') === 'ADAUSDT') return json({ code: '00000', data: [{ symbol: 'ADAUSDT', side: 'buy', priceAvg: '0.5', size: '100', feeDetail: { totalFee: '-0.2', feeCoin: 'BGB' }, cTime: String(ms('2025-02-20T09:00:00Z')), tradeId: 'bg1' }] });
    return json({ code: '40034', msg: 'Parameter symbol does not exist' }, 400);
  }
  return new Response('', { status: 500 });
}
module.exports = { KEYS, state, upstream, ms };
