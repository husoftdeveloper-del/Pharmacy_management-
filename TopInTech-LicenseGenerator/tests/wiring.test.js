'use strict';
/* Wiring tests: they do not need Electron. They check that the three layers
   (window, preload bridge, main process) agree with each other, because a
   missing channel or a renamed element is exactly the kind of bug that only
   shows up when the app is opened by hand.                                 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const preload = read('preload.js');
const html = read('src/index.html');
const renderer = read('src/scripts/app.js');
const main = read('main.js');
const pkg = JSON.parse(read('package.json'));

function allowedChannels() {
  const block = preload.slice(preload.indexOf('new Set(['), preload.indexOf('])'));
  return new Set([...block.matchAll(/'([a-zA-Z]+)'/g)].map(match => match[1]));
}

function mainChannels() {
  const start = main.indexOf('const channels = {');
  const block = main.slice(start, main.indexOf('\n};', start));
  return new Set([...block.matchAll(/^ {2}([a-zA-Z]+):/gm)].map(match => match[1]));
}

function rendererCalls() {
  return new Set([...renderer.matchAll(/\bcall\('([a-zA-Z]+)'/g)].map(match => match[1]));
}

test('every channel the window calls is allowed by the preload bridge and handled in main', () => {
  const used = rendererCalls();
  const allowed = allowedChannels();
  const handled = mainChannels();
  assert.ok(used.size >= 10, `expected at least ten channels, found ${used.size}`);
  for (const channel of used) {
    assert.ok(allowed.has(channel), `renderer calls ${channel} but preload does not allow it`);
    assert.ok(handled.has(channel), `renderer calls ${channel} but main does not handle it`);
  }
});

test('the preload allow-list and the main handlers are the same set', () => {
  const allowed = [...allowedChannels()].sort();
  const handled = [...mainChannels()].sort();
  assert.deepEqual(allowed, handled);
});

test('the preload exposes only the call() function and no raw ipcRenderer', () => {
  assert.match(preload, /contextBridge\.exposeInMainWorld\('generator'/);
  assert.equal((preload.match(/exposeInMainWorld/g) || []).length, 1);
  assert.match(preload, /ipcRenderer\.invoke\('generator:call'/);
  assert.doesNotMatch(preload, /exposeInMainWorld\([^)]*ipcRenderer\s*[,)]/);
});

test('every element the renderer looks up exists in the page', () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const used = [...renderer.matchAll(/\$\('#([^']+)'\)/g)].map(match => match[1]);
  assert.ok(used.length > 20);
  for (const id of new Set(used)) {
    assert.ok(ids.has(id), `the renderer looks up #${id} but index.html has no such element`);
  }
});

test('the page loads exactly one script and no inline code', () => {
  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map(match => match[1]);
  assert.equal(scripts.length, 1);
  assert.match(scripts[0], /src="scripts\/app\.js"/);
  assert.doesNotMatch(html, /<script[^>]*>[\s\S]*?[^<][\s\S]*?<\/script>/);
  assert.doesNotMatch(html, /\son[a-z]+="/i);
  assert.doesNotMatch(renderer, /\.innerHTML\s*=/);
});

test('the page ships a strict content-security policy and no remote assets', () => {
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(csp, 'index.html must declare a Content-Security-Policy');
  assert.match(csp[1], /default-src 'self'/);
  assert.match(csp[1], /script-src 'self'/);
  assert.match(csp[1], /object-src 'none'/);
  assert.match(csp[1], /connect-src 'none'/);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(renderer, /https?:\/\//);
});

test('the window is sandboxed, isolated and has no Node integration', () => {
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /sandbox: true/);
  assert.match(main, /preload: path\.join\(__dirname, 'preload\.js'\)/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(main, /will-navigate/);
  assert.match(main, /requestSingleInstanceLock/);
});

test('the private key never reaches the renderer', () => {
  const windowCode = `${preload}\n${renderer}`;
  assert.doesNotMatch(windowCode, /private\.pem/);
  assert.doesNotMatch(windowCode, /readPrivate/);
  assert.doesNotMatch(windowCode, /PRIVATE KEY/);
  // The renderer only ever sees describe(), which is public-only.
  assert.doesNotMatch(main, /privateKey:\s*keys\.readPrivate/);
});

test('the installer is configured for Windows setup and portable exe', () => {
  assert.equal(pkg.build.appId, 'com.topintech.licensegenerator');
  assert.equal(pkg.build.productName, 'Top In Tech License Generator');
  assert.deepEqual(pkg.build.win.target, ['nsis', 'portable']);
  assert.equal(pkg.build.win.signAndEditExecutable, false);
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false, 'the license database must survive an uninstall');
  assert.equal(pkg.build.nsis.oneClick, false);
  assert.equal(pkg.build.nsis.perMachine, false);
  assert.equal(pkg.build.asar, true);
  assert.equal(pkg.build.directories.output, 'release');
  assert.equal(pkg.main, 'main.js');
  for (const entry of ['main.js', 'preload.js', 'lib/**/*', 'src/**/*', 'package.json']) {
    assert.ok(pkg.build.files.includes(entry), `${entry} must be packaged`);
  }
  assert.equal(pkg.build.files.some(entry => entry.includes('keys')), false, 'keys must never be packaged');
});

test('the app depends on Electron only, with no frontend framework', () => {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const forbidden of ['react', 'react-dom', 'vue', 'next', 'angular', '@angular/core', 'tailwindcss', 'typescript', 'jquery', 'svelte']) {
    assert.equal(Object.keys(deps).includes(forbidden), false, `${forbidden} is not allowed`);
  }
  assert.equal(Object.keys(deps).sort().join(','), 'electron,electron-builder');
});

test('the renderer uses the sandbox bridge and no browser storage', () => {
  assert.match(renderer, /window\.generator\.call/);
  assert.doesNotMatch(renderer, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(renderer, /require\(|module\.exports/);
});

test('the license database lives in the app data folder, not next to the exe', () => {
  assert.match(main, /app\.getPath\('userData'\)/);
  assert.match(main, /path\.join\(dataFolder, 'keys'\)/);
  assert.doesNotMatch(main, /getPath\('exe'\)/);
});

test('the css file exists and both themes of drift are defined by variables', () => {
  const css = read('src/styles/app.css');
  assert.ok(css.length > 3000);
  assert.match(css, /:root\{/);
  assert.match(css, /--primary:#18b79c/);
  assert.match(css, /\.license-table/);
  for (const className of ['status-pill', 'plan-tag', 'toast', 'stat', 'panel']) {
    assert.ok(html.includes(className) || css.includes(`.${className}`), `${className} is missing`);
  }
});

test('the fields the table reads exist on a decorated license row', () => {
  const schema = read('lib/database.js');
  const licensesTable = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS licenses'), schema.indexOf('CREATE INDEX'));
  const columns = new Set([...licensesTable.matchAll(/^\s{2}([a-z_]+) TEXT|^\s{2}([a-z_]+) INTEGER/gm)]
    .map(match => match[1] || match[2]));
  assert.ok(columns.has('issued_on'), 'the schema must keep issued_on');
  assert.ok(columns.has('expires_on'), 'the schema must keep expires_on');
  const decorated = new Set(['planId', 'planLabel', 'formatted', 'plain']);
  const referenced = new Set([...renderer.matchAll(/\b(?:row|license)\.([a-z_]+)/gi)].map(match => match[1]));
  assert.ok(referenced.size > 4);
  for (const field of referenced) {
    assert.ok(columns.has(field) || decorated.has(field),
      `the renderer reads row.${field}, which neither the licenses table nor decorate() provides`);
  }
  // decorate() must actually add the four display fields.
  const decorate = main.slice(main.indexOf('function decorate'), main.indexOf('function newLicenseId'));
  for (const field of decorated) {
    assert.match(decorate, new RegExp(`\\b${field}\\s*[:,]`), `decorate() does not add ${field}`);
  }
});

test('every database query is parameterised, never string-concatenated with user input', () => {
  const db = read('lib/database.js');
  assert.doesNotMatch(db, /\.run\([^)]*\+\s*(id|status|note|term|search)\b/);
  assert.doesNotMatch(db, /prepare\(`[^`]*\$\{(?!like|ORDER)/);
  assert.match(db, /PRAGMA foreign_keys=ON/);
  assert.match(db, /CHECK\(status IN \('unused','assigned','used'\)\)/);
});

test('the installer always creates a desktop shortcut and opens the app when it finishes', () => {
  // The owner installs this once on a laptop: double-clicking the setup file
  // must leave a desktop icon behind and start the app straight away.
  assert.equal(pkg.build.nsis.createDesktopShortcut, 'always');
  assert.equal(pkg.build.nsis.createStartMenuShortcut, true);
  assert.equal(pkg.build.nsis.runAfterFinish, true);
  assert.equal(pkg.build.nsis.allowToChangeInstallationDirectory, true);
  assert.equal(pkg.build.nsis.oneClick, false, 'a visible wizard, not a silent install');
  assert.equal(pkg.build.nsis.perMachine, false, 'a per-user install needs no administrator password');
  assert.match(pkg.build.nsis.installerIcon, /\.ico$/);
  assert.match(pkg.build.nsis.uninstallerIcon, /\.ico$/);
  assert.equal(pkg.build.portable.unpackDirName, 'TopInTechLicenseGenerator');
  assert.match(pkg.build.artifactName, /-\$\{version\}-\$\{arch\}\.\$\{ext\}$/);
});

test('the icon files exist and the ico holds several sizes', () => {
  const ico = fs.readFileSync(path.join(root, 'buildResources/icon.ico'));
  assert.equal(ico.readUInt16LE(0), 0, 'reserved field');
  assert.equal(ico.readUInt16LE(2), 1, 'type 1 = icon');
  const count = ico.readUInt16LE(4);
  assert.ok(count >= 4, `expected at least four icon sizes, found ${count}`);
  const sizes = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    sizes.push(ico[offset] || 256);
  }
  for (const size of [256, 48, 32, 16]) assert.ok(sizes.includes(size), `missing the ${size}px icon`);
  assert.ok(fs.existsSync(path.join(root, 'buildResources/icon.png')));
});
