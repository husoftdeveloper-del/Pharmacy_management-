'use strict';
// The licence the setup writes, and the rule that stops the sign-in screen once
// its last valid day has passed. The key arithmetic has to agree with
// build/installer.nsh and TopInTech-LicenseGenerator/lib/setupkey.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const licence = require('../license');
const setupkey = require('../TopInTech-LicenseGenerator/lib/setupkey');

const serial = 'TIT1CI-VERIFY.SERIAL-0001';
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-licence-'));
function writeLicence(name, record) {
  const file = path.join(tempDir, name);
  fs.writeFileSync(file, JSON.stringify(record));
  return file;
}
const status = (file, now) => licence.status({ files: [file], now: new Date(`${now}T09:00:00Z`) });

test('a lifetime key never stops the application', () => {
  const key = setupkey.makeInstallKey(serial, '');
  const file = writeLicence('life.json', { version: 1, key, days: 0 });
  const state = status(file, '2099-01-01');
  assert.equal(state.found, true);
  assert.equal(state.expired, false);
  assert.equal(state.expiresOn, '');
  assert.equal(state.daysLeft, null);
});

test('a 10-day key works on its last day and is refused the day after', () => {
  const expires = '2026-11-28';
  const key = setupkey.makeInstallKey(serial, expires);
  const file = writeLicence('ten.json', { version: 1, key });
  assert.equal(status(file, '2026-11-27').expired, false, 'one day before');
  assert.equal(status(file, expires).expired, false, 'the last valid day is still usable');
  const later = status(file, '2026-11-29');
  assert.equal(later.expired, true);
  assert.equal(later.expiresOn, expires);
  // The sign-in call throws the exact sentence the customer sees.
  const thrown = (() => {
    try {
      licence.assertUsable({ files: [file], now: new Date('2026-11-29T09:00:00Z') });
      return null;
    } catch (error) {
      return error;
    }
  })();
  assert.ok(thrown, 'an expired licence must throw');
  assert.equal(thrown.message, 'Your serial key has expired. Please renew your serial key from the Owner.');
  assert.equal(thrown.code, 'LICENSE_EXPIRED');
});

test('the key decides the date, not the number in the file', () => {
  const key = setupkey.makeInstallKey(serial, '2026-11-28');
  // Someone edits the file to claim a lifetime licence. The key still says 2026.
  const file = writeLicence('edited.json', { version: 1, key, days: 0 });
  assert.equal(status(file, '2026-12-05').expired, true, 'editing days must not extend the licence');
  assert.equal(status(file, '2026-11-20').expired, false);
});

test('an older key without an expiry keeps working', () => {
  for (const key of [setupkey.shortMakeInstallKey(serial), setupkey.legacyMakeInstallKey(serial)]) {
    const file = writeLicence(`old-${key.replace(/[^A-Z0-9]/g, '').slice(0, 6)}.json`, { version: 1, key });
    const state = status(file, '2035-01-01');
    assert.equal(state.found, true);
    assert.equal(state.expired, false, `${key} has no expiry and must not lock anyone out`);
  }
});

test('no licence file means business as usual', () => {
  const state = licence.status({ files: [path.join(tempDir, 'missing.json')], now: new Date('2030-01-01T00:00:00Z') });
  assert.equal(state.found, false);
  assert.equal(state.expired, false);
  // A development run, a portable copy or an old installation must keep working.
  assert.equal(licence.assertUsable({ files: [path.join(tempDir, 'none.json')] }).found, false);
});

test('a damaged or hand-written file is ignored, not fatal', () => {
  const bad = [
    path.join(tempDir, 'broken.json'),
    path.join(tempDir, 'wrong.json'),
    path.join(tempDir, 'empty.json')
  ];
  fs.writeFileSync(bad[0], '{not json');
  fs.writeFileSync(bad[1], JSON.stringify({ version: 1, key: 'ABC-123-457' }));
  fs.writeFileSync(bad[2], '{}');
  for (const file of bad) {
    const state = licence.status({ files: [file], now: new Date('2026-01-01T00:00:00Z') });
    assert.equal(state.found, false, `${path.basename(file)} must not produce a licence`);
    assert.equal(state.expired, false);
  }
});

test('the arithmetic is the same in the app, the setup and the generator', () => {
  assert.equal(licence.ALPHABET, setupkey.ALPHABET);
  assert.equal(licence.SALT, setupkey.SALT);
  assert.equal(licence.MODULUS, setupkey.MODULUS);
  for (const expires of ['', '2026-11-28', '2027-05-18', '2113-12-31']) {
    const key = setupkey.makeInstallKey(serial, expires);
    const days = licence.daysFromKey(key);
    assert.equal(days, setupkey.verifyInstallKey(key).days, `the two disagree about ${key}`);
    assert.equal(licence.expiresOn(days), expires === '' ? '' : expires);
  }
  // A key with any character changed is rejected by both.
  const key = setupkey.makeInstallKey(serial, '2026-11-28');
  const typo = (key[0] === 'A' ? 'B' : 'A') + key.slice(1);
  assert.equal(licence.daysFromKey(typo), null);
  assert.equal(setupkey.verifyInstallKey(typo).valid, false);
});

test('the day counter starts on 2025-01-01', () => {
  assert.equal(licence.expiresOn(0), '');
  assert.equal(licence.expiresOn(1), '2025-01-02');
  assert.equal(licence.todayUtc(new Date('2025-01-01T23:59:00Z')), 0);
  assert.equal(licence.todayUtc(new Date('2026-11-28T00:00:00Z')), 696);
});

test('the setup writes the licence where the app looks for it', () => {
  const nsh = fs.readFileSync(path.join(__dirname, '..', 'build', 'installer.nsh'), 'utf8');
  assert.match(nsh, /!define SETUP_LICENSE_FILE "license\.json"/);
  assert.match(nsh, /!define SETUP_LICENSE_DIR "Pharmacy Management"/);
  assert.match(nsh, /FileOpen \$9 "\$INSTDIR\\\$\{SETUP_LICENSE_FILE\}"/, 'next to the program');
  assert.match(nsh, /FileOpen \$9 "\$APPDATA\\\$\{SETUP_LICENSE_DIR\}\\\$\{SETUP_LICENSE_FILE\}"/, 'in the app-data folder');
  assert.match(nsh, /'{"version":1,"key":"\$LicenceKey","days":\$LicenceDays}'/, 'the same fields this module reads');
  // And the application reads exactly those two places.
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /path\.join\(path\.dirname\(process\.execPath\),licence\.FILE_NAME\)/);
  assert.match(main, /path\.join\(app\.getPath\('appData'\),'Pharmacy Management',licence\.FILE_NAME\)/, 'the roaming folder the setup writes');
  assert.match(main, /path\.join\(app\.getPath\('userData'\),licence\.FILE_NAME\)/);
  // The check runs before the password, so "expired" wins over "wrong password".
  const login = main.slice(main.indexOf("if (c==='login')"), main.indexOf("if (c==='login')") + 700);
  assert.ok(login.indexOf('assertLicence()') < login.indexOf('service.login(p)'));
  // Setup and every signed-in request are gates too, so an expired licence
  // cannot be worked around by keeping the window open.
  assert.match(main, /if \(c==='setup'\) \{ assertLicence\(\)/);
  assert.match(main, /const user=currentUser\(event,request\.token\);/);
  const guard = main.slice(main.indexOf('function currentUser('), main.indexOf('function currentUser(') + 500);
  assert.match(guard, /assertLicence\(\)/, 'every request re-checks the licence');
});

test('the sign-in screen shows the expiry message and nothing else', () => {
  const root = path.join(__dirname, '..');
  const app = fs.readFileSync(path.join(root, 'src', 'scripts', 'app.js'), 'utf8');
  // The message the customer reads is the one from license.js, word for word.
  assert.ok(app.includes(licence.EXPIRED_MESSAGE), 'the sign-in screen quotes the licence message');
  assert.match(app, /function licenceEnded\(message\)\{await authScreen\(false\)/, 'an expired licence returns to the sign-in screen');
  assert.match(app, /error\.code==='LICENSE_EXPIRED'/, 'the app reacts to the licence code');
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  assert.match(preload, /result\.code === 'LICENSE_EXPIRED'/, 'the session token is dropped');
  // Nothing in the app can write the licence back or extend it.
  for (const file of ['main.js', 'preload.js', 'license.js']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(text, /writeFileSync\([^)]*licen[cs]e\.json/i, `${file} must not write a licence`);
  }
  assert.match(licence.EXPIRED_MESSAGE, /expired/i);
  assert.match(licence.EXPIRED_MESSAGE, /renew your serial key from the Owner/i);
  // assertUsable() refuses with the licence code, so main.js can pass it on.
  const expiredKey = setupkey.makeInstallKey(serial, '2026-11-28');
  const expiredFile = writeLicence('ended.json', { version: 1, key: expiredKey });
  assert.throws(
    () => licence.assertUsable({ files: [expiredFile], now: new Date('2026-11-29T08:00:00Z') }),
    error => error.code === 'LICENSE_EXPIRED' && error.message === licence.EXPIRED_MESSAGE
  );
  assert.doesNotThrow(() => licence.assertUsable({ files: [expiredFile], now: new Date('2026-11-28T20:00:00Z') }));
});
