'use strict';
/* Installer key for the customer's setup.

   The owner generates a serial in this tool and hands the customer a short key
   to type into the setup wizard. Typing the full 170-character serial would be
   impractical, so the wizard takes a 6-character key:

       ABC-123          5 data characters + 1 check character

   The installer has no cryptography available (NSIS ships no crypto library),
   so the check is the same small arithmetic both sides run:

       a = fold(data)          (alphabet index, a secret salt and the position
                                of every character, folded into a small number)
       check = alphabet[a % 32]

   build/installer.nsh in the Pharmacy app implements exactly these lines, which
   is what lets the wizard refuse a mistyped or invented key straight away with
   "Invalid Serial Key!". The data characters are derived from the serial, so
   every license gets its own key.

   The signed serial stays the real licence: the wizard only unlocks the
   installation, and the serial in this database is still the record of what was
   sold. Keep SALT below and SETUP_SALT in the installer identical.  */
const crypto = require('node:crypto');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O, U
const SALT = '7Q2M9K4X1B8T'; // identical in build/installer.nsh
const MODULUS = 100003;
const DATA_LENGTH = 5; // characters taken from the serial
const CHECK_LENGTH = 1; // characters that prove the rest was typed correctly
const GROUPS = 3; // ABC-123, so six characters read as two small pieces
// The shape version 2.3.2 printed (WXYZ-1234-5678-9ABC). Keys issued then are
// still accepted by the setup, so nobody has to ask for a new key.
const LEGACY_DATA_LENGTH = 12;
const LEGACY_CHECK_LENGTH = 4;

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

// The check characters for a block of data characters. One character here.
function checkGroups(data) {
  const a = fold(data);
  return ALPHABET[a % 32];
}

// The four check characters of the 2.3.2 layout, kept so an older key can still
// be told apart from a mistyped one.
function legacyCheckGroups(data) {
  const a = fold(data);
  const b = (a * 37 + 11) % MODULUS;
  return [a % 32, Math.floor(a / 32) % 32, b % 32, Math.floor(b / 32) % 32]
    .map(index => ALPHABET[index])
    .join('');
}

// Data characters: a stable base32 slice of the serial, so one license gets one
// key and the same key is shown every time the row is opened. A longer slice is
// the same stream continued, which is how 2.3.2 printed twelve characters.
function dataSlice(serial, length) {
  const digest = crypto.createHash('sha256').update(`install:${String(serial || '')}`, 'utf8').digest();
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of digest) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && output.length < length) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (output.length >= length) break;
  }
  return output;
}

function dataFor(serial) {
  return dataSlice(serial, DATA_LENGTH);
}

// The whole key exactly as version 2.3.2 printed it, for a customer who still
// holds the old paper slip.
function legacyMakeInstallKey(serial) {
  const data = dataSlice(serial, LEGACY_DATA_LENGTH);
  return (data + legacyCheckGroups(data)).replace(/(.{4})(?=.)/g, '$1-');
}

function group(text) {
  return String(text || '').replace(new RegExp(`(.{${GROUPS}})(?=.)`, 'g'), '$1-');
}

// The key the owner copies and the customer types: ABC-123.
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
  const refuse = { valid: false, reason: 'The key you entered is not valid. Check it and try again.' };
  try {
    if (clean.length === DATA_LENGTH + CHECK_LENGTH) {
      const data = clean.slice(0, DATA_LENGTH);
      if (checkGroups(data) === clean.slice(DATA_LENGTH)) return { valid: true, reason: '' };
      return refuse;
    }
    if (clean.length === LEGACY_DATA_LENGTH + LEGACY_CHECK_LENGTH) {
      const data = clean.slice(0, LEGACY_DATA_LENGTH);
      if (legacyCheckGroups(data) === clean.slice(LEGACY_DATA_LENGTH)) return { valid: true, reason: '' };
      return refuse;
    }
  } catch {
    return refuse;
  }
  return refuse;
}

module.exports = {
  ALPHABET, SALT, MODULUS, DATA_LENGTH, CHECK_LENGTH, GROUPS,
  LEGACY_DATA_LENGTH, LEGACY_CHECK_LENGTH,
  indexOf, fold, checkGroups, legacyCheckGroups, dataFor, dataSlice, group,
  makeInstallKey, legacyMakeInstallKey, verifyInstallKey, normalise
};
