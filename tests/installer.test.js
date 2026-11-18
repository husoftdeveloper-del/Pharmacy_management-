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
  const key = String(raw).replace(/ /g, '').replace(/-/g, '');
  if (key.length !== 16) return false;
  const indexOf = char => {
    for (let i = 0; i < 32; i += 1) {
      if (alphabet[i].toLowerCase() === String(char).toLowerCase()) return i;
    }
    return 32;
  };
  let a = 0;
  for (let i = 0; i < 12; i += 1) {
    const index = indexOf(key[i]);
    if (index === 32) return false;
    const saltIndex = indexOf(salt[i]);
    a = (a * 33 + index + saltIndex + i * 7) % modulus;
    a = a < 0 ? a + modulus : a;
  }
  // IntOp truncates towards zero, and every value here is positive.
  const b = ((a * 37 + 11) % modulus + modulus) % modulus;
  const expected = [
    alphabet[a % 32],
    alphabet[Math.trunc(a / 32) % 32],
    alphabet[b % 32],
    alphabet[Math.trunc(b / 32) % 32]
  ].join('');
  return expected.toLowerCase() === key.slice(12).toLowerCase();
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
  // Refusals: empty, and wrong.
  assert.match(nsh, /Please enter your serial key to continue\./);
  assert.match(nsh, /The key you entered is not valid\. Check it and try again\./);
  const leave = nsh.slice(nsh.indexOf('Function ActivationPageLeave'), nsh.indexOf('FunctionEnd', nsh.indexOf('Function ActivationPageLeave')));
  assert.equal((leave.match(/Abort/g) || []).length, 2, 'both refusals stop the wizard on the page');
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
    'IntOp $R4 $R2 * 37',            // b = a * 37
    'IntOp $R4 $R4 + 11',            //   + 11
    'IntOp $R4 $R4 % ${SETUP_MODULUS}',
    'IntOp $R6 $R2 / 32',            // the second character of the first pair
    'IntOp $R6 $R4 / 32'             // and of the second pair
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
    'wrong check group': key.slice(0, 15) + (key.endsWith('Z') ? 'Y' : 'Z'),
    'one data character changed': (key[0] === 'A' ? 'B' : 'A') + key.slice(1),
    'not from the alphabet': 'IIII-IIII-IIII-IIII',
    'made up': '1234-5678-9ABC-DEFG'
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
    for (let c = 0; c < 16; c += 1) text += setupkey.ALPHABET[next() % 32];
    if (next() % 2) text = text.slice(0, 12) + setupkey.checkGroups(text.slice(0, 12));
    assert.equal(nsisValidate(text), setupkey.verifyInstallKey(text).valid,
      `the installer and the generator disagree about ${text}`);
  }
});

test('an activated machine is not asked again', () => {
  // Same lesson as the license generator: reinstall, update and a second account
  // must not see the page again, so every place an activation can live is read.
  const check = nsh.slice(nsh.indexOf('!macro SetupKnownCheck'), nsh.indexOf('!macroend', nsh.indexOf('!macro SetupKnownCheck')));
  assert.match(check, /SetRegView 64/);
  assert.match(check, /SetRegView 32/);
  assert.equal((check.match(/ReadRegStr \$1 HKLM/g) || []).length, 2);
  assert.equal((check.match(/ReadRegStr \$1 HKCU/g) || []).length, 2);
  assert.match(check, /ReadEnvStr \$1 "ProgramData"/);
  assert.ok(check.includes('$LOCALAPPDATA\\Top In Tech\\Pharmacy Management\\${SETUP_MARKER}'));
  assert.ok(check.includes('$LOCALAPPDATA\\Programs\\${SETUP_APP_NAME}\\${SETUP_APP_EXE}'), 'a per-user install counts as activated');
  // The page removes itself when one of them is found.
  const show = nsh.slice(nsh.indexOf('Function ActivationPageShow'), nsh.indexOf('FunctionEnd', nsh.indexOf('Function ActivationPageShow')));
  assert.match(show, /!insertmacro SetupKnownCheck/);
  assert.match(show, /Abort/);
  // Every flag is written after the key is accepted, and uninstalling keeps them.
  const remember = nsh.slice(nsh.indexOf('!macro SetupRemember'), nsh.indexOf('!macroend', nsh.indexOf('!macro SetupRemember')));
  assert.equal((remember.match(/WriteRegStr/g) || []).length, 4);
  assert.equal((remember.match(/FileOpen/g) || []).length, 3);
  assert.match(nsh.slice(nsh.indexOf('!macro customInstall'), nsh.indexOf('!macroend', nsh.indexOf('!macro customInstall'))), /!insertmacro SetupRemember/);
  assert.doesNotMatch(nsh, /customUnInstall/, 'uninstalling never clears the activation');
});

test('the wizard still owns the shortcuts and files', () => {
  const install = nsh.slice(nsh.indexOf('!macro customInstall'), nsh.indexOf('!macroend', nsh.indexOf('!macro customInstall')));
  assert.doesNotMatch(install, /CreateShortcut/, 'a second shortcut would put two icons on the Desktop');
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
