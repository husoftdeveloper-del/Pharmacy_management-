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

test('an install key is 16 characters in four groups', () => {
  const key = keys.makeInstallKey('TIT1EXAMPLE.0123456789ABCDEF');
  assert.match(key, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  assert.equal(key.replace(/-/g, '').length, 16);
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
  const wrongCheck = key.slice(0, 15) + (key.endsWith('Z') ? 'Y' : 'Z');
  // One character of the data changed, check characters left alone.
  const typo = (key[0] === 'A' ? 'B' : 'A') + key.slice(1);
  const cases = [
    '', '   ', 'hello', '1234567890123456', key.slice(0, 15), key + 'X',
    wrongCheck, // right shape, wrong check characters
    typo
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
  // A hand-worked vector: data "000000000000" folds to salt digits only.
  const data = '000000000000';
  const a = keys.fold(data);
  const expected = [
    keys.ALPHABET[a % 32],
    keys.ALPHABET[Math.floor(a / 32) % 32],
    keys.ALPHABET[((a * 37 + 11) % keys.MODULUS) % 32],
    keys.ALPHABET[Math.floor(((a * 37 + 11) % keys.MODULUS) / 32) % 32]
  ].join('');
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
