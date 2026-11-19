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
const setupkey = require('./lib/setupkey');
const store = require('./lib/database');
const shortcuts = require('./lib/shortcut');
const account = require('./lib/account');

const APP_NAME = 'Top In Tech License Generator';

// Smoke mode is used by tests/electron-smoke.js on a real Windows runner: it
// keeps the profile and the shortcut inside a temporary folder so the test can
// inspect them without touching the machine it runs on.
const SMOKE = process.env.TIT_SMOKE === '1';
const SMOKE_ROOT = SMOKE ? fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tit-smoke-')) : '';
// A throwaway owner account for the unattended smoke run only.
const SMOKE_USER = 'smoke-owner';
const SMOKE_PASSWORD = 'smoke-Passw0rd';

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
    desktop: desktopCandidates(),
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
    plain: row.serial,
    // The key the customer types into the setup wizard: derived from the serial,
    // so the same row always shows the same key, and carrying the licence's last
    // valid day so the application can stop at sign-in once it has passed.
    installKey: setupkey.makeInstallKey(row.serial, row.expires_on),
    // A moment (a 10-minute licence) is shown as a moment; a date stays a date.
    installKeyExpires: setupkey.expiryOfKey(row.expires_on),
    // The table and the CSV show the same reading as the card.
    expiresLabel: setupkey.expiryOfKey(row.expires_on),
    installKeyMoment: String(row.expires_on || '').includes('T')
  };
}

function newLicenseId() {
  return crypto.randomBytes(6).toString('hex').toUpperCase().slice(0, 9);
}

/* ---- Desktop shortcut --------------------------------------------------- */
/* Setup already writes the icon, but Windows can hide it when the Desktop
   folder is redirected (OneDrive does this on most laptops) or when the shell
   points somewhere else. The app therefore fills the gap itself, in every
   Desktop folder that exists, and can use PowerShell as a fallback.          */
function desktopCandidates() {
  const os = require('node:os');
  // An unattended smoke run must not litter the runner's real desktops: it can
  // only see the throwaway folder it was given.
  if (SMOKE) return [app.getPath('desktop')];
  const home = os.homedir();
  const list = [];
  // 1. The folder Windows itself reports: this is the one the user sees.
  try { list.push(app.getPath('desktop')); } catch { /* not reported */ }
  // 2. The classic profile folder, in case the shell points elsewhere.
  list.push(path.join(home, 'Desktop'));
  // 3. OneDrive, which redirects the desktop on most laptops.
  list.push(path.join(home, 'OneDrive', 'Desktop'));
  if (process.env.OneDrive) list.push(path.join(process.env.OneDrive, 'Desktop'));
  if (process.env.OneDriveConsumer) list.push(path.join(process.env.OneDriveConsumer, 'Desktop'));
  if (process.env.OneDriveCommercial) list.push(path.join(process.env.OneDriveCommercial, 'Desktop'));
  // 4. The all-users desktop, which some installers write to.
  const publicRoot = process.env.PUBLIC || 'C:\\Users\\Public';
  list.push(path.join(publicRoot, 'Desktop'));
  try { list.push(path.join(app.getPath('appData'), '..', '..', 'Public', 'Desktop')); } catch { /* not reported */ }
  // The Start menu is deliberately absent: the setup wizard owns that entry, so
  // the tool must never add a second one next to it.
  // Folders that do not exist are skipped inside ensureDesktopShortcut().
  return list;
}

function isPortable() {
  return Boolean(process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE);
}

// Last resort: let Windows itself create the shortcut through WScript.Shell.
function powerShellShortcut(file, data) {
  const { spawnSync } = require('node:child_process');
  const quote = value => String(value).replace(/'/g, "''");
  const script = [
    "$ErrorActionPreference='Stop'",
    '$shell = New-Object -ComObject WScript.Shell',
    `$link = $shell.CreateShortcut('${quote(file)}')`,
    `$link.TargetPath = '${quote(data.target)}'`,
    `$link.WorkingDirectory = '${quote(data.cwd)}'`,
    `$link.Description = '${quote(data.description)}'`,
    `$link.IconLocation = '${quote(data.icon)}'`,
    '$link.Save()'
  ].join('; ');
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script
  ], { windowsHide: true, timeout: 20000 });
  return result.status === 0;
}

function ensureDesktopShortcut() {
  return shortcuts.ensureDesktopShortcut({
    platform: process.platform,
    portable: isPortable(),
    desktopFolders: desktopCandidates(),
    name: APP_NAME,
    target: process.execPath,
    appUserModelId: 'com.topintech.licensegenerator',
    fs,
    writeShortcutLink: (file, data) => shell.writeShortcutLink(file, data),
    powerShell: powerShellShortcut
  });
}

/* ---- Owner sign-in ------------------------------------------------------ */
// The window starts locked. Only these three operations work before the owner
// signs in; everything else is refused here, in the main process, so a script
// in the page cannot reach the private key or the license database.
let session = { signedIn: false, username: '' };
const PUBLIC_CHANNELS = new Set(['authState', 'signIn', 'register']);
let failedAuthDelay = 0;

function requireSignIn() {
  if (!session.signedIn) throw new Error('Sign in to continue.');
}

/* ---- Channels ---------------------------------------------------------- */
const inner = {
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

  createShortcut: () => {
    const result = { ...ensureDesktopShortcut(), exe: process.execPath, userData: dataFolder, desktop: desktopCandidates() };
    try {
      const report = [
        'Top In Tech License Generator — desktop shortcut report',
        `When        : ${new Date().toISOString()}`,
        `Windows user: ${process.env.USERNAME || ''}`,
        `Home        : ${require('node:os').homedir()}`,
        `Program     : ${process.execPath}`,
        `Portable    : ${isPortable() ? 'yes' : 'no'}`,
        '',
        'Desktop folders checked:',
        ...(result.checked || []).map(file => `  ${file}  ${fs.existsSync(file) ? 'EXISTS' : 'missing'}`),
        '',
        `Result      : ${result.created ? 'created' : 'NOT created'}`,
        `Reason      : ${result.reason || ''}`,
        `Written to  : ${(result.paths || []).join(', ')}`
      ].join('\n');
      const file = path.join(dataFolder, 'desktop-shortcut-report.txt');
      fs.writeFileSync(file, report, { encoding: 'utf8' });
      result.report = file;
    } catch { /* a report is never more important than the shortcut itself */ }
    return result;
  },

  showShortcut: payload => {
    const file = String(payload?.path || '');
    if (file && fs.existsSync(file)) {
      shell.showItemInFolder(file);
      return { shown: true, path: file };
    }
    const error = shell.openPath(dataFolder);
    return { shown: false, path: file, error: error || '' };
  },

  copyPublicKey: () => ({ publicKey: keys.readPublic(keyFolder), keyId: keys.describe(keyFolder).keyId }),

  backupKeys: async () => backupKeys(),

  /* --- owner sign-in --------------------------------------------------- */
  authState: () => ({ ...account.state(store, db), signedIn: session.signedIn, signedInAs: session.username, locked: account.state(store, db).locked }),

  register: async payload => {
    const created = await account.register(store, db, payload || {});
    session = { signedIn: true, username: created.username };
    return { ...account.state(store, db), signedIn: true, signedInAs: created.username };
  },

  signIn: async payload => {
    try {
      const result = await account.signIn(store, db, payload || {});
      session = { signedIn: true, username: result.username };
      return { ...account.state(store, db), signedIn: true, signedInAs: result.username };
    } catch (error) {
      // A small delay blunts scripted guessing without annoying a real owner.
      failedAuthDelay = Math.min(failedAuthDelay + 150, 900);
      await new Promise(resolve => setTimeout(resolve, failedAuthDelay));
      throw error;
    }
  },

  signOut: () => {
    session = { signedIn: false, username: '' };
    return { signedIn: false };
  },

  /* --- Settings -------------------------------------------------------- */
  /* Everything the Settings window needs in one call: the owner account, the
     places the tool keeps its data, and the build that is running. */
  settingsInfo: () => ({
    ...account.info(store, db),
    signedInAs: session.username,
    version: app.getVersion(),
    dataFolder,
    databaseFile: dbFile,
    databaseBytes: (() => { try { return fs.statSync(dbFile).size; } catch { return 0; } })(),
    keyId: keys.describe(keyFolder).keyId,
    counts: counts(),
    platform: `${process.platform} ${process.arch}`,
    electron: process.versions.electron,
    node: process.versions.node
  }),

  // Both of these require the current password, so an unlocked window is not
  // enough to take the tool over.
  changePassword: async payload => {
    const result = await account.changePassword(store, db, payload || {});
    return { ...settingsResult(), ...result };
  },

  changeUsername: async payload => {
    const result = await account.changeUsername(store, db, payload || {});
    // Keep the session and the window title in step with the new name.
    if (result.changed) session = { signedIn: true, username: result.username };
    return { ...settingsResult(), ...result };
  }
};

// The account after a change, in the shape the Settings window already renders.
function settingsResult() {
  return { ...account.state(store, db), signedIn: session.signedIn, signedInAs: session.username };
}

// Every other operation goes through this guard.
const channels = new Proxy(inner, {
  get(target, name) {
    if (name === 'then') return undefined;
    const handler = target[name];
    if (typeof handler !== 'function') return handler;
    return payload => {
      if (!PUBLIC_CHANNELS.has(name)) requireSignIn();
      return handler(payload);
    };
  }
});

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

/* ---- Smoke test -------------------------------------------------------- */
// Runs on a real Windows runner: proves the main process starts, the window
// renders, a serial can be generated and stored, and the desktop shortcut is
// written where the test can see it.
async function runSmokeTest() {
  const say = value => process.stdout.write(`${value}\n`);
  const evaluate = code => mainWindow.webContents.executeJavaScript(code);
  // The page fills itself from the bridge asynchronously, so a check must wait
  // for the value instead of reading whatever is on screen at load time.
  const waitFor = async (expression, label, timeout = 8000) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      if (await evaluate(`Boolean(${expression})`)) return true;
      if (Date.now() > deadline) return false;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  };
  try {
    await waitFor("document.querySelector('#app-version').textContent.trim() !== '…'", 'the version badge');
    await waitFor("document.querySelector('#key-id').textContent.trim() !== '…'", 'the key id');
    await waitFor("document.querySelector('#public-key').value.includes('BEGIN PUBLIC KEY')", 'the public key');
    const page = await mainWindow.webContents.executeJavaScript(`({
      title: document.title,
      // The tool must be open (signed in) and the sign-in form gone.
      signedIn: document.querySelector('#app-main').hidden === false,
      loginHidden: document.querySelector('#login-screen').hidden === true,
      product: Boolean(document.querySelector('#product')),
      version: document.querySelector('#app-version').textContent,
      keyId: document.querySelector('#key-id').textContent,
      rows: document.querySelectorAll('#license-rows tr').length,
      publicKey: document.querySelector('#public-key').value.includes('BEGIN PUBLIC KEY')
    })`);

    // The Settings window, in the real window: the gear icon opens it, it shows
    // the owner account, and Esc closes it. The page script is plain and
    // synchronous on purpose — a smoke run must never be able to hang the build.
    const opened = await mainWindow.webContents.executeJavaScript(`(() => {
      document.querySelector('#settings-button').click();
      return true;
    })()`);
    await new Promise(resolve => setTimeout(resolve, 150));
    await waitFor("document.querySelector('#settings-folder').textContent.trim() !== '—'", 'the data folder');
    const settings = await mainWindow.webContents.executeJavaScript(`({
      open: document.querySelector('#settings-window').hidden === false,
      user: document.querySelector('#settings-user').textContent.trim(),
      folder: document.querySelector('#settings-folder').textContent.trim(),
      hasPasswordForm: Boolean(document.querySelector('#password-form')),
      hasUsernameForm: Boolean(document.querySelector('#username-form')),
      hasSignOut: Boolean(document.querySelector('#settings-signout'))
    })`);
    await mainWindow.webContents.executeJavaScript(`(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      return true;
    })()`);
    settings.closedByEscape = await mainWindow.webContents.executeJavaScript("document.querySelector('#settings-window').hidden === true");

    // The password change itself through the same channel the form uses, then a
    // real sign-in with the new password against the real database.
    const changedVia = await channels.changePassword({ current: SMOKE_PASSWORD, password: 'smoke-Changed1', confirm: 'smoke-Changed1' });
    const changed = await account.signIn(store, db, { username: SMOKE_USER, password: 'smoke-Changed1' });

    const generated = await channels.generate({ product: 'Pharmacy Management', plan: '1y' });
    const verified = await channels.verify({ serial: generated.license.formatted });
    const shortcut = ensureDesktopShortcut();
    const linkExists = (shortcut.paths || []).every(file => fs.existsSync(file));

    say(`SMOKE_RESULT ${JSON.stringify({
      page,
      settings: { ...settings, opened: opened === true, passwordChanged: changed.username === SMOKE_USER, changedBy: changedVia?.username || '' },
      generated: { serial: generated.license.formatted, plan: generated.license.planLabel, id: generated.license.id },
      verified: { valid: verified.valid, product: verified.product },
      shortcut: { created: shortcut.created, paths: shortcut.paths, checked: shortcut.checked, reason: shortcut.reason || '' },
      linkExists,
      counts: counts()
    })}`);
    setTimeout(() => app.exit(0), 150);
  } catch (error) {
    say(`SMOKE_ERROR ${error.stack || error.message}`);
    setTimeout(() => app.exit(1), 150);
  }
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

app.whenReady().then(async () => {
  if (SMOKE) {
    app.setPath('userData', path.join(SMOKE_ROOT, 'profile'));
    app.setPath('desktop', path.join(SMOKE_ROOT, 'Desktop'));
  }
  dataFolder = app.getPath('userData');
  keyFolder = path.join(dataFolder, 'keys');
  keys.ensureKeyPair(keyFolder);
  const opened = store.openDatabase(dataFolder);
  db = opened.db;
  dbFile = opened.file;

  // An unattended smoke run signs in with the throwaway account it created, so
  // the window it drives is the real, signed-in tool.
  if (SMOKE) {
    try {
      if (!account.state(store, db).configured) {
        await account.register(store, db, { username: SMOKE_USER, password: SMOKE_PASSWORD, confirm: SMOKE_PASSWORD });
      }
      await account.signIn(store, db, { username: SMOKE_USER, password: SMOKE_PASSWORD });
      session = { signedIn: true, username: SMOKE_USER };
    } catch (error) {
      console.error('[generator] smoke sign-in failed:', error.message);
    }
  }

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
  // Give the window a moment to appear, then make sure the desktop icon exists.
  mainWindow.webContents.once('did-finish-load', () => {
    if (SMOKE) {
      runSmokeTest();
      return;
    }
    const result = ensureDesktopShortcut();
    if (result.created) console.log('[generator] desktop shortcut created:', result.path);
    else if (result.reason && result.reason !== 'exists' && result.reason !== 'portable') {
      console.log('[generator] desktop shortcut not created:', result.reason);
    }
  });
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
