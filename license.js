'use strict';
/* The licence the Windows setup wrote, and the rule that ends it.

   The setup asks for the customer's install key before it installs anything and
   writes what it learned here:

       %APPDATA%\Pharmacy Management\license.json      (and the program folder)

   {"version":1,"key":"ABC-123-456","days":1234}

   `days` is the last day the licence is valid, counted from 2025-01-01 in UTC;
   0 means a lifetime licence. The key itself carries the same number, so the
   value in the file is only a convenience: `status()` always recomputes it from
   the key and ignores a hand-edited `days`.

   This file only decides whether the sign-in screen is allowed. It never
   touches the database, and it is read, not written, by the application.

   Keep ALPHABET, SALT and MODULUS identical to build/installer.nsh and
   TopInTech-LicenseGenerator/lib/setupkey.js. */
const fs = require('node:fs');
const path = require('node:path');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SALT = '7Q2M9K4X1B8T';
const MODULUS = 100003;
const DATA_LENGTH = 5;
const EXPIRY_LENGTH = 3;
const KEY_LENGTH = DATA_LENGTH + EXPIRY_LENGTH + 1;
const SHORT_KEY_LENGTH = 6; // ABC-123, versions 2.3.3 - 2.3.5: no expiry
const LEGACY_KEY_LENGTH = 16; // WXYZ-1234-5678-9ABC, version 2.3.2: no expiry
const LEGACY_DATA_LENGTH = 12;
const EPOCH = Date.UTC(2025, 0, 1); // day 0
const DAY_MS = 86400000;
const FILE_NAME = 'license.json';

const EXPIRED_MESSAGE = 'Your serial key has expired. Please renew your serial key from the Owner.';

function normaliseKey(text) {
  return String(text || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

function indexOf(char) {
  const index = ALPHABET.indexOf(char);
  return index < 0 ? null : index;
}

// The same fold the setup runs, for the characters a key keeps its check for.
function fold(text) {
  let value = 0;
  for (let i = 0; i < text.length; i += 1) {
    const index = indexOf(text[i]);
    if (index === null) return null;
    const salt = indexOf(SALT[i]);
    if (salt === null) return null;
    value = (value * 33 + index + salt + i * 7) % MODULUS;
  }
  return value;
}

// Days since 2025-01-01, or null when the key does not check out. The two older
// key shapes carry no expiry and are read as lifetime (0), exactly as the setup
// treats them.
function daysFromKey(key) {
  const clean = normaliseKey(key);
  if (clean.length === SHORT_KEY_LENGTH) {
    const data = clean.slice(0, DATA_LENGTH);
    const value = fold(data);
    if (value === null || ALPHABET[value % 32] !== clean[DATA_LENGTH]) return null;
    return 0;
  }
  if (clean.length === LEGACY_KEY_LENGTH) {
    const data = clean.slice(0, LEGACY_DATA_LENGTH);
    const a = fold(data);
    if (a === null) return null;
    const b = (a * 37 + 11) % MODULUS;
    const expected = [a % 32, Math.floor(a / 32) % 32, b % 32, Math.floor(b / 32) % 32]
      .map(index => ALPHABET[index]).join('');
    return expected === clean.slice(LEGACY_DATA_LENGTH) ? 0 : null;
  }
  if (clean.length !== KEY_LENGTH) return null;
  const body = clean.slice(0, KEY_LENGTH - 1);
  const value = fold(body);
  if (value === null) return null;
  if (ALPHABET[value % 32] !== clean[KEY_LENGTH - 1]) return null;
  let days = 0;
  for (const char of clean.slice(DATA_LENGTH, DATA_LENGTH + EXPIRY_LENGTH)) {
    const index = indexOf(char);
    if (index === null) return null;
    days = days * 32 + index;
  }
  return days;
}

function expiresOn(days) {
  if (!days) return '';
  return new Date(EPOCH + days * DAY_MS).toISOString().slice(0, 10);
}

function todayUtc(now = new Date()) {
  return Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - EPOCH) / DAY_MS);
}

// Candidate files, most specific first. Tests and unusual installs can point at
// one file with PHARMACY_LICENSE_FILE.
function candidateFiles(env = process.env) {
  const list = [];
  if (env.PHARMACY_LICENSE_FILE) list.push(env.PHARMACY_LICENSE_FILE);
  const appData = env.APPDATA;
  if (appData) list.push(path.join(appData, 'Pharmacy Management', FILE_NAME));
  if (env.PHARMACY_LICENSE_DIR) list.push(path.join(env.PHARMACY_LICENSE_DIR, FILE_NAME));
  return list;
}

function readFile(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/* { found, key, days, expiresOn, expired, daysLeft, file }
   `found` is false when no setup licence exists (a development run, a portable
   copy, or an installation made before licences carried an expiry). The app
   then behaves exactly as before, so an update never locks anyone out. */
function status(options = {}) {
  const env = options.env || process.env;
  const now = options.now || new Date();
  const files = options.files || candidateFiles(env);
  for (const file of files) {
    const record = readFile(file);
    if (!record) continue;
    const days = daysFromKey(record.key);
    if (days === null) {
      // A damaged or hand-written file is not a licence: ignore it and keep
      // looking, rather than lock a paying customer out of their pharmacy.
      if (options.logger) options.logger(`[licence] ignored ${file}: the key does not check out`);
      continue;
    }
    const today = todayUtc(now);
    const expired = days > 0 && today > days;
    return {
      found: true, key: record.key, days, file,
      expiresOn: expiresOn(days), daysLeft: days > 0 ? days - today : null, expired
    };
  }
  return { found: false, key: '', days: 0, expiresOn: '', daysLeft: null, expired: false, file: '' };
}

// Thrown by the sign-in handler; the login screen shows error.message as it is.
function assertUsable(options = {}) {
  const state = status(options);
  if (!state.expired) return state;
  const error = new Error(EXPIRED_MESSAGE);
  error.code = 'LICENSE_EXPIRED';
  error.licence = state;
  throw error;
}

module.exports = {
  ALPHABET, SALT, MODULUS, DATA_LENGTH, EXPIRY_LENGTH, KEY_LENGTH,
  SHORT_KEY_LENGTH, LEGACY_KEY_LENGTH, LEGACY_DATA_LENGTH,
  EPOCH, DAY_MS, FILE_NAME, EXPIRED_MESSAGE,
  normaliseKey, fold, daysFromKey, expiresOn, todayUtc, candidateFiles, status, assertUsable
};
