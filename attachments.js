// ============================================================================
// MAERMIN — Source documents on a transaction  (window.MaerminAttachments)
// ----------------------------------------------------------------------------
// Audit 2026-10-24, feature 10. A transaction can carry its source document
// (a broker PDF, a photo of a receipt): PDF, PNG, JPEG or WebP, up to 5 MB.
//
// Owner decision: attachments stay ON THIS DEVICE. Each file is encrypted with
// the vault key (context 'attachment') and stored in IndexedDB under its own
// key 'att:<txId>:<id>'; the list per transaction is the encrypted
// 'att-index'. Neither is a storage key of storage.js, so they are not in the
// encrypted backup (one blob of the app's keys), not in the plain backup and
// not in sync. Losing the device loses the files; the transactions stay.
// A password change keeps the data key, so files stay readable; a vault
// restored from another device's backup cannot read them (shown as such).
//
//   validate({ name, type, size }) -> null | 'type' | 'size' | 'empty'
//   b64(ArrayBuffer) / unb64(string) -> Uint8Array
//   indexAdd(index, txId, meta) / indexRemove(index, txId, id) -> new index
//   add(txId, File) / list(txId) / open(txId, id) -> Blob / remove(txId, id)
//   Panel({ txId })
// Pure parts tested in test/attachments.test.js.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }

  var MAX_BYTES = 5 * 1024 * 1024;
  var TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];
  var INDEX_KEY = 'att-index';
  var CTX = 'attachment';

  function validate(f) {
    if (!f || !(f.size > 0)) return 'empty';
    if (TYPES.indexOf(String(f.type || '').toLowerCase()) === -1) return 'type';
    if (f.size > MAX_BYTES) return 'size';
    return null;
  }

  // Base64 in chunks (String.fromCharCode on a 5 MB array overflows the stack).
  function b64(buf) {
    var bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    var s = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return (typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64'));
  }
  function unb64(str) {
    var bin = typeof atob === 'function' ? atob(str) : Buffer.from(str, 'base64').toString('binary');
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function indexAdd(index, txId, meta) {
    var out = Object.assign({}, index || {});
    out[txId] = (out[txId] || []).filter(function (m) { return m.id !== meta.id; }).concat([meta]);
    return out;
  }
  function indexRemove(index, txId, id) {
    var out = Object.assign({}, index || {});
    var left = (out[txId] || []).filter(function (m) { return m.id !== id; });
    if (left.length) out[txId] = left; else delete out[txId];
    return out;
  }

  // ---- browser storage (vault-encrypted, IndexedDB) -------------------------
  function deps() {
    var W = typeof window !== 'undefined' ? window : {};
    var V = W.MaerminVault, I = W.MaerminIDB;
    if (!V || !I || !I.isSupported || !I.isSupported() || !V.isUnlocked || !V.isUnlocked()) return null;
    return { V: V, I: I };
  }
  function loadIndex(d) {
    return d.I.get(INDEX_KEY).then(function (env) {
      if (!env) return {};
      return d.V.decryptJSON(env, CTX).catch(function () { return { __unreadable: true }; });
    });
  }
  function saveIndex(d, index) { return d.V.encryptJSON(index, CTX).then(function (env) { return d.I.set(INDEX_KEY, env); }); }
  function keyOf(txId, id) { return 'att:' + txId + ':' + id; }

  function list(txId) {
    var d = deps();
    if (!d) return Promise.resolve({ items: [], available: false });
    return loadIndex(d).then(function (idx) {
      return { items: (idx[txId] || []).slice(), available: true, unreadable: !!idx.__unreadable };
    });
  }

  function add(txId, file) {
    var d = deps();
    if (!d) return Promise.reject(new Error('locked'));
    var bad = validate(file);
    if (bad) return Promise.reject(new Error(bad));
    var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    var meta = { id: id, name: String(file.name || 'document').slice(0, 120), type: file.type, size: file.size, addedAt: Date.now() };
    return file.arrayBuffer()
      .then(function (buf) { return d.V.encryptJSON({ meta: meta, data: b64(buf) }, CTX); })
      .then(function (env) { return d.I.set(keyOf(txId, id), env); })
      .then(function (ok) { if (ok === false) throw new Error('read-only'); return loadIndex(d); })
      .then(function (idx) { if (idx.__unreadable) idx = {}; return saveIndex(d, indexAdd(idx, txId, meta)); })
      .then(function () { return meta; });
  }

  function open(txId, id) {
    var d = deps();
    if (!d) return Promise.reject(new Error('locked'));
    return d.I.get(keyOf(txId, id)).then(function (env) {
      if (!env) throw new Error('missing');
      return d.V.decryptJSON(env, CTX).then(function (o) { return new Blob([unb64(o.data)], { type: o.meta.type }); }, function () { throw new Error('unreadable'); });
    });
  }

  function remove(txId, id) {
    var d = deps();
    if (!d) return Promise.reject(new Error('locked'));
    return d.I.del(keyOf(txId, id))
      .then(function () { return loadIndex(d); })
      .then(function (idx) { return saveIndex(d, indexRemove(idx.__unreadable ? {} : idx, txId, id)); });
  }

  function sizeText(n) {
    var I = window.MaerminI18n;
    return n >= 1024 * 1024 ? I.num(n / 1024 / 1024, 1) + ' MB' : I.num(Math.max(1, Math.round(n / 1024)), 0) + ' KB';
  }

  function Panel(props) {
    var React = window.React, h = React.createElement;
    var UIC = window.MaerminComponents || {};
    var st = React.useState({ items: [], available: false, loading: true }), state = st[0], setState = st[1];
    var es = React.useState(''), err = es[0], setErr = es[1];
    var busyS = React.useState(false), busy = busyS[0], setBusy = busyS[1];
    var inputRef = React.useRef(null);
    var reload = function () { list(props.txId).then(function (r) { setState(Object.assign({ loading: false }, r)); }, function () { setState({ items: [], available: false, loading: false }); }); };
    React.useEffect(reload, [props.txId]);
    if (state.loading || !state.available) return null;
    var MSG = {
      type: __('attErrType', 'Only PDF, PNG, JPEG or WebP files.'),
      size: __('attErrSize', 'The file is larger than 5 MB.'),
      empty: __('attErrEmpty', 'The file is empty.'),
      unreadable: __('attErrUnreadable', 'This file was saved with another vault and cannot be opened here.'),
      'read-only': __('attErrReadOnly', 'MAERMIN is open in another tab; add the file there.')
    };
    var onPick = function (ev) {
      var f = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!f) return;
      setErr(''); setBusy(true);
      add(props.txId, f).then(reload, function (e) { setErr(MSG[e && e.message] || __('attErrFailed', 'The file could not be saved.')); }).then(function () { setBusy(false); });
    };
    var onOpen = function (m) {
      setErr('');
      open(props.txId, m.id).then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.download = m.name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      }, function (e) { setErr(MSG[e && e.message] || __('attErrOpen', 'The file could not be opened.')); });
    };
    var onDelete = function (m) {
      (window.MaerminUI && window.MaerminUI.confirm ? window.MaerminUI.confirm({
        title: __('attDeleteTitle', 'Delete this document?'),
        message: __('attDeleteMsg', '"{name}" is removed from this device. The transaction stays.', { name: m.name }),
        confirmLabel: __('delete', 'Delete'), danger: true
      }) : Promise.resolve(true)).then(function (yes) { if (yes) remove(props.txId, m.id).then(reload); });
    };
    return h('section', { className: 'ui-txd__block', 'data-testid': 'tx-attachments' },
      h('h3', null, __('attTitle', 'Documents')),
      h('p', { className: 'ui-note ui-note--flush' }, __('attHint', 'Kept encrypted on this device only: not in backups and not synced.')),
      state.unreadable ? h('p', { className: 'ui-note' }, MSG.unreadable) : null,
      state.items.length ? h('ul', { className: 'ui-txd__list' }, state.items.map(function (m) {
        return h('li', { key: m.id, 'data-attachment': m.id },
          h('button', { type: 'button', className: 'ui-link', onClick: function () { onOpen(m); } }, m.name),
          h('span', { className: 'ui-muted num' }, sizeText(m.size)),
          UIC.IconButton ? h(UIC.IconButton, { size: 'sm', label: __('attDelete', 'Delete {name}', { name: m.name }), 'data-attachment-delete': m.id, onClick: function () { onDelete(m); }, icon: h('span', { 'aria-hidden': 'true' }, '×') }) : null);
      })) : null,
      err ? h('p', { className: 'ui-note is-error', role: 'alert' }, err) : null,
      h('input', { ref: inputRef, type: 'file', accept: TYPES.join(','), className: 'sr-only', tabIndex: -1, 'aria-hidden': 'true', 'data-testid': 'tx-attachment-input', onChange: onPick }),
      UIC.Button ? h(UIC.Button, { size: 'sm', loading: busy, 'data-testid': 'tx-attachment-add', onClick: function () { if (inputRef.current) inputRef.current.click(); } }, __('attAdd', 'Attach document…')) : null);
  }

  var api = { MAX_BYTES: MAX_BYTES, TYPES: TYPES, INDEX_KEY: INDEX_KEY, validate: validate, b64: b64, unb64: unb64,
    indexAdd: indexAdd, indexRemove: indexRemove, add: add, list: list, open: open, remove: remove, Panel: Panel };
  if (typeof window !== 'undefined') window.MaerminAttachments = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
