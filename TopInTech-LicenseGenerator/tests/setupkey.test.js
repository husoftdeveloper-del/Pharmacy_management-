'use strict';
// The install key the customer types into the setup wizard.
// The wizard (build/installer.nsh) runs the same arithmetic in NSIS, so these
// tests pin the numbers both sides must agree on and prove that a key generated
// from a serial is accepted while a mistyped or invented one is refused.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const keys = require('../lib/setupkey');
const serial = require('../lib/serial');
const crypto = require('node:crypto');

test('an install key is six characters: 7M2K4X, carrying the expiry', () => {
  const key = keys.makeInstallKey('TIT1EXAMPLE.0123456789ABCDEF', '2026-11-28');
  assert.match(key, /^[0-9A-Z]{6}$/);
  assert.equal(key.length, 6);
  assert.equal(keys.SHORT_DATA_LENGTH, 2);
  assert.equal(keys.EXPIRY_LENGTH, 3);
  assert.equal(keys.CHECK_LENGTH, 1);
  // The last three characters before the check are the last valid day, so two
  // licences that end on different days get different keys from one serial.
  const later = keys.makeInstallKey('TIT1EXAMPLE.0123456789ABCDEF', '2027-01-28');
  assert.notEqual(key, later);
  assert.equal(key.slice(0, 2), later.slice(0, 2), 'the same serial keeps the same two data characters');
  assert.notEqual(key.slice(2, 5), later.slice(2, 5), 'a different day is a different expiry part');
  // The owner asked for keys in the shape 212328 or 12QW21: letters and digits
  // mixed, six characters, nothing else.
  for (const serial of ['TIT1A.B', 'TIT1B.C', 'TIT1C.D', 'TIT1D.E', 'TIT1E.F']) {
    assert.match(keys.makeInstallKey(serial, '2026-12-01'), /^[0-9A-Z]{6}$/);
  }
});

test('a licence measured in minutes gets a 12-character key with the minute', () => {
  const key = keys.makeInstallKey('TIT1CI-VERIFY.SERIAL-0001', '2026-11-19T07:40:00Z');
  assert.match(key, /^[0-9A-Z]{3}-[0-9A-Z]{3}-[0-9A-Z]{3}-[0-9A-Z]{3}$/);
  assert.equal(key.replace(/-/g, '').length, 12);
  const result = keys.verifyInstallKey(key);
  assert.equal(result.valid, true);
  assert.equal(result.days, keys.dayNumber('2026-11-19'));
  assert.equal(result.minutes, 7 * 60 + 40, 'the minute of the day, in UTC');
  assert.equal(result.expiresOn, '2026-11-19');
  assert.equal(result.expiresAt, '2026-11-19T07:40:00Z');
  // A minute key keeps the older twelve-character shape, because six characters
  // cannot hold a time of day.
  const dayKey = keys.makeInstallKey('TIT1CI-VERIFY.SERIAL-0001', '2026-11-19');
  assert.equal(dayKey.length, 6, 'the same licence in whole days is a six-character key');
  assert.notEqual(key, dayKey, 'the two shapes are different keys');
  // The card prints the moment, not just the date.
  assert.equal(keys.expiryOfKey('2026-11-19T07:40:00Z'), '2026-11-19 07:40:00 UTC');
  assert.equal(keys.expiryOfKey('2026-11-28'), '2026-11-28');
  assert.equal(keys.expiryOfKey(''), '');
  // 23:59 is the last minute a key can say, and 00:00 the first.
  assert.equal(keys.verifyInstallKey(keys.makeInstallKey('TIT1X.Y', '2026-11-19T23:59:00Z')).minutes, 1439);
  assert.equal(keys.verifyInstallKey(keys.makeInstallKey('TIT1X.Y', '2026-11-19T00:00:00Z')).minutes, 0);
  // A whole-day key still reads as a whole day, and never claims a minute.
  const whole = keys.verifyInstallKey(dayKey);
  assert.equal(whole.minutes, null);
  assert.equal(whole.expiresAt, '2026-11-20T00:00:00Z');
});

test('the expiry in the key is the licence expiry', () => {
  for (const expires of ['', '2026-11-28', '2026-12-03', '2027-05-18', '2113-12-31']) {
    const key = keys.makeInstallKey('TIT1AAA.BBB', expires);
    const result = keys.verifyInstallKey(key);
    assert.equal(result.valid, true, key);
    assert.equal(result.expiresOn, expires === '' ? '' : expires, `the key says ${result.expiresOn}`);
    assert.equal(result.days, expires === '' ? 0 : keys.dayNumber(expires));
  }
  // Day 0 is printed as 000: a lifetime licence.
  const lifetime = keys.makeInstallKey('TIT1AAA.BBB', '').replace(/-/g, '');
  assert.equal(lifetime.slice(2, 5), '000', 'a lifetime key carries day 0');
  assert.equal(lifetime.length, 6);
  // A date before the counter starts is refused instead of silently wrapped.
  assert.throws(() => keys.makeInstallKey('TIT1AAA.BBB', '2024-06-01'));
});

test('the same serial always produces the same key, different serials differ', () => {
  const a = keys.makeInstallKey('TIT1AAA.BBB');
  const again = keys.makeInstallKey('TIT1AAA.BBB');
  const other = keys.makeInstallKey('TIT1AAA.CCC');
  assert.equal(a, again, 'the owner can reopen the row and read the same key');
  assert.notEqual(a, other, 'every license gets its own key');
});

test('a generated key is accepted, in every way a customer may type it', () => {
  const key = keys.makeInstallKey('TIT1SERIAL.FORSETUP');
  for (const typed of [key, key.replace(/-/g, ''), key.toLowerCase(), ` ${key} `, key.replace(/-/g, ' ')]) {
    assert.equal(keys.verifyInstallKey(typed).valid, true, `accepted: ${typed}`);
  }
});

test('a mistyped, invented or empty key is refused with the wizard message', () => {
  const key = keys.makeInstallKey('TIT1SERIAL.FORSETUP');
  const flat = key.replace(/-/g, '');
  const wrongCheck = flat.slice(0, 5) + (flat.endsWith('Z') ? 'Y' : 'Z');
  assert.equal(wrongCheck.length, 6);
  // One character of the data changed, the check character left alone.
  const typo = (flat[0] === 'A' ? 'B' : 'A') + flat.slice(1);
  const cases = [
    '', '   ', 'hello', '1234567890123456', flat.slice(0, 5), key + 'X',
    wrongCheck, // right shape, wrong check character
    typo,
    'ABC-123', // a neat looking key nobody issued
    '000-001'
  ];
  for (const typed of cases) {
    const result = keys.verifyInstallKey(typed);
    assert.equal(result.valid, false, `refused: ${typed}`);
    assert.match(result.reason, typed.trim() === '' ? /Please enter your serial key/ : /not valid/);
  }
});

test('the check arithmetic matches what the NSIS installer computes', () => {
  // These constants are also in the Pharmacy installer; if one changes without
  // the other, every key the owner generates stops working at install time.
  assert.equal(keys.ALPHABET, '0123456789ABCDEFGHJKMNPQRSTVWXYZ');
  assert.equal(keys.SALT.length, 12);
  assert.equal(keys.MODULUS, 100003);
  // A hand-worked vector: data "00000" folds to salt digits only.
  const data = '00000';
  const a = keys.fold(data);
  const expected = keys.ALPHABET[a % 32];
  assert.equal(keys.checkGroups(data), expected);
  assert.equal(keys.verifyInstallKey(data + expected).valid, true);
});

test('a real serial from the generator produces a working install key', () => {
  // End to end with the generator's own key pair: sign a serial, derive the
  // install key from it, and check the serial still verifies with the public key
  // so the owner keeps their auditable record.
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const kid = serial.keyId(publicPem);
  const payload = serial.buildPayload({ product: 'Pharmacy Management', plan: 'lifetime', licenseId: 'AB12CD34', kid });
  const signed = serial.signPayload(payload, privatePem);
  const installKey = keys.makeInstallKey(signed);
  assert.equal(keys.verifyInstallKey(installKey).valid, true);
  assert.equal(keys.verifyInstallKey(installKey).reason, '');
  assert.equal(serial.verifySerial(serial.formatSerial(signed), publicPem).valid, true, 'the signed serial stays valid');
});

test('a nine-character key from 2.3.6 - 2.3.8 is still accepted', () => {
  // Five data characters, the three of the day and one check: ABC-123-456.
  const body = 'ABCDE' + keys.encodeDays(keys.dayNumber('2026-11-28'));
  const key = body + keys.checkGroups(body);
  assert.equal(key.length, 9);
  const result = keys.verifyInstallKey(key);
  assert.equal(result.valid, true);
  assert.equal(result.days, keys.dayNumber('2026-11-28'), 'the same expiry the new key carries');
  assert.equal(result.expiresOn, '2026-11-28');
  // Printed in groups, typed without them, or in lower case: the same key.
  for (const typed of [keys.group(key), key, key.toLowerCase()]) {
    assert.equal(keys.verifyInstallKey(typed).valid, true, `accepted: ${typed}`);
  }
});

test('a 16-character key from version 2.3.2 is still accepted', () => {
  // The owner may keep an old key or an old printout; the setup accepts both
  // shapes, so this module must too.
  const legacy = keys.legacyMakeInstallKey('TIT1OLD.SERIAL-0001');
  assert.equal(legacy.replace(/-/g, '').length, 16);
  assert.equal(keys.verifyInstallKey(legacy).valid, true);
  assert.equal(keys.verifyInstallKey(legacy.toLowerCase()).valid, true);
  // Damage it and it is refused, like any other key.
  const broken = (legacy[0] === 'A' ? 'B' : 'A') + legacy.slice(1);
  assert.equal(keys.verifyInstallKey(broken).valid, false);
  // The current generator issues the six-character key with the expiry in it.
  assert.match(keys.makeInstallKey('TIT1OLD.SERIAL-0001', '2026-12-01'), /^[0-9A-Z]{6}$/);
});
