'use strict';
/* Serial key format for Top In Tech licenses.

   A serial is self-contained: it carries a small payload (product, plan,
   issue date, expiry) and an Ed25519 signature over that payload. Anyone with
   the public key can check a serial offline; nobody can forge one without the
   private key, which never leaves the owner's computer.

   Structure:  TIT1<base32 payload>.<base32 signature>
   Every character after the prefix is drawn from the Crockford base32
   alphabet (0-9 A-Z without I, L, O, U), so a serial survives being typed by
   hand, read over the phone or pasted from an e-mail.                     */
const crypto = require('node:crypto');

const PREFIX = 'TIT1';
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
// The single letter in the payload is what older generators read, so the three
// original letters never change; the short plans use letters nobody used before.
const PLANS = {
  lifetime: { key: 'L', label: 'Lifetime', months: 0 },
  '1y': { key: 'Y', label: '1 Year', months: 12 },
  '6m': { key: 'H', label: '6 Months', months: 6 },
  '1m': { key: 'M', label: '1 Month', months: 1 },
  '15d': { key: 'F', label: '15 Days', days: 15 },
  '10d': { key: 'T', label: '10 Days', days: 10 }
};
const PLAN_BY_KEY = Object.fromEntries(Object.entries(PLANS).map(([id, plan]) => [plan.key, { id, ...plan }]));

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(text) {
  const clean = String(text || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  let bits = 0;
  let buffer = 0;
  const bytes = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Serial contains an invalid character.');
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
      buffer &= (1 << bits) - 1;
    }
  }
  return Buffer.from(bytes);
}

// Short, stable id for a key pair: the first six bytes of the public key hash.
function keyId(publicKeyPem) {
  const der = crypto.createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return base32Encode(crypto.createHash('sha256').update(der).digest().subarray(0, 6));
}

function addMonths(date, months) {
  const copy = new Date(date.getTime());
  copy.setUTCMonth(copy.getUTCMonth() + months);
  return copy;
}

// Short plans count whole days, so 10 and 15 days land on the same clock time
// as the issue moment, not on a rounded month.
function addDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function planDetails(planId) {
  const plan = PLANS[planId];
  if (!plan) throw new Error('Choose a license duration.');
  return plan;
}

// Payload keys are single letters so the serial stays as short as possible.
function buildPayload({ product, plan, licenseId, issuedAt = new Date(), kid }) {
  const name = String(product || '').trim();
  if (!name) throw new Error('Enter the product name.');
  if (name.length > 60) throw new Error('The product name must be 60 characters or fewer.');
  if (!kid) throw new Error('The signing key is missing.');
  const details = planDetails(plan);
  const issued = new Date(issuedAt);
  const expires = details.days
    ? addDays(issued, details.days)
    : (details.months ? addMonths(issued, details.months) : null);
  return {
    v: 1,
    k: kid,
    id: String(licenseId || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12).toUpperCase(),
    pr: name,
    d: details.key,
    i: issued.toISOString().slice(0, 10),
    x: expires ? expires.toISOString().slice(0, 10) : ''
  };
}

function payloadBytes(payload) {
  // Fixed key order keeps the signature stable across app versions.
  const ordered = { v: payload.v, k: payload.k, id: payload.id, pr: payload.pr, d: payload.d, i: payload.i, x: payload.x };
  return Buffer.from(JSON.stringify(ordered), 'utf8');
}

function signPayload(payload, privateKeyPem) {
  const signature = crypto.sign(null, payloadBytes(payload), crypto.createPrivateKey(privateKeyPem));
  return `${PREFIX}${base32Encode(payloadBytes(payload))}.${base32Encode(signature)}`;
}

function parseSerial(serial) {
  const text = String(serial || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!text.startsWith(PREFIX)) throw new Error('This is not a Top In Tech serial key.');
  const body = text.slice(PREFIX.length);
  const [payloadPart, signaturePart] = body.split('.');
  if (!payloadPart || !signaturePart) throw new Error('The serial key is incomplete. Copy it again.');
  let payload;
  try {
    payload = JSON.parse(base32Decode(payloadPart).toString('utf8'));
  } catch {
    throw new Error('The serial key is damaged.');
  }
  return { payload, signature: base32Decode(signaturePart) };
}

// Returns { valid, reason, payload, plan } and never throws on a bad serial.
function verifySerial(serial, publicKeyPem, now = new Date()) {
  try {
    const { payload, signature } = parseSerial(serial);
    const expected = keyId(publicKeyPem);
    if (payload.k !== expected) return { valid: false, reason: 'This key was issued by a different key pair.', payload };
    const ok = crypto.verify(null, payloadBytes(payload), crypto.createPublicKey(publicKeyPem), signature);
    if (!ok) return { valid: false, reason: 'The signature does not match. The key was edited or forged.', payload };
    if (payload.x) {
      const today = now.toISOString().slice(0, 10);
      if (payload.x < today) return { valid: false, reason: `This license expired on ${payload.x}.`, payload };
    }
    const plan = PLAN_BY_KEY[payload.d] || { id: 'unknown', label: 'Unknown', months: 0, days: 0 };
    return { valid: true, reason: '', payload, plan };
  } catch (error) {
    return { valid: false, reason: error.message, payload: null };
  }
}

// Grouped for reading aloud: the TIT1 prefix stays whole, then the payload and
// the signature are broken into fives after the dot, e.g. TIT1AB12C-DE34F….   */
function formatSerial(serial) {
  const text = String(serial || '');
  const body = text.startsWith(PREFIX) ? text.slice(PREFIX.length) : text;
  const [head, tail] = body.split('.');
  const groups = value => String(value || '').replace(/(.{5})(?=.)/g, '$1-');
  return `${PREFIX}${groups(head)}${tail ? `.${groups(tail)}` : ''}`;
}

function unformatSerial(serial) {
  return String(serial || '').replace(/[^A-Za-z0-9.]/g, '');
}

module.exports = {
  PREFIX, ALPHABET, PLANS, PLAN_BY_KEY,
  base32Encode, base32Decode, keyId, buildPayload, payloadBytes,
  signPayload, parseSerial, verifySerial, formatSerial, unformatSerial, planDetails, addMonths, addDays
};
