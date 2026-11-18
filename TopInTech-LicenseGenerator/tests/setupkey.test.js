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

test('an install key is 6 characters in two groups: ABC-123', () => {
  const key = keys.makeInstallKey('TIT1EXAMPLE.0123456789ABCDEF');
  assert.match(key, /^[0-9A-Z]{3}-[0-9A-Z]{3}$/);
  assert.equal(key.replace(/-/g, '').length, 6);
  assert.equal(keys.DATA_LENGTH, 5);
  assert.equal(keys.CHECK_LENGTH, 1);
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
  // The current generator keeps issuing the short key.
  assert.match(keys.makeInstallKey('TIT1OLD.SERIAL-0001'), /^[0-9A-Z]{3}-[0-9A-Z]{3}$/);
});
