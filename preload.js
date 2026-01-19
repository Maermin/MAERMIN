// ============================================================================
// MAERMIN v6.0 - Preload Script
// Secure bridge between main process and renderer
// ============================================================================

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to renderer
contextBridge.exposeInMainWorld('maermin', {
  // ========== App Info ==========
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  getAppPaths: () => ipcRenderer.invoke('get-app-paths'),
  
  // ========== Window Management ==========
  detachPanel: (panelId, config) => ipcRenderer.invoke('detach-panel', panelId, config),
  getDetachedWindows: () => ipcRenderer.invoke('get-detached-windows'),
  closeDetachedWindow: (panelId) => ipcRenderer.invoke('close-detached-window', panelId),
  syncState: (state) => ipcRenderer.send('sync-state', state),
  onStateUpdated: (callback) => {
    ipcRenderer.on('state-updated', (event, state) => callback(state));
  },
  onPanelReattached: (callback) => {
    ipcRenderer.on('panel-reattached', (event, panelId) => callback(panelId));
  },
  
  // ========== Workspace Management ==========
  getWorkspaces: () => ipcRenderer.invoke('get-workspaces'),
  saveWorkspace: (id, config) => ipcRenderer.invoke('save-workspace', id, config),
  deleteWorkspace: (id) => ipcRenderer.invoke('delete-workspace', id),
  switchWorkspace: (id) => ipcRenderer.invoke('switch-workspace', id),
  
  // ========== Database ==========
  dbQuery: (query, params) => ipcRenderer.invoke('db-query', query, params),
  dbGetAll: (table) => ipcRenderer.invoke('db-get-all', table),
  dbSaveQuery: (name, query) => ipcRenderer.invoke('db-save-query', name, query),
  dbGetSavedQueries: () => ipcRenderer.invoke('db-get-saved-queries'),
  
  // ========== Backup System ==========
  createBackup: (options) => ipcRenderer.invoke('create-backup', options),
  restoreBackup: (path, password) => ipcRenderer.invoke('restore-backup', path, password),
  listBackups: () => ipcRenderer.invoke('list-backups'),
  deleteBackup: (path) => ipcRenderer.invoke('delete-backup', path),
  
  // ========== Alerts ==========
  createAlert: (config) => ipcRenderer.invoke('create-alert', config),
  getAlerts: () => ipcRenderer.invoke('get-alerts'),
  deleteAlert: (id) => ipcRenderer.invoke('delete-alert', id),
  checkAlerts: (prices) => ipcRenderer.invoke('check-alerts', prices),
  resetAlert: (id) => ipcRenderer.invoke('reset-alert', id),
  
  // ========== File Import/Export ==========
  importFile: (path) => ipcRenderer.invoke('import-file', path),
  selectImportFile: () => ipcRenderer.invoke('select-import-file'),
  exportToFile: (data, format, name) => ipcRenderer.invoke('export-to-file', data, format, name),
  
  // ========== Plugins ==========
  getPlugins: () => ipcRenderer.invoke('get-plugins'),
  installPlugin: () => ipcRenderer.invoke('install-plugin'),
  togglePlugin: (id, enabled) => ipcRenderer.invoke('toggle-plugin', id, enabled),
  
  // ========== Menu Events ==========
  onMenuImport: (callback) => ipcRenderer.on('menu-import', callback),
  onMenuExport: (callback) => ipcRenderer.on('menu-export', callback),
  onMenuBackup: (callback) => ipcRenderer.on('menu-backup', callback),
  onMenuRestore: (callback) => ipcRenderer.on('menu-restore', callback),
  onToggleCommandPalette: (callback) => ipcRenderer.on('toggle-command-palette', callback),
  onSwitchWorkspace: (callback) => {
    ipcRenderer.on('switch-workspace', (event, workspaceId) => callback(workspaceId));
  },
  onOpenAnalytics: (callback) => {
    ipcRenderer.on('open-analytics', (event, type) => callback(type));
  },
  onDetachCurrentPanel: (callback) => ipcRenderer.on('detach-current-panel', callback),
  onShowShortcuts: (callback) => ipcRenderer.on('show-shortcuts', callback),
  onQuickAdd: (callback) => ipcRenderer.on('quick-add', callback),
  onRefreshPrices: (callback) => ipcRenderer.on('refresh-prices', callback),
  onFileDetected: (callback) => {
    ipcRenderer.on('file-detected', (event, file) => callback(file));
  },
  
  // ========== Utilities ==========
  platform: process.platform,
  
  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});

// Log preload completion
console.log('[MAERMIN v6.0] Preload script initialized');
