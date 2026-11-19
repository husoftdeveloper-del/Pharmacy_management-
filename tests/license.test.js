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
  assert.equal(thrown.message, 'Your Serial key has expired, please Renew Serial key on the Owner.');
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
  assert.match(app, /async function licenceEnded\(message\)\{/, 'an expired licence returns to the sign-in screen');
  assert.match(app, /await authScreen\(false\)/, 'the sign-in screen is drawn again');
  assert.match(app, /error\.code==='LICENSE_EXPIRED'/, 'the app reacts to the licence code');
  const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
  assert.match(preload, /result\.code === 'LICENSE_EXPIRED'/, 'the session token is dropped');
  // Nothing in the app can write the licence back or extend it.
  for (const file of ['main.js', 'preload.js', 'license.js']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(text, /writeFileSync\([^)]*licen[cs]e\.json/i, `${file} must not write a licence`);
  }
  // The sentence the owner asked for, word for word.
  assert.equal(licence.EXPIRED_MESSAGE, 'Your Serial key has expired, please Renew Serial key on the Owner.');
  // assertUsable() refuses with the licence code, so main.js can pass it on.
  const expiredKey = setupkey.makeInstallKey(serial, '2026-11-28');
  const expiredFile = writeLicence('ended.json', { version: 1, key: expiredKey });
  assert.throws(
    () => licence.assertUsable({ files: [expiredFile], now: new Date('2026-11-29T08:00:00Z') }),
    error => error.code === 'LICENSE_EXPIRED' && error.message === licence.EXPIRED_MESSAGE
  );
  assert.doesNotThrow(() => licence.assertUsable({ files: [expiredFile], now: new Date('2026-11-28T20:00:00Z') }));
});

/* ---- The customer's ten days, one day at a time -------------------------
   The owner sells a 10-Day licence, the customer installs on day 1 and opens
   the application every day. Days 1-10 sign in; day 11 is refused with the
   renewal sentence and nothing else works. */
test('ten days of use, then the sign-in is refused on the eleventh', () => {
  const sold = '2026-11-19';                                   // issue day
  const key = setupkey.makeInstallKey(serial, '2026-11-28');   // issue + 9 = 10 days in
  const file = writeLicence('ten-days.json', { version: 1, key, days: 696 });
  assert.equal(licence.expiresOn(licence.daysFromKey(key)), '2026-11-28');

  for (let day = 19; day <= 28; day += 1) {
    const now = new Date(`2026-11-${day}T09:00:00Z`);
    const state = licence.status({ files: [file], now });
    assert.equal(state.expired, false, `day ${day} must still sign in`);
    assert.equal(state.daysLeft, 28 - day);
    assert.doesNotThrow(() => licence.assertUsable({ files: [file], now }));
  }

  const eleventh = new Date('2026-11-29T09:00:00Z');
  const state = licence.status({ files: [file], now: eleventh });
  assert.equal(state.expired, true);
  assert.equal(state.daysLeft, -1);
  assert.throws(() => licence.assertUsable({ files: [file], now: eleventh }), error => {
    assert.equal(error.code, 'LICENSE_EXPIRED');
    assert.equal(error.message, 'Your Serial key has expired, please Renew Serial key on the Owner.');
    return true;
  });
  // and it stays refused every later day
  for (const later of ['2026-11-30', '2027-01-01', '2030-06-15']) {
    assert.throws(() => licence.assertUsable({ files: [file], now: new Date(`${later}T09:00:00Z`) }), /Renew Serial key on the Owner/);
  }
});

test('deleting license.json does not restart a finished licence', () => {
  const key = setupkey.makeInstallKey(serial, '2026-11-28');
  const remembered = licence.daysFromKey(key);
  const after = new Date('2026-12-05T09:00:00Z');
  // No file at all: the application falls back to the day it wrote in its database.
  const state = licence.resolve(licence.status({ files: [], now: after }), remembered, { now: after });
  assert.equal(state.found, true);
  assert.equal(state.expired, true);
  assert.equal(state.expiresOn, '2026-11-28');
  assert.throws(() => licence.assertUsable({ files: [], remembered, now: after }), /Renew Serial key/);
  // While the licence is still running the same fallback keeps it working.
  const running = new Date('2026-11-25T09:00:00Z');
  assert.equal(licence.assertUsable({ files: [], remembered, now: running }).expired, false);
  // A new key from the owner (a later date, or lifetime) takes over.
  const renewed = setupkey.makeInstallKey(serial, '2026-12-28');
  const renewedFile = writeLicence('renewed.json', { version: 1, key: renewed });
  assert.equal(licence.status({ files: [renewedFile], now: after }).expired, false);
  // No file and nothing remembered is an ordinary installation: no lockout.
  assert.equal(licence.resolve(licence.status({ files: [], now: after }), null, { now: after }).found, false);
  assert.doesNotThrow(() => licence.assertUsable({ files: [], remembered: null, now: after }));
});

test('the application writes the day down and reads it back', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  // Written once per read of a valid licence, in the pharmacy's own database.
  assert.match(main, /licenceSetting\('licence_days'\)/, 'the day is stored in settings');
  assert.match(main, /licenceSetting\('licence_minutes'\)/, 'and the minute, for a licence that ends at a time');
  assert.match(main, /INSERT INTO settings\(key,value\) VALUES \(\?,\?\) ON CONFLICT\(key\) DO UPDATE/, 'and written with the usual upsert');
  assert.match(main, /if\(found\.found\)rememberLicence\(found\)/, 'a valid licence is remembered');
  assert.match(main, /remembered:found\.found\?null:rememberedLicence\(\)/, 'the fallback is used only when the file is gone');
  // Nothing can write a licence file back.
  assert.doesNotMatch(main, /writeFileSync\([^)]*licen[cs]e\.json/i);
});

/* ---- A licence measured in minutes -------------------------------------
   The generator's 10 Minutes plan exists so the whole chain can be tried in
   ten minutes instead of ten days. Its key is ABC-123-456-789: the same key
   with the minute of the day added, so the application stops at the minute. */
test('a 10-minute key lasts exactly ten minutes', () => {
  const issued = '2026-11-19T07:30:00Z';
  const ends = '2026-11-19T07:40:00Z';
  const key = setupkey.makeInstallKey(serial, ends);
  assert.equal(key.replace(/-/g, '').length, 12);
  const file = writeLicence('ten-minutes.json', { version: 1, key });

  const at = moment => licence.status({ files: [file], now: new Date(moment) });
  // Signed in from the moment it is installed (07:30) ...
  for (const moment of ['2026-11-19T07:30:00Z', '2026-11-19T07:35:00Z', '2026-11-19T07:39:59Z']) {
    const state = at(moment);
    assert.equal(state.found, true, moment);
    assert.equal(state.expired, false, `${moment} must still sign in`);
    assert.equal(state.expiresOn, '2026-11-19');
    assert.equal(state.expiresAt, ends);
    assert.equal(state.minutes, 460);
    assert.doesNotThrow(() => licence.assertUsable({ files: [file], now: new Date(moment) }), moment);
  }
  // ... refused at the tenth minute and onwards, with the renewal sentence.
  for (const moment of ['2026-11-19T07:40:00Z', '2026-11-19T07:40:01Z', '2026-11-20T00:00:00Z']) {
    const state = at(moment);
    assert.equal(state.expired, true, moment);
    assert.throws(
      () => licence.assertUsable({ files: [file], now: new Date(moment) }),
      error => error.code === 'LICENSE_EXPIRED' && error.message === licence.EXPIRED_MESSAGE,
      moment
    );
  }
  // The clock does not tick backwards into a working licence.
  assert.equal(at('2026-11-19T06:00:00Z').expired, false, 'an earlier clock still reads the key');
  // Ten minutes, not "until midnight": at 07:41 the same day it is over.
  assert.equal(at('2026-11-19T07:41:00Z').expired, true);
});

test('the ten-minute licence is remembered to the minute as well', () => {
  const key = setupkey.makeInstallKey(serial, '2026-11-19T07:40:00Z');
  const parsed = licence.parseKey(key);
  assert.deepEqual(parsed, { days: 687, minutes: 460 });
  // With license.json deleted, the database copy keeps the same minute.
  const after = new Date('2026-11-19T07:41:00Z');
  const state = licence.resolve(licence.status({ files: [], now: after }), parsed, { now: after });
  assert.equal(state.expired, true, 'deleting the file does not add a day');
  assert.equal(state.expiresAt, '2026-11-19T07:40:00Z');
  const before = new Date('2026-11-19T07:35:00Z');
  assert.equal(licence.resolve(licence.status({ files: [], now: before }), parsed, { now: before }).expired, false);
  // A number, as written by an older build, still means a whole day.
  const dayOnly = licence.resolve(licence.status({ files: [], now: after }), 687, { now: after });
  assert.equal(dayOnly.expired, false, 'a day-only memory keeps the licence through that day');
});

test('the whole-day keys keep their meaning', () => {
  // 10 Days still ends with its last day, not at the minute it was made.
  const key = setupkey.makeInstallKey(serial, '2026-11-28');
  const file = writeLicence('whole-day.json', { version: 1, key });
  const late = licence.status({ files: [file], now: new Date('2026-11-28T23:59:59Z') });
  assert.equal(late.expired, false, 'the last day is usable to its end');
  assert.equal(late.minutes, null);
  assert.equal(late.expiresAt, '2026-11-29T00:00:00Z');
  assert.equal(late.minutesLeft, null);
});

/* ---- One machine, more than one licence file ---------------------------
   The setup writes the same licence in two places, and a machine can collect
   more than one over time: an older folder, a portable copy, a renewal. If an
   exhausted copy could outvote the renewed key beside it, a paying customer
   who renewed would still be locked out. The licence that lasts longest wins,
   whatever order the files come in. */
test('a renewed key beats an exhausted copy, in any file order', () => {
  const used = setupkey.makeInstallKey(serial, '2026-11-19T07:40:00Z'); // finished 10 minutes
  const renewed = setupkey.makeInstallKey(serial, '2026-11-29');       // ten more days
  const first = writeLicence('old-copy.json', { version: 1, key: used });
  const second = writeLicence('renewed-copy.json', { version: 1, key: renewed });
  const now = new Date('2026-11-20T09:00:00Z');
  for (const files of [[first, second], [second, first]]) {
    const state = licence.status({ files, now });
    assert.equal(state.found, true);
    assert.equal(state.expired, false, 'the renewal must win');
    assert.equal(state.expiresOn, '2026-11-29');
    assert.doesNotThrow(() => licence.assertUsable({ files, now }));
  }
  // A lifetime key beats every dated one, even an expired one.
  const lifetimeFile = writeLicence('life-copy.json', { version: 1, key: setupkey.makeInstallKey(serial, '') });
  const withLife = licence.status({ files: [first, lifetimeFile], now });
  assert.equal(withLife.expiresOn, '');
  assert.equal(withLife.expired, false);
  // Both expired: the later end still decides, and the gate refuses.
  const older = writeLicence('older.json', { version: 1, key: setupkey.makeInstallKey(serial, '2026-11-10') });
  const later = writeLicence('later.json', { version: 1, key: setupkey.makeInstallKey(serial, '2026-11-28') });
  const both = licence.status({ files: [older, later], now: new Date('2026-12-01T09:00:00Z') });
  assert.equal(both.expiresOn, '2026-11-28');
  assert.equal(both.expired, true);
  assert.throws(() => licence.assertUsable({ files: [older, later], now: new Date('2026-12-01T09:00:00Z') }), /Renew Serial key on the Owner/);
  // A damaged file never wins, even when it is listed first.
  const damaged = path.join(tempDir, 'damaged.json');
  fs.writeFileSync(damaged, '{"version":1,"key":"NOT-A-KEY"}');
  assert.equal(licence.status({ files: [damaged, second], now }).expiresOn, '2026-11-29');
});

test('the useful sentence stays first, the detail comes second', () => {
  const root = path.join(__dirname, '..');
  const app = fs.readFileSync(path.join(root, 'src', 'scripts', 'app.js'), 'utf8');
  // The exact message, then a quiet line with the moment and the key used.
  assert.ok(app.includes(licence.EXPIRED_MESSAGE), 'the sentence the owner asked for comes first');
  assert.match(app, /t\('licenceEndedAt'\)/, 'the moment it ended is shown under it');
  assert.match(app, /t\('licenceKeyUsed'\)/, 'with the key this computer used');
  assert.match(app, /line\.className='licence-ended'/);
  // Settings -> License shows the key from the licence file, read-only.
  const settings = fs.readFileSync(path.join(root, 'src', 'pages', 'settings.js'), 'utf8');
  assert.match(settings, /id="license-key"/);
  assert.match(settings, /keyRow\.textContent=info\.key/);
  for (const key of ['licenceEndedAt', 'licenseKeyUsed']) {
    const i18n = fs.readFileSync(path.join(root, 'src', 'scripts', 'i18n.js'), 'utf8');
    assert.equal((i18n.match(new RegExp(`${key}:'`, 'g')) || []).length, 3, `${key} in all three languages`);
  }
});
