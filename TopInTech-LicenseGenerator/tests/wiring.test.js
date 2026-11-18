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
  // The handlers live in `inner`; `channels` is the sign-in-guarded wrapper
  // around them (a Proxy, so it has no literal channel list).
  const start = main.indexOf('const inner = {');
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

test('the tool is locked until the owner signs in', () => {
  // The window shows a sign-in form; the main process is the real lock, so a
  // script in the page cannot reach the private key or the license database.
  assert.match(html, /id="login-screen"/);
  assert.match(html, /id="login-form"/);
  assert.match(html, /id="login-username"/);
  assert.match(html, /id="login-password"[^>]*type="password"/);
  assert.match(html, /id="login-confirm"[^>]*type="password"/);
  assert.match(html, /id="app-main" hidden/, 'the tool starts hidden behind the form');

  assert.match(main, /let session = \{ signedIn: false/, 'the app starts signed out');
  assert.match(main, /const PUBLIC_CHANNELS = new Set\(\['authState', 'signIn', 'register'\]\)/);
  assert.match(main, /if \(!session\.signedIn\) throw new Error\('Sign in to continue\.'\)/, 'every other operation is refused');
  assert.match(main, /new Proxy\(inner/, 'the guard wraps every handler');

  // The password is hashed, never kept in clear text or written to a log.
  assert.match(main, /require\('\.\/lib\/account'\)/);
  const lib = fs.readFileSync(path.join(root, 'lib/account.js'), 'utf8');
  assert.match(lib, /crypto\.scrypt\(/);
  assert.match(lib, /timingSafeEqual/);
  assert.equal(/console\.(log|error|warn)\([^)]*password/i.test(lib + main), false, 'the password is never logged');
  assert.equal((html.match(/HKDEVELOPER2/g) || []).length, 0, 'no password is baked into the page');
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

test('the installer is configured as a Windows setup wizard', () => {
  assert.equal(pkg.build.appId, 'com.topintech.licensegenerator');
  assert.equal(pkg.build.productName, 'Top In Tech License Generator');
  assert.deepEqual(pkg.build.win.target, ['nsis']);
  assert.equal(pkg.build.win.signAndEditExecutable, false);
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false, 'the license database must survive an uninstall');
  assert.equal(pkg.build.nsis.perMachine, true);
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

test('the setup file is a full Windows installation wizard, not a portable copy', () => {
  // Requirement: double-clicking the setup file must show Welcome -> Location ->
  // Install -> Finish, install into Program Files and leave both shortcuts.
  assert.equal(pkg.build.nsis.oneClick, false, 'a wizard, so the user sees the steps');
  assert.equal(pkg.build.nsis.allowToChangeInstallationDirectory, true, 'the Installation Location page');
  assert.equal(pkg.build.nsis.perMachine, true, 'install for all users, into Program Files');
  assert.equal(pkg.build.nsis.allowElevation, true, 'Program Files needs the UAC prompt');
  assert.equal(pkg.build.nsis.createDesktopShortcut, true);
  assert.equal(pkg.build.nsis.createStartMenuShortcut, true);
  assert.equal(pkg.build.nsis.runAfterFinish, true, 'the Finish page can start the app');
  assert.equal(pkg.build.nsis.shortcutName, 'Top In Tech License Generator');
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false, 'licences and keys must survive an uninstall');
  assert.equal(pkg.build.nsis.artifactName, 'Top In Tech License Generator Setup.exe');
  assert.match(pkg.build.nsis.installerIcon, /\.ico$/);
  assert.match(pkg.build.nsis.uninstallerIcon, /\.ico$/);
  assert.equal(pkg.build.nsis.uninstallDisplayName, 'Top In Tech License Generator');
  assert.equal(pkg.build.nsis.include, 'buildResources/installer.nsh');
});

test('the default Windows build produces the setup wizard only', () => {
  assert.deepEqual(pkg.build.win.target, ['nsis'], 'no portable target by default');
  assert.match(pkg.scripts['dist:win'], /--win nsis /);
  assert.doesNotMatch(pkg.scripts['dist:win'], /portable/, 'the main installer is the setup wizard');
  // A portable build is still available, but only when explicitly asked for.
  assert.match(pkg.scripts['dist:portable'], /--win portable /);
});

test('the two downloads are named in plain words, not with version numbers', () => {
  const names = [pkg.build.nsis.artifactName, pkg.build.portable.artifactName];
  for (const name of names) {
    assert.match(name, /\.exe$/);
    assert.match(name, /Setup\.exe$|Portable\.exe$/);
    // The owner asked for the literal name "Top In Tech License Generator Setup.exe".
    // GitHub rewrites the spaces in release asset names, which is why the run also
    // publishes a hyphenated copy; locally the file keeps the requested name.
  }
  assert.notEqual(names[0], names[1], 'setup and portable must not overwrite each other');
});

test('the owner logo is used for the window, the shortcut and the installer', () => {
  const page = read('src/index.html');
  assert.match(page, /<link rel="icon" href="assets\/pharmacy-logo\.png">/);
  assert.match(page, /brand-mark[\s\S]{0,200}assets\/pharmacy-logo\.png/);
  assert.equal(pkg.build.win.icon, 'buildResources/icon.ico');
  for (const file of ['buildResources/icon.ico', 'buildResources/icon.png', 'src/assets/pharmacy-logo.png']) {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} is missing`);
  }
  assert.ok(pkg.build.files.includes('src/**/*'), 'the renderer and its logo must be packaged');
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

test('the installer asks for the serial key before anything is installed', () => {
  const nsh = fs.readFileSync(path.join(root, 'buildResources/installer.nsh'), 'utf8');

  // The page itself.
  assert.match(nsh, /!macro customWelcomePage/);
  assert.match(nsh, /!insertmacro MUI_PAGE_WELCOME/);
  assert.match(nsh, /Page custom ActivationPageShow ActivationPageLeave/);

  // The form the owner asked for: title, label, input, Continue, Cancel.
  assert.match(nsh, /"Software Activation"/);
  assert.match(nsh, /"Enter Your Key"/);
  assert.match(nsh, /\$\{NSD_CreateText\}/, 'the serial key input field');
  assert.match(nsh, /STR:Continue/);
  assert.match(nsh, /STR:Cancel/);
  assert.match(nsh, /\$\{NSD_CreateLabel\}[^\n]*ActivationError|NSD_CreateLabel\} 0 66u 100% 28u ""/);

  // The key is compared case-sensitively with StrCmpS semantics.
  assert.match(nsh, /!define ACTIVATION_KEY "mynewpharmacy1221"/);
  assert.match(nsh, /StrCmpS \$0 "\$\{ACTIVATION_KEY\}" ActivationAccepted/, 'an exact, case-sensitive comparison');
  assert.doesNotMatch(nsh, /StrCmp [^\n]*ACTIVATION_KEY/, 'StrCmp is case-insensitive, so it must not be used');
  assert.doesNotMatch(nsh, /StrCmp /, 'no case-insensitive comparison at all');
  assert.match(nsh, /StrCmpS \$R0 "\$\{ACTIVATION_KEY\}"/, 'the silent guard is case-sensitive too');

  // A wrong or empty key keeps the user on the page: Abort, and the install never starts.
  assert.match(nsh, /Please enter your license key/);
  assert.match(nsh, /The key you entered is not valid/);
  assert.equal((nsh.match(/Abort/g) || []).length >= 2, true);

  // Never shown in the UI, and never asked twice.
  const uiLines = nsh.split('\n').filter(line => !line.trim().startsWith(';'));
  const keyMentions = uiLines.filter(line => line.includes('mynewpharmacy1221'));
  assert.equal(keyMentions.length, 1, 'the key appears only in its !define, never in a label or message');
  assert.match(keyMentions[0], /!define ACTIVATION_KEY/);
  assert.match(nsh, /WriteRegStr HKLM "\$\{ACTIVATION_REG_KEY\}"/);
  // An activated machine skips the page: the remembered flags are checked in
  // ActivationKnownCheck (both registry views, marker files, installed app).
  assert.match(nsh, /ReadRegStr \$1 HKLM/, 'an activated machine skips the page');
});

test('a laptop that was activated once is never asked for the key again', () => {
  // The owner reinstalled the setup on a laptop that had been activated before
  // and the "Enter Your Key" page came back, because only one registry value was
  // remembered. The page must now look everywhere an activation can be stored.
  const nsh = fs.readFileSync(path.join(root, 'buildResources/installer.nsh'), 'utf8');
  assert.match(nsh, /!macro ActivationKnownCheck/);
  const check = nsh.slice(nsh.indexOf('!macro ActivationKnownCheck'), nsh.indexOf('!macroend', nsh.indexOf('!macro ActivationKnownCheck')));
  // Both registry views and both hives: 32-bit setup writes WOW6432Node.
  assert.match(check, /SetRegView 64/, 'the 64-bit view is read');
  assert.match(check, /SetRegView 32/, 'the 32-bit view is read');
  assert.match(check, /SetRegView lastused/, 'the view is restored');
  assert.equal((check.match(/ReadRegStr \$1 HKLM/g) || []).length, 2, 'HKLM is read through both views');
  assert.equal((check.match(/ReadRegStr \$1 HKCU/g) || []).length, 2, 'HKCU is read through both views');
  // Marker files survive an uninstall and a setup that could not write HKLM.
  // The machine-wide folder is read from the ProgramData environment variable,
  // because the bundled NSIS has no $COMMONAPPDATA and switching the shell
  // context here would move the desktop shortcut the wizard later creates.
  assert.doesNotMatch(check, /\$COMMONAPPDATA/, 'no variable the bundled makensis rejects');
  assert.doesNotMatch(check, /SetShellVarContext/, 'the page must not change where shortcuts go');
  assert.match(check, /ReadEnvStr \$1 "ProgramData"/);
  assert.ok(check.includes('"$1\\Top In Tech\\License Generator\\${ACTIVATION_MARKER}"'), 'the machine-wide marker is checked');
  assert.ok(check.includes('"$LOCALAPPDATA\\Top In Tech\\License Generator\\${ACTIVATION_MARKER}"'), 'the local-appdata marker is checked');
  assert.ok(check.includes('"$APPDATA\\Top In Tech\\License Generator\\${ACTIVATION_MARKER}"'), 'the roaming-appdata marker is checked');
  // The application folder itself proves it was installed with a key.
  assert.ok(check.includes('$PROGRAMFILES64\\Top In Tech License Generator'), 'the installed app counts as activated');
  assert.ok(check.includes('$LOCALAPPDATA\\Programs\\Top In Tech License Generator'), 'a per-user install counts too');

  // Leaving the page out is what "never asked again" means.
  const show = nsh.slice(nsh.indexOf('Function ActivationPageShow'), nsh.indexOf('FunctionEnd', nsh.indexOf('Function ActivationPageShow')));
  assert.match(show, /!insertmacro ActivationKnownCheck/);
  assert.match(show, /Abort/, 'the page removes itself when the machine is known');

  // Every flag is written after a successful install, so the next run finds one.
  assert.match(nsh, /!macro RememberActivation/);
  const remember = nsh.slice(nsh.indexOf('!macro RememberActivation'), nsh.indexOf('!macroend', nsh.indexOf('!macro RememberActivation')));
  assert.equal((remember.match(/WriteRegStr/g) || []).length, 4, 'both hives in both views are written');
  assert.equal((remember.match(/FileOpen/g) || []).length, 3, 'three marker files are written');
  assert.match(remember, /ReadEnvStr \$1 "ProgramData"/);
  assert.doesNotMatch(remember, /SetShellVarContext/, 'writing the flags must not move the shortcuts');
  const install = nsh.slice(nsh.indexOf('!macro customInstall'), nsh.indexOf('!macroend', nsh.indexOf('!macro customInstall')));
  assert.match(install, /!insertmacro RememberActivation/);
  const uninstall = nsh.slice(nsh.indexOf('!macro customUnInstall'), nsh.indexOf('!macroend', nsh.indexOf('!macro customUnInstall')));
  assert.doesNotMatch(uninstall, /DeleteRegValue|DeleteRegKey/, 'uninstalling keeps the activation');
  // The key itself is still never displayed.
  const uiLines = nsh.split('\n').filter(line => !line.trim().startsWith(';'));
  assert.equal(uiLines.filter(line => line.includes('mynewpharmacy1221')).length, 1);
});

test('the activation page is left out of the uninstaller pass', () => {
  // electron-builder compiles the script twice: once with BUILD_UNINSTALLER to
  // extract the uninstaller (no pages there) and once for the real installer.
  // A page callback that nothing references in the first pass raises
  // "warning 6010", and electron-builder passes -WX, so the build would fail.
  const nsh = fs.readFileSync(path.join(root, 'buildResources/installer.nsh'), 'utf8');
  const start = nsh.indexOf('!ifndef BUILD_UNINSTALLER');
  assert.ok(start > 0, 'the activation block is guarded');
  const end = nsh.indexOf('!endif', start);
  assert.ok(end > start, 'the guard is closed');
  const guarded = nsh.slice(start, end);
  assert.match(guarded, /Function ActivationPageShow/);
  assert.match(guarded, /Function ActivationPageLeave/);
  assert.match(guarded, /!macro customWelcomePage/);
  assert.match(guarded, /Var ActivationField/);
});

test('a silent install cannot skip the activation check', () => {
  const nsh = fs.readFileSync(path.join(root, 'buildResources/installer.nsh'), 'utf8');
  assert.match(nsh, /!macro customInit/);
  assert.match(nsh, /\$\{Silent\}/);
  assert.match(nsh, /ReadEnvStr \$R0 "TIT_SETUP_KEY"/);
  assert.match(nsh, /SetErrorLevel 2/);
  assert.match(nsh, /Quit/, 'a silent run without the key must stop, not install');
  // ...unless the machine was already activated: a silent update is allowed.
  const init = nsh.slice(nsh.indexOf('!macro customInit'), nsh.indexOf('!macroend', nsh.indexOf('!macro customInit')));
  assert.match(init, /!insertmacro ActivationKnownCheck/);
  assert.ok(init.indexOf('ActivationKnownCheck') < init.indexOf('TIT_SETUP_KEY'), 'the remembered flag is checked before the environment key');
});

test('the wizard owns the shortcuts, so no second Desktop icon is created', () => {
  const nsh = fs.readFileSync(path.join(root, 'buildResources/installer.nsh'), 'utf8');
  assert.match(nsh, /!macro customInstall/);

  // electron-builder creates the Desktop and Start-menu shortcuts itself, in the
  // all-users locations. Creating them again from customInstall is what put two
  // identical icons on the Desktop, so the include must not create any.
  assert.doesNotMatch(nsh, /CreateShortcut/, 'the wizard creates the shortcuts, not the include');
  assert.doesNotMatch(nsh, /Exec '/, 'never launch the app from the elevated installer context');
  assert.equal(pkg.build.nsis.createDesktopShortcut, true, 'the wizard still makes the desktop icon');
  assert.equal(pkg.build.nsis.createStartMenuShortcut, true, 'the wizard still makes the start-menu entry');
  assert.equal(pkg.build.nsis.runAfterFinish, true, 'the Finish page runs the app');
});

test('the include removes the duplicate shortcuts the older builds left behind', () => {
  const nsh = fs.readFileSync(path.join(root, 'buildResources/installer.nsh'), 'utf8');
  const install = nsh.slice(nsh.indexOf('!macro customInstall'));
  assert.match(install, /SetShellVarContext current/, 'the per-user copies belong to the account that ran setup');
  assert.match(install, /Delete "\$DESKTOP\\Top In Tech License Generator\.lnk"/);
  assert.match(install, /Delete "\$PROFILE\\Desktop\\Top In Tech License Generator\.lnk"/);
  assert.match(install, /Delete "\$PROFILE\\OneDrive\\Desktop\\Top In Tech License Generator\.lnk"/);
  assert.match(install, /Delete "\$SMPROGRAMS\\Top In Tech License Generator/);
  assert.match(nsh, /!macro customUnInstall/);
  assert.match(nsh, /Delete "\$DESKTOP/);
});
