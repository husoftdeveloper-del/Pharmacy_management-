'use strict';
/* Top In Tech License Generator — main process.

   Owner-only desktop tool. It creates the Ed25519 key pair, signs license
   records, stores them in its own SQLite database and exports them. The window
   never receives the private key: every privileged action is a named channel in
   the allow-list below, and the renderer has no Node access at all.          */
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const keys = require('./lib/keys');
const serial = require('./lib/serial');
const store = require('./lib/database');

const APP_NAME = 'Top In Tech License Generator';
app.setName(APP_NAME);
if (!app.requestSingleInstanceLock()) app.quit();
app.enableSandbox();
Menu.setApplicationMenu(null);

let mainWindow = null;
let db = null;
let dbFile = '';
let dataFolder = '';
let keyFolder = '';

function dataFiles() {
  return { dataFolder, keyFolder, databaseFile: dbFile };
}

function counts() {
  return store.stats(db);
}

function status() {
  const info = keys.describe(keyFolder);
  return {
    ...info,
    ...dataFiles(),
    counts: counts(),
    appVersion: app.getVersion(),
    version: app.getVersion(),
    userData: dataFolder,
    database: dbFile,
    created: info.createdAt,
    electron: process.versions.electron,
    node: process.versions.node,
    signingReady: true
  };
}

// A licence row as the table needs it: the plan spelled out and the serial
// grouped for reading, with the stored serial left untouched.
function decorate(row) {
  const planId = Object.keys(serial.PLANS).find(id => serial.PLANS[id].key === row.plan) || '';
  return {
    ...row,
    planId,
    planLabel: planId ? serial.PLANS[planId].label : (row.plan || ''),
    formatted: serial.formatSerial(row.serial),
    plain: row.serial
  };
}

function newLicenseId() {
  return crypto.randomBytes(6).toString('hex').toUpperCase().slice(0, 9);
}

/* ---- Channels ---------------------------------------------------------- */
const channels = {
  status: () => status(),

  licenses: payload => ({
    licenses: store.listLicenses(db, payload || {}).map(decorate),
    stats: counts()
  }),

  events: payload => store.events(db, payload?.id),

  generate: payload => {
    const product = String(payload?.product || '').trim();
    const plan = String(payload?.plan || '');
    if (!product) throw new Error('Enter the product name.');
    if (!serial.PLANS[plan]) throw new Error('Choose a license duration.');
    const privatePem = keys.readPrivate(keyFolder);
    const kid = keys.describe(keyFolder).keyId;
    const licenseId = newLicenseId();
    const record = serial.buildPayload({ product, plan, licenseId, kid });
    const key = serial.signPayload(record, privatePem);
    // Sign it back through the public key before it is stored, so a broken key
    // pair can never produce a serial the customer app would reject.
    const check = serial.verifySerial(key, keys.readPublic(keyFolder));
    if (!check.valid) throw new Error(`The generated serial did not verify: ${check.reason}`);
    const id = store.insertLicense(db, {
      serial: key,
      product,
      plan: serial.PLANS[plan].key,
      issuedOn: record.i,
      expiresOn: record.x,
      keyId: kid,
      assignedTo: String(payload?.assignedTo || '').trim().slice(0, 120),
      note: String(payload?.note || '').trim().slice(0, 300),
      status: String(payload?.assignedTo || '').trim() ? 'assigned' : 'unused'
    });
    const row = db.prepare('SELECT * FROM licenses WHERE id=?').get(id);
    return { license: decorate(row), counts: counts(), payload: record };
  },

  verify: payload => {
    const result = serial.verifySerial(serial.unformatSerial(payload?.serial), keys.readPublic(keyFolder), new Date());
    return {
      valid: result.valid,
      reason: result.reason,
      product: result.payload?.pr || '',
      plan: result.plan?.label || '',
      issued: result.payload?.i || '',
      expires: result.payload?.x || '',
      keyId: result.payload?.k || ''
    };
  },

  setStatus: payload => {
    const row = store.updateStatus(db, payload?.id, payload?.status, payload?.assignedTo);
    return { license: decorate(row), counts: counts() };
  },

  saveNote: payload => ({
    license: decorate(store.saveNote(db, payload?.id, payload?.note, payload?.assignedTo)),
    counts: counts()
  }),

  removeLicense: payload => ({ ...store.deleteLicense(db, payload?.id), counts: counts() }),

  export: async payload => exportLicenses(payload),

  openDataFolder: async () => {
    const error = await shell.openPath(dataFolder);
    if (error) throw new Error('The data folder could not be opened.');
    return { path: dataFolder };
  },

  copyPublicKey: () => ({ publicKey: keys.readPublic(keyFolder), keyId: keys.describe(keyFolder).keyId }),

  backupKeys: async () => backupKeys()
};

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportRows() {
  return store.listLicenses(db, {}).map(decorate);
}

async function exportLicenses(payload) {
  const format = ['csv', 'json', 'txt'].includes(payload?.format) ? payload.format : 'csv';
  const wanted = Array.isArray(payload?.ids) ? payload.ids.map(Number).filter(Number.isFinite) : [];
  const rows = exportRows().filter(row => !wanted.length || wanted.includes(row.id));
  if (!rows.length) throw new Error('There are no licenses to export yet.');
  const stamp = new Date().toISOString().slice(0, 10);
  const filters = {
    csv: [{ name: 'CSV spreadsheet', extensions: ['csv'] }],
    json: [{ name: 'JSON data', extensions: ['json'] }],
    txt: [{ name: 'Text list', extensions: ['txt'] }]
  }[format];
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export license records',
    defaultPath: path.join(app.getPath('documents'), `top-in-tech-licenses-${stamp}.${format}`),
    filters
  });
  if (result.canceled || !result.filePath) return { cancelled: true };
  let filename = result.filePath;
  if (!filename.toLowerCase().endsWith(`.${format}`)) filename += `.${format}`;
  let body;
  if (format === 'csv') {
    const head = ['serial', 'product', 'plan', 'issued_on', 'expires_on', 'status', 'assigned_to', 'note', 'key_id', 'created_at'];
    body = '\uFEFF' + [head.map(csvCell).join(','), ...rows.map(row => [row.serial, row.product, row.planLabel, row.issued_on, row.expires_on, row.status, row.assigned_to, row.note, row.key_id, row.created_at].map(csvCell).join(','))].join('\r\n');
  } else if (format === 'json') {
    body = JSON.stringify({
      generator: APP_NAME,
      exported: new Date().toISOString(),
      keyId: keys.describe(keyFolder).keyId,
      publicKey: keys.readPublic(keyFolder),
      licenses: rows.map(row => ({
        serial: row.serial, formatted: row.formatted, product: row.product, plan: row.planLabel,
        issued: row.issued_on, expires: row.expires_on, status: row.status,
        assignedTo: row.assigned_to, note: row.note, keyId: row.key_id
      }))
    }, null, 2);
  } else {
    body = rows.map(row => [
      serial.formatSerial(row.serial),
      `  Product : ${row.product}`,
      `  Duration: ${row.planLabel}`,
      `  Issued  : ${row.issued_on}${row.expires_on ? `   Expires: ${row.expires_on}` : '   Expires: never'}`,
      `  Status  : ${row.status}${row.assigned_to ? `   Customer: ${row.assigned_to}` : ''}`,
      ''
    ].join('\n')).join('\n');
  }
  fs.writeFileSync(filename, body, { encoding: 'utf8' });
  return { path: filename, count: rows.length };
}

async function backupKeys() {
  const target = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a folder for the key backup',
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Back up here'
  });
  if (target.canceled || !target.filePaths[0]) return { cancelled: true };
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const folder = path.join(target.filePaths[0], `top-in-tech-keys-${stamp}`);
  fs.mkdirSync(folder, { recursive: true });
  const files = keys.paths(keyFolder);
  fs.copyFileSync(files.privateKey, path.join(folder, keys.PRIVATE_FILE));
  fs.copyFileSync(files.publicKey, path.join(folder, keys.PUBLIC_FILE));
  fs.writeFileSync(path.join(folder, 'README.txt'), [
    'Top In Tech signing keys',
    `Created: ${new Date().toISOString()}`,
    `Key id : ${keys.describe(keyFolder).keyId}`,
    '',
    'private.pem  — SECRET. Only the owner needs this file. Never ship it with a',
    '               customer application and never store it in a git repository.',
    'public.pem   — Safe to embed in every customer application so it can verify',
    '               its own serial key offline.',
    '',
    'Losing private.pem means no new serials can be issued for this key id.',
    'Restore it into the generator data folder: Application data / keys/.'
  ].join('\n'), { encoding: 'utf8' });
  return { path: folder };
}

/* ---- Window ------------------------------------------------------------ */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 940,
    minHeight: 620,
    backgroundColor: '#0d1c22',
    show: false,
    title: APP_NAME,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  // The tool never navigates away or opens extra windows.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  dataFolder = app.getPath('userData');
  keyFolder = path.join(dataFolder, 'keys');
  keys.ensureKeyPair(keyFolder);
  const opened = store.openDatabase(dataFolder);
  db = opened.db;
  dbFile = opened.file;

  ipcMain.handle('generator:call', async (event, request) => {
    try {
      if (!mainWindow || event.sender !== mainWindow.webContents) throw new Error('Unknown window.');
      const name = String(request?.channel || '');
      const handler = channels[name];
      if (!handler) throw new Error('Unknown operation.');
      const data = await handler(request.payload || {});
      return { ok: true, data };
    } catch (error) {
      console.error('[generator]', error.message);
      return { ok: false, error: String(error.message || 'The operation could not be completed.').slice(0, 300) };
    }
  });

  createWindow();
}).catch(error => {
  dialog.showErrorBox('Top In Tech License Generator cannot start', error.message);
  app.quit();
});

app.on('second-instance', () => {
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  if (!db) return;
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch {}
  db = null;
});
process.on('uncaughtException', error => {
  console.error(error);
  if (app.isReady()) dialog.showErrorBox('Application error', error.message);
});
