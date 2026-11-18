'use strict';
/* Installer key for the customer's setup.

   The owner generates a serial in this tool and hands the customer a short key
   to type into the setup wizard. Typing the full 170-character serial would be
   impractical, so the wizard takes a 16-character key:

       WXYZ-1234-5678-9ABC         12 data characters + 4 check characters

   The installer has no cryptography available (NSIS ships no crypto library),
   so the check is the same small arithmetic both sides run:

       a = fold(data)                    (alphabet index, a secret salt and the
                                          position of every character)
       b = (a * 37 + 11) mod 100003
       check = alphabet[a % 32] alphabet[(a/32) % 32]
               alphabet[b % 32] alphabet[(b/32) % 32]

   build/installer.nsh in the Pharmacy app implements exactly these lines, which
   is what lets the wizard refuse a mistyped or invented key straight away with
   "The key you entered is not valid". The data characters are derived from the
   serial, so every license gets its own key.

   The signed serial stays the real licence: the wizard only unlocks the
   installation, and the serial in this database is still the record of what was
   sold. Keep ACTIVATION_SALT below and SETUP_SALT in the installer identical.  */
const crypto = require('node:crypto');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O, U
const SALT = '7Q2M9K4X1B8T'; // 12 characters, identical in build/installer.nsh
const MODULUS = 100003;
const DEFAULT_GROUPS = 4;

// Alphabet index of one character; accepts the lower-case form and the usual
// Crockford confusions (O -> 0, I/L -> 1) so a key read over the phone works.
function indexOf(char) {
  const raw = String(char || '').toUpperCase();
  const normal = raw.replace(/O/g, '0').replace(/[IL]/g, '1');
  const index = ALPHABET.indexOf(normal);
  if (index < 0) throw new Error('The install key contains an invalid character.');
  return index;
}

function fold(data) {
  let value = 0;
  for (let i = 0; i < data.length; i += 1) {
    value = (value * 33 + indexOf(data[i]) + indexOf(SALT[i]) + i * 7) % MODULUS;
  }
  return value;
}

function checkGroups(data) {
  const a = fold(data);
  const b = (a * 37 + 11) % MODULUS;
  return [a % 32, Math.floor(a / 32) % 32, b % 32, Math.floor(b / 32) % 32]
    .map(index => ALPHABET[index])
    .join('');
}

// Data characters: a stable base32 slice of the serial, so one license gets one
// key and the same key is shown every time the row is opened.
function dataFor(serial) {
  const digest = crypto.createHash('sha256').update(`install:${String(serial || '')}`, 'utf8').digest();
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of digest) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && output.length < 12) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (output.length >= 12) break;
  }
  return output;
}

function group(text) {
  return String(text || '').replace(/(.{4})(?=.)/g, '$1-');
}

// The key the owner copies and the customer types: WXYZ-1234-5678-9ABC.
function makeInstallKey(serial) {
  const data = dataFor(serial);
  return group(data + checkGroups(data));
}

function normalise(key) {
  return String(key || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

// Returns { valid, reason }. Never throws, because the wizard calls it on
// whatever the customer typed.
function verifyInstallKey(key) {
  const clean = normalise(key);
  if (!clean) return { valid: false, reason: 'Please enter your serial key to continue.' };
  if (clean.length !== 16) return { valid: false, reason: 'The key you entered is not valid. Check it and try again.' };
  try {
    const data = clean.slice(0, 12);
    if (checkGroups(data) !== clean.slice(12)) {
      return { valid: false, reason: 'The key you entered is not valid. Check it and try again.' };
    }
  } catch {
    return { valid: false, reason: 'The key you entered is not valid. Check it and try again.' };
  }
  return { valid: true, reason: '' };
}

module.exports = {
  ALPHABET, SALT, MODULUS, DEFAULT_GROUPS,
  indexOf, fold, checkGroups, dataFor, group, makeInstallKey, verifyInstallKey, normalise
};
