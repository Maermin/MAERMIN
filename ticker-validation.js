// ============================================================================
// MAERMIN — Ticker Validation & Normalisation  (window.MaerminTickers)
// ----------------------------------------------------------------------------
// Feature #4: dividends were missed because stored symbols come in many forms
// (Yahoo suffixes "SAP.DE", class shares "BRK.B" vs "BRK-B", or human names),
// while the dividend provider expects a specific ticker format. This is the
// single validation layer that normalises a stored symbol to a canonical ticker
// and tells callers whether it can be resolved + on which exchange.
//
// Pure + unit-tested (test/tickers.test.js). The dividend service runs every
// stock symbol through normalizeForDividends() before lookup.
// ============================================================================
(function () {
  'use strict';

  // Yahoo/FMP exchange suffixes → human label. Used to tell an exchange suffix
  // ("SAP.DE") apart from a share-class letter ("BRK.B").
  var EXCHANGE_SUFFIXES = {
    DE: 'Xetra', F: 'Frankfurt', BE: 'Berlin', SG: 'Stuttgart', MU: 'Munich', HM: 'Hamburg', DU: 'Düsseldorf',
    L: 'London', PA: 'Paris', AS: 'Amsterdam', BR: 'Brussels', MI: 'Milan', MC: 'Madrid', LS: 'Lisbon',
    VI: 'Vienna', SW: 'SIX Swiss', ST: 'Stockholm', HE: 'Helsinki', CO: 'Copenhagen', OL: 'Oslo', IC: 'Iceland',
    TO: 'Toronto', V: 'TSX-V', HK: 'Hong Kong', T: 'Tokyo', AX: 'Australia', NZ: 'New Zealand',
    SI: 'Singapore', KS: 'Korea', TW: 'Taiwan', JO: 'Johannesburg', SA: 'São Paulo', MX: 'Mexico', NS: 'India NSE', BO: 'India BSE'
  };

  function isExchangeSuffix(s) { return Object.prototype.hasOwnProperty.call(EXCHANGE_SUFFIXES, s); }

  // Renamed/re-tickered companies — the "second converter". A stored symbol may
  // be the OLD ticker while the data provider (Yahoo) only knows the new one, so
  // a lookup under the stored symbol 404s (this is why FISV charts/dividends
  // failed). Mapped to the current ticker before resolution. Keep conservative:
  // only unambiguous, well-known one-to-one renames.
  // (Fiserv is no longer here: it trades as FISV again and Yahoo 404s "FI".)
  var RENAMES = {
    FB:   'META',   // Facebook → Meta
    RTN:  'RTX',    // Raytheon → RTX
    ANTM: 'ELV',    // Anthem → Elevance Health
    WLTW: 'WTW',    // Willis Towers Watson
    SQ:   'XYZ',    // Block → XYZ (2025)
    GOOGL: 'GOOGL'  // explicit no-op (kept for clarity; GOOG/GOOGL both valid)
  };
  function applyRename(sym) { return Object.prototype.hasOwnProperty.call(RENAMES, sym) ? RENAMES[sym] : sym; }

  // Break a raw symbol into parts. Recognises exchange suffix vs share class.
  function parseSymbol(raw) {
    var s = String(raw || '').trim().toUpperCase();
    var result = { raw: raw, clean: s, base: s, exchangeSuffix: null, exchange: null, shareClass: null, hasSpace: /\s/.test(s) };
    if (!s) return result;

    // Split on the LAST '.' or '-' separator.
    var m = /^([A-Z0-9]+)[.\-]([A-Z0-9]{1,4})$/.exec(s);
    if (m) {
      var base = m[1], suffix = m[2];
      result.base = base;
      if (isExchangeSuffix(suffix)) {
        result.exchangeSuffix = suffix;
        result.exchange = EXCHANGE_SUFFIXES[suffix];
      } else if (suffix.length <= 2) {
        result.shareClass = suffix; // e.g. BRK.B / BRK-B
      } else {
        // Unknown longer suffix — keep base only, treat suffix as unknown exchange.
        result.exchangeSuffix = suffix;
      }
    }
    return result;
  }

  // Canonical ticker for the dividend provider:
  //   - US/plain:       AAPL            -> AAPL
  //   - exchange suffix: SAP.DE         -> SAP.DE   (kept; provider is exchange-aware)
  //   - share class:    BRK.B / BRK-B   -> BRK-B    (provider uses the dash form)
  function normalizeForDividends(raw) {
    var p = parseSymbol(raw);
    if (!p.clean) return '';
    if (p.shareClass) return applyRename(p.base) + '-' + p.shareClass;
    if (p.exchangeSuffix) return applyRename(p.base) + '.' + p.exchangeSuffix;
    return applyRename(p.base);
  }

  // Only equities/ETFs pay dividends in this app's data model.
  function isDividendEligible(category) {
    return category === 'stocks' || category === undefined || category === null;
  }

  // Validate a symbol for dividend resolution. Returns a structured verdict the
  // UI can use to flag unrecognised holdings.
  function validate(raw, category) {
    var p = parseSymbol(raw);
    if (category && !isDividendEligible(category)) {
      return { valid: false, normalized: null, reason: 'not-an-equity', exchange: null };
    }
    if (!p.clean) return { valid: false, normalized: null, reason: 'empty', exchange: null };
    if (p.hasSpace) return { valid: false, normalized: null, reason: 'looks-like-name', exchange: null };
    if (!/^[A-Z0-9]{1,6}([.\-][A-Z0-9]{1,4})?$/.test(p.clean)) {
      return { valid: false, normalized: null, reason: 'not-ticker-format', exchange: null };
    }
    return { valid: true, normalized: normalizeForDividends(raw), reason: 'ok', exchange: p.exchange || 'US/Default' };
  }

  // Validate a whole portfolio's stock symbols; surfaces what won't resolve.
  function validatePortfolio(portfolio) {
    var stocks = (portfolio && portfolio.stocks) || [];
    var valid = [], invalid = [];
    stocks.forEach(function (s) {
      var v = validate(s.symbol || s.name, 'stocks');
      (v.valid ? valid : invalid).push({ symbol: s.symbol || s.name, name: s.name, verdict: v });
    });
    return { valid: valid, invalid: invalid, total: stocks.length, unresolved: invalid.length };
  }

  // ---- CS2 skin names --------------------------------------------------------
  // THE single normalising place for Steam market_hash_name lookups. Steam is
  // exact about the name: the "Souvenir " / "StatTrak™ " prefix with one
  // space, single spaces around the "|", and the wear in parentheses. The
  // picker delivers exact names; this guards manual entry and any later
  // whitespace damage so the price lookup, the history fetch and the picker
  // all hit the same listing. Applied at LOOKUP time - stored data stays as-is.
  var WEAR_NAMES = ['Factory New', 'Minimal Wear', 'Field-Tested', 'Well-Worn', 'Battle-Scarred'];

  // Steam spelling of names that plain title case gets wrong.
  var SKIN_WORDS = {};
  ['AK-47', 'AWP', 'AUG', 'FAMAS', 'M4A4', 'M4A1-S', 'M249', 'MAC-10', 'MAG-7', 'MP5-SD', 'MP7', 'MP9',
    'P2000', 'P250', 'P90', 'PP-Bizon', 'SG', 'SSG', 'UMP-45', 'USP-S', 'XM1014', 'CZ75-Auto', 'G3SG1',
    'SCAR-20', 'Glock-18', 'Five-SeveN', 'Tec-9', 'R8', 'AR', 'StatTrak™', 'CS:GO', 'CS20', 'CS2', 'ESL',
    'DreamHack', 'EMS', 'MLG', 'PGL', 'IEM', 'BLAST', 'ELEAGUE', 'FACEIT', 'HLTV', 'NaVi', 'G2', 'FaZe',
    'MOUZ', 'NIP', 'TSM', 'VP', 'CT', 'T', 'X-Ray', 'GO', 'II', 'III', 'IV', 'V2']
    .forEach(function (w) { SKIN_WORDS[w.toUpperCase()] = w; });
  var SKIN_SMALL = { OF: 'of', THE: 'the', AND: 'and', IN: 'in', ON: 'on', A: 'a', TO: 'to' };
  // An ALL-CAPS market name (an import upper-cased it like a stock ticker) back
  // to Steam's spelling: Steam answers nothing for "AK-47 | FUEL INJECTOR
  // (FIELD-TESTED)". Title case with Steam's weapon/brand spellings; names
  // that already contain a lower-case letter are left alone.
  function restoreSkinCase(s) {
    if (!/[A-Z]/.test(s) || /[a-z]/.test(s)) return s;
    return s.replace(/[^\s|()]+/g, function (word, offset) {
      var up = word.toUpperCase();
      // Start of a part: the name, after "|" or "(", or after a ★ / StatTrak™ prefix.
      var before = s.slice(0, offset).replace(/(★|STATTRAK™|SOUVENIR)\s*/g, '').trim();
      var partStart = !before || /[|(]$/.test(before);
      if (SKIN_WORDS[up]) return SKIN_WORDS[up];
      if (!partStart && SKIN_SMALL[up]) return SKIN_SMALL[up];
      return word.toLowerCase().replace(/(^|-)([a-zà-ÿ])/g, function (m, sep, ch) { return sep + ch.toUpperCase(); });
    });
  }

  function normalizeSkinName(raw) {
    var s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    if (!s) return '';
    s = restoreSkinCase(s);
    // Prefix casing (Steam: "Souvenir AWP | ...", "StatTrak™ AK-47 | ...").
    s = s.replace(/^souvenir\s+/i, 'Souvenir ');
    s = s.replace(/^stattrak(?:™|\(tm\)|tm)?\s+/i, 'StatTrak™ ');
    // Exactly one space around the weapon/finish separator.
    s = s.replace(/\s*\|\s*/, ' | ');
    // Wear tier: canonical casing + exactly one space before the parenthesis.
    var wearMatch = s.match(/\(([^)]+)\)\s*$/);
    if (wearMatch) {
      var canonical = null;
      for (var i = 0; i < WEAR_NAMES.length; i++) {
        if (WEAR_NAMES[i].toLowerCase() === wearMatch[1].trim().toLowerCase()) { canonical = WEAR_NAMES[i]; break; }
      }
      if (canonical) s = s.replace(/\s*\([^)]+\)\s*$/, ' (' + canonical + ')');
    }
    return s;
  }

  // Does a stored symbol look like a CS2 market name ("AK-47 | Redline
  // (Field-Tested)", "★ Nomad Knife", "Fever Case", "Sticker | ...")? Market
  // tickers never contain spaces, "|", "★" or "™", so such a name filed under
  // stocks would only flood the Yahoo routes with 404s.
  var SKIN_ITEM_WORDS = /\b(case|capsule|package|sticker|patch|graffiti|music kit|pin|key|souvenir|stattrak|knife|gloves|wraps|agent|charm)\b/i;
  function looksLikeSkin(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return false;
    if (/[|★™]/.test(s)) return true;
    if (/\((factory new|minimal wear|field-tested|well-worn|battle-scarred)\)\s*$/i.test(s)) return true;
    return /\s/.test(s) && SKIN_ITEM_WORDS.test(s);
  }

  // Could this be a market symbol Yahoo understands (AAPL, SAP.DE, BRK-B,
  // ^GDAXI, EURUSD=X, GC=F, 0700.HK, an ISIN)? Anything else is not worth a
  // request to the quote, fundamentals or profile routes.
  function isMarketSymbol(raw) {
    var s = String(raw == null ? '' : raw).trim();
    return /^[A-Za-z0-9^][A-Za-z0-9.\-=^_]{0,23}$/.test(s);
  }

  // Common crypto tickers -> CoinGecko id. Crypto is priced per id
  // ("bitcoin"); the exchange sync, imports and older data store tickers
  // ("BTC"), which CoinGecko does not know, so the lookup maps them.
  var COINGECKO_IDS = {
    BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', ADA: 'cardano', XRP: 'ripple', DOGE: 'dogecoin',
    DOT: 'polkadot', LTC: 'litecoin', BCH: 'bitcoin-cash', LINK: 'chainlink', MATIC: 'matic-network',
    POL: 'polygon-ecosystem-token', AVAX: 'avalanche-2', BNB: 'binancecoin', TRX: 'tron', UNI: 'uniswap',
    ATOM: 'cosmos', ETC: 'ethereum-classic', XLM: 'stellar', ALGO: 'algorand', VET: 'vechain',
    ICP: 'internet-computer', FIL: 'filecoin', EGLD: 'elrond-erd-2', THETA: 'theta-token', EOS: 'eos',
    XMR: 'monero', NEO: 'neo', DASH: 'dash', ZEC: 'zcash', AAVE: 'aave', COMP: 'compound-governance-token',
    MKR: 'maker', SNX: 'havven', CRV: 'curve-dao-token', YFI: 'yearn-finance', SUSHI: 'sushi',
    '1INCH': '1inch', BAT: 'basic-attention-token', GRT: 'the-graph', ENJ: 'enjincoin',
    MANA: 'decentraland', SAND: 'the-sandbox', AXS: 'axie-infinity', CHZ: 'chiliz', GALA: 'gala',
    IMX: 'immutable-x', APE: 'apecoin', LRC: 'loopring', DYDX: 'dydx-chain', OP: 'optimism',
    ARB: 'arbitrum', PEPE: 'pepe', SHIB: 'shiba-inu', WLD: 'worldcoin-wld', SUI: 'sui', SEI: 'sei-network',
    APT: 'aptos', NEAR: 'near', TON: 'the-open-network', HBAR: 'hedera-hashgraph', KAS: 'kaspa',
    INJ: 'injective-protocol', RNDR: 'render-token', RENDER: 'render-token', FET: 'fetch-ai',
    XTZ: 'tezos', IOTA: 'iota', MIOTA: 'iota', QNT: 'quant-network', FTM: 'fantom', S: 'sonic-3',
    KSM: 'kusama', CRO: 'crypto-com-chain', OKB: 'okb', LEO: 'leo-token', XDC: 'xdce-crowd-sale',
    STX: 'blockstack', TIA: 'celestia', JUP: 'jupiter-exchange-solana', BONK: 'bonk', WIF: 'dogwifcoin',
    FLOKI: 'floki', ONDO: 'ondo-finance', ENA: 'ethena', PYTH: 'pyth-network', HYPE: 'hyperliquid',
    TAO: 'bittensor', CAKE: 'pancakeswap-token', RUNE: 'thorchain', ZRX: '0x', KNC: 'kyber-network-crystal',
    BAL: 'balancer', LDO: 'lido-dao', RPL: 'rocket-pool', GNO: 'gnosis', XEM: 'nem', WAVES: 'waves',
    ZIL: 'zilliqa', ICX: 'icon', ONT: 'ontology', QTUM: 'qtum', BTT: 'bittorrent', HOT: 'holotoken',
    NEXO: 'nexo', BEST: 'bitpanda-ecosystem-token', PAXG: 'pax-gold', XAUT: 'tether-gold',
    WBTC: 'wrapped-bitcoin', STETH: 'staked-ether', WETH: 'weth',
    USDT: 'tether', USDC: 'usd-coin', DAI: 'dai', BUSD: 'binance-usd', FDUSD: 'first-digital-usd',
    EURC: 'euro-coin', PYUSD: 'paypal-usd', USDE: 'ethena-usde', XBT: 'bitcoin'
  };
  /** Stored crypto symbol -> CoinGecko id ("BTC" / "btc" -> "bitcoin"; an id stays as it is). */
  function coinGeckoId(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    var up = s.toUpperCase();
    if (Object.prototype.hasOwnProperty.call(COINGECKO_IDS, up)) return COINGECKO_IDS[up];
    return s.toLowerCase();
  }

  // Transactions filed under stocks (or crypto) whose symbol is a CS2 market
  // name: [{ symbol, category, count }], one entry per stored symbol.
  function findMisfiledSkins(transactions) {
    var by = {};
    (Array.isArray(transactions) ? transactions : []).forEach(function (tx) {
      if (!tx || (tx.category !== 'stocks' && tx.category !== 'crypto')) return;
      if (!looksLikeSkin(tx.symbol)) return;
      var k = tx.category + '|' + tx.symbol;
      by[k] = by[k] || { symbol: tx.symbol, category: tx.category, count: 0 };
      by[k].count++;
    });
    return Object.keys(by).map(function (k) { return by[k]; });
  }

  // Move those transactions to the skins category. nameMap { stored -> Steam
  // name } restores the exact market name (imports upper-cased it); without
  // an entry the name is only re-spaced (normalizeSkinName). Returns
  // { transactions, moved } - a new array, the input is not changed.
  function repairMisfiledSkins(transactions, nameMap) {
    nameMap = nameMap || {};
    var moved = 0;
    var out = (Array.isArray(transactions) ? transactions : []).map(function (tx) {
      if (!tx || (tx.category !== 'stocks' && tx.category !== 'crypto') || !looksLikeSkin(tx.symbol)) return tx;
      moved++;
      var name = nameMap[tx.symbol] || normalizeSkinName(tx.symbol);
      var next = {};
      Object.keys(tx).forEach(function (k) { next[k] = tx[k]; });
      next.category = 'skins';
      next.symbol = name;
      if (!next.symbolName || next.symbolName === tx.symbol) next.symbolName = name;
      // Steam quotes skins in USD; a stock import set the currency from the file.
      if (!next.currency) next.currency = 'USD';
      return next;
    });
    return { transactions: out, moved: moved };
  }

  var api = {
    EXCHANGE_SUFFIXES: EXCHANGE_SUFFIXES,
    RENAMES: RENAMES,
    COINGECKO_IDS: COINGECKO_IDS,
    coinGeckoId: coinGeckoId,
    looksLikeSkin: looksLikeSkin,
    isMarketSymbol: isMarketSymbol,
    findMisfiledSkins: findMisfiledSkins,
    repairMisfiledSkins: repairMisfiledSkins,
    parseSymbol: parseSymbol,
    normalizeForDividends: normalizeForDividends,
    isDividendEligible: isDividendEligible,
    normalizeSkinName: normalizeSkinName,
    validate: validate,
    validatePortfolio: validatePortfolio
  };
  if (typeof window !== 'undefined') window.MaerminTickers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
