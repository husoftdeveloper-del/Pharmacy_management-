'use strict';
const { contextBridge, ipcRenderer } = require('electron');
let sessionToken = null;
const allowed = new Set(['bootstrap','setup','login','logout','session','preference','preferences','dashboard','options','list','save','catalog','sale','purchase','documents','document','return','payment','expense','advance','salary','register','inventory','stockCount','savePrescription','prescriptionFile','cancelPrescription','saveUser','settings','report','generateBarcode','barcode','pdf','receipt','printBarcode','backup','restore']);
contextBridge.exposeInMainWorld('pharmacy', Object.freeze({
  invoke: async (channel, payload = {}) => {
    if (!allowed.has(channel)) throw new Error('This operation is not available.');
    const result = await ipcRenderer.invoke('pharmacy:request', { channel, payload, token: sessionToken });
    if (!result || typeof result !== 'object') throw new Error('Invalid application response.');
    if (channel === 'login' || channel === 'setup') {
      if (result.ok) sessionToken = result.data.token;
      else sessionToken = null;
    }
    if (channel === 'logout' || result.code === 'SESSION_EXPIRED') sessionToken = null;
    if (!result.ok) { const error = new Error(result.error || 'Operation failed.'); error.code = result.code; throw error; }
    if (Array.isArray(result.data)) return result.data;
    const { token, ...data } = result.data || {};
    return data;
  }
}));
