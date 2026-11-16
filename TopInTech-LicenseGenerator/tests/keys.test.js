'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const keys = require('../lib/keys');
const serial = require('../lib/serial');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tit-keys-'));
}

test('the first run creates a private and a public key file', () => {
  const dir = tempDir();
  const result = keys.ensureKeyPair(dir);
  assert.equal(result.created, true);
  assert.equal(fs.existsSync(path.join(dir, 'private.pem')), true);
  assert.equal(fs.existsSync(path.join(dir, 'public.pem')), true);
  assert.match(fs.readFileSync(path.join(dir, 'private.pem'), 'utf8'), /BEGIN PRIVATE KEY/);
  assert.match(fs.readFileSync(path.join(dir, 'public.pem'), 'utf8'), /BEGIN PUBLIC KEY/);
});

test('a second run keeps the existing pair instead of replacing it', () => {
  const dir = tempDir();
  keys.ensureKeyPair(dir);
  const before = fs.readFileSync(path.join(dir, 'private.pem'), 'utf8');
  const again = keys.ensureKeyPair(dir);
  assert.equal(again.created, false);
  assert.equal(fs.readFileSync(path.join(dir, 'private.pem'), 'utf8'), before);
});

test('the private key is written owner-only', { skip: process.platform === 'win32' }, () => {
  const dir = tempDir();
  keys.ensureKeyPair(dir);
  const mode = fs.statSync(path.join(dir, 'private.pem')).mode & 0o777;
  assert.equal(mode, 0o600);
});

test('a missing public key is rebuilt from the private key', () => {
  const dir = tempDir();
  keys.ensureKeyPair(dir);
  const kid = keys.describe(dir).keyId;
  fs.rmSync(path.join(dir, 'public.pem'));
  const repaired = keys.ensureKeyPair(dir);
  assert.equal(repaired.repaired, true);
  assert.equal(keys.describe(dir).keyId, kid);
});

test('a missing private key is a hard error, never a silent new pair', () => {
  const dir = tempDir();
  keys.ensureKeyPair(dir);
  const kid = keys.describe(dir).keyId;
  fs.rmSync(path.join(dir, 'private.pem'));
  assert.throws(() => keys.ensureKeyPair(dir), /private key is missing/);
  assert.throws(() => keys.readPrivate(dir), /private key is missing/);
  // The public key survives, so already-issued serials still verify.
  assert.equal(serial.keyId(keys.readPublic(dir)), kid);
});

test('describe() exposes the public key and paths but never the private bytes', () => {
  const dir = tempDir();
  keys.ensureKeyPair(dir);
  const info = keys.describe(dir);
  assert.equal(info.keyId.length, 10);
  assert.match(info.publicKey, /BEGIN PUBLIC KEY/);
  assert.equal(info.publicKeyFile, path.join(dir, 'public.pem'));
  const leaked = JSON.stringify(info).includes('PRIVATE KEY');
  assert.equal(leaked, false);
});

test('only Ed25519 private keys are accepted', () => {
  const dir = tempDir();
  keys.ensureKeyPair(dir);
  const rsa = require('node:crypto').generateKeyPairSync('rsa', { modulusLength: 2048 });
  fs.writeFileSync(path.join(dir, 'private.pem'), rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  assert.throws(() => keys.readPrivate(dir), /not an Ed25519 key/);
});

test('a serial made with the stored keys verifies with the shipped public key', () => {
  const dir = tempDir();
  keys.ensureKeyPair(dir);
  const info = keys.describe(dir);
  const payload = serial.buildPayload({ product: 'Clinic', plan: '6m', licenseId: 'ABCDEF123', kid: info.keyId });
  const key = serial.signPayload(payload, keys.readPrivate(dir));
  const check = serial.verifySerial(key, info.publicKey);
  assert.equal(check.valid, true);
  assert.equal(check.payload.pr, 'Clinic');
});
