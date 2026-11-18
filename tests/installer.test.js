'use strict';
// The Pharmacy setup wizard asks for the install key the owner generates in
// Top In Tech License Generator, and refuses a wrong one before anything is
// installed. The arithmetic lives in two places — build/installer.nsh (NSIS)
// and TopInTech-LicenseGenerator/lib/setupkey.js — so these tests pin the
// constants both sides share and run the NSIS algorithm step by step to prove a
// generated key is accepted and a mistyped or invented one is refused.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const nsh = fs.readFileSync(path.join(root, 'build/installer.nsh'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const setupkey = require(path.join(root, 'TopInTech-LicenseGenerator/lib/setupkey.js'));

const value = name => {
  const match = nsh.match(new RegExp(`!define ${name} "?([^"\\n\\r]*)"?$`, 'm'));
  assert.ok(match, `${name} is missing from the installer script`);
  return match[1];
};

// The NSIS macro, transcribed instruction by instruction: 32-character alphabet
// lookup, a folded sum in 32-bit integers, then two five-bit slices of a mixed
// value. Written from the .nsh, not from setupkey.js, so a change on either side
// breaks this test instead of the customer's install.
function nsisValidate(raw) {
  const alphabet = value('SETUP_ALPHABET');
  const salt = value('SETUP_SALT');
  const modulus = Number(value('SETUP_MODULUS'));
  const dataLength = Number(value('SETUP_DATA_LENGTH'));
  const keyLength = Number(value('SETUP_KEY_LENGTH'));
  const key = String(raw).replace(/ /g, '').replace(/-/g, '');
  if (key.length !== keyLength) return false;
  const indexOf = char => {
    for (let i = 0; i < 32; i += 1) {
      if (alphabet[i].toLowerCase() === String(char).toLowerCase()) return i;
    }
    return 32;
  };
  let a = 0;
  for (let i = 0; i < dataLength; i += 1) {
    const index = indexOf(key[i]);
    if (index === 32) return false;
    a = (a * 33 + index + indexOf(salt[i]) + i * 7) % modulus;
    a = a < 0 ? a + modulus : a;
  }
  // IntOp truncates towards zero, and every value here is positive.
  const check = alphabet[a % 32];
  return check.toLowerCase() === key.slice(dataLength).toLowerCase();
}

test('the setup wizard asks for the serial key before anything is installed', () => {
  assert.equal(pkg.build.nsis.include, 'build/installer.nsh', 'electron-builder must compile the activation page');
  assert.ok(fs.existsSync(path.join(root, 'build/installer.nsh')));
  // Welcome -> Software Activation -> Installation Location -> Install -> Finish
  assert.match(nsh, /!macro customWelcomePage/);
  assert.match(nsh, /!insertmacro MUI_PAGE_WELCOME/);
  assert.match(nsh, /Page custom ActivationPageShow ActivationPageLeave/);
  // The form: title, label, input, Continue and Cancel.
  assert.match(nsh, /"Pharmacy Management Activation"/);
  assert.match(nsh, /"Enter your serial key"/);
  assert.match(nsh, /\$\{NSD_CreateText\}/, 'the serial key field');
  assert.match(nsh, /STR:Continue/);
  assert.match(nsh, /STR:Cancel/);
  // One refusal message, word for word, for both an empty and a wrong key.
  assert.match(nsh, /!define SETUP_REFUSED "Invalid Serial Key!\$\\r\$\\nApplication Not Installed\."/);
  const leave = nsh.slice(nsh.indexOf('Function ActivationPageLeave'), nsh.indexOf('FunctionEnd', nsh.indexOf('Function ActivationPageLeave')));
  assert.equal((leave.match(/Abort/g) || []).length, 1, 'a refused key stops the wizard on the page');
  assert.match(leave, /\$\{NSD_SetText\} \$ActivationError "\$\{SETUP_REFUSED\}"/, 'the refusal is shown in the page');
  assert.match(leave, /StrCpy \$3 \$0/, 'an empty field is checked first');
  assert.match(leave, /!insertmacro SetupKeyValidate/, 'the typed key is validated');
});

test('the installer and the generator run the same arithmetic', () => {
  assert.equal(value('SETUP_ALPHABET'), setupkey.ALPHABET);
  assert.equal(value('SETUP_SALT'), setupkey.SALT);
  assert.equal(Number(value('SETUP_MODULUS')), setupkey.MODULUS);
  // The two formulas, instruction by instruction, as setupkey.js writes them.
  const lines = [
    'IntOp $R2 $R2 * 33',            // a = a * 33
    'IntOp $R2 $R2 + $R5',           //   + alphabet index of the character
    'IntOp $R2 $R2 + $R8',           //   + salt index
    'IntOp $R4 $R3 * 7',             //   + i * 7
    'IntOp $R2 $R2 % ${SETUP_MODULUS}',
    'IntOp $R6 $R2 % 32'             // the check character
  ];
  for (const line of lines) {
    assert.ok(nsh.includes(line), `the installer is missing: ${line}`);
  }
});

test('every key the owner generates is accepted by the wizard', () => {
  for (const serial of [
    'TIT1AB12CD34EF56.GH78JK90LM12NP34QR56ST78VW90XY12Z3456789ABCDEF',
    'TIT1ONE.TWO',
    'TIT1SOME-OTHER.SERIAL-0001',
    ''
  ]) {
    const key = setupkey.makeInstallKey(serial);
    assert.equal(nsisValidate(key), true, `accepted: ${key}`);
    assert.equal(setupkey.verifyInstallKey(key).valid, true);
    // Typed by hand: lower case, without the dashes, or with spaces instead.
    assert.equal(nsisValidate(key.toLowerCase()), true);
    assert.equal(nsisValidate(key.replace(/-/g, '')), true);
    assert.equal(nsisValidate(key.replace(/-/g, ' ')), true);
  }
});

test('a mistyped or invented key is refused', () => {
  const key = setupkey.makeInstallKey('TIT1OWNER.SERIAL-2');
  const cases = {
    empty: '',
    spaces: '   ',
    short: 'ABC',
    long: `${key}-EXTRA`,
    'wrong check character': key.slice(0, 5) + (key.endsWith('Z') ? 'Y' : 'Z'),
    'one data character changed': (key[0] === 'A' ? 'B' : 'A') + key.slice(1),
    'not from the alphabet': 'III-III',
    'made up': 'ABC-124',
    'neat but unissued': '123-456'
  };
  for (const [name, typed] of Object.entries(cases)) {
    assert.equal(nsisValidate(typed), false, `refused: ${name}`);
  }
  // And the two implementations agree on a large sample of random strings.
  let seed = 7;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed;
  };
  for (let i = 0; i < 500; i += 1) {
    let text = '';
    for (let c = 0; c < 6; c += 1) text += setupkey.ALPHABET[next() % 32];
    if (next() % 2) text = text.slice(0, 5) + setupkey.checkGroups(text.slice(0, 5));
    assert.equal(nsisValidate(text), setupkey.verifyInstallKey(text).valid,
      `the installer and the generator disagree about ${text}`);
  }
});

test('every run asks for the key and no earlier install can skip it', () => {
  // The page must have no precondition at all: an installed application, an old
  // registry flag or a leftover marker file must not remove it.
  const show = nsh.slice(nsh.indexOf('Function ActivationPageShow'), nsh.indexOf('FunctionEnd', nsh.indexOf('Function ActivationPageShow')));
  // The only Abort left in the page is the nsDialogs::Create failure path, not a
  // "this machine is already activated" decision.
  assert.ok(!/SetupKnownCheck|ReadRegStr|FileExists/.test(show), 'the page is always drawn, never skipped');
  for (const remembered of ['ReadRegStr', 'WriteRegStr', 'activated.txt', 'SETUP_MARKER', 'SetupKnownCheck', 'SetupRemember']) {
    assert.ok(!nsh.includes(remembered), `the installer must not remember an activation: found ${remembered}`);
  }
  // Nothing is written at install time that a later setup could read back.
  assert.doesNotMatch(nsh, /!macro customInstall\b/, 'customInstall would be the place to write such a flag');
  assert.doesNotMatch(nsh, /customUnInstall/, 'the wizard never touches an activation record');
  // The silent path has no exemption for a machine that already has the app:
  // one branch only, straight to the environment variable and the same check.
  const init = nsh.slice(nsh.indexOf('!macro customInit'), nsh.indexOf('!macroend', nsh.indexOf('!macro customInit')));
  // Two conditions only: "is this a silent run" and "was the key accepted".
  assert.equal((init.match(/\$\{If\}/g) || []).length, 2, 'no third condition may exempt an existing installation');
  assert.doesNotMatch(init, /ReadRegStr|FileExists|SetupKnownCheck/, 'a silent upgrade is checked like a first install');
  assert.match(init, /ReadEnvStr \$0 "PHARMACY_SETUP_KEY"/);
  assert.match(init, /!insertmacro SetupKeyValidate \$0 \$1/);
});

test('the application itself is left alone', () => {
  // The key is checked once, by the setup. No application file may grow a check.
  const appFiles = ['main.js', 'preload.js', 'src/scripts/app.js', 'src/scripts/version.js'];
  for (const file of appFiles) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(!/SetupKeyValidate|verifyInstallKey|makeInstallKey|serial key/i.test(text),
      `${file} must not ask for a serial key`);
  }
});

test('the wizard still owns the shortcuts and files', () => {
  assert.doesNotMatch(nsh, /CreateShortcut/, 'a second shortcut would put two icons on the Desktop');
  assert.doesNotMatch(nsh, /SetShellVarContext/, 'changing the shell context moves where the wizard puts its shortcuts');
  assert.equal(pkg.build.nsis.createDesktopShortcut, true);
  assert.equal(pkg.build.nsis.createStartMenuShortcut, true);
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false, 'the database must survive an uninstall');
  // A silent run proves the key through the environment; without one it stops.
  const init = nsh.slice(nsh.indexOf('!macro customInit'), nsh.indexOf('!macroend', nsh.indexOf('!macro customInit')));
  assert.match(init, /\$\{Silent\}/);
  assert.match(init, /ReadEnvStr \$0 "PHARMACY_SETUP_KEY"/);
  assert.match(init, /!insertmacro SetupKeyValidate/);
  assert.match(init, /SetErrorLevel 2/);
  assert.match(init, /Quit/);
});
