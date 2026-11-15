'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensureDesktopShortcut, uniqueFolders, REASONS } = require('../lib/shortcut');

const NAME = 'Top In Tech License Generator';
const TARGET = 'C:\\Users\\Owner\\AppData\\Local\\Programs\\Top In Tech License Generator\\Top In Tech License Generator.exe';

function desktop() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tit-desktop-'));
}

// Stands in for shell.writeShortcutLink: records the call and writes a file.
function writer(calls = [], succeeds = true) {
  return (file, data) => {
    calls.push({ file, data });
    if (succeeds) fs.writeFileSync(file, 'shortcut');
    return succeeds;
  };
}

function run(extra) {
  return ensureDesktopShortcut({
    platform: 'win32', portable: false, name: NAME, target: TARGET, fs, ...extra
  });
}

test('a missing desktop icon is created in the folder Windows reports', () => {
  const folder = desktop();
  const calls = [];
  const result = run({ desktopFolders: [folder], writeShortcutLink: writer(calls) });
  assert.equal(result.created, true);
  assert.equal(result.path, path.join(folder, `${NAME}.lnk`));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].data.target, TARGET);
  assert.equal(calls[0].data.description, NAME);
  assert.equal(calls[0].data.appUserModelId, 'com.topintech.licensegenerator');
  assert.equal(fs.existsSync(result.path), true);
});

test('a redirected desktop folder is the one that gets the icon', () => {
  // OneDrive moved the desktop: setup used the old path, the shell shows the new
  // one. The app must write to the new one.
  const redirected = path.join(desktop(), 'OneDrive', 'Desktop');
  const calls = [];
  const result = run({ desktopFolders: [redirected], writeShortcutLink: writer(calls) });
  assert.equal(result.created, true);
  assert.equal(result.path, path.join(redirected, `${NAME}.lnk`));
  assert.equal(calls[0].file, result.path);
});

test('every Desktop folder that exists gets the icon, so one of them must show', () => {
  const plain = desktop();
  const oneDrive = path.join(desktop(), 'OneDrive', 'Desktop');
  fs.mkdirSync(oneDrive, { recursive: true });
  const missing = path.join(desktop(), 'no-such-folder');
  const calls = [];
  const result = run({ desktopFolders: [plain, missing, oneDrive], writeShortcutLink: writer(calls) });
  assert.equal(result.created, true);
  assert.deepEqual(result.paths.sort(), [path.join(plain, `${NAME}.lnk`), path.join(oneDrive, `${NAME}.lnk`)].sort());
  assert.equal(calls.length, 2, 'the folder that does not exist is skipped');
  assert.equal(fs.existsSync(path.join(plain, `${NAME}.lnk`)), true);
  assert.equal(fs.existsSync(path.join(oneDrive, `${NAME}.lnk`)), true);
});

test('the folder Windows reported is created when it does not exist yet', () => {
  // A brand-new profile can have no Desktop folder; the first candidate is the
  // one Windows pointed at, so it is created rather than skipped.
  const fresh = path.join(desktop(), 'NewProfile', 'Desktop');
  const calls = [];
  const result = run({ desktopFolders: [fresh, path.join(desktop(), 'gone')], writeShortcutLink: writer(calls) });
  assert.equal(result.created, true);
  assert.equal(fs.existsSync(path.join(fresh, `${NAME}.lnk`)), true);
  assert.equal(calls.length, 1, 'later folders that do not exist are still skipped');
});

test('duplicate and trailing-slash paths are handled once', () => {
  const folder = desktop();
  const calls = [];
  const result = run({ desktopFolders: [folder, `${folder}\\`, folder.toUpperCase()], writeShortcutLink: writer(calls) });
  assert.equal(result.created, true);
  assert.equal(calls.length, 1);
  assert.equal(result.paths.length, 1);
  assert.deepEqual(uniqueFolders(['C:\\a', 'c:\\A\\', '', 'C:\\b']).length, 2);
});

test('the shortcut is never recreated when it is already there', () => {
  const folder = desktop();
  fs.writeFileSync(path.join(folder, `${NAME}.lnk`), 'existing');
  let writes = 0;
  const result = run({ desktopFolders: [folder], writeShortcutLink: () => { writes += 1; return true; } });
  assert.equal(result.created, true, 'the icon exists, so the user is fine');
  assert.equal(result.allExisted, true);
  assert.equal(writes, 0);
  assert.equal(fs.readFileSync(path.join(folder, `${NAME}.lnk`), 'utf8'), 'existing');
});

test('a silent write failure falls back to PowerShell and is verified', () => {
  const folder = desktop();
  const used = [];
  const result = run({
    desktopFolders: [folder],
    // Claims success but writes nothing: exactly what some Windows builds do.
    writeShortcutLink: () => true,
    powerShell: (file) => { used.push(file); fs.writeFileSync(file, 'ps'); return true; }
  });
  assert.equal(result.created, true);
  assert.equal(used.length, 1);
  assert.equal(fs.existsSync(result.path), true);
});

test('the portable build leaves no icon behind', () => {
  const folder = desktop();
  let writes = 0;
  const result = ensureDesktopShortcut({
    platform: 'win32', portable: true, desktopFolders: [folder], name: NAME, target: TARGET,
    fs, writeShortcutLink: () => { writes += 1; return true; }
  });
  assert.equal(result.created, false);
  assert.equal(result.reason, REASONS.portable);
  assert.equal(writes, 0);
  assert.equal(fs.readdirSync(folder).length, 0);
});

test('other platforms are left alone instead of failing', () => {
  const folder = desktop();
  const result = ensureDesktopShortcut({
    platform: 'linux', portable: false, desktopFolders: [folder], name: NAME, target: '/app/app',
    fs, writeShortcutLink: writer()
  });
  assert.equal(result.created, false);
  assert.equal(result.reason, REASONS.platform);
});

test('a refused write, a thrown error and a missing desktop are reported, never fatal', () => {
  const folder = desktop();
  const refused = run({ desktopFolders: [folder], writeShortcutLink: () => false });
  assert.equal(refused.created, false);
  assert.equal(refused.reason, REASONS.refused);

  const thrown = run({ desktopFolders: [folder], writeShortcutLink: () => { throw new Error('Access is denied.'); } });
  assert.equal(thrown.created, false);
  assert.match(thrown.reason, /Access is denied/);

  const noDesktop = run({ desktopFolders: [], writeShortcutLink: writer() });
  assert.equal(noDesktop.created, false);
  assert.equal(noDesktop.reason, REASONS.missingDesktop);
});

test('the createShortcut channel is wired from window to main', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'src/scripts/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
  assert.match(main, /createShortcut: \(\) => \(\{ \.\.\.ensureDesktopShortcut\(\), exe: process\.execPath \}\)/);
  assert.match(main, /app\.getPath\('desktop'\)/);
  assert.match(main, /OneDrive/);
  assert.match(main, /Parts|Public/);
  assert.match(main, /WScript\.Shell/);
  assert.match(main, /PORTABLE_EXECUTABLE_DIR/);
  assert.match(main, /shell\.showItemInFolder/);
  assert.match(preload, /'createShortcut'/);
  assert.match(preload, /'showShortcut'/);
  assert.match(renderer, /call\('createShortcut'/);
  assert.match(html, /id="desktop-shortcut"/);
});
