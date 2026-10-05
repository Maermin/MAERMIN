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
  var STYLE = `
    #maermin-auth { position: fixed; inset: 0; z-index: 99999; overflow-y: auto; padding: 1.5rem;
      background:
        radial-gradient(760px 460px at 20% -5%, rgba(124,92,255,0.30) 0%, transparent 65%),
        radial-gradient(640px 420px at 85% 0%, rgba(56,189,248,0.14) 0%, transparent 65%),
        radial-gradient(900px 600px at 50% 115%, rgba(124,92,255,0.10) 0%, transparent 60%),
        #07080d;
      display: flex; align-items: center; justify-content: center; color: #f1f2f8;
      font-family: 'Geist', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      letter-spacing: -0.011em; -webkit-font-smoothing: antialiased; }
    #maermin-auth::before { content:''; position: fixed; inset: 0; pointer-events: none;
      background-image: linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(255,255,255,0.05) 1px, transparent 1px);
      background-size: 56px 56px;
      -webkit-mask-image: radial-gradient(700px 480px at 50% 30%, #000 0%, transparent 75%);
      mask-image: radial-gradient(700px 480px at 50% 30%, #000 0%, transparent 75%); }
    #maermin-auth .auth-card { position: relative; width: 100%; max-width: 420px; padding: 2.5rem 2.25rem 2rem;
      background: linear-gradient(180deg, rgba(23,24,36,0.82), rgba(15,16,24,0.88));
      border: 1px solid rgba(255,255,255,0.09); border-radius: 24px;
      box-shadow: 0 1px 0 rgba(255,255,255,0.06) inset, 0 40px 90px -30px rgba(0,0,0,0.9), 0 0 80px -20px rgba(124,108,255,0.25);
      backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
      animation: authFadeIn 0.6s cubic-bezier(0.16,1,0.3,1); }
    @keyframes authFadeIn { from { opacity:0; transform: translateY(14px) scale(0.98);} to { opacity:1; transform:none;} }
    #maermin-auth .auth-logo { text-align:center; margin-bottom: 1.6rem; display:flex; flex-direction:column; align-items:center; }
    #maermin-auth .auth-logo::before { content:''; width: 52px; height: 52px; border-radius: 16px; margin-bottom: 1.1rem;
      background:
        url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23fff' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 19V6l8 8 8-8v13'/%3E%3C/svg%3E") center / 30px no-repeat,
        linear-gradient(135deg, #a597ff 0%, #7c6cff 50%, #5b8cff 100%);
      box-shadow: 0 0 0 1px rgba(255,255,255,0.16) inset, 0 14px 40px -10px rgba(124,108,255,0.8); }
    #maermin-auth .auth-logo h1 { font-size: 1.35rem; font-weight: 700; letter-spacing: 0.22em; color: #f1f2f8; }
    #maermin-auth .auth-logo p { color: #8d91a7; font-size: 0.8rem; margin-top: 0.3rem; }
    #maermin-auth .auth-sub { color: #8d91a7; font-size:.82rem; text-align:center; margin: -0.4rem 0 1.4rem; line-height:1.55; }
    #maermin-auth .auth-field { position: relative; margin-bottom: 1rem; }
    #maermin-auth .auth-field label { display:block; color: #b5b8ca; font-size: 0.78rem; font-weight: 500; margin-bottom: 0.45rem; }
    #maermin-auth .auth-field input { width:100%; height: 46px; padding: 0 0.95rem; background: rgba(255,255,255,0.035);
      border:1px solid rgba(255,255,255,0.10); border-radius:12px; color:#f1f2f8; font: inherit; font-size:0.95rem; outline:none;
      transition: border-color .15s, box-shadow .15s, background .15s; }
    #maermin-auth .auth-field input::placeholder { color: #6d7188; }
    #maermin-auth .auth-field input:focus { border-color:#8b7cff; background: rgba(139,124,255,0.05); box-shadow:0 0 0 4px rgba(139,124,255,0.18); }
    #maermin-auth .auth-field input.error { border-color:#ff6b81; box-shadow:0 0 0 4px rgba(255,107,129,0.16); animation: shake .3s ease-out; }
    @keyframes shake { 0%,100%{transform:translateX(0);} 20%{transform:translateX(-6px);} 60%{transform:translateX(6px);} }
    #maermin-auth .auth-check { display:flex; gap:.6rem; align-items:flex-start; margin:.35rem 0 1.25rem;
      color: #a3a7bb; font-size:.8rem; line-height:1.45; cursor:pointer; }
    #maermin-auth .auth-check input { margin-top:.15rem; accent-color:#8b7cff; }
    #maermin-auth .auth-error { background: rgba(255,107,129,0.10); border:1px solid rgba(255,107,129,0.32);
      border-radius:12px; padding:0.7rem 0.9rem; color:#ffb3bf; font-size:0.84rem; margin-bottom:1rem; display:none; }
    #maermin-auth .auth-error.visible { display:block; }
    #maermin-auth .auth-btn { width:100%; height: 48px;
      background: linear-gradient(135deg, #a597ff 0%, #7c6cff 50%, #5b8cff 100%);
      border:none; border-radius:12px; color:#ffffff; font: inherit; font-size:0.95rem; font-weight:600; cursor:pointer;
      box-shadow: 0 1px 0 rgba(255,255,255,0.25) inset, 0 12px 28px -10px rgba(124,108,255,0.7);
      transition: transform .15s, box-shadow .2s, filter .15s; display:flex; align-items:center; justify-content:center; gap:0.5rem; }
    #maermin-auth .auth-btn:hover:not(:disabled){ filter:brightness(1.07); transform:translateY(-1px); box-shadow: 0 1px 0 rgba(255,255,255,0.25) inset, 0 18px 36px -12px rgba(124,108,255,0.85); }
    #maermin-auth .auth-btn:active:not(:disabled){ transform: scale(0.985); }
    #maermin-auth .auth-btn:disabled{ opacity:.7; cursor:not-allowed; transform:none; }
    #maermin-auth .auth-btn .spinner{ width:18px;height:18px;border:2px solid rgba(255,255,255,0.3);
      border-top-color:#ffffff;border-radius:50%;animation:spin .8s linear infinite;display:none; }
    #maermin-auth .auth-btn.loading .spinner{ display:block; } #maermin-auth .auth-btn.loading .btn-text{ display:none; }
    @keyframes spin { to { transform: rotate(360deg); } }
    #maermin-auth .auth-alt { width:100%; margin-top:.65rem; height: 44px; background: rgba(255,255,255,0.03);
      border:1px solid rgba(255,255,255,0.10); border-radius:12px; color:#d5d7e3; font: inherit;
      font-size:.86rem; font-weight: 500; cursor:pointer; transition: border-color .15s, background .15s, color .15s; }
    #maermin-auth .auth-alt:hover{ border-color: rgba(139,124,255,0.55); background: rgba(139,124,255,0.08); color:#fff; }
    #maermin-auth .auth-footer { margin-top: 1.5rem; padding-top: 1.1rem; border-top: 1px solid rgba(255,255,255,0.06);
      text-align:center; color: #6d7188; font-size: 0.72rem; line-height: 1.6; }
    #maermin-auth .rc-code { font-family: 'Geist Mono', ui-monospace,'SF Mono',Menlo,monospace; font-size:1.05rem;
      letter-spacing:0.05em; color:#c3b8ff; background: rgba(139,124,255,0.08); border:1px dashed rgba(139,124,255,0.4); border-radius:12px;
      padding:1rem; text-align:center; word-break:break-all; margin-bottom:0.9rem; user-select:all; }
    #maermin-auth .rc-actions { display:flex; gap:0.5rem; margin-bottom:0.6rem; }
    #maermin-auth .rc-actions .auth-alt { margin-top:0; flex:1; height: 38px; font-size:0.8rem; }
    #maermin-auth::after { content:''; position: fixed; inset: -20vmax; z-index: -1; pointer-events: none;
      background:
        radial-gradient(34vmax 28vmax at 25% 20%, rgba(124,108,255,0.38), transparent 70%),
        radial-gradient(30vmax 24vmax at 78% 18%, rgba(56,189,248,0.22), transparent 70%),
        radial-gradient(30vmax 24vmax at 55% 90%, rgba(236,72,153,0.14), transparent 70%);
      filter: blur(40px); animation: authAurora 22s ease-in-out infinite alternate; }
    #maermin-auth { isolation: isolate; }
    @keyframes authAurora { 0% { transform: translate3d(0,0,0) rotate(0) scale(1); } 50% { transform: translate3d(4vmax,3vmax,0) rotate(8deg) scale(1.08); } 100% { transform: translate3d(-3vmax,4vmax,0) rotate(-6deg) scale(1.04); } }
    #maermin-auth .auth-card::before { content:''; position:absolute; inset:-1px; border-radius: inherit; padding: 1px; pointer-events:none;
      background: conic-gradient(from var(--mx-angle, 0deg), transparent 0 70%, #8b7cff 84%, #38bdf8 93%, transparent);
      -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;
      mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
      animation: authSpin 6s linear infinite; }
    @keyframes authSpin { to { --mx-angle: 360deg; } }
    #maermin-auth .auth-logo::before { animation: authFloat 3.2s ease-in-out infinite; }
    @keyframes authFloat { 50% { transform: translateY(-5px); box-shadow: 0 0 0 1px rgba(255,255,255,0.16) inset, 0 22px 50px -10px rgba(124,108,255,0.95); } }
    #maermin-auth .auth-logo h1 { background: linear-gradient(90deg,#f1f2f8 0%,#f1f2f8 40%,#a597ff 50%,#f1f2f8 60%,#f1f2f8 100%); background-size: 300% 100%;
      -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; animation: authSheen 6s ease-in-out infinite; }
    @keyframes authSheen { 0%,55% { background-position: 100% 0; } 100% { background-position: -50% 0; } }
    #maermin-auth .auth-field, #maermin-auth .auth-check, #maermin-auth .auth-btn, #maermin-auth .auth-alt, #maermin-auth .auth-sub, #maermin-auth .auth-footer { animation: authRise .7s cubic-bezier(0.16,1,0.3,1) both; }
    #maermin-auth .auth-field:nth-of-type(2) { animation-delay: .06s; } #maermin-auth .auth-check { animation-delay: .12s; }
    #maermin-auth .auth-btn { animation-delay: .18s; } #maermin-auth .auth-footer { animation-delay: .26s; }
    @keyframes authRise { from { opacity: 0; transform: translateY(10px); filter: blur(4px); } to { opacity: 1; transform: none; filter: none; } }
    #maermin-auth .auth-btn { position: relative; overflow: hidden; }
    #maermin-auth .auth-btn::after { content:''; position:absolute; inset:0; background: linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.45) 50%, transparent 65%); transform: translateX(-120%); animation: authShine 4s ease-in-out infinite; }
    @keyframes authShine { 0%,60% { transform: translateX(-120%); } 100% { transform: translateX(120%); } }
    @media (prefers-reduced-motion: reduce) { #maermin-auth *, #maermin-auth::after, #maermin-auth .auth-card::before { animation: none !important; } }
    @media (max-width: 480px) { #maermin-auth .auth-card { padding: 2rem 1.4rem 1.6rem; border-radius: 20px; } }
  `;

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
      '• ' + tr('authRcKeepsOnPwChange', 'Changing your password does not change this code.'),
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
        : 'Set an access password to encrypt your portfolio. MAERMIN cannot reset it — the recovery code shown next is the only other way in.'}</div>
      <div class="auth-error" id="auth-error" role="alert"></div>
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
      <div class="auth-error" id="auth-error" role="alert"></div>
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
      <div class="auth-error" id="auth-error" role="alert"></div>
      <div class="auth-field">
        <label for="auth-rc">Recovery code</label>
        <input type="text" id="auth-rc" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" autofocus />
      </div>
      <button class="auth-btn" id="auth-submit"><div class="spinner"></div><span class="btn-text">Unlock →</span></button>
      <button class="auth-alt" id="auth-back" type="button">Back to password</button>
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
        setError('Could not create the vault. ' + (e && e.message === 'crypto-unsupported' ? 'WebCrypto unavailable in this browser.' : 'Please try again.'));
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
      .then(function (ok) { if (Storage && Storage.isEnabled() && ok === false) { Vault.lock(); throw new Error('decrypt-failed'); } })
      .then(function () { audit('vault.unlock.recovery', 'unlocked with recovery code'); setLoading(false); showScreen('new-password', {}); })
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
      .then(function (ok) { if (Storage && Storage.isEnabled() && ok === false) { Vault.lock(); throw new Error('decrypt-failed'); } })
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
      .then(function (ok) { if (Storage && Storage.isEnabled() && ok === false) { Vault.lock(); throw new Error('decrypt-failed'); } })
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
