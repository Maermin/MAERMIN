// ============================================================================
// MAERMIN - Electron main process
// ----------------------------------------------------------------------------
// The desktop app is a thin, locked-down shell around the same web UI that runs
// on GitHub Pages. All data lives in the renderer's (encrypted) storage; the
// renderer never used the old IPC surface (JSON "database", alerts, workspaces,
// plugin loader, arbitrary-path file import), so it was removed - it only added
// attack surface (any XSS became a local file read) and crash paths.
//
// Hardening:
//   - contextIsolation + sandbox, no nodeIntegration, minimal preload
//   - no in-app navigation away from the bundled index.html; http(s) links open
//     in the system browser, everything else is blocked
//   - no new BrowserWindows from window.open (except blank print windows)
//   - permission requests denied except clipboard + notifications
//   - single instance; window bounds validated against the connected displays
//   - no globalShortcut (it hijacked Ctrl+R/N/K in every other application)
// ============================================================================

const { app, BrowserWindow, Menu, dialog, shell, screen, session } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_VERSION = require('./package.json').version;
const INDEX_URL = require('url').pathToFileURL(path.join(__dirname, 'index.html')).href;

let mainWindow = null;

// ---- window bounds ----------------------------------------------------------
function boundsFile() { return path.join(app.getPath('userData'), 'window-bounds.json'); }

function loadBounds() {
  const fallback = { width: 1600, height: 1000 };
  try {
    const b = JSON.parse(fs.readFileSync(boundsFile(), 'utf8'));
    if (!b || !(b.width > 0) || !(b.height > 0)) return fallback;
    // Drop a saved position that is no longer on any display (monitor removed).
    if (typeof b.x === 'number' && typeof b.y === 'number') {
      const visible = screen.getAllDisplays().some((d) => {
        const a = d.workArea;
        return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
      });
      if (!visible) return { width: b.width, height: b.height };
    }
    return b;
  } catch (e) {
    return fallback;
  }
}

function saveBounds(win) {
  try {
    if (!win || win.isDestroyed()) return;
    fs.mkdirSync(path.dirname(boundsFile()), { recursive: true });
    fs.writeFileSync(boundsFile(), JSON.stringify(win.getNormalBounds()));
  } catch (e) {
    console.error('[MAERMIN] could not save window bounds:', e.message);
  }
}

// ---- navigation guards ------------------------------------------------------
function isHttpUrl(u) {
  try { const p = new URL(u).protocol; return p === 'https:' || p === 'http:'; } catch (e) { return false; }
}

function hardenContents(contents) {
  // Links with target=_blank / window.open: http(s) goes to the system browser.
  // about:blank is allowed so the recovery-code "Print" window keeps working.
  contents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || url === '') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
        }
      };
    }
    if (isHttpUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // The app is a single page: never navigate the window itself anywhere else.
  contents.on('will-navigate', (event, url) => {
    if (url === INDEX_URL || url.startsWith(INDEX_URL + '?') || url.startsWith(INDEX_URL + '#')) return;
    event.preventDefault();
    if (isHttpUrl(url)) shell.openExternal(url);
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

// ---- main window ------------------------------------------------------------
function createMainWindow() {
  const bounds = loadBounds();
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 1024,
    minHeight: 700,
    title: `MAERMIN v${APP_VERSION}`,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#080b11',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => mainWindow && mainWindow.show());
  mainWindow.on('close', () => saveBounds(mainWindow));
  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow;
}

// ---- menu ---------------------------------------------------------------------
// Only standard roles: the web UI already handles its own shortcuts (Ctrl+K,
// g+key, ...) through keydown listeners, so no accelerators are needed here.
function createApplicationMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [isMac ? { role: 'close' } : { role: 'quit' }] },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' },
    {
      label: 'Help',
      submenu: [{
        label: 'About MAERMIN',
        click: () => dialog.showMessageBox(mainWindow, {
          type: 'info',
          title: 'About MAERMIN',
          message: `MAERMIN v${APP_VERSION}`,
          detail: 'Multi-Asset Portfolio Tracker\n\nAll data stays encrypted on this device.'
        })
      }]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- lifecycle ------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  // A second instance would open a second window on the same storage and race
  // the encrypted-store writes. Focus the running one instead.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('web-contents-created', (_event, contents) => hardenContents(contents));

  app.whenReady().then(() => {
    // Deny camera/mic/geolocation/etc. WebAuthn (passkeys) does not go through
    // this handler; notifications + clipboard are what the app actually uses.
    const allowed = new Set(['notifications', 'clipboard-sanitized-write', 'clipboard-read']);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));

    createApplicationMenu();
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
