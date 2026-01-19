// ============================================================================
// MAERMIN v6.0 - Advanced Desktop Portfolio Tracker
// Main Process with Multi-Window Support, SQLite, Backup & Plugin System
// ============================================================================

const { app, BrowserWindow, ipcMain, dialog, Notification, Menu, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ============================================================================
// CONFIGURATION
// ============================================================================

const APP_CONFIG = {
  name: 'MAERMIN',
  version: '6.0.0',
  dataDir: path.join(app.getPath('userData'), 'maermin-data'),
  backupDir: path.join(app.getPath('userData'), 'maermin-backups'),
  pluginDir: path.join(app.getPath('userData'), 'maermin-plugins'),
  importWatchDir: path.join(app.getPath('documents'), 'MAERMIN-Import')
};

// Ensure directories exist
[APP_CONFIG.dataDir, APP_CONFIG.backupDir, APP_CONFIG.pluginDir, APP_CONFIG.importWatchDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// ============================================================================
// WINDOW MANAGEMENT
// ============================================================================

let mainWindow = null;
const detachedWindows = new Map();
let workspaces = {};
let currentWorkspace = 'default';
let alerts = [];

function createMainWindow() {
  // Load saved window bounds
  const boundsFile = path.join(APP_CONFIG.dataDir, 'window-bounds.json');
  let bounds = { width: 1600, height: 1000 };
  
  if (fs.existsSync(boundsFile)) {
    try {
      bounds = JSON.parse(fs.readFileSync(boundsFile, 'utf8'));
    } catch (e) {
      console.error('Failed to load window bounds:', e);
    }
  }

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 1200,
    minHeight: 800,
    title: `MAERMIN v${APP_CONFIG.version}`,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#1e293b',
    show: false
  });

  mainWindow.loadFile('index.html');

  // Save window bounds on close
  mainWindow.on('close', () => {
    const bounds = mainWindow.getBounds();
    fs.writeFileSync(boundsFile, JSON.stringify(bounds));
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Create application menu
  createApplicationMenu();

  return mainWindow;
}

// ============================================================================
// DETACHABLE PANELS (Multi-Window)
// ============================================================================

ipcMain.handle('detach-panel', async (event, panelId, panelConfig) => {
  const { width, height, title, component } = panelConfig;
  
  const detachedWin = new BrowserWindow({
    width: width || 800,
    height: height || 600,
    title: `MAERMIN - ${title || panelId}`,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#1e293b'
  });

  detachedWin.loadFile('index.html', {
    query: { 
      detached: 'true', 
      panel: panelId,
      component: component
    }
  });

  detachedWindows.set(panelId, detachedWin);

  detachedWin.on('closed', () => {
    detachedWindows.delete(panelId);
    mainWindow?.webContents.send('panel-reattached', panelId);
  });

  return { success: true, windowId: detachedWin.id };
});

ipcMain.handle('get-detached-windows', () => {
  return Array.from(detachedWindows.keys());
});

ipcMain.handle('close-detached-window', (event, panelId) => {
  const win = detachedWindows.get(panelId);
  if (win) {
    win.close();
    return true;
  }
  return false;
});

// Sync state between windows
ipcMain.on('sync-state', (event, state) => {
  BrowserWindow.getAllWindows().forEach(win => {
    if (win.webContents.id !== event.sender.id) {
      win.webContents.send('state-updated', state);
    }
  });
});

// ============================================================================
// WORKSPACE MANAGEMENT
// ============================================================================

const workspacesFile = path.join(APP_CONFIG.dataDir, 'workspaces.json');

function loadWorkspaces() {
  if (fs.existsSync(workspacesFile)) {
    try {
      workspaces = JSON.parse(fs.readFileSync(workspacesFile, 'utf8'));
    } catch (e) {
      workspaces = createDefaultWorkspaces();
    }
  } else {
    workspaces = createDefaultWorkspaces();
  }
}

function createDefaultWorkspaces() {
  return {
    'default': {
      name: 'Default',
      panels: ['portfolio-summary', 'price-chart', 'watchlist'],
      layout: { type: 'horizontal', sizes: [40, 35, 25] },
      filters: {}
    },
    'tax-season': {
      name: 'Tax Season',
      panels: ['transactions', 'realized-gains', 'tax-report'],
      layout: { type: 'horizontal', sizes: [30, 40, 30] },
      filters: { year: new Date().getFullYear() }
    },
    'deep-analysis': {
      name: 'Deep Analysis',
      panels: ['correlation-matrix', 'monte-carlo', 'risk-analytics', 'stress-test'],
      layout: { type: 'grid', columns: 2 },
      filters: {}
    },
    'daily-check': {
      name: 'Daily Check',
      panels: ['portfolio-summary', 'watchlist', 'alerts'],
      layout: { type: 'horizontal', sizes: [50, 30, 20] },
      filters: {}
    }
  };
}

function saveWorkspaces() {
  fs.writeFileSync(workspacesFile, JSON.stringify(workspaces, null, 2));
}

ipcMain.handle('get-workspaces', () => workspaces);

ipcMain.handle('save-workspace', (event, workspaceId, config) => {
  workspaces[workspaceId] = config;
  saveWorkspaces();
  return { success: true };
});

ipcMain.handle('delete-workspace', (event, workspaceId) => {
  if (workspaceId !== 'default') {
    delete workspaces[workspaceId];
    saveWorkspaces();
    return { success: true };
  }
  return { success: false, error: 'Cannot delete default workspace' };
});

ipcMain.handle('switch-workspace', (event, workspaceId) => {
  if (workspaces[workspaceId]) {
    currentWorkspace = workspaceId;
    return { success: true, workspace: workspaces[workspaceId] };
  }
  return { success: false, error: 'Workspace not found' };
});

// ============================================================================
// SQLITE DATABASE
// ============================================================================

let db = null;

function initDatabase() {
  const dbPath = path.join(APP_CONFIG.dataDir, 'maermin.db');
  
  // Using better-sqlite3 would be ideal, but for compatibility we'll use a JSON-based approach
  // that mimics SQL queries for the renderer process
  const dbFile = path.join(APP_CONFIG.dataDir, 'database.json');
  
  if (fs.existsSync(dbFile)) {
    try {
      db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    } catch (e) {
      db = createEmptyDatabase();
    }
  } else {
    db = createEmptyDatabase();
  }
}

function createEmptyDatabase() {
  return {
    transactions: [],
    positions: [],
    price_history: [],
    alerts: [],
    watchlists: [],
    queries: [],
    plugins: []
  };
}

function saveDatabase() {
  const dbFile = path.join(APP_CONFIG.dataDir, 'database.json');
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
}

ipcMain.handle('db-query', (event, query, params) => {
  // Simple query parser for common operations
  const queryLower = query.toLowerCase().trim();
  
  try {
    if (queryLower.startsWith('select')) {
      return handleSelectQuery(query, params);
    } else if (queryLower.startsWith('insert')) {
      return handleInsertQuery(query, params);
    } else if (queryLower.startsWith('update')) {
      return handleUpdateQuery(query, params);
    } else if (queryLower.startsWith('delete')) {
      return handleDeleteQuery(query, params);
    }
    return { success: false, error: 'Unsupported query type' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

function handleSelectQuery(query, params) {
  // Extract table name
  const tableMatch = query.match(/from\s+(\w+)/i);
  if (!tableMatch) return { success: false, error: 'Invalid SELECT query' };
  
  const table = tableMatch[1];
  if (!db[table]) return { success: false, error: `Table ${table} not found` };
  
  let results = [...db[table]];
  
  // Handle WHERE clause
  const whereMatch = query.match(/where\s+(.+?)(?:order|group|limit|$)/i);
  if (whereMatch && params) {
    // Simple filtering based on params
    results = results.filter(row => {
      return Object.entries(params).every(([key, value]) => row[key] === value);
    });
  }
  
  // Handle ORDER BY
  const orderMatch = query.match(/order\s+by\s+(\w+)\s*(asc|desc)?/i);
  if (orderMatch) {
    const orderField = orderMatch[1];
    const orderDir = (orderMatch[2] || 'asc').toLowerCase();
    results.sort((a, b) => {
      if (orderDir === 'desc') return b[orderField] > a[orderField] ? 1 : -1;
      return a[orderField] > b[orderField] ? 1 : -1;
    });
  }
  
  // Handle LIMIT
  const limitMatch = query.match(/limit\s+(\d+)/i);
  if (limitMatch) {
    results = results.slice(0, parseInt(limitMatch[1]));
  }
  
  return { success: true, data: results };
}

function handleInsertQuery(query, params) {
  const tableMatch = query.match(/into\s+(\w+)/i);
  if (!tableMatch) return { success: false, error: 'Invalid INSERT query' };
  
  const table = tableMatch[1];
  if (!db[table]) db[table] = [];
  
  const newRecord = {
    id: generateId(),
    ...params,
    created_at: new Date().toISOString()
  };
  
  db[table].push(newRecord);
  saveDatabase();
  
  return { success: true, id: newRecord.id };
}

function handleUpdateQuery(query, params) {
  const tableMatch = query.match(/update\s+(\w+)/i);
  if (!tableMatch) return { success: false, error: 'Invalid UPDATE query' };
  
  const table = tableMatch[1];
  if (!db[table]) return { success: false, error: `Table ${table} not found` };
  
  const { id, ...updates } = params;
  const index = db[table].findIndex(r => r.id === id);
  
  if (index === -1) return { success: false, error: 'Record not found' };
  
  db[table][index] = { ...db[table][index], ...updates, updated_at: new Date().toISOString() };
  saveDatabase();
  
  return { success: true };
}

function handleDeleteQuery(query, params) {
  const tableMatch = query.match(/from\s+(\w+)/i);
  if (!tableMatch) return { success: false, error: 'Invalid DELETE query' };
  
  const table = tableMatch[1];
  if (!db[table]) return { success: false, error: `Table ${table} not found` };
  
  const { id } = params;
  const initialLength = db[table].length;
  db[table] = db[table].filter(r => r.id !== id);
  saveDatabase();
  
  return { success: true, deleted: initialLength - db[table].length };
}

ipcMain.handle('db-get-all', (event, table) => {
  if (!db[table]) return { success: false, error: `Table ${table} not found` };
  return { success: true, data: db[table] };
});

ipcMain.handle('db-save-query', (event, queryName, queryText) => {
  if (!db.queries) db.queries = [];
  
  const existingIndex = db.queries.findIndex(q => q.name === queryName);
  if (existingIndex >= 0) {
    db.queries[existingIndex].query = queryText;
    db.queries[existingIndex].updated_at = new Date().toISOString();
  } else {
    db.queries.push({
      id: generateId(),
      name: queryName,
      query: queryText,
      created_at: new Date().toISOString()
    });
  }
  
  saveDatabase();
  return { success: true };
});

ipcMain.handle('db-get-saved-queries', () => {
  return { success: true, data: db.queries || [] };
});

// ============================================================================
// BACKUP SYSTEM
// ============================================================================

ipcMain.handle('create-backup', async (event, options = {}) => {
  const { encrypt, password } = options;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `maermin-backup-${timestamp}.json`;
  const backupPath = path.join(APP_CONFIG.backupDir, backupName);
  
  const backupData = {
    version: APP_CONFIG.version,
    timestamp: new Date().toISOString(),
    database: db,
    workspaces: workspaces
  };
  
  let dataToWrite = JSON.stringify(backupData, null, 2);
  
  if (encrypt && password) {
    dataToWrite = encryptData(dataToWrite, password);
  }
  
  fs.writeFileSync(backupPath, dataToWrite);
  
  return { 
    success: true, 
    path: backupPath,
    size: fs.statSync(backupPath).size,
    encrypted: !!encrypt
  };
});

ipcMain.handle('restore-backup', async (event, backupPath, password) => {
  if (!fs.existsSync(backupPath)) {
    return { success: false, error: 'Backup file not found' };
  }
  
  try {
    let data = fs.readFileSync(backupPath, 'utf8');
    
    // Check if encrypted
    if (data.startsWith('{"encrypted":true')) {
      if (!password) {
        return { success: false, error: 'Password required for encrypted backup' };
      }
      const parsed = JSON.parse(data);
      data = decryptData(parsed.data, password, parsed.iv, parsed.authTag);
    }
    
    const backupData = JSON.parse(data);
    
    // Restore data
    db = backupData.database;
    workspaces = backupData.workspaces;
    
    saveDatabase();
    saveWorkspaces();
    
    return { success: true, version: backupData.version, timestamp: backupData.timestamp };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('list-backups', () => {
  const backups = fs.readdirSync(APP_CONFIG.backupDir)
    .filter(f => f.startsWith('maermin-backup-') && f.endsWith('.json'))
    .map(f => {
      const stats = fs.statSync(path.join(APP_CONFIG.backupDir, f));
      return {
        name: f,
        path: path.join(APP_CONFIG.backupDir, f),
        size: stats.size,
        created: stats.birthtime
      };
    })
    .sort((a, b) => b.created - a.created);
  
  return { success: true, backups };
});

ipcMain.handle('delete-backup', (event, backupPath) => {
  if (fs.existsSync(backupPath)) {
    fs.unlinkSync(backupPath);
    return { success: true };
  }
  return { success: false, error: 'Backup not found' };
});

// Schedule automatic backups
function scheduleAutoBackup() {
  const settingsFile = path.join(APP_CONFIG.dataDir, 'settings.json');
  let settings = { autoBackup: true, backupInterval: 'daily' };
  
  if (fs.existsSync(settingsFile)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    } catch (e) {}
  }
  
  if (settings.autoBackup) {
    // Check last backup time
    const lastBackupFile = path.join(APP_CONFIG.dataDir, 'last-backup.txt');
    let shouldBackup = false;
    
    if (!fs.existsSync(lastBackupFile)) {
      shouldBackup = true;
    } else {
      const lastBackup = new Date(fs.readFileSync(lastBackupFile, 'utf8'));
      const now = new Date();
      const hoursSinceBackup = (now - lastBackup) / (1000 * 60 * 60);
      
      if (settings.backupInterval === 'daily' && hoursSinceBackup >= 24) {
        shouldBackup = true;
      } else if (settings.backupInterval === 'weekly' && hoursSinceBackup >= 168) {
        shouldBackup = true;
      }
    }
    
    if (shouldBackup) {
      ipcMain.emit('create-backup', {}, {});
      fs.writeFileSync(lastBackupFile, new Date().toISOString());
    }
  }
}

// ============================================================================
// ENCRYPTION UTILITIES
// ============================================================================

function encryptData(data, password) {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, 'maermin-salt', 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return JSON.stringify({
    encrypted: true,
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
    data: encrypted
  });
}

function decryptData(data, password, ivHex, authTagHex) {
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const key = crypto.scryptSync(password, 'maermin-salt', 32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

// ============================================================================
// PRICE ALERTS
// ============================================================================

const alertsFile = path.join(APP_CONFIG.dataDir, 'alerts.json');

function loadAlerts() {
  if (fs.existsSync(alertsFile)) {
    try {
      alerts = JSON.parse(fs.readFileSync(alertsFile, 'utf8'));
    } catch (e) {
      alerts = [];
    }
  }
}

function saveAlerts() {
  fs.writeFileSync(alertsFile, JSON.stringify(alerts, null, 2));
}

ipcMain.handle('create-alert', (event, alertConfig) => {
  const alert = {
    id: generateId(),
    ...alertConfig,
    fired: false,
    created_at: new Date().toISOString()
  };
  
  alerts.push(alert);
  saveAlerts();
  
  return { success: true, alert };
});

ipcMain.handle('get-alerts', () => {
  return { success: true, alerts };
});

ipcMain.handle('delete-alert', (event, alertId) => {
  alerts = alerts.filter(a => a.id !== alertId);
  saveAlerts();
  return { success: true };
});

ipcMain.handle('check-alerts', (event, currentPrices) => {
  const triggeredAlerts = [];
  
  alerts.forEach(alert => {
    if (alert.fired) return;
    
    const price = currentPrices[alert.symbol];
    if (!price) return;
    
    let triggered = false;
    
    switch (alert.condition) {
      case 'above':
        triggered = price >= alert.threshold;
        break;
      case 'below':
        triggered = price <= alert.threshold;
        break;
      case 'change_percent':
        const change = ((price - alert.basePrice) / alert.basePrice) * 100;
        triggered = Math.abs(change) >= alert.threshold;
        break;
    }
    
    if (triggered) {
      alert.fired = true;
      alert.fired_at = new Date().toISOString();
      alert.triggered_price = price;
      triggeredAlerts.push(alert);
      
      // Show system notification
      new Notification({
        title: `MAERMIN Alert: ${alert.symbol}`,
        body: `${alert.symbol} is now ${price.toFixed(2)} (${alert.condition} ${alert.threshold})`
      }).show();
    }
  });
  
  if (triggeredAlerts.length > 0) {
    saveAlerts();
  }
  
  return { success: true, triggered: triggeredAlerts };
});

ipcMain.handle('reset-alert', (event, alertId) => {
  const alert = alerts.find(a => a.id === alertId);
  if (alert) {
    alert.fired = false;
    alert.fired_at = null;
    alert.triggered_price = null;
    saveAlerts();
    return { success: true };
  }
  return { success: false, error: 'Alert not found' };
});

// ============================================================================
// FILE IMPORT SYSTEM
// ============================================================================

let fileWatcher = null;

function startFileWatcher() {
  const watchDir = APP_CONFIG.importWatchDir;
  
  // Simple polling-based watcher (cross-platform compatible)
  let lastFiles = new Set(fs.readdirSync(watchDir));
  
  fileWatcher = setInterval(() => {
    const currentFiles = new Set(fs.readdirSync(watchDir));
    
    currentFiles.forEach(file => {
      if (!lastFiles.has(file)) {
        const ext = path.extname(file).toLowerCase();
        if (['.csv', '.xlsx', '.xls'].includes(ext)) {
          mainWindow?.webContents.send('file-detected', {
            path: path.join(watchDir, file),
            name: file,
            type: ext
          });
        }
      }
    });
    
    lastFiles = currentFiles;
  }, 2000);
}

function stopFileWatcher() {
  if (fileWatcher) {
    clearInterval(fileWatcher);
    fileWatcher = null;
  }
}

ipcMain.handle('import-file', async (event, filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  
  try {
    if (ext === '.csv') {
      const content = fs.readFileSync(filePath, 'utf8');
      return { success: true, data: parseCSV(content), type: 'csv' };
    } else if (ext === '.xlsx' || ext === '.xls') {
      // For Excel files, we'll need to handle in renderer with a library
      const content = fs.readFileSync(filePath);
      return { success: true, data: content.toString('base64'), type: 'excel' };
    } else if (ext === '.json') {
      const content = fs.readFileSync(filePath, 'utf8');
      return { success: true, data: JSON.parse(content), type: 'json' };
    }
    
    return { success: false, error: 'Unsupported file type' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('select-import-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Data',
    filters: [
      { name: 'Supported Files', extensions: ['csv', 'xlsx', 'xls', 'json'] },
      { name: 'CSV Files', extensions: ['csv'] },
      { name: 'Excel Files', extensions: ['xlsx', 'xls'] },
      { name: 'JSON Files', extensions: ['json'] }
    ],
    properties: ['openFile']
  });
  
  if (result.canceled) {
    return { success: false, canceled: true };
  }
  
  return { success: true, path: result.filePaths[0] };
});

function parseCSV(content) {
  const lines = content.trim().split('\n');
  if (lines.length === 0) return { headers: [], rows: [] };
  
  const headers = parseCSVLine(lines[0]);
  const rows = lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((header, i) => {
      row[header] = values[i] || '';
    });
    return row;
  });
  
  return { headers, rows };
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if ((char === ',' || char === ';') && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

// ============================================================================
// EXPORT SYSTEM
// ============================================================================

ipcMain.handle('export-to-file', async (event, data, format, defaultName) => {
  const filters = {
    'csv': { name: 'CSV Files', extensions: ['csv'] },
    'xlsx': { name: 'Excel Files', extensions: ['xlsx'] },
    'json': { name: 'JSON Files', extensions: ['json'] },
    'pdf': { name: 'PDF Files', extensions: ['pdf'] },
    'md': { name: 'Markdown Files', extensions: ['md'] },
    'html': { name: 'HTML Files', extensions: ['html'] }
  };
  
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Data',
    defaultPath: defaultName || `maermin-export.${format}`,
    filters: [filters[format] || { name: 'All Files', extensions: ['*'] }]
  });
  
  if (result.canceled) {
    return { success: false, canceled: true };
  }
  
  try {
    fs.writeFileSync(result.filePath, data);
    return { success: true, path: result.filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ============================================================================
// PLUGIN SYSTEM
// ============================================================================

let loadedPlugins = new Map();

function loadPlugins() {
  const pluginDirs = fs.readdirSync(APP_CONFIG.pluginDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  
  pluginDirs.forEach(pluginName => {
    const pluginPath = path.join(APP_CONFIG.pluginDir, pluginName);
    const manifestPath = path.join(pluginPath, 'manifest.json');
    
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        loadedPlugins.set(pluginName, {
          manifest,
          path: pluginPath,
          enabled: true
        });
        console.log(`[Plugin] Loaded: ${manifest.name} v${manifest.version}`);
      } catch (e) {
        console.error(`[Plugin] Failed to load ${pluginName}:`, e);
      }
    }
  });
}

ipcMain.handle('get-plugins', () => {
  const plugins = [];
  loadedPlugins.forEach((plugin, id) => {
    plugins.push({
      id,
      ...plugin.manifest,
      enabled: plugin.enabled,
      path: plugin.path
    });
  });
  return { success: true, plugins };
});

ipcMain.handle('install-plugin', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Install Plugin',
    filters: [
      { name: 'MAERMIN Plugin', extensions: ['maermin-plugin', 'zip'] }
    ],
    properties: ['openFile']
  });
  
  if (result.canceled) {
    return { success: false, canceled: true };
  }
  
  // TODO: Implement plugin installation (unzip, validate, copy)
  return { success: false, error: 'Plugin installation not yet implemented' };
});

ipcMain.handle('toggle-plugin', (event, pluginId, enabled) => {
  const plugin = loadedPlugins.get(pluginId);
  if (plugin) {
    plugin.enabled = enabled;
    return { success: true };
  }
  return { success: false, error: 'Plugin not found' };
});

// ============================================================================
// APPLICATION MENU
// ============================================================================

function createApplicationMenu() {
  const isMac = process.platform === 'darwin';
  
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Import...',
          accelerator: 'CmdOrCtrl+I',
          click: () => mainWindow?.webContents.send('menu-import')
        },
        {
          label: 'Export...',
          accelerator: 'CmdOrCtrl+E',
          click: () => mainWindow?.webContents.send('menu-export')
        },
        { type: 'separator' },
        {
          label: 'Create Backup',
          click: () => mainWindow?.webContents.send('menu-backup')
        },
        {
          label: 'Restore Backup...',
          click: () => mainWindow?.webContents.send('menu-restore')
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Command Palette',
          accelerator: 'CmdOrCtrl+K',
          click: () => mainWindow?.webContents.send('toggle-command-palette')
        },
        { type: 'separator' },
        {
          label: 'Workspaces',
          submenu: [
            {
              label: 'Default',
              click: () => mainWindow?.webContents.send('switch-workspace', 'default')
            },
            {
              label: 'Tax Season',
              click: () => mainWindow?.webContents.send('switch-workspace', 'tax-season')
            },
            {
              label: 'Deep Analysis',
              click: () => mainWindow?.webContents.send('switch-workspace', 'deep-analysis')
            },
            {
              label: 'Daily Check',
              click: () => mainWindow?.webContents.send('switch-workspace', 'daily-check')
            }
          ]
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Analytics',
      submenu: [
        {
          label: 'Correlation Matrix',
          click: () => mainWindow?.webContents.send('open-analytics', 'correlation')
        },
        {
          label: 'Monte Carlo Simulation',
          click: () => mainWindow?.webContents.send('open-analytics', 'montecarlo')
        },
        {
          label: 'Stress Testing',
          click: () => mainWindow?.webContents.send('open-analytics', 'stress')
        },
        { type: 'separator' },
        {
          label: 'Risk Analytics',
          click: () => mainWindow?.webContents.send('open-analytics', 'risk')
        },
        {
          label: 'CS2 Analytics',
          click: () => mainWindow?.webContents.send('open-analytics', 'cs2')
        }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        {
          label: 'Detach Current Panel',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => mainWindow?.webContents.send('detach-current-panel')
        },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' }
        ] : [])
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CmdOrCtrl+/',
          click: () => mainWindow?.webContents.send('show-shortcuts')
        },
        { type: 'separator' },
        {
          label: 'About MAERMIN',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About MAERMIN',
              message: `MAERMIN v${APP_CONFIG.version}`,
              detail: 'Multi-Asset Portfolio Tracker\n\nDesktop-native financial analysis for power users.\n\n© 2025'
            });
          }
        }
      ]
    }
  ];
  
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ============================================================================
// GLOBAL SHORTCUTS
// ============================================================================

function registerGlobalShortcuts() {
  // Command palette
  globalShortcut.register('CommandOrControl+K', () => {
    mainWindow?.webContents.send('toggle-command-palette');
  });
  
  // Quick add
  globalShortcut.register('CommandOrControl+N', () => {
    mainWindow?.webContents.send('quick-add');
  });
  
  // Refresh prices
  globalShortcut.register('CommandOrControl+R', () => {
    mainWindow?.webContents.send('refresh-prices');
  });
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================================================
// APP LIFECYCLE
// ============================================================================

app.whenReady().then(() => {
  initDatabase();
  loadWorkspaces();
  loadAlerts();
  loadPlugins();
  
  createMainWindow();
  registerGlobalShortcuts();
  startFileWatcher();
  scheduleAutoBackup();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopFileWatcher();
  globalShortcut.unregisterAll();
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  stopFileWatcher();
  globalShortcut.unregisterAll();
});

// ============================================================================
// IPC: App Info
// ============================================================================

ipcMain.handle('get-app-info', () => {
  return {
    version: APP_CONFIG.version,
    dataDir: APP_CONFIG.dataDir,
    backupDir: APP_CONFIG.backupDir,
    pluginDir: APP_CONFIG.pluginDir,
    importWatchDir: APP_CONFIG.importWatchDir
  };
});

ipcMain.handle('get-app-paths', () => {
  return {
    userData: app.getPath('userData'),
    documents: app.getPath('documents'),
    downloads: app.getPath('downloads')
  };
});

console.log('[MAERMIN v' + APP_CONFIG.version + '] Main process initialized');
