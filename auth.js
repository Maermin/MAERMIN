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
  var _unlockListeners = [];

  // Translation lookup for this pre-React screen. The dictionary and prefs
  // load after this file, but init() runs at DOMContentLoaded, so both exist
  // by the time a screen is built. Falls back to English, then to `fb`.
  function tr(key, fb) {
    try {
      var T = window.completeTranslations;
      var lang = (window.MaerminPrefs && window.MaerminPrefs.get('language')) || 'en';
      return (T && T[lang] && T[lang][key]) || (T && T.en && T.en[key]) || fb;
    } catch (e) { return fb; }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Styles (shared by setup / unlock / lock)
  // ─────────────────────────────────────────────────────────────────────────
  // The lock-screen styles live in styles.css (no inline <style>: SEC-020).

  // The box is role="alert": screen readers announce the message. The fields
  // point at it (aria-describedby) and are marked aria-invalid while it shows.
  // Clearing first makes a repeated identical message ("Incorrect password")
  // announce again.
  function setError(msg) {
    var box = document.getElementById('auth-error');
    if (!box) return;
    ['auth-pw', 'auth-pw2', 'auth-rc'].forEach(function (id) {
      var f = document.getElementById(id);
      if (!f) return;
      if (msg) { f.setAttribute('aria-invalid', 'true'); f.setAttribute('aria-describedby', 'auth-error'); }
      else { f.removeAttribute('aria-invalid'); f.removeAttribute('aria-describedby'); }
    });
    if (msg) {
      box.textContent = '';
      box.classList.add('visible');
      setTimeout(function () { box.textContent = msg; }, 30);
    } else box.classList.remove('visible');
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
      'MAERMIN — ' + tr('authRcFileTitle', 'Vault Recovery Code'),
      '================================',
      '',
      tr('authRcFileCode', 'Recovery code:'),
      '    ' + code,
      '',
      tr('authRcFileUse1', 'Use this on the unlock screen ("Use a recovery code") to open your vault'),
      tr('authRcFileUse2', 'if you forget your password. MAERMIN cannot reset it for you.'),
      '',
      '• ' + tr('authRcFileAnyone', 'Anyone with this code can open your vault — keep it offline and private.'),
      '• ' + tr('authRcFileNever', 'It is NEVER uploaded; only a one-way wrapped copy lives on this device.'),
      '• ' + tr('authRcKeepsOnPwChange', 'Changing your password does not change this code.'),
      '',
      tr('authRcFileGenerated', 'Generated:') + ' ' + new Date().toISOString()
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
      w.document.write('<title>MAERMIN Recovery Code</title><pre id="rc">' + esc + '</pre>');
        try { var pre = w.document.getElementById('rc'); pre.style.font = '14px ui-monospace,Menlo,monospace'; pre.style.padding = '24px'; pre.style.whiteSpace = 'pre-wrap'; } catch (e) {} // CSSOM: allowed without 'unsafe-inline'
      w.document.close(); w.focus(); w.print();
    } catch (e) { console.error('[MAERMIN Auth] print failed:', e); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Screen builders
  // ─────────────────────────────────────────────────────────────────────────
  function overlayShell(innerHtml) {
    var el = document.createElement('div');
    el.id = 'maermin-auth';
    el.innerHTML = '<div class="auth-card">' + innerHtml + '</div>';
    return el;
  }

  function setupInner(hasLegacyData) {
    return `
      <div class="auth-logo"><h1>MAERMIN</h1><p>${tr('authSecureVault', 'Secure your vault')}</p></div>
      <div class="auth-sub">${hasLegacyData
        ? tr('authSetupLegacy', 'Set an access password. Your existing data will be encrypted with it.')
        : tr('authSetupNew', 'Set an access password to encrypt your portfolio. MAERMIN cannot reset it — the recovery code shown next is the only other way in.')}</div>
      <div class="auth-error" id="auth-error" role="alert"></div>
      <div class="auth-field">
        <label for="auth-pw">${tr('authAccessPw', 'Access password')}</label>
        <input type="password" id="auth-pw" placeholder="${tr('authPwMinHint', 'At least 8 characters')}" autocomplete="new-password" autofocus />
      </div>
      <div class="auth-field">
        <label for="auth-pw2">${tr('authConfirmPw', 'Confirm password')}</label>
        <input type="password" id="auth-pw2" placeholder="${tr('authPwRepeat', 'Repeat password')}" autocomplete="new-password" />
      </div>
      <label class="auth-check"><input type="checkbox" id="auth-atrest" checked />
        <span>${tr('authAtRest', 'Encrypt my portfolio data at rest (AES-256). Recommended.')}</span></label>
      <button class="auth-btn" id="auth-submit"><div class="spinner"></div><span class="btn-text">${tr('authCreateVault', 'Create vault →')}</span></button>
      <div class="auth-footer">${tr('authEncryptedWith', 'Encrypted locally with {kdf} + AES-256-GCM.').replace('{kdf}', Vault && Vault.availableKdfs().indexOf('argon2id') > -1 ? 'Argon2id' : 'PBKDF2')}<br>${tr('authStaysInBrowser', 'All data stays in your browser.')}</div>
    `;
  }

  function unlockInner(hasPasskey, hasRecovery, locked) {
    return `
      <div class="auth-logo"><h1>MAERMIN</h1><p>${locked ? tr('authLocked', 'Locked') : tr('authTagline', 'Professional Portfolio Tracker')}</p></div>
      ${locked ? '<div class="auth-sub">' + tr('authLockedIdle', 'Session locked due to inactivity.') + '</div>' : ''}
      <div class="auth-error" id="auth-error" role="alert"></div>
      <div class="auth-field">
        <label for="auth-pw">${tr('authAccessPw', 'Access password')}</label>
        <input type="password" id="auth-pw" placeholder="${tr('authEnterPw', 'Enter your password…')}" autocomplete="current-password" autofocus />
      </div>
      <button class="auth-btn" id="auth-submit"><div class="spinner"></div><span class="btn-text">${tr('authUnlock', 'Unlock →')}</span></button>
      ${hasPasskey ? '<button class="auth-alt" id="auth-passkey" type="button">' + tr('authUsePasskey', 'Use a passkey') + '</button>' : ''}
      ${hasRecovery ? '<button class="auth-alt" id="auth-recovery" type="button">' + tr('authUseRecovery', 'Use a recovery code') + '</button>' : ''}
      <div class="auth-footer">${tr('authStaysLocal', 'All data stays local in your browser.')}</div>
    `;
  }

  // One-time recovery-code reveal shown right after vault creation. The vault is
  // already unlocked at this point; "Continue" just mounts the app.
  function recoveryKitInner(code) {
    return `
      <div class="auth-logo"><h1>MAERMIN</h1><p>${tr('secRecovery', 'Recovery code')}</p></div>
      <div class="auth-sub">${tr('authRcSaveNow', "Save this now — it's the <b>only</b> way into your vault if you forget your password. MAERMIN can't reset it for you.")}</div>
      <div class="rc-code" id="rc-code">${code}</div>
      <div class="rc-actions">
        <button class="auth-alt" id="rc-copy" type="button">${tr('authCopy', 'Copy')}</button>
        <button class="auth-alt" id="rc-download" type="button">${tr('authDownload', 'Download')}</button>
        <button class="auth-alt" id="rc-print" type="button">${tr('authPrint', 'Print')}</button>
      </div>
      <div class="auth-sub" id="rc-copy-msg" role="status" aria-live="polite"></div>
      <label class="auth-check"><input type="checkbox" id="rc-saved" />
        <span>${tr('authRcSaved', "I've saved my recovery code somewhere safe and private.")}</span></label>
      <button class="auth-btn" id="auth-submit" disabled><div class="spinner"></div><span class="btn-text">${tr('authContinue', 'Continue →')}</span></button>
      <div class="auth-footer">${tr('authRcNeverUploaded', 'Never uploaded — anyone with this code can open your vault.')}</div>
    `;
  }

  function recoveryUnlockInner() {
    return `
      <div class="auth-logo"><h1>MAERMIN</h1><p>${tr('authRecovery', 'Recovery')}</p></div>
      <div class="auth-sub">${tr('authRcEnter', 'Enter your recovery code to unlock without your password.')}</div>
      <div class="auth-error" id="auth-error" role="alert"></div>
      <div class="auth-field">
        <label for="auth-rc">${tr('secRecovery', 'Recovery code')}</label>
        <input type="text" id="auth-rc" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" autofocus />
      </div>
      <button class="auth-btn" id="auth-submit"><div class="spinner"></div><span class="btn-text">${tr('authUnlock', 'Unlock →')}</span></button>
      <button class="auth-alt" id="auth-back" type="button">${tr('authBackToPw', 'Back to password')}</button>
      <div class="auth-footer">${tr('authRcNextStep', 'After unlocking you set a new password.')}</div>
    `;
  }

  // Right after a recovery-code unlock: the user has forgotten the password,
  // so they set a new one (re-wraps the unlocked data key; nothing else changes).
  function newPasswordInner() {
    return `
      <div class="auth-logo"><h1>MAERMIN</h1><p>${tr('authNewPwTitle', 'Set a new password')}</p></div>
      <div class="auth-sub">${tr('authNewPwSub', 'You unlocked with your recovery code. Set a new password now. Your data, recovery code and passkey stay as they are.')}</div>
      <div class="auth-error" id="auth-error" role="alert"></div>
      <div class="auth-field">
        <label for="auth-pw">${tr('authNewPwLabel', 'New password')}</label>
        <input type="password" id="auth-pw" placeholder="${tr('authPwMinHint', 'At least 8 characters')}" autocomplete="new-password" autofocus />
      </div>
      <div class="auth-field">
        <label for="auth-pw2">${tr('authNewPwConfirm', 'Confirm new password')}</label>
        <input type="password" id="auth-pw2" placeholder="${tr('authPwRepeat', 'Repeat password')}" autocomplete="new-password" />
      </div>
      <button class="auth-btn" id="auth-submit"><div class="spinner"></div><span class="btn-text">${tr('authNewPwSave', 'Save password')} →</span></button>
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
    _unlockListeners.forEach(function (cb) { try { cb(); } catch (e) {} });
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
    if (pw.length < 8) { setError(tr('authPwTooShort', 'Password must be at least 8 characters.')); return; }
    if (pw !== pw2) { setError(tr('authPwMismatch', 'Passwords do not match.')); return; }
    setError(''); setLoading(true);

    Vault.create(pw)
      .then(function () {
        try { sessionStorage.removeItem(LEGACY_SESSION_KEY); } catch (e) {}
        if (atRest && Storage) return Storage.enableAtRest();
      })
      // Generate a recovery kit so a forgotten password is recoverable. If the
      // enrollment itself fails we still let the user in (the vault is created).
      // The code stays pending until "Continue": a reload on the code screen
      // must not leave a recovery code the user never saw (FINDINGS M-7).
      .then(function () {
        return Vault.enrollRecovery({ pending: true }).then(
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
        setError(tr('authCreateFailed', 'Could not create the vault.') + ' ' + (e && e.message === 'crypto-unsupported' ? tr('authNoWebCrypto', 'WebCrypto unavailable in this browser.') : tr('authTryAgain', 'Please try again.')));
        setLoading(false);
      });
  }

  // Continue from the one-time recovery-code reveal — vault is already unlocked.
  function handleRecoveryContinue() {
    try { Vault.confirmRecovery(); } catch (e) { console.error('[MAERMIN Auth] confirm recovery failed:', e); }
    finishUnlock();
  }

  function handleNewPassword() {
    var pw = (document.getElementById('auth-pw').value || '');
    var pw2 = (document.getElementById('auth-pw2').value || '');
    if (pw.length < 8) { setError(tr('authPwTooShort', 'Password must be at least 8 characters.')); return; }
    if (pw !== pw2) { setError(tr('authPwMismatch', 'Passwords do not match.')); return; }
    setError(''); setLoading(true);
    Vault.setPassword(pw)
      .then(function () { audit('vault.password.reset', 'new password set after recovery-code unlock'); finishUnlock(); })
      .catch(function (e) {
        console.error('[MAERMIN Auth] set password failed:', e);
        setError(tr('authNewPwFailed', 'Could not save the new password. Please try again.'));
        setLoading(false);
      });
  }

  function wireRecoveryKit(code) {
    var saved = document.getElementById('rc-saved');
    var submit = document.getElementById('auth-submit');
    if (saved && submit) saved.addEventListener('change', function () { submit.disabled = !saved.checked; });
    var copy = document.getElementById('rc-copy');
    // A failed copy says so and selects the code for a manual copy (FINDINGS L-7).
    var copyFailed = function () {
      var msg = document.getElementById('rc-copy-msg');
      if (msg) msg.textContent = tr('rcCopyFailed', 'Copy failed. Select the code and copy it manually.');
      var el = document.getElementById('rc-code');
      try {
        var range = document.createRange(); range.selectNodeContents(el);
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      } catch (e) {}
    };
    if (copy) copy.addEventListener('click', function () {
      try {
        navigator.clipboard.writeText(code).then(function () {
          var msg = document.getElementById('rc-copy-msg');
          if (msg) msg.textContent = '';
          copy.textContent = tr('obCopied', 'Copied ✓'); setTimeout(function () { copy.textContent = tr('authCopy', 'Copy'); }, 1500);
        }, copyFailed);
      } catch (e) { copyFailed(); }
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
      .then(function (ok) { if (Storage && Storage.isEnabled() && ok === false) { Vault.lock(); throw new Error('decrypt-failed'); } })
      .then(function () { audit('vault.unlock.recovery', 'unlocked with recovery code'); setLoading(false); showScreen('new-password', {}); })
      .catch(function (e) {
        input.classList.add('error');
        setError(e && e.message === 'bad-recovery-code' ? tr('authRcInvalid', 'That recovery code is not valid.') : tr('authRcFailed', 'Recovery failed. Please try again.'));
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
      .then(function (ok) { if (Storage && Storage.isEnabled() && ok === false) { Vault.lock(); throw new Error('decrypt-failed'); } })
      .then(function () { audit('vault.unlock', 'unlocked with password'); finishUnlock(); })
      .catch(function (e) {
        input.classList.add('error');
        setError(e && e.message === 'bad-password' ? tr('authBadPw', 'Incorrect password. Please try again.') : tr('authUnlockFailed', 'Unlock failed. Please try again.'));
        input.value = ''; input.focus(); setLoading(false);
        setTimeout(function () { input.classList.remove('error'); }, 600);
      });
  }

  function handlePasskey() {
    setError(''); setLoading(true);
    Vault.unlockWithPasskey()
      .then(function () { return Storage ? Storage.resume() : null; })
      .then(function (ok) { if (Storage && Storage.isEnabled() && ok === false) { Vault.lock(); throw new Error('decrypt-failed'); } })
      .then(function () { audit('vault.unlock.passkey', 'unlocked with passkey'); finishUnlock(); })
      .catch(function () { setError(tr('authPasskeyFailed', 'Passkey unlock failed. Use your password.')); setLoading(false); });
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
    else if (mode === 'new-password') { inner = newPasswordInner(); onSubmit = handleNewPassword; }
    else { inner = unlockInner(opts.hasPasskey, opts.hasRecovery, opts.locked); onSubmit = handleUnlock; }

    var overlay = overlayShell(inner);
    document.body.appendChild(overlay);

    // One submit at a time: the handlers disable the button while they run,
    // and Enter must respect that too (FINDINGS M-8: setup and unlock could
    // run twice in parallel).
    var submitBtn = document.getElementById('auth-submit');
    function submitOnce() { if (!submitBtn.disabled) onSubmit(); }
    submitBtn.addEventListener('click', submitOnce);
    var fields = overlay.querySelectorAll('input[type="password"], #auth-rc');
    fields.forEach(function (f) {
      f.addEventListener('keydown', function (e) { if (e.key === 'Enter') submitOnce(); });
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
      var el = overlayShell('<div class="auth-logo"><h1>MAERMIN</h1></div><div class="auth-sub">' + tr('authNoCryptoApi', 'This browser does not support the Web Crypto API required to unlock your vault. Please use a modern browser.') + '</div>');
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
    /** Called after EVERY successful unlock (incl. re-unlock after auto-lock). */
    onUnlock: function (cb) { if (typeof cb === 'function') _unlockListeners.push(cb); },
    isUnlocked: function () { return !!(Vault && Vault.isUnlocked()); },
    /** Lock now (wipes key, re-shows unlock screen via onLock). */
    lock: function () { if (Vault) Vault.lock(); },
    /** Lock + reload to a clean state. */
    logout: function () { if (Vault) Vault.lock(); window.location.reload(); },
    /** Change the access password. Only the password wrapping of the data key
     *  changes (MaerminVault.setPassword): stored data, exchange credentials,
     *  passkey, recovery code, auto-lock and the sync account stay valid. */
    changePassword: function (oldPw, newPw) {
      return Vault.changePassword(oldPw, newPw).then(function () {
        audit('vault.password.change', 'access password changed');
        return true;
      });
    },
    /** Enroll a platform passkey (Touch ID / Hello) for password-less unlock. */
    enrollPasskey: function (label) { return Vault.enrollPasskey(label); },
    /** Generate (or rotate) the printable recovery kit — resolves with { code }.
     *  The caller must surface the one-time code; it is never recoverable after. */
    enrollRecovery: function (opts) { return Vault.enrollRecovery(opts); },
    /** Activate a pending recovery code once the user confirmed saving it. */
    confirmRecovery: function () { return Vault.confirmRecovery(); },
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
