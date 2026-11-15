'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ensureDesktopShortcut, REASONS } = require('../lib/shortcut');

const NAME = 'Top In Tech License Generator';
const TARGET = 'C:\\Users\\Owner\\AppData\\Local\\Programs\\Top In Tech License Generator\\Top In Tech License Generator.exe';

function desktop() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tit-desktop-'));
}

// Stands in for shell.writeShortcutLink: records the call and writes a file.
function writer(calls = []) {
  return (file, data) => {
    calls.push({ file, data });
    fs.writeFileSync(file, 'shortcut');
    return true;
  };
}

test('a missing desktop icon is created in the folder Windows reports', () => {
  const folder = desktop();
  const calls = [];
  const result = ensureDesktopShortcut({
    platform: 'win32', portable: false, desktopFolder: folder, name: NAME, target: TARGET,
    fs, writeShortcutLink: writer(calls)
  });
  assert.equal(result.created, true);
  assert.equal(result.path, path.join(folder, `${NAME}.lnk`));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].data.target, TARGET);
  assert.equal(calls[0].data.description, NAME);
  assert.equal(calls[0].data.appUserModelId, 'com.topintech.licensegenerator');
  assert.equal(fs.existsSync(result.path), true);
});

test('a redirected desktop folder is the one that gets the icon', () => {
  // OneDrive moved the desktop: the installer used the old path, the shell
  // shows the new one. The app must write to the new one.
  const redirected = path.join(desktop(), 'OneDrive', 'Desktop');
  const calls = [];
  const result = ensureDesktopShortcut({
    platform: 'win32', portable: false, desktopFolder: redirected, name: NAME, target: TARGET,
    fs, writeShortcutLink: writer(calls)
  });
  assert.equal(result.created, true);
  assert.equal(result.path, path.join(redirected, `${NAME}.lnk`));
  assert.equal(calls[0].file, result.path);
});

test('the shortcut is never recreated when it is already there', () => {
  const folder = desktop();
  fs.writeFileSync(path.join(folder, `${NAME}.lnk`), 'existing');
  let writes = 0;
  const result = ensureDesktopShortcut({
    platform: 'win32', portable: false, desktopFolder: folder, name: NAME, target: TARGET,
    fs, writeShortcutLink: () => { writes += 1; return true; }
  });
  assert.equal(result.created, false);
  assert.equal(result.reason, REASONS.exists);
  assert.equal(writes, 0);
});

test('the portable build leaves no icon behind', () => {
  const folder = desktop();
  let writes = 0;
  const result = ensureDesktopShortcut({
    platform: 'win32', portable: true, desktopFolder: folder, name: NAME, target: TARGET,
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
    platform: 'linux', portable: false, desktopFolder: folder, name: NAME, target: '/app/app',
    fs, writeShortcutLink: writer()
  });
  assert.equal(result.created, false);
  assert.equal(result.reason, REASONS.platform);
});

test('a refused write or a thrown error is reported, never fatal', () => {
  const folder = desktop();
  const refused = ensureDesktopShortcut({
    platform: 'win32', portable: false, desktopFolder: folder, name: NAME, target: TARGET,
    fs, writeShortcutLink: () => false
  });
  assert.equal(refused.created, false);
  assert.equal(refused.reason, REASONS.refused);

  const thrown = ensureDesktopShortcut({
    platform: 'win32', portable: false, desktopFolder: folder, name: NAME, target: TARGET,
    fs, writeShortcutLink: () => { throw new Error('Access is denied.'); }
  });
  assert.equal(thrown.created, false);
  assert.match(thrown.reason, /Access is denied/);
});

test('the createShortcut channel is wired from window to main', () => {
  const root = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'src/scripts/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
  assert.match(main, /createShortcut: \(\) => ensureDesktopShortcut\(\)/);
  assert.match(main, /app\.getPath\('desktop'\)/);
  assert.match(main, /PORTABLE_EXECUTABLE_DIR/);
  assert.match(main, /shell\.writeShortcutLink/);
  assert.match(preload, /'createShortcut'/);
  assert.match(renderer, /call\('createShortcut'/);
  assert.match(html, /id="desktop-shortcut"/);
});
