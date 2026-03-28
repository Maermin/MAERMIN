// ============================================================================
// MAERMIN v7.0 - Shared Secret Authentication
// Client-side only – no server, no user database needed.
// The secret is hashed with SHA-256; only the HASH is stored here.
// To change the password: run hashSecret('yourNewPassword') in the console
// and replace MAERMIN_SECRET_HASH below.
// ============================================================================

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────
  // CONFIG
  // Default secret: "maermin2024"
  // To set your own: open browser console and run:
  //   MaerminAuth.generateHash('YourNewSecret').then(h => console.log(h))
  // Then replace the hash string below and commit.
  // ─────────────────────────────────────────────────────────────────────────
  const MAERMIN_SECRET_HASH = 'f62a8064fe60923839fe03b627f747987a2b9fec37888ecccb748157c966f54a';
  // ↑ SHA-256 of "maermin2024"  – change this after first login!

  const SESSION_KEY   = 'maermin_auth_session';
  const SESSION_TTL   = 8 * 60 * 60 * 1000; // 8 hours

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────
  async function sha256hex(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray  = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function isSessionValid() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return false;
      const { hash, expires } = JSON.parse(raw);
      if (Date.now() > expires) { sessionStorage.removeItem(SESSION_KEY); return false; }
      return hash === MAERMIN_SECRET_HASH;
    } catch { return false; }
  }

  function saveSession() {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      hash:    MAERMIN_SECRET_HASH,
      expires: Date.now() + SESSION_TTL
    }));
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UI
  // ─────────────────────────────────────────────────────────────────────────
  function buildLoginScreen() {
    const overlay = document.createElement('div');
    overlay.id = 'maermin-auth';
    overlay.innerHTML = `
      <style>
        #maermin-auth {
          position: fixed; inset: 0; z-index: 99999;
          background: linear-gradient(135deg, #0f172a 0%, #1a0533 50%, #0f172a 100%);
          display: flex; align-items: center; justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        #maermin-auth .auth-card {
          background: rgba(30,41,59,0.95);
          border: 1px solid rgba(139,92,246,0.3);
          border-radius: 20px;
          padding: 3rem;
          width: 100%;
          max-width: 420px;
          box-shadow: 0 25px 60px rgba(0,0,0,0.6), 0 0 40px rgba(139,92,246,0.1);
          backdrop-filter: blur(20px);
          animation: authFadeIn 0.5s ease-out;
        }
        @keyframes authFadeIn {
          from { opacity: 0; transform: translateY(-20px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)     scale(1);    }
        }
        #maermin-auth .auth-logo {
          text-align: center; margin-bottom: 2rem;
        }
        #maermin-auth .auth-logo h1 {
          font-size: 3rem; font-weight: 800; letter-spacing: -0.05em;
          background: linear-gradient(135deg, #3b82f6, #8b5cf6);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        #maermin-auth .auth-logo p {
          color: rgba(255,255,255,0.5); font-size: 0.8rem;
          letter-spacing: 0.15em; text-transform: uppercase; margin-top: 0.25rem;
        }
        #maermin-auth .auth-field {
          position: relative; margin-bottom: 1.25rem;
        }
        #maermin-auth .auth-field label {
          display: block; color: rgba(255,255,255,0.6);
          font-size: 0.75rem; letter-spacing: 0.05em;
          text-transform: uppercase; margin-bottom: 0.5rem;
        }
        #maermin-auth .auth-field input {
          width: 100%; padding: 0.875rem 1rem;
          background: #0f172a; border: 1px solid #334155;
          border-radius: 10px; color: white; font-size: 1rem;
          outline: none; transition: border-color 0.2s, box-shadow 0.2s;
        }
        #maermin-auth .auth-field input:focus {
          border-color: #7c3aed;
          box-shadow: 0 0 0 3px rgba(124,58,237,0.2);
        }
        #maermin-auth .auth-field input.error {
          border-color: #ef4444;
          box-shadow: 0 0 0 3px rgba(239,68,68,0.2);
          animation: shake 0.3s ease-out;
        }
        @keyframes shake {
          0%,100%{ transform:translateX(0);}
          20%    { transform:translateX(-6px); }
          60%    { transform:translateX(6px); }
        }
        #maermin-auth .auth-toggle-pw {
          position: absolute; right: 0.875rem; top: 2.45rem;
          background: none; border: none; color: rgba(255,255,255,0.4);
          cursor: pointer; font-size: 1.1rem; padding: 0;
          transition: color 0.2s;
        }
        #maermin-auth .auth-toggle-pw:hover { color: rgba(255,255,255,0.8); }
        #maermin-auth .auth-error {
          background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.4);
          border-radius: 8px; padding: 0.75rem 1rem;
          color: #fca5a5; font-size: 0.875rem; margin-bottom: 1rem;
          display: none;
        }
        #maermin-auth .auth-error.visible { display: block; }
        #maermin-auth .auth-btn {
          width: 100%; padding: 0.875rem;
          background: linear-gradient(135deg, #6d28d9, #7c3aed);
          border: none; border-radius: 10px;
          color: white; font-size: 1rem; font-weight: 600;
          cursor: pointer; transition: all 0.2s;
          display: flex; align-items: center; justify-content: center; gap: 0.5rem;
        }
        #maermin-auth .auth-btn:hover:not(:disabled) {
          background: linear-gradient(135deg, #7c3aed, #8b5cf6);
          transform: translateY(-1px);
          box-shadow: 0 8px 20px rgba(124,58,237,0.4);
        }
        #maermin-auth .auth-btn:disabled {
          opacity: 0.7; cursor: not-allowed; transform: none;
        }
        #maermin-auth .auth-btn .spinner {
          width: 18px; height: 18px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: white; border-radius: 50%;
          animation: spin 0.8s linear infinite; display: none;
        }
        #maermin-auth .auth-btn.loading .spinner { display: block; }
        #maermin-auth .auth-btn.loading .btn-text { display: none; }
        @keyframes spin { to { transform: rotate(360deg); } }
        #maermin-auth .auth-footer {
          margin-top: 1.5rem; text-align: center;
          color: rgba(255,255,255,0.3); font-size: 0.75rem; line-height: 1.6;
        }
        #maermin-auth .auth-footer a {
          color: rgba(139,92,246,0.7); text-decoration: none;
        }
        #maermin-auth .auth-footer a:hover { color: #8b5cf6; }
      </style>
      <div class="auth-card">
        <div class="auth-logo">
          <h1>MAERMIN</h1>
          <p>Professional Portfolio Tracker</p>
        </div>
        <div class="auth-field">
          <label for="auth-secret">Zugangscode</label>
          <input
            type="password"
            id="auth-secret"
            placeholder="Geheimcode eingeben..."
            autocomplete="current-password"
            autofocus
          />
          <button class="auth-toggle-pw" id="auth-toggle-pw" title="Passwort anzeigen">👁</button>
        </div>
        <div class="auth-error" id="auth-error">
          ❌ Falscher Zugangscode. Bitte erneut versuchen.
        </div>
        <button class="auth-btn" id="auth-submit">
          <div class="spinner"></div>
          <span class="btn-text">Zugang öffnen →</span>
        </button>
        <div class="auth-footer">
          Alle Daten bleiben lokal in deinem Browser.<br>
          <a href="https://github.com/Maermin/MAERMIN" target="_blank" rel="noopener">MAERMIN v7.0 auf GitHub</a>
        </div>
      </div>
    `;
    return overlay;
  }

  async function handleLogin() {
    const input     = document.getElementById('auth-secret');
    const errorBox  = document.getElementById('auth-error');
    const btn       = document.getElementById('auth-submit');

    const secret = input.value.trim();
    if (!secret) { input.focus(); return; }

    // Show loading
    btn.classList.add('loading');
    btn.disabled = true;
    errorBox.classList.remove('visible');
    input.classList.remove('error');

    try {
      const hash = await sha256hex(secret);
      // Artificial tiny delay so the spinner is visible
      await new Promise(r => setTimeout(r, 300));

      if (hash === MAERMIN_SECRET_HASH) {
        saveSession();
        const overlay = document.getElementById('maermin-auth');
        overlay.style.transition = 'opacity 0.4s ease-out';
        overlay.style.opacity = '0';
        setTimeout(() => overlay.remove(), 420);
      } else {
        input.classList.add('error');
        errorBox.classList.add('visible');
        input.value = '';
        input.focus();
        btn.classList.remove('loading');
        btn.disabled = false;
        setTimeout(() => input.classList.remove('error'), 600);
      }
    } catch (e) {
      console.error('[MAERMIN Auth] Error:', e);
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Init
  // ─────────────────────────────────────────────────────────────────────────
  function init() {
    if (isSessionValid()) return; // already authenticated

    const screen = buildLoginScreen();
    document.body.appendChild(screen);

    // Submit on button click
    document.getElementById('auth-submit').addEventListener('click', handleLogin);

    // Submit on Enter
    document.getElementById('auth-secret').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleLogin();
    });

    // Toggle password visibility
    document.getElementById('auth-toggle-pw').addEventListener('click', () => {
      const inp = document.getElementById('auth-secret');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API (accessible via MaerminAuth.xxx in the console)
  // ─────────────────────────────────────────────────────────────────────────
  window.MaerminAuth = {
    /** Generate a new hash for a secret → paste result into MAERMIN_SECRET_HASH */
    generateHash: sha256hex,
    /** Force logout (clears session) */
    logout: () => { clearSession(); window.location.reload(); }
  };

  // Run immediately
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
