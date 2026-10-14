// ============================================================================
// MAERMIN — Serverless sync transports  (window.MaerminSyncTransports)
// ----------------------------------------------------------------------------
// P5-5.6. The zero-knowledge sync (sync-engine.js) without a Worker: the same
// encrypted blob goes to
//   - a local file (File System Access API, Chromium browsers), e.g. in a
//     folder that Syncthing, Dropbox or a NAS share keeps in step, or
//   - a WebDAV folder (Nextcloud, ownCloud, a NAS), with Basic auth.
// One file, `maermin-sync.json`, holds the same record the Worker keeps
// ({ rev, blob, updatedAt }) plus the account id and the write MAC:
//   HMAC-SHA256(HKDF(vaultKey,'sync-auth'), account + '.' + baseRev + '.' + blob)
// - the MAC the Worker checks on every write. With no server in between, the
// client checks it on every read: a blob or revision changed by anyone without
// the vault key is refused ("tampered"). The blob itself is AES-256-GCM
// ciphertext; the storage never sees plaintext.
// Concurrency: WebDAV writes are conditional on the ETag just read (If-Match,
// If-None-Match: * for the first write), so a lost race is a conflict the
// engine merges. A plain file has no such guard: a sync tool's conflicted copy
// is not read; the merge on the next sync keeps every transaction.
// Same transport interface as WorkerTransport: get(account), put(account,
// baseRev, blob, auth). Node-tested in test/sync-transports.test.js.
// ============================================================================
(function () {
  'use strict';
// Translation lookup (i18n.js): __('key', 'English fallback', { slot: value }).
function __(k, f, v) { return (typeof window !== 'undefined' && window.MaerminI18n ? window.MaerminI18n : require('./i18n.js')).t(k, f, v); }
  var W = typeof window !== 'undefined' ? window : {};

  var FORMAT = 'maermin-sync';
  var FILE_NAME = 'maermin-sync.json';
  var MAX_BLOB = 4000000; // the Worker's limit, so a record moves between transports

  // What the sync badge says for each failure (the code stays on e.code).
  function messageFor(code) {
    switch (code) {
      case 'not-a-sync-file': return __('stNotSyncFile', 'The file is not a MAERMIN sync file.');
      case 'other-vault': return __('stOtherVault', 'The sync file belongs to another vault (a different password). Pick another file or folder.');
      case 'tampered': return __('stTampered', 'The sync file was changed without your key and was not used.');
      case 'unsigned': return __('stUnsigned', 'Unlock the vault to sync.');
      case 'too-large': return __('stTooLarge', 'The encrypted data is larger than 4 MB.');
      case 'webdav-url': return __('stWebDavUrl', 'Use an https:// WebDAV address.');
      case 'webdav-auth': return __('stWebDavAuth', 'The WebDAV server refused the user name or app password.');
      case 'webdav-folder': return __('stWebDavFolder', 'The WebDAV folder does not exist. Create it first.');
      case 'webdav-csp': return __('stWebDavCsp', 'This copy of MAERMIN may only connect to the hosts named in its security policy. Add your WebDAV host when you build it (MAERMIN_CONNECT_SRC), or sync through a file.');
      case 'webdav-network': return __('stWebDavNetwork', 'The WebDAV server could not be reached. It must allow this site (CORS), or you are offline.');
      case 'file-permission': return __('stFilePermission', 'Allow access to the sync file again (Security & sync).');
      default: return code;
    }
  }
  function err(code) { var e = new Error(messageFor(code)); e.code = code; return e; }

  // ---- record ------------------------------------------------------------------
  function makeRecord(account, baseRev, blob, mac, now) {
    return { format: FORMAT, v: 1, account: account, rev: (Number(baseRev) || 0) + 1, baseRev: Number(baseRev) || 0,
      blob: blob, mac: mac, updatedAt: typeof now === 'number' ? now : Date.now() };
  }
  // null for an empty file; throws 'not-a-sync-file' for anything else.
  function parseRecord(text) {
    if (text == null || !String(text).trim()) return null;
    var r;
    try { r = JSON.parse(text); } catch (e) { throw err('not-a-sync-file'); }
    if (!r || r.format !== FORMAT || typeof r.blob !== 'string' || typeof r.rev !== 'number' || typeof r.account !== 'string') throw err('not-a-sync-file');
    return r;
  }
  // The record for this account, its MAC checked: { rev, blob } | null.
  function checkRecord(r, account, verify) {
    if (!r) return Promise.resolve(null);
    if (r.account !== account) return Promise.reject(err('other-vault'));
    if (r.rev !== r.baseRev + 1 || typeof verify !== 'function') return Promise.reject(err('tampered'));
    return Promise.resolve(verify(account, r.baseRev, r.blob, r.mac)).then(function (good) {
      if (!good) throw err('tampered');
      return { rev: r.rev, blob: r.blob, updatedAt: r.updatedAt, protected: true };
    });
  }
  function checkPut(blob, auth) {
    if (!auth || !auth.mac) return err('unsigned');
    if (typeof blob !== 'string' || blob.length > MAX_BLOB) return err('too-large');
    return null;
  }

  // ---- local file (File System Access) ------------------------------------------
  // opts: { handle: FileSystemFileHandle, verify(account, baseRev, blob, mac) -> Promise<bool>, now() }
  function FileTransport(opts) {
    opts = opts || {};
    var handle = opts.handle, verify = opts.verify;
    var now = opts.now || function () { return Date.now(); };
    function read() { return handle.getFile().then(function (f) { return f.text(); }).then(parseRecord); }
    function write(rec) {
      return handle.createWritable().then(function (w) {
        return Promise.resolve(w.write(JSON.stringify(rec))).then(function () { return w.close(); });
      });
    }
    return {
      kind: 'file',
      get: function (account) { return read().then(function (r) { return checkRecord(r, account, verify); }); },
      put: function (account, baseRev, blob, auth) {
        var bad = checkPut(blob, auth);
        if (bad) return Promise.reject(bad);
        return read().then(function (r) {
          return checkRecord(r, account, verify).then(function (cur) {
            var serverRev = cur ? cur.rev : 0;
            if (serverRev !== baseRev) return { conflict: true, serverRev: serverRev, blob: cur ? cur.blob : null };
            var rec = makeRecord(account, baseRev, blob, auth.mac, now());
            return write(rec).then(function () { return { ok: true, rev: rec.rev }; });
          });
        });
      }
    };
  }

  // ---- WebDAV ---------------------------------------------------------------------
  function validWebDavUrl(u) {
    var m = /^(https?):\/\/([^/?#]+)/i.exec(String(u || '').trim());
    if (!m) return false;
    if (m[1].toLowerCase() === 'https') return true;
    return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(m[2]);
  }
  function httpErr(status) { var e = new Error(__('stWebDavHttp', 'The WebDAV server answered {s}.', { s: status })); e.code = 'webdav-http'; return e; }
  function b64(s) {
    var bytes = new TextEncoder().encode(s), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
  }
  // opts: { url (folder), username, password, fetchImpl, verify, now() }
  function WebDavTransport(opts) {
    opts = opts || {};
    if (!validWebDavUrl(opts.url)) throw err('webdav-url');
    var fileUrl = String(opts.url).trim().replace(/\/+$/, '') + '/' + FILE_NAME;
    // Kept in this closure only, so the transport object itself carries no secret.
    var authHeader = 'Basic ' + b64(String(opts.username || '') + ':' + String(opts.password || ''));
    var fetchImpl = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    var verify = opts.verify;
    var now = opts.now || function () { return Date.now(); };
    var origin = (/^https?:\/\/[^/?#]+/i.exec(fileUrl) || [''])[0].toLowerCase();
    function call(method, headers, body) {
      var h = Object.assign({ Authorization: authHeader }, headers || {});
      // A host the page's security policy (connect-src) does not name fails
      // like a network error; the violation event tells the two apart.
      var doc = typeof document !== 'undefined' ? document : null, blocked = false;
      var onViolation = function (ev) { if (String((ev && ev.blockedURI) || '').toLowerCase().indexOf(origin) === 0) blocked = true; };
      if (doc && doc.addEventListener) doc.addEventListener('securitypolicyviolation', onViolation);
      var done = function () { if (doc && doc.removeEventListener) doc.removeEventListener('securitypolicyviolation', onViolation); };
      return Promise.resolve().then(function () { return fetchImpl(fileUrl, { method: method, headers: h, body: body, cache: 'no-store', credentials: 'omit' }); })
        .then(function (r) {
          done();
          if (r.status === 401 || r.status === 403) throw err('webdav-auth');
          return r;
        }, function () {
          // the violation event may arrive just after the rejection
          return new Promise(function (res) { setTimeout(res, 50); }).then(function () { done(); throw err(blocked ? 'webdav-csp' : 'webdav-network'); });
        });
    }
    // { rec, etag } of the file now (rec null when there is none).
    function fetchCurrent() {
      return call('GET').then(function (r) {
        if (r.status === 404) return { rec: null, etag: null };
        if (!r.ok) throw httpErr(r.status);
        var etag = r.headers && r.headers.get ? r.headers.get('etag') : null;
        return r.text().then(function (t) { return { rec: parseRecord(t), etag: etag }; });
      });
    }
    return {
      kind: 'webdav',
      get: function (account) { return fetchCurrent().then(function (c) { return checkRecord(c.rec, account, verify); }); },
      put: function (account, baseRev, blob, auth) {
        var bad = checkPut(blob, auth);
        if (bad) return Promise.reject(bad);
        return fetchCurrent().then(function (c) {
          return checkRecord(c.rec, account, verify).then(function (cur) {
            var serverRev = cur ? cur.rev : 0;
            if (serverRev !== baseRev) return { conflict: true, serverRev: serverRev, blob: cur ? cur.blob : null };
            var rec = makeRecord(account, baseRev, blob, auth.mac, now());
            var cond = c.etag ? { 'If-Match': c.etag } : (c.rec ? {} : { 'If-None-Match': '*' });
            return call('PUT', Object.assign({ 'Content-Type': 'application/json' }, cond), JSON.stringify(rec)).then(function (r) {
              if (r.status === 412) {
                // Someone wrote since our read: hand the engine their record to merge.
                return fetchCurrent().then(function (c2) {
                  return checkRecord(c2.rec, account, verify).then(function (cur2) {
                    return { conflict: true, serverRev: cur2 ? cur2.rev : 0, blob: cur2 ? cur2.blob : null };
                  });
                });
              }
              if (r.status === 409 || r.status === 404) throw err('webdav-folder');
              if (!r.ok) throw httpErr(r.status);
              return { ok: true, rev: rec.rev };
            });
          });
        });
      }
    };
  }


  // ---- where the chosen file and the WebDAV login live on this device -----------
  var HANDLE_KEY = 'maermin_sync_file';   // IndexedDB (a file handle is not secret)
  var DAV_KEY = 'maermin_webdav';         // encrypted at rest, device-local, never synced or backed up
  function fileSupported() { return typeof W.showSaveFilePicker === 'function' && typeof W.showOpenFilePicker === 'function'; }
  function saveHandle(h) { return W.MaerminIDB ? W.MaerminIDB.set(HANDLE_KEY, h) : Promise.resolve(); }
  function loadHandle() { return W.MaerminIDB ? W.MaerminIDB.get(HANDLE_KEY) : Promise.resolve(null); }
  function loadDav() { try { return JSON.parse(localStorage.getItem(DAV_KEY) || 'null'); } catch (e) { return null; } }
  function saveDav(d) { try { if (d) localStorage.setItem(DAV_KEY, JSON.stringify(d)); else localStorage.removeItem(DAV_KEY); } catch (e) {} }
  // Read and write access to a stored handle; asks (needs a click) when `ask`.
  function permitted(handle, ask) {
    if (!handle || typeof handle.queryPermission !== 'function') return Promise.resolve(!!handle);
    var o = { mode: 'readwrite' };
    return handle.queryPermission(o).then(function (p) {
      if (p === 'granted') return true;
      if (!ask || typeof handle.requestPermission !== 'function') return false;
      return handle.requestPermission(o).then(function (q) { return q === 'granted'; });
    });
  }
  var PICK_TYPES = [{ description: 'JSON', accept: { 'application/json': ['.json'] } }];

  // The destination picker in Security & sync.
  // props: { theme, workerUrl, busy, onConnect(cfg) } - cfg is what MaerminSync.configure takes.
  function Panel(props) {
    var React = W.React;
    if (!React) return null;
    var e = React.createElement, useState = React.useState;
    var th = props.theme || {};
    var text = th.text || '#e6edf3', dim = th.textSecondary || '#9aa4b2', border = th.cardBorder || 'rgba(255,255,255,0.1)';
    var warn = th.warning || '#f59e0b', accent = th.accent || '#8b7cff';
    var dav0 = loadDav() || {};
    var s0 = useState(props.workerUrl ? 'worker' : fileSupported() ? 'file' : 'webdav'); var mode = s0[0], setMode = s0[1];
    var s1 = useState(dav0.url || ''); var url = s1[0], setUrl = s1[1];
    var s2 = useState(dav0.username || ''); var user = s2[0], setUser = s2[1];
    var s3 = useState(''); var pass = s3[0], setPass = s3[1];
    var s4 = useState(''); var problem = s4[0], setProblem = s4[1];
    var chip = function (on) { return { padding: '0.3rem 0.65rem', borderRadius: '999px', border: '1px solid ' + (on ? accent : border), background: on ? (th.accentFill || accent) : th.inputBg, color: on ? '#fff' : text, cursor: 'pointer', fontSize: '0.74rem', fontWeight: 600 }; };
    var btn = { padding: '0.4rem 0.8rem', borderRadius: '8px', border: '1px solid ' + accent, background: th.accentFill || accent, color: '#fff', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600 };
    var input = { boxSizing: 'border-box', width: '100%', padding: '0.45rem 0.6rem', background: th.inputBg, border: '1px solid ' + (th.inputBorder || border), borderRadius: '8px', color: text, fontSize: '0.8rem', fontFamily: 'inherit', marginBottom: '0.4rem' };
    var note = function (t, color) { return e('p', { style: { color: color || dim, fontSize: '0.74rem', lineHeight: 1.5, margin: '0.3rem 0 0.5rem' } }, t); };

    function pickFile(create) {
      setProblem('');
      var pick = create
        ? W.showSaveFilePicker({ suggestedName: FILE_NAME, types: PICK_TYPES })
        : W.showOpenFilePicker({ types: PICK_TYPES }).then(function (hs) { return hs[0]; });
      pick.then(function (h) {
        return permitted(h, true).then(function (yes) {
          if (!yes) { setProblem(messageFor('file-permission')); return; }
          return saveHandle(h).then(function () { props.onConnect({ provider: 'file', handle: h, endpoint: h.name }); });
        });
      }).catch(function (x) { if (!x || x.name !== 'AbortError') setProblem(String((x && x.message) || x)); });
    }
    function connectDav() {
      setProblem('');
      var u = url.trim();
      if (!validWebDavUrl(u)) { setProblem(messageFor('webdav-url')); return; }
      if (!user.trim() || !pass) { setProblem(__('stDavMissing', 'Enter the user name and an app password.')); return; }
      saveDav({ url: u, username: user.trim(), password: pass });
      setPass('');
      props.onConnect({ provider: 'webdav', endpoint: u, username: user.trim(), password: pass });
    }

    return e('div', { 'data-testid': 'sync-dest', style: { margin: '0.3rem 0 0.2rem' } },
      e('div', { style: { color: dim, fontSize: '0.74rem', marginBottom: '0.35rem' } }, __('stWhere', 'Where the encrypted copy goes')),
      e('div', { style: { display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.4rem' } },
        e('button', { 'data-testid': 'sync-dest-worker', 'aria-pressed': mode === 'worker' ? 'true' : 'false', style: chip(mode === 'worker'), onClick: function () { setMode('worker'); } }, __('stWorker', 'Your Worker')),
        e('button', { 'data-testid': 'sync-dest-file', 'aria-pressed': mode === 'file' ? 'true' : 'false', style: chip(mode === 'file'), onClick: function () { setMode('file'); } }, __('stFile', 'File (Syncthing, Dropbox, NAS)')),
        e('button', { 'data-testid': 'sync-dest-webdav', 'aria-pressed': mode === 'webdav' ? 'true' : 'false', style: chip(mode === 'webdav'), onClick: function () { setMode('webdav'); } }, __('stWebDav', 'WebDAV / Nextcloud'))),
      mode === 'worker' ? e('div', null,
        note(__('stWorkerHint', 'Your own Cloudflare Worker keeps the encrypted copy and checks every write.')),
        e('button', { 'data-testid': 'sync-enable-worker', style: btn, disabled: !props.workerUrl || props.busy, onClick: function () { props.onConnect({ provider: 'worker', endpoint: props.workerUrl }); } }, __('syncEnable', 'Enable & sync')),
        !props.workerUrl ? note(__('syncNeedWorkerHint', 'Add a Worker URL in API Settings to enable sync.'), warn) : null) : null,
      mode === 'file' ? e('div', null,
        fileSupported()
          ? e('div', null,
            note(__('stFileHint', 'A file on this computer, e.g. in a folder that Syncthing, Dropbox or a NAS share copies to your other devices. Only ciphertext goes into it. Two devices should not sync at the very same moment: a sync tool may then keep a conflicted copy.')),
            e('div', { style: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap' } },
              e('button', { 'data-testid': 'sync-file-new', style: btn, disabled: props.busy, onClick: function () { pickFile(true); } }, __('stFileNew', 'Create sync file…')),
              e('button', { 'data-testid': 'sync-file-open', style: btn, disabled: props.busy, onClick: function () { pickFile(false); } }, __('stFileOpen', 'Use existing file…'))))
          : note(__('stFileUnsupported', 'This browser does not let web pages write files (Chrome, Edge and other Chromium browsers do). Use WebDAV instead.'), warn)) : null,
      mode === 'webdav' ? e('div', null,
        note(__('stDavHint', 'A folder on your Nextcloud, ownCloud or NAS. Use an app password, not your main password. The server must allow requests from this site (CORS); Nextcloud needs a CORS app or a proxy rule for that. The site itself may only reach hosts named in its security policy: on your own copy, add the host with MAERMIN_CONNECT_SRC when you build it.')),
        e('input', { 'data-testid': 'sync-webdav-url', type: 'url', value: url, placeholder: __('stDavUrlPh', 'https://cloud.example.org/remote.php/dav/files/you/MAERMIN'), 'aria-label': __('stDavUrl', 'Folder address (WebDAV)'), style: input, onChange: function (ev) { setUrl(ev.target.value); } }),
        e('input', { 'data-testid': 'sync-webdav-user', value: user, autoComplete: 'username', placeholder: __('stDavUser', 'User name'), 'aria-label': __('stDavUser', 'User name'), style: input, onChange: function (ev) { setUser(ev.target.value); } }),
        e('input', { 'data-testid': 'sync-webdav-pass', type: 'password', value: pass, autoComplete: 'new-password', placeholder: __('stDavPass', 'App password'), 'aria-label': __('stDavPass', 'App password'), style: input, onChange: function (ev) { setPass(ev.target.value); }, onKeyDown: function (ev) { if (ev.key === 'Enter') connectDav(); } }),
        e('button', { 'data-testid': 'sync-webdav-connect', style: btn, disabled: props.busy, onClick: connectDav }, __('stDavConnect', 'Connect & sync')),
        note(__('stDavStored', 'The login stays on this device, encrypted with your vault. It is not synced and not in backups.'))) : null,
      problem ? e('div', { role: 'alert', 'data-testid': 'sync-dest-problem', style: { color: th.danger || '#ef4444', fontSize: '0.76rem', marginTop: '0.35rem' } }, problem) : null);
  }
  // A short name for the destination in the status row.
  function describe(cfg) {
    if (!cfg || !cfg.provider) return '';
    if (cfg.provider === 'file') return __('stDescFile', 'File {name}', { name: cfg.endpoint || FILE_NAME });
    if (cfg.provider === 'webdav') { var m = /^https?:\/\/([^/]+)/i.exec(cfg.endpoint || ''); return __('stDescDav', 'WebDAV {host}', { host: m ? m[1] : '' }); }
    return __('stDescWorker', 'Your Worker');
  }

  var api = { FORMAT: FORMAT, FILE_NAME: FILE_NAME, makeRecord: makeRecord, parseRecord: parseRecord, checkRecord: checkRecord,
    FileTransport: FileTransport, WebDavTransport: WebDavTransport, validWebDavUrl: validWebDavUrl, messageFor: messageFor,
    HANDLE_KEY: HANDLE_KEY, DAV_KEY: DAV_KEY, fileSupported: fileSupported, loadHandle: loadHandle, loadDav: loadDav, saveDav: saveDav, permitted: permitted,
    Panel: Panel, describe: describe };
  if (typeof window !== 'undefined') window.MaerminSyncTransports = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
