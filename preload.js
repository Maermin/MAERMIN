// ============================================================================
// MAERMIN - Preload script
// ----------------------------------------------------------------------------
// The renderer is the same web app that runs in the browser and needs no
// privileged APIs. Only harmless, read-only facts are exposed; there is
// deliberately no IPC channel (the previous bridge was unused and exposed
// file reads, a JSON "database" and window spawning to any injected script).
// ============================================================================

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('maerminDesktop', Object.freeze({
  isDesktop: true,
  platform: process.platform
}));
