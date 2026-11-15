'use strict';
/* The only bridge between the window and the main process. Every operation is
   named here; anything else is refused before it reaches Electron.          */
const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED = new Set([
  'status', 'licenses', 'events', 'generate', 'verify',
  'setStatus', 'saveNote', 'removeLicense', 'export',
  'openDataFolder', 'copyPublicKey', 'backupKeys'
]);

contextBridge.exposeInMainWorld('generator', {
  call(channel, payload = {}) {
    if (!ALLOWED.has(channel)) return Promise.reject(new Error('This operation is not available.'));
    return ipcRenderer.invoke('generator:call', { channel, payload }).then(response => {
      if (!response.ok) {
        const error = new Error(response.error);
        throw error;
      }
      return response.data;
    });
  }
});
