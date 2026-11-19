'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const serial = require('../lib/serial');
const keys = require('../lib/keys');

const pair = keys.createKeyPair();
const other = keys.createKeyPair();
const kid = serial.keyId(pair.publicPem);
const otherKid = serial.keyId(other.publicPem);

function make(plan = '1y', product = 'Pharmacy Management', issuedAt = new Date('2026-01-15T10:00:00Z')) {
  const payload = serial.buildPayload({ product, plan, licenseId: 'AB12CD34E', kid, issuedAt });
  return { payload, key: serial.signPayload(payload, pair.privatePem) };
}

test('base32 round-trips arbitrary bytes and ignores typo-prone letters', () => {
  const bytes = crypto.randomBytes(64);
  assert.equal(Buffer.compare(serial.base32Decode(serial.base32Encode(bytes)), bytes), 0);
  // O reads as 0, I and L read as 1: what a person would mistype still works.
  assert.equal(Buffer.compare(serial.base32Decode('O0IL1'), serial.base32Decode('00111')), 0);
  for (const size of [1, 2, 3, 4, 5, 31, 32, 33]) {
    const sample = crypto.randomBytes(size);
    assert.equal(Buffer.compare(serial.base32Decode(serial.base32Encode(sample)), sample), 0);
  }
  assert.equal(serial.ALPHABET.includes('I'), false);
  assert.equal(serial.ALPHABET.includes('O'), false);
});

test('a signed serial verifies with the matching public key', () => {
  const { key, payload } = make();
  const result = serial.verifySerial(key, pair.publicPem, new Date('2026-02-01T00:00:00Z'));
  assert.equal(result.valid, true);
  assert.equal(result.reason, '');
  assert.equal(result.payload.pr, 'Pharmacy Management');
  assert.equal(result.payload.i, '2026-01-15');
  assert.equal(result.payload.x, '2027-01-15');
  assert.equal(result.plan.label, '1 Year');
  assert.equal(payload.k, kid);
});

test('serial keys are formatted in readable groups and parse back', () => {
  const { key } = make();
  const pretty = serial.formatSerial(key);
  assert.match(pretty, /^TIT1[0-9A-Z]{5}-/);
  assert.ok(pretty.includes('-'));
  assert.equal(serial.unformatSerial(pretty), key);
  assert.equal(serial.verifySerial(pretty, pair.publicPem, new Date('2026-02-01T00:00:00Z')).valid, true);
});

test('an edited serial is rejected', () => {
  const { key } = make();
  const index = key.indexOf('.') + 3;
  const flipped = key.slice(0, index) + (key[index] === 'A' ? 'B' : 'A') + key.slice(index + 1);
  const result = serial.verifySerial(flipped, pair.publicPem);
  assert.equal(result.valid, false);
  assert.match(result.reason, /damaged|signature|invalid/i);
});

test('a serial cannot be verified with a different key pair', () => {
  const { key } = make();
  const result = serial.verifySerial(key, other.publicPem);
  assert.equal(result.valid, false);
  assert.match(result.reason, /different key pair/);
});

test('a payload signed by another private key with the same key id is rejected', () => {
  const { key } = make();
  const [head, tail] = key.split('.');
  const swapped = `${head}.${tail.split('').reverse().join('')}`;
  assert.equal(serial.verifySerial(swapped, pair.publicPem).valid, false);
});

test('expiry: a 6-month key is valid before and invalid after its end date', () => {
  const { payload, key } = make('6m');
  assert.equal(payload.x, '2026-07-15');
  assert.equal(serial.verifySerial(key, pair.publicPem, new Date('2026-07-15T09:00:00Z')).valid, true);
  const expired = serial.verifySerial(key, pair.publicPem, new Date('2026-07-16T00:00:00Z'));
  assert.equal(expired.valid, false);
  assert.match(expired.reason, /expired on 2026-07-15/);
});

test('a lifetime key never expires', () => {
  const { payload, key } = make('lifetime');
  assert.equal(payload.x, '');
  assert.equal(serial.verifySerial(key, pair.publicPem, new Date('2099-01-01T00:00:00Z')).valid, true);
});

test('month arithmetic keeps the day and rolls over short months', () => {
  assert.equal(serial.addMonths(new Date('2026-01-31T00:00:00Z'), 1).toISOString().slice(0, 10), '2026-03-03');
  assert.equal(serial.addMonths(new Date('2026-11-15T00:00:00Z'), 6).toISOString().slice(0, 10), '2027-05-15');
});

test('the short durations issue keys with the right expiry date', () => {
  // Issue date in these tests is 2026-01-15 (see make()).
  const cases = {
    '1m': { label: '1 Month', key: 'M', expires: '2026-02-15' },
    '15d': { label: '15 Days', key: 'F', expires: '2026-01-30' },
    '10d': { label: '10 Days', key: 'T', expires: '2026-01-25' }
  };
  for (const [planId, expected] of Object.entries(cases)) {
    assert.equal(serial.PLANS[planId].label, expected.label);
    assert.equal(serial.PLANS[planId].key, expected.key, 'the payload letter must be unique');
    const { payload, key } = make(planId);
    assert.equal(payload.d, expected.key);
    assert.equal(payload.x, expected.expires);
    // Valid on the last day, refused the day after, and the label comes back.
    const lastDay = serial.verifySerial(key, pair.publicPem, new Date(`${expected.expires}T12:00:00Z`));
    assert.equal(lastDay.valid, true);
    assert.equal(lastDay.plan.label, expected.label);
    const dayAfter = serial.verifySerial(key, pair.publicPem, new Date(new Date(`${expected.expires}T00:00:00Z`).getTime() + 86400000));
    assert.equal(dayAfter.valid, false);
  }
  // The three original letters keep their meaning, so old keys still read right.
  assert.equal(serial.PLANS.lifetime.key, 'L');
  assert.equal(serial.PLANS['1y'].key, 'Y');
  assert.equal(serial.PLANS['6m'].key, 'H');
  // Every plan letter is distinct.
  const letters = Object.values(serial.PLANS).map(plan => plan.key);
  assert.equal(new Set(letters).size, letters.length);
});

test('the 10 Minutes plan ends at a time, not at midnight', () => {
  // Issue date in these tests is 2026-01-15 (see make()).
  assert.equal(serial.PLANS['10min'].label, '10 Minutes');
  assert.equal(serial.PLANS['10min'].key, 'Q');
  assert.equal(serial.PLANS['10min'].minutes, 10);
  const { payload, key } = make('10min');
  assert.equal(payload.d, 'Q');
  assert.match(payload.x, /^2026-01-15T\d{2}:\d{2}:00Z$/, 'the expiry keeps the clock time');
  // Issued at 10:00, so it ends at 10:10 — ten minutes, exactly.
  assert.equal(payload.x, '2026-01-15T10:10:00Z');
  // Valid one second before the tenth minute, refused at it.
  const moment = Date.parse(payload.x);
  assert.equal(serial.verifySerial(key, pair.publicPem, new Date(moment - 1000)).valid, true);
  assert.equal(serial.verifySerial(key, pair.publicPem, new Date(moment)).valid, false);
  // The label travels back with the serial.
  assert.equal(serial.verifySerial(key, pair.publicPem, new Date(moment - 1000)).plan.label, '10 Minutes');
  // The three older letters keep their meaning; every letter is still distinct.
  const letters = Object.values(serial.PLANS).map(plan => plan.key);
  assert.equal(new Set(letters).size, letters.length);
});

test('minute arithmetic is exact', () => {
  assert.equal(serial.addMinutes(new Date('2026-01-15T10:00:00Z'), 10).toISOString(), '2026-01-15T10:10:00.000Z');
  assert.equal(serial.addMinutes(new Date('2026-01-15T23:55:00Z'), 10).toISOString(), '2026-01-16T00:05:00.000Z');
});

test('day arithmetic adds whole days', () => {
  assert.equal(serial.addDays(new Date('2026-01-15T05:30:00Z'), 10).toISOString().slice(0, 10), '2026-01-25');
  assert.equal(serial.addDays(new Date('2026-12-28T00:00:00Z'), 15).toISOString().slice(0, 10), '2027-01-12');
  assert.equal(serial.addDays(new Date('2026-01-15T05:30:00Z'), 10).toISOString().slice(11, 16), '05:30');
});

test('bad input returns a reason instead of throwing', () => {
  for (const input of ['', 'hello', 'TIT1', 'TIT1AAAA.BBBB', null, undefined]) {
    const result = serial.verifySerial(input, pair.publicPem);
    assert.equal(result.valid, false);
    assert.equal(typeof result.reason, 'string');
    assert.ok(result.reason.length > 0);
  }
});

test('buildPayload refuses an empty or over-long product name and unknown plan', () => {
  assert.throws(() => serial.buildPayload({ product: '  ', plan: '1y', licenseId: 'X', kid }), /product name/);
  assert.throws(() => serial.buildPayload({ product: 'x'.repeat(61), plan: '1y', licenseId: 'X', kid }), /60 characters/);
  assert.throws(() => serial.buildPayload({ product: 'Ok', plan: 'weekly', licenseId: 'X', kid }), /duration/);
  assert.throws(() => serial.buildPayload({ product: 'Ok', plan: '1y', licenseId: 'X' }), /signing key/);
});

test('the key id is stable, short and differs between pairs', () => {
  assert.equal(serial.keyId(pair.publicPem), kid);
  assert.equal(kid.length, 10);
  assert.notEqual(kid, otherKid);
  assert.match(kid, /^[0-9A-HJKMNP-TV-Z]+$/);
});
