// ============================================================================
// MAERMIN — Vault Authentication  (window.MaerminAuth)
// ----------------------------------------------------------------------------
// Replaces the old SHA-256 shared-secret gate. The access password now derives
// the AES-256 vault key (Argon2id when available, else PBKDF2-600k) via
// crypto-vault.js. The password/its hash is never stored — a wrong password
// simply fails to decrypt the vault's wrap-check.
//
// Modes
//   - setup   : no vault yet → create a password (+ optionally encrypt data at
//               rest, migrating any existing plaintext via storage.js).
//   - unlock  : vault exists → derive key, verify, hydrate encrypted data.
//   - lock    : idle auto-lock (MaerminVault) re-shows the unlock screen.
//
// The app (renderer.js) waits on MaerminAuth.whenUnlocked() before mounting, so
// it always reads DECRYPTED data. Client-side only — no server, no user DB.
// ============================================================================
(function () {
  'use strict';

  var Vault   = window.MaerminVault;
  var Storage = window.MaerminStorage;
  var LEGACY_SESSION_KEY = 'maermin_auth_session'; // old SHA-256 session — cleared on upgrade

  // Promise the app awaits before mounting React.
  var _resolveUnlock;
  var _unlockedPromise = new Promise(function (res) { _resolveUnlock = res; });
  var _everUnlocked = false;

  // ─────────────────────────────────────────────────────────────────────────
  // Styles (shared by setup / unlock / lock)
  // ─────────────────────────────────────────────────────────────────────────
  var STYLE = `
    #maermin-auth { position: fixed; inset: 0; z-index: 99999;
      background:
        radial-gradient(800px 500px at 50% -10%, rgba(245,165,36,0.10) 0%, transparent 60%),
        radial-gradient(1100px 700px at 50% 110%, #11161f 0%, #080b11 70%);
      display: flex; align-items: center; justify-content: center;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    #maermin-auth .auth-card { background: rgba(20,26,37,0.92);
      border: 1px solid rgba(255,255,255,0.08); border-radius: 20px; padding: 3rem;
      width: 100%; max-width: 420px;
      box-shadow: 0 32px 70px -20px rgba(0,0,0,0.8), 0 0 40px rgba(245,165,36,0.06);
      backdrop-filter: blur(20px); animation: authFadeIn 0.5s cubic-bezier(0.16,1,0.3,1); }
    @keyframes authFadeIn { from { opacity:0; transform: translateY(-20px) scale(0.97);} to { opacity:1; transform:none;} }
    #maermin-auth .auth-logo { text-align:center; margin-bottom: 1.75rem; }
    #maermin-auth .auth-logo h1 { font-size: 3rem; font-weight: 800; letter-spacing: -0.05em;
      background: linear-gradient(135deg, #ffd479 0%, #f5a524 55%, #d97706 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    #maermin-auth .auth-logo p { color: rgba(255,255,255,0.5); font-size: 0.8rem;
      letter-spacing: 0.15em; text-transform: uppercase; margin-top: 0.25rem; }
    #maermin-auth .auth-sub { color: rgba(255,255,255,0.55); font-size:.8rem; text-align:center;
      margin: -0.5rem 0 1.25rem; line-height:1.5; }
    #maermin-auth .auth-field { position: relative; margin-bottom: 1.1rem; }
    #maermin-auth .auth-field label { display:block; color: rgba(255,255,255,0.6);
      font-size: 0.75rem; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 0.5rem; }
    #maermin-auth .auth-field input { width:100%; padding: 0.875rem 1rem; background:#0f172a;
      border:1px solid #334155; border-radius:10px; color:white; font-size:1rem; outline:none;
      transition: border-color .2s, box-shadow .2s; }
    #maermin-auth .auth-field input:focus { border-color:#f5a524; box-shadow:0 0 0 3px rgba(245,165,36,0.22); }
    #maermin-auth .auth-field input.error { border-color:#ef4444; box-shadow:0 0 0 3px rgba(239,68,68,0.2); animation: shake .3s ease-out; }
    @keyframes shake { 0%,100%{transform:translateX(0);} 20%{transform:translateX(-6px);} 60%{transform:translateX(6px);} }
    #maermin-auth .auth-check { display:flex; gap:.6rem; align-items:flex-start; margin:.25rem 0 1.1rem;
      color: rgba(255,255,255,0.65); font-size:.8rem; line-height:1.4; cursor:pointer; }
    #maermin-auth .auth-check input { margin-top:.15rem; accent-color:#f5a524; }
    #maermin-auth .auth-error { background: rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.4);
      border-radius:8px; padding:0.75rem 1rem; color:#fca5a5; font-size:0.875rem; margin-bottom:1rem; display:none; }
    #maermin-auth .auth-error.visible { display:block; }
    #maermin-auth .auth-btn { width:100%; padding:0.875rem;
      background: linear-gradient(135deg, #ffd479 0%, #f5a524 55%, #d97706 100%);
      border:none; border-radius:10px; color:#13110a; font-size:1rem; font-weight:700; cursor:pointer;
      transition: all .2s; display:flex; align-items:center; justify-content:center; gap:0.5rem; }
    #maermin-auth .auth-btn:hover:not(:disabled){ filter:brightness(1.05); transform:translateY(-1px); box-shadow:0 10px 24px -6px rgba(245,165,36,0.5); }
    #maermin-auth .auth-btn:disabled{ opacity:.7; cursor:not-allowed; transform:none; }
    #maermin-auth .auth-btn .spinner{ width:18px;height:18px;border:2px solid rgba(19,17,10,0.3);
      border-top-color:#13110a;border-radius:50%;animation:spin .8s linear infinite;display:none; }
    #maermin-auth .auth-btn.loading .spinner{ display:block; } #maermin-auth .auth-btn.loading .btn-text{ display:none; }
    @keyframes spin { to { transform: rotate(360deg); } }
    #maermin-auth .auth-alt { width:100%; margin-top:.75rem; padding:.75rem; background:transparent;
      border:1px solid rgba(255,255,255,0.12); border-radius:10px; color:rgba(255,255,255,0.8);
      font-size:.9rem; cursor:pointer; transition:all .2s; }
    #maermin-auth .auth-alt:hover{ border-color:#f5a524; color:#f5a524; }
    #maermin-auth .auth-footer { margin-top: 1.5rem; text-align:center; color: rgba(255,255,255,0.3); font-size: 0.72rem; line-height: 1.6; }
    #maermin-auth .rc-code { font-family: ui-monospace,'SF Mono',Menlo,monospace; font-size:1.1rem;
      letter-spacing:0.05em; color:#ffd479; background:#0f172a; border:1px solid #334155; border-radius:10px;
      padding:1rem; text-align:center; word-break:break-all; margin-bottom:0.9rem; user-select:all; }
    #maermin-auth .rc-actions { display:flex; gap:0.5rem; margin-bottom:0.6rem; }
    #maermin-auth .rc-actions .auth-alt { margin-top:0; flex:1; padding:0.6rem; font-size:0.82rem; }
  `;

  function setError(msg) {
    var box = document.getElementById('auth-error');
    if (!box) return;
    if (msg) { box.textContent = msg; box.classList.add('visible'); }
    else box.classList.remove('visible');
  }
  function setLoading(on) {
    var btn = document.getElementById('auth-submit');
    if (!btn) return;
    btn.classList.toggle('loading', on);
    btn.disabled = on;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Recovery-kit helpers (shared by setup screen + Settings re-enroll)
  // ─────────────────────────────────────────────────────────────────────────
  function recoveryFileText(code) {
    return [
      'MAERMIN — Vault Recovery Code',
      '================================',
      '',
      'Recovery code:',
      '    ' + code,
      '',
      'Use this on the unlock screen ("Use a recovery code") to open your vault',
      'if you forget your password. MAERMIN cannot reset it for you.',
      '',
      '• Anyone with this code can open your vault — keep it offline and private.',
      '• It is NEVER uploaded; only a one-way wrapped copy lives on this device.',
      '• Changing your password invalidates this code — generate a new one after.',
      '',
      'Generated: ' + new Date().toISOString()
    ].join('\n');
  }
  function downloadText(filename, text) {
    try {
      var url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 0);
    } catch (e) { console.error('[MAERMIN Auth] download failed:', e); }
  }
  function printText(text) {
    try {
      var w = window.open('', '_blank');
      if (!w) return;
      var esc = text.replace(/[&<>]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]; });
      w.document.write('<title>MAERMIN Recovery Code</title><pre style="font:14px ui-monospace,Menlo,monospace;padding:24px;white-space:pre-wrap">' + esc + '</pre>');
      w.document.close(); w.focus(); w.print();
    } catch (e) { console.error('[MAERMIN Auth] print failed:', e); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Screen builders
  // ─────────────────────────────────────────────────────────────────────────
  function overlayShell(innerHtml) {
    var el = document.createElement('div');
    el.id = 'maermin-auth';
    el.innerHTML = '<style>' + STYLE + '</style><div class="auth-card">' + innerHtml + '</div>';
    return el;
  }

  function setupInner(hasLegacyData) {
    return `
      <div class="auth-logo"><h1>MAERMIN</h1><p>Secure your vault</p></div>
      <div class="auth-sub">${hasLegacyData
        ? 'Set an access password. Your existing data will be encrypted with it.'
        : 'Set an access password to encrypt your portfolio. There is no recovery — store it safely.'}</div>
      <div class="auth-error" id="auth-error"></div>
      <div class="auth-field">
        <label for="auth-pw">Access password</label>
        <input type="password" id="auth-pw" placeholder="At least 8 characters" autocomplete="new-password" autofocus />
      </div>
      <div class="auth-field">
        <label for="auth-pw2">Confirm password</label>
        <input type="password" id="auth-pw2" placeholder="Repeat password" autocomplete="new-password" />
      </div>
      <label class="auth-check"><input type="checkbox" id="auth-atrest" checked />
        <span>Encrypt my portfolio data at rest (AES-256). Recommended.</span></label>
      <button class="auth-btn" id="auth-submit"><div class="spinner"></div><span class="btn-text">Create vault →</span></button>
      <div class="auth-footer">Encrypted locally with ${Vault && Vault.availableKdfs().indexOf('argon2id') > -1 ? 'Argon2id' : 'PBKDF2'} + AES-256-GCM.<br>All data stays in your browser.</div>
    `;
  }

  function unlockInner(hasPasskey, hasRecovery, locked) {
    return `
      <div class="auth-logo"><h1>MAERMIN</h1><p>${locked ? 'Locked' : 'Professional Portfolio Tracker'}</p></div>
      ${locked ? '<div class="auth-sub">Session locked due to inactivity.</div>' : ''}
      <div class="auth-error" id="auth-error"></div>
      <div class="auth-field">
        <label for="auth-pw">Access password</label>
        <input type="password" id="auth-pw" placeholder="Enter your password…" autocomplete="current-password" autofocus />
      </div>
      <button class="auth-btn" id="auth-submit"><div class="spinner"></div><span class="btn-text">Unlock →</span></button>
      ${hasPasskey ? '<button class="auth-alt" id="auth-passkey" type="button">Use a passkey</button>' : ''}
      ${hasRecovery ? '<button class="auth-alt" id="auth-recovery" type="button">Use a recovery code</button>' : ''}
      <div class="auth-footer">All data stays local in your browser.</div>
    `;
  }

  // One-time recovery-code reveal shown right after vault creation. The vault is
  // already unlocked at this point; "Continue" just mounts the app.
  function recoveryKitInner(code) {
    return `
      <div class="auth-logo"><h1>MAERMIN</h1><p>Recovery code</p></div>
      <div class="auth-sub">Save this now — it's the <b>only</b> way into your vault if you forget your password. MAERMIN can't reset it for you.</div>
      <div class="rc-code" id="rc-code">${code}</div>
      <div class="rc-actions">
        <button class="auth-alt" id="rc-copy" type="button">Copy</button>
        <button class="auth-alt" id="rc-download" type="button">Download</button>
        <button class="auth-alt" id="rc-print" type="button">Print</button>
      </div>
      <label class="auth-check"><input type="checkbox" id="rc-saved" />
        <span>I've saved my recovery code somewhere safe and private.</span></label>
      <button class="auth-btn" id="auth-submit" disabled><div class="spinner"></div><span class="btn-text">Continue →</span></button>
      <div class="auth-footer">Never uploaded — anyone with this code can open your vault.</div>
    `;
  }

  function recoveryUnlockInner() {
    return `
      <div class="auth-logo"><h1>MAERMIN</h1><p>Recovery</p></div>
      <div class="auth-sub">Enter your recovery code to unlock without your password.</div>
      <div class="auth-error" id="auth-error"></div>
      <div class="auth-field">
        <label for="auth-rc">Recovery code</label>
        <input type="text" id="auth-rc" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" autofocus />
      </div>
      <button class="auth-btn" id="auth-submit"><div class="spinner"></div><span class="btn-text">Unlock →</span></button>
      <button class="auth-alt" id="auth-back" type="button">Back to password</button>
      <div class="auth-footer">Changing your password invalidates the recovery code.</div>
    `;
  }

  function legacyHasData() {
    try {
      return !!(localStorage.getItem('transactions') || localStorage.getItem('maermin_portfolios'));
    } catch (e) { return false; }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Handlers
  // ─────────────────────────────────────────────────────────────────────────
  function audit(type, detail) {
    try { if (window.MaerminAuditLog) window.MaerminAuditLog.record(type, detail); } catch (e) {}
  }

  function finishUnlock() {
    _everUnlocked = true;
    _resolveUnlock(true);
    var overlay = document.getElementById('maermin-auth');
    if (overlay) {
      overlay.style.transition = 'opacity 0.4s ease-out';
      overlay.style.opacity = '0';
      setTimeout(function () { if (overlay.parentNode) overlay.remove(); }, 420);
    }
  }

  function handleSetup() {
    var pw = (document.getElementById('auth-pw').value || '');
    var pw2 = (document.getElementById('auth-pw2').value || '');
    var atRest = document.getElementById('auth-atrest').checked;
    if (pw.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (pw !== pw2) { setError('Passwords do not match.'); return; }
    setError(''); setLoading(true);

    Vault.create(pw)
      .then(function () {
        try { sessionStorage.removeItem(LEGACY_SESSION_KEY); } catch (e) {}
        if (atRest && Storage) return Storage.enableAtRest();
      })
      // Generate a recovery kit so a forgotten password is recoverable. If the
      // enrollment itself fails we still let the user in (the vault is created).
      .then(function () {
        return Vault.enrollRecovery().then(
          function (kit) {
            audit('vault.setup', 'vault created' + (atRest ? ' (encrypted at rest)' : '') + ' + recovery kit');
            setLoading(false);
            showScreen('recovery-kit', { code: kit.code });
          },
          function (e) {
            console.error('[MAERMIN Auth] recovery enroll failed:', e);
            audit('vault.setup', 'vault created (recovery kit unavailable)');
            finishUnlock();
          }
        );
      })
      .catch(function (e) {
        console.error('[MAERMIN Auth] setup failed:', e);
        setError('Could not create the vault. ' + (e && e.message === 'crypto-unsupported' ? 'WebCrypto unavailable in this browser.' : 'Please try again.'));
        setLoading(false);
      });
  }

  // Continue from the one-time recovery-code reveal — vault is already unlocked.
  function handleRecoveryContinue() { finishUnlock(); }

  function wireRecoveryKit(code) {
    var saved = document.getElementById('rc-saved');
    var submit = document.getElementById('auth-submit');
    if (saved && submit) saved.addEventListener('change', function () { submit.disabled = !saved.checked; });
    var copy = document.getElementById('rc-copy');
    if (copy) copy.addEventListener('click', function () {
      try {
        navigator.clipboard.writeText(code).then(function () {
          copy.textContent = 'Copied ✓'; setTimeout(function () { copy.textContent = 'Copy'; }, 1500);
        }, function () {});
      } catch (e) {}
    });
    var dl = document.getElementById('rc-download');
    if (dl) dl.addEventListener('click', function () { downloadText('maermin-recovery-code.txt', recoveryFileText(code)); });
    var pr = document.getElementById('rc-print');
    if (pr) pr.addEventListener('click', function () { printText(recoveryFileText(code)); });
  }

  function handleRecoveryUnlock() {
    var input = document.getElementById('auth-rc');
    var code = (input.value || '');
    if (!code.trim()) { input.focus(); return; }
    setError(''); setLoading(true); input.classList.remove('error');

    Vault.unlockWithRecovery(code)
      .then(function () { return Storage ? Storage.resume() : null; })
      .then(function () { audit('vault.unlock.recovery', 'unlocked with recovery code'); finishUnlock(); })
      .catch(function (e) {
        input.classList.add('error');
        setError(e && e.message === 'bad-recovery-code' ? 'That recovery code is not valid.' : 'Recovery failed. Please try again.');
        setLoading(false); input.focus();
        setTimeout(function () { input.classList.remove('error'); }, 600);
      });
  }

  function handleUnlock() {
    var input = document.getElementById('auth-pw');
    var pw = (input.value || '');
    if (!pw) { input.focus(); return; }
    setError(''); setLoading(true); input.classList.remove('error');

    Vault.unlock(pw)
      .then(function () { return Storage ? Storage.resume() : null; })
      .then(function () { audit('vault.unlock', 'unlocked with password'); finishUnlock(); })
      .catch(function (e) {
        input.classList.add('error');
        setError(e && e.message === 'bad-password' ? 'Incorrect password. Please try again.' : 'Unlock failed. Please try again.');
        input.value = ''; input.focus(); setLoading(false);
        setTimeout(function () { input.classList.remove('error'); }, 600);
      });
  }

  function handlePasskey() {
    setError(''); setLoading(true);
    Vault.unlockWithPasskey()
      .then(function () { return Storage ? Storage.resume() : null; })
      .then(function () { audit('vault.unlock.passkey', 'unlocked with passkey'); finishUnlock(); })
      .catch(function () { setError('Passkey unlock failed. Use your password.'); setLoading(false); });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render a screen + bind events
  // ─────────────────────────────────────────────────────────────────────────
  function showScreen(mode, opts) {
    opts = opts || {};
    var existing = document.getElementById('maermin-auth');
    if (existing) existing.remove();

    var inner, onSubmit;
    if (mode === 'setup') { inner = setupInner(opts.hasLegacyData); onSubmit = handleSetup; }
    else if (mode === 'recovery-kit') { inner = recoveryKitInner(opts.code); onSubmit = handleRecoveryContinue; }
    else if (mode === 'recovery-unlock') { inner = recoveryUnlockInner(); onSubmit = handleRecoveryUnlock; }
    else { inner = unlockInner(opts.hasPasskey, opts.hasRecovery, opts.locked); onSubmit = handleUnlock; }

    var overlay = overlayShell(inner);
    document.body.appendChild(overlay);

    document.getElementById('auth-submit').addEventListener('click', onSubmit);
    var fields = overlay.querySelectorAll('input[type="password"], #auth-rc');
    fields.forEach(function (f) {
      f.addEventListener('keydown', function (e) { if (e.key === 'Enter') onSubmit(); });
    });
    var pk = document.getElementById('auth-passkey');
    if (pk) pk.addEventListener('click', handlePasskey);
    var rc = document.getElementById('auth-recovery');
    if (rc) rc.addEventListener('click', function () { showScreen('recovery-unlock', {}); });
    var back = document.getElementById('auth-back');
    if (back) back.addEventListener('click', function () {
      var m = Vault.getMeta();
      showScreen('unlock', { hasPasskey: m && m.hasPasskey, hasRecovery: m && m.hasRecovery });
    });
    if (mode === 'recovery-kit') wireRecoveryKit(opts.code);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Init
  // ─────────────────────────────────────────────────────────────────────────
  function init() {
    if (!Vault || !Vault.isSupported()) {
      // No WebCrypto → cannot secure the vault. Fail closed with a message.
      var el = overlayShell('<div class="auth-logo"><h1>MAERMIN</h1></div><div class="auth-sub">This browser does not support the Web Crypto API required to unlock your vault. Please use a modern browser.</div>');
      document.body.appendChild(el);
      return;
    }

    var meta = Vault.getMeta();
    if (!meta) {
      showScreen('setup', { hasLegacyData: legacyHasData() });
    } else {
      showScreen('unlock', { hasPasskey: meta.hasPasskey, hasRecovery: meta.hasRecovery });
    }

    // Idle auto-lock → re-show the unlock screen (without reload, key already wiped).
    Vault.onLock(function () {
      if (!_everUnlocked) return;
      var m = Vault.getMeta();
      showScreen('unlock', { hasPasskey: m && m.hasPasskey, hasRecovery: m && m.hasRecovery, locked: true });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────
  window.MaerminAuth = {
    /** App mount gate — resolves once the vault is unlocked. */
    whenUnlocked: function () { return _unlockedPromise; },
    isUnlocked: function () { return !!(Vault && Vault.isUnlocked()); },
    /** Lock now (wipes key, re-shows unlock screen via onLock). */
    lock: function () { if (Vault) Vault.lock(); },
    /** Lock + reload to a clean state. */
    logout: function () { if (Vault) Vault.lock(); window.location.reload(); },
    /** Change the access password and re-encrypt the data blob under the new key. */
    changePassword: function (oldPw, newPw) {
      return Vault.changePassword(oldPw, newPw).then(function () {
        audit('vault.password.change', 'access password changed');
        return Storage && Storage.isEnabled() ? Storage.rekey() : true;
      });
    },
    /** Enroll a platform passkey (Touch ID / Hello) for password-less unlock. */
    enrollPasskey: function (label) { return Vault.enrollPasskey(label); },
    /** Generate (or rotate) the printable recovery kit — resolves with { code }.
     *  The caller must surface the one-time code; it is never recoverable after. */
    enrollRecovery: function () { return Vault.enrollRecovery(); },
    /** Remove the recovery kit (e.g. user opts out). */
    removeRecovery: function () { return Vault.removeRecovery(); },
    /** Build the printable/downloadable recovery-code document (for re-enroll UIs). */
    recoveryFileText: recoveryFileText,
    /** Configure idle auto-lock (ms). */
    setAutoLock: function (ms) { if (Vault) Vault.configureAutoLock(ms); },
    /** Status for a settings UI. */
    getStatus: function () {
      var m = Vault && Vault.getMeta();
      return {
        hasVault: !!m, unlocked: !!(Vault && Vault.isUnlocked()),
        kdf: m && m.kdf, autoLockMs: m && m.autoLockMs, hasPasskey: !!(m && m.hasPasskey),
        hasRecovery: !!(m && m.hasRecovery),
        encryptedAtRest: !!(Storage && Storage.isEnabled()),
        passkeySupported: !!(Vault && Vault.passkeySupported())
      };
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
