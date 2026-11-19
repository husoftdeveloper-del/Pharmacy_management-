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
// returns { valid, days } — days is the last valid day counted from 2025-01-01
function nsisValidate(raw) {
  const alphabet = value('SETUP_ALPHABET');
  const salt = value('SETUP_SALT');
  const modulus = Number(value('SETUP_MODULUS'));
  const dataLength = Number(value('SETUP_DATA_LENGTH'));
  const expiryLength = Number(value('SETUP_EXPIRY_LENGTH'));
  const keyLength = Number(value('SETUP_KEY_LENGTH'));
  const shortLength = Number(value('SETUP_SHORT_KEY_LENGTH'));
  const legacyData = Number(value('SETUP_LEGACY_DATA_LENGTH'));
  const legacyLength = Number(value('SETUP_LEGACY_KEY_LENGTH'));
  const key = String(raw).replace(/ /g, '').replace(/-/g, '').toUpperCase();
  const indexOf = char => {
    for (let i = 0; i < 32; i += 1) {
      if (alphabet[i] === char) return i;
    }
    return 32;
  };
  const fold = length => {
    let a = 0;
    for (let i = 0; i < length; i += 1) {
      const index = indexOf(key[i]);
      if (index === 32) return null;
      a = (a * 33 + index + indexOf(salt[i]) + i * 7) % modulus;
      a = a < 0 ? a + modulus : a;
    }
    return a;
  };
  if (key.length === keyLength) {
    const a = fold(keyLength - 1);
    if (a === null || alphabet[a % 32] !== key[keyLength - 1]) return { valid: false, days: 0 };
    let days = 0;
    for (const char of key.slice(dataLength, dataLength + expiryLength)) {
      const index = indexOf(char);
      if (index === 32) return { valid: false, days: 0 };
      days = days * 32 + index;
    }
    return { valid: true, days };
  }
  if (key.length === shortLength) {
    const a = fold(dataLength);
    return { valid: a !== null && alphabet[a % 32] === key[dataLength], days: 0 };
  }
  if (key.length === legacyLength) {
    const a = fold(legacyData);
    if (a === null) return { valid: false, days: 0 };
    const b = (a * 37 + 11) % modulus;
    const expected = [alphabet[a % 32], alphabet[Math.trunc(a / 32) % 32], alphabet[b % 32], alphabet[Math.trunc(b / 32) % 32]].join('');
    return { valid: expected === key.slice(legacyData), days: 0 };
  }
  return { valid: false, days: 0 };
}

test('the fold is called with a length the macro cannot overwrite', () => {
  // SetupKeyFold counts in $R3 and folds the first LENGTH characters of $R0.
  // A call that passed $R3 as LENGTH folded zero characters and refused every
  // valid key — the setup has to pass a number.
  const nsh = fs.readFileSync(path.join(__dirname, '..', 'build', 'installer.nsh'), 'utf8');
  const defines = {};
  for (const [, name, value] of nsh.matchAll(/^!define (SETUP_[A-Z_]+) (\d+)$/gm)) defines[name] = Number(value);
  assert.equal(defines.SETUP_FOLD_LENGTH, defines.SETUP_KEY_LENGTH - 1, 'the fold covers every character but the check');
  assert.equal(defines.SETUP_DATA_LENGTH + defines.SETUP_EXPIRY_LENGTH + 1, defines.SETUP_KEY_LENGTH);

  const body = nsh.slice(nsh.indexOf('!macro SetupKeyFold'), nsh.indexOf('!macroend', nsh.indexOf('!macro SetupKeyFold')));
  const written = new Set([...body.matchAll(/(?:StrCpy|IntOp|StrLen) \$(R\d)/g)].map(match => match[1]));
  assert.ok(written.has('R3'), 'the fold uses $R3 for its counter');

  const calls = [...nsh.matchAll(/!insertmacro SetupKeyFold ([^\n]+)/g)].map(match => match[1].trim());
  assert.equal(calls.length, 3, 'the three key shapes each fold once');
  for (const call of calls) {
    const literal = /^\d+$/.test(call);
    const define = /^\$\{(SETUP_[A-Z_]+)\}$/.exec(call);
    assert.ok(literal || define, `a call must pass a number, not ${call}`);
    if (define) assert.equal(typeof defines[define[1]], 'number', `${define[1]} must be a number`);
  }
  // The 9-character branch keeps the check position in a register the fold
  // never writes, so remembering it before the fold is safe.
  assert.ok(!written.has('R9'), 'the fold must not touch $R9');
});

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
    assert.equal(nsisValidate(key).valid, true, `accepted: ${key}`);
    assert.equal(setupkey.verifyInstallKey(key).valid, true);
    // Typed by hand: lower case, without the dashes, or with spaces instead.
    assert.equal(nsisValidate(key.toLowerCase()).valid, true);
    assert.equal(nsisValidate(key.replace(/-/g, '')).valid, true);
    assert.equal(nsisValidate(key.replace(/-/g, ' ')).valid, true);
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
    assert.equal(nsisValidate(typed).valid, false, `refused: ${name}`);
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
    assert.equal(nsisValidate(text).valid, setupkey.verifyInstallKey(text).valid,
      `the installer and the generator disagree about ${text}`);
  }
});

test('a key printed by the older generator (16 characters) still installs', () => {
  // This is the bug the owner hit: generator 2.3.2 printed WXYZ-1234-5678-9ABC
  // and the 6-character setup refused it. Both shapes must be accepted, and the
  // generator must agree with the installer about which ones are good.
  assert.equal(Number(value('SETUP_LEGACY_DATA_LENGTH')), setupkey.LEGACY_DATA_LENGTH);
  assert.equal(Number(value('SETUP_LEGACY_KEY_LENGTH')), setupkey.LEGACY_DATA_LENGTH + setupkey.LEGACY_CHECK_LENGTH);

  for (const serial of ['TIT1AAA.BBB', 'TIT1OLD.SERIAL-0001', 'TIT1ABC.DEF']) {
    // Exactly the key version 2.3.2 printed: twelve derived characters plus the
    // four old check characters.
    const legacy = setupkey.legacyMakeInstallKey(serial);
    assert.equal(legacy.replace(/-/g, '').length, 16);
    assert.equal(nsisValidate(legacy).valid, true, `the setup must accept the old key ${legacy}`);
    assert.equal(setupkey.verifyInstallKey(legacy).valid, true, `the generator must accept the old key ${legacy}`);
    // Typed by hand, without dashes or in lower case, it is still the same key.
    assert.equal(nsisValidate(legacy.replace(/-/g, '')).valid, true);
    assert.equal(nsisValidate(legacy.toLowerCase()).valid, true);
    // A damaged old key is still refused.
    const broken = (legacy[0] === 'A' ? 'B' : 'A') + legacy.slice(1);
    assert.equal(nsisValidate(broken).valid, false);
    assert.equal(setupkey.verifyInstallKey(broken).valid, false);
  }
});

test('a pasted serial gets a hint about the short key', () => {
  assert.match(nsh, /!define SETUP_REFUSED_SERIAL "Invalid Serial Key!\$\\r\$\\nApplication Not Installed\./,
    'the refusal message stays word for word');
  assert.match(nsh, /That looks like the serial key/);
  assert.match(nsh, /The setup needs the short install key/);
  const leave = nsh.slice(nsh.indexOf('Function ActivationPageLeave'), nsh.indexOf('FunctionEnd', nsh.indexOf('Function ActivationPageLeave')));
  assert.match(leave, /StrCpy \$6 \$5 4/, 'the first four characters are compared');
  assert.match(leave, /\$6 == "TIT1"/, 'a serial starts with TIT1');
  assert.match(leave, /\$7 > 20/, 'anything longer than a key is a serial');
  assert.equal((leave.match(/Abort/g) || []).length, 1, 'either way the install is blocked');
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
  // The install step writes the licence for the application, never an activation
  // flag a later setup could read back to skip the key page.
  const install = nsh.slice(nsh.indexOf('!macro customInstall'), nsh.indexOf('!macroend', nsh.indexOf('!macro customInstall')));
  assert.match(install, /SetupWriteLicence/);
  assert.doesNotMatch(install, /WriteRegStr|activated/i, 'no activation flag may be written');
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

test('the application never asks for a key, it only reads the licence', () => {
  // The key is typed once, in the setup. The application has no key prompt and
  // no key arithmetic of its own: it reads license.json through license.js and
  // shows the expiry sentence at sign-in.
  for (const file of ['main.js', 'preload.js', 'src/scripts/app.js', 'src/scripts/version.js']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(!/SetupKeyValidate|verifyInstallKey|makeInstallKey|prompt\(/i.test(text),
      `${file} must not ask for a serial key`);
  }
  const bridge = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  assert.ok(!/licen[cs]e.?key|serial.?key/i.test(bridge), 'no key channel is exposed to the page');
  // The expiry sentence lives in one place, and the sign-in path uses it.
  const licenceModule = fs.readFileSync(path.join(root, 'license.js'), 'utf8');
  assert.match(licenceModule, /Your serial key has expired\. Please renew your serial key from the Owner\./);
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.match(main, /const licence = require\('\.\/license'\)/);
  const login = main.slice(main.indexOf("if (c==='login')"), main.indexOf("if (c==='login')") + 700);
  assert.ok(login.indexOf('assertLicence()') < login.indexOf('service.login(p)'), 'expired wins over the password');
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
