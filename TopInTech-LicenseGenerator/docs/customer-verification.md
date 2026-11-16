# Checking a serial key inside a customer application

The customer app only needs two things:

1. `public.pem` — copied from the generator (button **Copy public key**).
2. The verifier below, saved as `license/verify.js` in the customer app.

It has **no** signing code and no private key: it can only confirm that a serial
was issued by your key pair and has not expired. Node's built-in `crypto` does
all of the work, so nothing extra has to be installed and no network is used.

```js
'use strict';
/* Offline license check for Top In Tech applications. */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PREFIX = 'TIT1';
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PLANS = { L: 'Lifetime', Y: '1 Year', H: '6 Months' };

function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  let bits = 0;
  let buffer = 0;
  const bytes = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('invalid character');
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

function payloadBytes(payload) {
  // Key order is fixed by the generator; do not reorder.
  return Buffer.from(JSON.stringify({
    v: payload.v, k: payload.k, id: payload.id, pr: payload.pr,
    d: payload.d, i: payload.i, x: payload.x
  }), 'utf8');
}

function verifySerial(serial, publicPem, now = new Date()) {
  try {
    const text = String(serial).trim().toUpperCase().replace(/[^A-Z0-9.]/g, '');
    if (!text.startsWith(PREFIX)) return { valid: false, reason: 'This is not a Top In Tech serial key.' };
    const [payloadPart, signaturePart] = text.slice(PREFIX.length).split('.');
    if (!payloadPart || !signaturePart) return { valid: false, reason: 'The serial key is incomplete.' };
    const payload = JSON.parse(base32Decode(payloadPart).toString('utf8'));
    const der = crypto.createPublicKey(publicPem).export({ type: 'spki', format: 'der' });
    const expectedKid = base32Encode(crypto.createHash('sha256').update(der).digest().subarray(0, 6));
    if (payload.k !== expectedKid) return { valid: false, reason: 'This key was issued by a different key pair.' };
    const ok = crypto.verify(null, payloadBytes(payload), crypto.createPublicKey(publicPem), base32Decode(signaturePart));
    if (!ok) return { valid: false, reason: 'The signature does not match.' };
    if (payload.x && payload.x < now.toISOString().slice(0, 10)) {
      return { valid: false, reason: `This license expired on ${payload.x}.` };
    }
    return { valid: true, product: payload.pr, plan: PLANS[payload.d] || 'Unknown', issued: payload.i, expires: payload.x };
  } catch (error) {
    return { valid: false, reason: error.message };
  }
}

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

// Read the key once, next to your application code, and check the stored serial.
const publicPem = fs.readFileSync(path.join(__dirname, 'public.pem'), 'utf8');

function checkStoredLicense(serial) {
  const result = verifySerial(serial, publicPem);
  if (!result.valid) return { licensed: false, message: result.reason };
  return { licensed: true, message: `${result.product} · ${result.plan}` };
}

module.exports = { verifySerial, checkStoredLicense };
```

## Rules to follow in the customer app

* Store the serial **encrypted** (the app's own SQLite settings table is fine);
  never hand it out through an IPC channel that the window can read.
* Split the check across two places: a licence gate before the dashboard loads,
  and a periodic re-check (for example on start-up and once a day) so an
  expired 1-year key stops working without a reinstall.
* Show a friendly message and the product name from the payload; never show the
  raw serial in a screenshot-friendly place.
* Keep `public.pem` in `resources/`, not in the asar root, so you can replace it
  only when you rotate keys. Rotating keys makes every old serial unknown to the
  new build — issue new keys with the same key pair instead.
* Test with `npm test` in the generator, then press **Verify** in the generator
  window with a serial from the build you are about to ship.
