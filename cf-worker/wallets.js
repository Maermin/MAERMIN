// P5-3.6: read-only balances (and, where the explorer has them, recent
// transactions) of PUBLIC crypto addresses, for `GET /?action=wallet`. No API
// key, no signing: the explorers see only the address, and they see the
// user's Worker instead of the user's browser.
//
//   btc                         mempool.space   balance + last 25 transactions
//   eth arb op base polygon     Blockscout      native balance, ERC-20 tokens, last 50 transactions
//   sol                         Solana RPC      SOL balance
//
// → { chain, address, native: { symbol, amount }, tokens: [{ symbol, name, amount, contract }],
//     txs: [{ hash, date, direction: 'in'|'out'|'self', amount, symbol, fee }], source }
export const WALLET_CHAINS = {
  btc: { name: 'Bitcoin', symbol: 'BTC', kind: 'btc' },
  eth: { name: 'Ethereum', symbol: 'ETH', kind: 'evm', host: 'eth.blockscout.com' },
  arb: { name: 'Arbitrum One', symbol: 'ETH', kind: 'evm', host: 'arbitrum.blockscout.com' },
  op: { name: 'Optimism', symbol: 'ETH', kind: 'evm', host: 'optimism.blockscout.com' },
  base: { name: 'Base', symbol: 'ETH', kind: 'evm', host: 'base.blockscout.com' },
  polygon: { name: 'Polygon PoS', symbol: 'POL', kind: 'evm', host: 'polygon.blockscout.com' },
  sol: { name: 'Solana', symbol: 'SOL', kind: 'sol' }
};

export function validAddress(chain, address) {
  const c = WALLET_CHAINS[chain];
  const a = String(address || '').trim();
  if (!c) return false;
  if (c.kind === 'btc') return /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/.test(a);
  if (c.kind === 'evm') return /^0x[0-9a-fA-F]{40}$/.test(a);
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
}

// a big integer string with `decimals` places → Number (display precision)
export function units(raw, decimals) {
  const s = String(raw == null ? '0' : raw).trim();
  if (!/^\d+$/.test(s)) return 0;
  const d = Math.max(0, Math.min(36, Number(decimals) || 0));
  const padded = s.padStart(d + 1, '0');
  const whole = padded.slice(0, padded.length - d), frac = d ? padded.slice(padded.length - d) : '';
  return Number(whole + (frac ? '.' + frac.slice(0, 18) : ''));
}
const round8 = (n) => Math.round(n * 1e8) / 1e8;
const isoOfSec = (s) => (s ? new Date(s * 1000).toISOString().slice(0, 10) : null);

export function btcFromMempool(address, info, txs) {
  const cs = (info && info.chain_stats) || {};
  const sats = (Number(cs.funded_txo_sum) || 0) - (Number(cs.spent_txo_sum) || 0);
  const out = { chain: 'btc', address, native: { symbol: 'BTC', amount: round8(sats / 1e8) }, tokens: [], txs: [], source: 'mempool.space' };
  (Array.isArray(txs) ? txs : []).slice(0, 25).forEach((t) => {
    let inSum = 0, outSum = 0;
    (t.vout || []).forEach((v) => { if (v && v.scriptpubkey_address === address) inSum += Number(v.value) || 0; });
    (t.vin || []).forEach((v) => { if (v && v.prevout && v.prevout.scriptpubkey_address === address) outSum += Number(v.prevout.value) || 0; });
    const net = inSum - outSum;
    out.txs.push({ hash: String(t.txid || ''), date: t.status && t.status.confirmed ? isoOfSec(t.status.block_time) : null,
      direction: net > 0 ? 'in' : net < 0 ? 'out' : 'self', amount: round8(Math.abs(net) / 1e8), symbol: 'BTC', fee: outSum > 0 ? round8((Number(t.fee) || 0) / 1e8) : 0 });
  });
  return out;
}

export function evmFromBlockscout(chain, address, info, tokens, txs) {
  const c = WALLET_CHAINS[chain];
  const me = address.toLowerCase();
  const out = { chain, address, native: { symbol: c.symbol, amount: units(info && info.coin_balance, 18) }, tokens: [], txs: [], source: c.host };
  (Array.isArray(tokens) ? tokens : []).forEach((b) => {
    const tk = (b && b.token) || {};
    if (String(tk.type || '').toUpperCase() !== 'ERC-20') return;
    const amount = units(b.value, tk.decimals);
    const symbol = String(tk.symbol || '').trim().slice(0, 16);
    if (!(amount > 0) || !symbol || /[^\x20-\x7e]/.test(symbol)) return;
    out.tokens.push({ symbol: symbol.toUpperCase(), name: String(tk.name || '').slice(0, 60), amount, contract: String(tk.address || tk.address_hash || '').toLowerCase() });
  });
  out.tokens = out.tokens.slice(0, 50);
  const items = txs && Array.isArray(txs.items) ? txs.items : [];
  items.slice(0, 50).forEach((t) => {
    const from = String((t.from && t.from.hash) || '').toLowerCase(), to = String((t.to && t.to.hash) || '').toLowerCase();
    const direction = from === me && to === me ? 'self' : to === me ? 'in' : 'out';
    out.txs.push({ hash: String(t.hash || ''), date: String(t.timestamp || '').slice(0, 10) || null, direction, amount: units(t.value, 18), symbol: c.symbol,
      fee: from === me ? units(t.fee && t.fee.value, 18) : 0 });
  });
  return out;
}

export function solFromRpc(address, balance) {
  const lamports = balance && balance.result ? Number(balance.result.value) || 0 : 0;
  return { chain: 'sol', address, native: { symbol: 'SOL', amount: round8(lamports / 1e9) }, tokens: [], txs: [], source: 'solana-rpc' };
}

// fetchJson(url, init) → parsed JSON, or { __status } on an HTTP error
export async function walletSnapshot(chain, address, fetchJson) {
  const c = WALLET_CHAINS[chain];
  if (c.kind === 'btc') {
    const base = 'https://mempool.space/api/address/' + address;
    const [info, txs] = await Promise.all([fetchJson(base), fetchJson(base + '/txs')]);
    if (info && info.__status) throw Object.assign(new Error('explorer'), { status: info.__status });
    return btcFromMempool(address, info, txs && txs.__status ? [] : txs);
  }
  if (c.kind === 'evm') {
    const base = 'https://' + c.host + '/api/v2/addresses/' + address;
    const [info, tokens, txs] = await Promise.all([fetchJson(base), fetchJson(base + '/token-balances'), fetchJson(base + '/transactions')]);
    // a never-used address is a 404 on Blockscout: zero balance, not an error
    if (info && info.__status && info.__status !== 404) throw Object.assign(new Error('explorer'), { status: info.__status });
    return evmFromBlockscout(chain, address, info && info.__status ? {} : info, tokens && tokens.__status ? [] : tokens, txs && txs.__status ? {} : txs);
  }
  const bal = await fetchJson('https://api.mainnet-beta.solana.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] }) });
  if (bal && (bal.__status || bal.error)) throw Object.assign(new Error('explorer'), { status: bal.__status || 502 });
  return solFromRpc(address, bal);
}
