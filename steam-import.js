// ============================================================================
// MAERMIN — Steam inventory import  (window.MaerminSteamImport)
// ----------------------------------------------------------------------------
// P2-7. The CS2 items of a public Steam inventory become buy transactions
// (category skins), through an editable preview like the PDF import:
//   1. the user enters a SteamID64, profile URL or custom URL name; the Worker
//      reads the inventory (?action=steaminv). Steam throttles cloud IPs, so
//      the user can instead open the inventory JSON in their own browser and
//      paste it here - both paths end in the same item list;
//   2. one row per item name with the count, the purchase price pre-filled
//      with today's price (Steam Market list, USD -> EUR) and the date
//      (today), all editable; items without a price start unticked;
//   3. import books one buy per row. Each transaction keeps the asset ids it
//      covers (steamAssetIds), so a re-import only offers items not imported
//      before. Nothing is ever sold: items gone from the inventory stay.
// Pure helpers are Node-tested in test/steam-import.test.js.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function round2(v) { return Math.round(v * 100) / 100; }

  // SteamID64 from an id or a profiles/ URL (custom URL names need the Worker).
  function steamId64(raw) {
    // Profile links may go on (".../inventory/"): only the id counts.
    var m = String(raw == null ? '' : raw).trim().match(/^(?:(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/profiles\/)?(\d{17})(?:[/?#].*)?$/i);
    return m ? m[1] : null;
  }
  function inventoryUrl(id) { return 'https://steamcommunity.com/inventory/' + id + '/730/2?l=english&count=2000'; }

  // Inventory JSON (one page or several, as Steam returns it) or the Worker's
  // { items } -> [{ assetid, name, marketable }]. Same rule as the Worker.
  function itemsFrom(data) {
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch (e) { return null; } }
    if (!data) return null;
    if (Array.isArray(data.items)) return data.items.filter(function (i) { return i && i.assetid && i.name; });
    var pages = Array.isArray(data) ? data : [data];
    if (!pages.some(function (p) { return p && Array.isArray(p.assets); })) return null;
    var out = [];
    pages.forEach(function (p) {
      if (!p || !Array.isArray(p.assets)) return;
      var desc = {};
      (p.descriptions || []).forEach(function (d) { if (d) desc[d.classid + '_' + (d.instanceid || '0')] = d; });
      p.assets.forEach(function (a) {
        var d = a && desc[a.classid + '_' + (a.instanceid || '0')];
        if (!d || !d.market_hash_name) return;
        var n = Math.max(1, parseInt(a.amount, 10) || 1);
        for (var i = 0; i < n; i++) out.push({ assetid: String(a.assetid) + (n > 1 ? '#' + i : ''), name: String(d.market_hash_name), marketable: d.marketable === 1 || d.marketable === true });
      });
    });
    return out;
  }

  // Asset ids already booked (any transaction's steamAssetIds).
  function importedIds(transactions) {
    var set = {};
    (transactions || []).forEach(function (tx) {
      (tx && Array.isArray(tx.steamAssetIds) ? tx.steamAssetIds : []).forEach(function (id) { set[String(id)] = true; });
    });
    return set;
  }

  // Items not imported yet, one row per name: { name, assetIds, qty, marketable }.
  function newRows(items, imported) {
    imported = imported || {};
    var by = Object.create(null), order = []; // item names are imported text (SEC-023)
    (items || []).forEach(function (it) {
      if (!it || imported[String(it.assetid)]) return;
      if (!by[it.name]) { by[it.name] = { name: it.name, assetIds: [], qty: 0, marketable: false }; order.push(it.name); }
      by[it.name].assetIds.push(String(it.assetid));
      by[it.name].qty++;
      if (it.marketable) by[it.name].marketable = true;
    });
    return order.sort(function (a, b) { return a.localeCompare(b); }).map(function (n) { return by[n]; });
  }

  // Preview rows -> buy transactions. row: { name, assetIds, qty, price (EUR), date, include }.
  function toTransactions(rows, opts) {
    opts = opts || {};
    var stamp = opts.now || Date.now();
    var portfolioId = opts.portfolioId || 'default';
    return (rows || []).filter(function (r) { return r && r.include && r.qty > 0; }).map(function (r, i) {
      return { id: 'steam_' + stamp.toString(36) + '_' + i, type: 'buy', category: 'skins', symbol: r.name,
        quantity: r.qty, price: round2(Math.max(0, num(r.price))), fees: 0, currency: 'EUR', date: r.date,
        portfolioId: portfolioId, notes: __('stNote', 'Steam inventory import'), source: 'steam-import', steamAssetIds: r.assetIds.slice() };
    });
  }

  // ---- panel (Data → Steam) ---------------------------------------------------
  // props: { theme, workerUrl, transactions, exchangeRate, onImport(txs), addToast, portfolioId }
  function Panel(props) {
    var React = (typeof window !== 'undefined') ? window.React : null;
    if (!React) return null;
    var e = React.createElement, useState = React.useState;
    // R4.6: Card, shared inputs and buttons, the shared table look
    var UIC = window.MaerminComponents;
    var I = window.MaerminI18n;
    var toast = props.addToast || function () {};
    var p0 = useState(''); var profile = p0[0], setProfile = p0[1];
    var b0 = useState(false); var busy = b0[0], setBusy = b0[1];
    var r0 = useState(null); var rows = r0[0], setRows = r0[1];
    var m0 = useState(''); var msg = m0[0], setMsg = m0[1];
    var x0 = useState(false); var showPaste = x0[0], setShowPaste = x0[1];
    var t0 = useState(''); var pasted = t0[0], setPasted = t0[1];
    var INPUT = ['ui-input', 'ui-input--sm'].join(' ');

    function preview(items) {
      if (!items) { setMsg(__('stBadJson', 'That is not a Steam inventory (JSON with "assets" and "descriptions").')); return; }
      var fresh = newRows(items, importedIds(props.transactions));
      var today = (window.MaerminUtils && window.MaerminUtils.todayISO) ? window.MaerminUtils.todayISO() : (typeof window !== 'undefined' && window.MaerminUtils ? window.MaerminUtils : require('./utils.js')).todayISO();
      var SP = window.MaerminSkinPrices, rate = num(props.exchangeRate) || 0;
      var fill = function (index) {
        setRows(fresh.map(function (r) {
          var usd = index && SP && SP.priceFor ? num(SP.priceFor(index, r.name)) : 0;
          var eur = usd > 0 && rate > 0 ? round2(usd * rate) : 0;
          return Object.assign({}, r, { price: eur, date: today, include: eur > 0 });
        }));
        setMsg(fresh.length ? __('stFound', '{n} new {n:item|items} ({k} {k:name|names}) not imported before.', { n: fresh.reduce(function (s, r) { return s + r.qty; }, 0), k: fresh.length })
          : __('stNothingNew', 'Every item of this inventory is already imported.'));
      };
      if (SP && SP.load && props.workerUrl) SP.load(props.workerUrl).then(fill, function () { fill(null); }); else fill(null);
    }

    function load() {
      var url = String(props.workerUrl || '').trim().replace(/\/$/, '');
      if (!profile.trim()) return;
      if (!url) { setMsg(__('stNoWorker', 'Loading needs your Worker URL (API Settings). You can paste the inventory instead.')); setShowPaste(true); return; }
      setBusy(true); setMsg(''); setRows(null);
      fetch(url + '?action=steaminv&profile=' + encodeURIComponent(profile.trim()))
        .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
        .then(function (o) {
          setBusy(false);
          if (o.status === 200 && o.j && Array.isArray(o.j.items)) { preview(o.j.items); return; }
          var why = o.status === 403 ? __('stPrivate', 'The inventory is private. Set it to public in your Steam privacy settings and try again.')
            : o.status === 429 ? __('stLimited', 'Steam refused the request from the Worker (rate limit). Paste the inventory instead (below).')
            : o.status === 404 ? __('stNotFound', 'No Steam profile with that name.')
            : o.status === 400 && o.j && /Unknown action/.test(o.j.error || '') ? __('stOldWorker', 'Your Worker is older than this feature. Update it (API Settings) or paste the inventory instead.')
            : __('stFailed', 'Loading failed ({msg}). Paste the inventory instead (below).', { msg: (o.j && o.j.error) || ('HTTP ' + o.status) });
          setMsg(why); if (o.status !== 403 && o.status !== 404) setShowPaste(true);
        }, function () { setBusy(false); setMsg(__('stFailed', 'Loading failed ({msg}). Paste the inventory instead (below).', { msg: 'network' })); setShowPaste(true); });
    }

    function edit(i, patch) { setRows(rows.map(function (r, j) { return j === i ? Object.assign({}, r, patch) : r; })); }
    function doImport() {
      var txs = toTransactions(rows, { portfolioId: props.portfolioId });
      if (!txs.length) return;
      if (props.onImport) props.onImport(txs);
      toast(__('stImported', '{n} {n:item|items} imported as {k} {k:transaction|transactions}', { n: txs.reduce(function (s, t) { return s + t.quantity; }, 0), k: txs.length }), 'success');
      setRows(null); setMsg('');
    }
    var id64 = steamId64(profile);
    var chosen = rows ? rows.filter(function (r) { return r.include; }) : [];

    return e(UIC.Card, { 'data-testid': 'steam-import', className: 'ui-sync', headingLevel: 'h3', title: __('stTitle', 'Steam inventory (CS2)'),
      subtitle: __('stIntro', 'Imports the CS2 items of a public Steam inventory as purchases. You check every row before anything is booked; a later import only offers items not imported before, and nothing is ever sold.') },
      e('div', { className: 'ui-ca-add' },
        e('input', { type: 'text', value: profile, spellCheck: false, 'aria-label': __('stProfile', 'Steam profile'),
          placeholder: __('stProfilePh', 'SteamID64, profile URL or custom URL name'),
          onChange: function (ev) { setProfile(ev.target.value); }, onKeyDown: function (ev) { if (ev.key === 'Enter') load(); }, className: 'ui-input' }),
        e(UIC.Button, { variant: 'primary', onClick: load, disabled: !profile.trim(), loading: busy }, busy ? __('stLoading', 'Loading…') : __('stLoad', 'Load inventory')),
        e(UIC.Button, { variant: 'quiet', onClick: function () { setShowPaste(!showPaste); }, 'aria-expanded': showPaste ? 'true' : 'false' }, __('stPasteToggle', 'Paste instead'))),
      msg && e('p', { role: 'status', 'data-testid': 'steam-msg', className: rows && rows.length ? 'ui-muted' : 'tone-warning' }, msg),
      showPaste && e('div', { className: 'ui-taxp__box' },
        e('p', { className: 'ui-muted' }, id64
          ? [__('stPasteOpen', 'Open'), ' ', e('a', { key: 'a', href: inventoryUrl(id64), target: '_blank', rel: 'noopener noreferrer', className: 'ui-link' }, __('stPasteLink', 'your inventory as JSON')), ' ', __('stPasteCopy', 'while signed in to Steam, select everything, copy it and paste it here.')]
          : __('stPasteNeedId', 'Enter your SteamID64 (17 digits, in your profile URL) above to get the link to your inventory JSON.')),
        e('textarea', { value: pasted, onChange: function (ev) { setPasted(ev.target.value); }, rows: 4, 'aria-label': __('stPasteAria', 'Inventory JSON'), spellCheck: false,
          placeholder: '{"assets":[…],"descriptions":[…]}', className: ['ui-input', 'ui-textarea'].join(' ') }),
        e('div', { className: 'ui-actions' }, e(UIC.Button, { onClick: function () { preview(itemsFrom(pasted)); }, disabled: !pasted.trim() }, __('stReadPasted', 'Read pasted inventory')))),
      rows && rows.length > 0 && e('div', { className: 'ui-taxp__body' },
        e('div', { className: 'ui-table-wrap' }, e('table', { className: ['ui-table', 'ui-table--dense', 'ui-table--left'].join(' ') },
          e('thead', null, e('tr', null,
            ['', __('stItem', 'Item'), __('stQty', 'Qty'), __('stPrice', 'Price per item (EUR)'), __('stDate', 'Purchase date')].map(function (h, i) {
              return e('th', { key: i, scope: 'col', className: i === 2 ? 'is-right' : 'is-left' }, h || e('span', { className: 'sr-only' }, __('stIncludeCol', 'Import')));
            }))),
          e('tbody', null, rows.map(function (r, i) {
            return e('tr', { key: r.name, 'data-steam-item': r.name, className: r.include ? undefined : 'is-off' },
              e('td', null, e('input', { type: 'checkbox', checked: !!r.include, className: 'ui-st-check', 'aria-label': __('stInclude', 'Import {name}', { name: r.name }), onChange: function () { edit(i, { include: !r.include }); } })),
              e('td', { className: 'is-wrap' }, r.name, r.marketable ? null : e('span', { className: 'ui-tcell__sub' }, __('stNotMarketable', 'not marketable'))),
              e('td', { className: ['is-right', 'num'].join(' ') }, I ? I.num(r.qty, 0) : r.qty),
              e('td', null, e('input', { type: 'text', inputMode: 'decimal', defaultValue: r.price ? (I ? I.num(r.price, 2) : r.price) : '', placeholder: '0',
                'aria-label': __('stPriceAria', 'Price per item for {name}', { name: r.name }),
                onBlur: function (ev) { var v = window.MaerminUtils.parseDecimal(ev.target.value); edit(i, { price: v >= 0 ? v : 0, include: v > 0 ? true : r.include }); },
                className: [INPUT, 'ui-gt-num'].join(' ') })),
              e('td', null, e('input', { type: 'date', value: r.date, 'aria-label': __('stDateAria', 'Purchase date for {name}', { name: r.name }),
                onChange: function (ev) { edit(i, { date: ev.target.value }); }, className: INPUT })));
          })))),
        e('div', { className: 'ui-dlg-sec__head' },
          e('span', { className: 'ui-note' }, __('stPriceHint', 'Prices are today\'s Steam Market prices; change them to what you paid.')),
          e(UIC.Button, { variant: 'primary', 'data-testid': 'steam-do-import', onClick: doImport, disabled: !chosen.length },
            __('stImportBtn', 'Import {n} {n:row|rows}', { n: chosen.length })))));
  }

  var api = { steamId64: steamId64, inventoryUrl: inventoryUrl, itemsFrom: itemsFrom, importedIds: importedIds, newRows: newRows, toTransactions: toTransactions, Panel: Panel };
  if (typeof window !== 'undefined') window.MaerminSteamImport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
