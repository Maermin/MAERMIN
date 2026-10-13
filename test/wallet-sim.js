// Synthetic block explorers (made-up data) for P5-3.6: mempool.space
// (Bitcoin), Blockscout (EVM chains) and the Solana RPC, as the Worker's
// `action=wallet` calls them. Used by test/worker-wallet.test.js and e2e.
'use strict';
const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const EVM = '0xabababababababababababababababababababab';
const OTHER = '0x1111111111111111111111111111111111111111';
const SOL = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const calls = [];
const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { 'Content-Type': 'application/json' } });

async function upstream(url, init) {
  const u = new URL(url);
  calls.push(u.hostname + u.pathname);
  if (u.hostname === 'mempool.space') {
    if (u.pathname === '/api/address/' + BTC) return json({ address: BTC, chain_stats: { funded_txo_sum: 250000000, spent_txo_sum: 150000000 }, mempool_stats: { funded_txo_sum: 0, spent_txo_sum: 0 } });
    if (u.pathname === '/api/address/' + BTC + '/txs') return json([
      { txid: 'b2', status: { confirmed: true, block_time: 1736000000 }, fee: 10000,
        vin: [{ prevout: { scriptpubkey_address: BTC, value: 150000000 } }], vout: [{ scriptpubkey_address: 'bc1qother000000000000000000000000000000', value: 49990000 }, { scriptpubkey_address: BTC, value: 100000000 }] },
      { txid: 'b1', status: { confirmed: true, block_time: 1700000000 }, fee: 2000,
        vin: [{ prevout: { scriptpubkey_address: 'bc1qother000000000000000000000000000000', value: 150002000 } }], vout: [{ scriptpubkey_address: BTC, value: 150000000 }] }]);
    return json({ error: 'not found' }, 404);
  }
  if (u.hostname === 'eth.blockscout.com') {
    const base = '/api/v2/addresses/' + EVM;
    if (u.pathname === base) return json({ hash: EVM, coin_balance: '1500000000000000000' });
    if (u.pathname === base + '/token-balances') return json([
      { token: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', name: 'USD Coin', decimals: '6', type: 'ERC-20' }, value: '2500000000' },
      { token: { address: '0x2', symbol: 'NFT', name: 'Some NFT', decimals: null, type: 'ERC-721' }, value: '1' },
      { token: { address: '0x3', symbol: 'ＦＲＥＥ', name: 'spam', decimals: '18', type: 'ERC-20' }, value: '1000000000000000000000' },
      { token: { address: '0x4', symbol: 'ZERO', name: 'empty', decimals: '18', type: 'ERC-20' }, value: '0' }]);
    if (u.pathname === base + '/transactions') return json({ items: [
      { hash: '0xe2', timestamp: '2025-02-10T10:00:00.000000Z', from: { hash: EVM }, to: { hash: OTHER }, value: '500000000000000000', fee: { value: '2100000000000000' } },
      { hash: '0xe1', timestamp: '2025-01-05T09:00:00.000000Z', from: { hash: OTHER }, to: { hash: EVM }, value: '2000000000000000000', fee: { value: '21000000000000' } }] });
    return json({ message: 'Not found' }, 404);
  }
  if (/\.blockscout\.com$/.test(u.hostname)) return json({ message: 'Not found' }, 404); // a never-used address
  if (u.hostname === 'api.mainnet-beta.solana.com') {
    const body = JSON.parse(init.body);
    if (body.method === 'getBalance' && body.params[0] === SOL) return json({ jsonrpc: '2.0', id: 1, result: { context: { slot: 1 }, value: 2500000000 } });
    return json({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Invalid param' } });
  }
  return new Response('', { status: 500 });
}

module.exports = { BTC, EVM, OTHER, SOL, calls, upstream };
