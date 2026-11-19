'use strict';
/* The licence the Windows setup wrote, and the rule that ends it.

   The setup asks for the customer's install key before it installs anything and
   writes what it learned here:

       %APPDATA%\Pharmacy Management\license.json      (and the program folder)

   {"version":1,"key":"7M2K4X","days":1234,"pharmacy":"Kabul Care Pharmacy"}

   `days` is the last day the licence is valid, counted from 2025-01-01 in UTC;
   0 means a lifetime licence. The key itself carries the same number, so the
   value in the file is only a convenience: `status()` always recomputes it from
   the key and ignores a hand-edited `days`.

   `pharmacy` is the name the customer typed into the wizard, so the first-run
   screen opens with the name already filled in. The application treats it as a
   suggestion only: the name is stored in the database when the owner finishes
   the setup, and it can be edited there at any time.

   This file only decides whether the sign-in screen is allowed. It never
   touches the database, and it is read, not written, by the application. The
   application copies the same day into its own settings table
   (`licence_days`) so that deleting the JSON file cannot restart a licence.

   Keep ALPHABET, SALT and MODULUS identical to build/installer.nsh and
   TopInTech-LicenseGenerator/lib/setupkey.js. */
const fs = require('node:fs');
const path = require('node:path');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SALT = '7Q2M9K4X1B8T';
const MODULUS = 100003;
const DATA_LENGTH = 5;
const EXPIRY_LENGTH = 3;
const KEY_LENGTH = DATA_LENGTH + EXPIRY_LENGTH + 1; // 9: ABC-123-456 (2.3.6+)
// The key handed out today: six characters, 7M2K4X — two data characters, the
// three of the expiry day, one check.
const SHORT_DATA_LENGTH = 2;
const SHORT_KEY_LENGTH = SHORT_DATA_LENGTH + EXPIRY_LENGTH + 1;
// A licence shorter than a day ends at a time, so its key carries the minute of
// that day as well: ABC-123-456-789 (5 data + 3 day + 3 minute + 1 check).
const MINUTE_LENGTH = 3;
const MINUTE_KEY_LENGTH = DATA_LENGTH + EXPIRY_LENGTH + MINUTE_LENGTH + 1;
const MINUTES_PER_DAY = 1440;
const LEGACY_KEY_LENGTH = 16; // WXYZ-1234-5678-9ABC, version 2.3.2: no expiry
const LEGACY_DATA_LENGTH = 12;
const EPOCH = Date.UTC(2025, 0, 1); // day 0
const DAY_MS = 86400000;
const FILE_NAME = 'license.json';

// Exactly the sentence the owner asked the customer to see, so nobody has to
// guess what "expired" means or who can fix it.
const EXPIRED_MESSAGE = 'Your Serial key has expired, please Renew Serial key on the Owner.';

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

// One key, read back as { days, minutes } — or null when it does not check out.
// `minutes` is null for the three whole-day shapes (they end with their last
// day) and a number for ABC-123-456-789 (a licence that ends at a time).
function parseKey(key) {
  const clean = normaliseKey(key);
  if (clean.length === LEGACY_KEY_LENGTH) {
    const data = clean.slice(0, LEGACY_DATA_LENGTH);
    const a = fold(data);
    if (a === null) return null;
    const b = (a * 37 + 11) % MODULUS;
    const expected = [a % 32, Math.floor(a / 32) % 32, b % 32, Math.floor(b / 32) % 32]
      .map(index => ALPHABET[index]).join('');
    return expected === clean.slice(LEGACY_DATA_LENGTH) ? { days: 0, minutes: null } : null;
  }
  if (clean.length !== SHORT_KEY_LENGTH && clean.length !== KEY_LENGTH && clean.length !== MINUTE_KEY_LENGTH) return null;
  const checkAt = clean.length - 1;
  const value = fold(clean.slice(0, checkAt));
  if (value === null) return null;
  if (ALPHABET[value % 32] !== clean[checkAt]) return null;
  const number = text => {
    let result = 0;
    for (const char of text) {
      const index = indexOf(char);
      if (index === null) return null;
      result = result * 32 + index;
    }
    return result;
  };
  // Where the expiry day starts depends on the shape: after two characters in
  // the six-character key, after five in the older nine- and twelve-character
  // ones.
  const dataLength = clean.length === SHORT_KEY_LENGTH ? SHORT_DATA_LENGTH : DATA_LENGTH;
  const days = number(clean.slice(dataLength, dataLength + EXPIRY_LENGTH));
  if (days === null) return null;
  if (clean.length !== MINUTE_KEY_LENGTH) return { days, minutes: null };
  const minutes = number(clean.slice(dataLength + EXPIRY_LENGTH, dataLength + EXPIRY_LENGTH + MINUTE_LENGTH));
  if (minutes === null || minutes >= MINUTES_PER_DAY) return null;
  return { days, minutes };
}

// Days since 2025-01-01, or null when the key does not check out. The two older
// key shapes carry no expiry and are read as lifetime (0), exactly as the setup
// treats them.
function daysFromKey(key) {
  const parsed = parseKey(key);
  return parsed ? parsed.days : null;
}

/* The exact moment a licence ends, as an ISO string ('' when it never ends).
   A whole-day licence is usable through its last day, so it ends at the
   midnight that closes that day; a licence with a minute ends at that minute. */
function endsAt(days, minutes) {
  if (!days) return '';
  const moment = minutes === null || minutes === undefined
    ? EPOCH + (days + 1) * DAY_MS
    : EPOCH + days * DAY_MS + minutes * 60000;
  // Seconds are always whole, so the zero milliseconds are noise here.
  return new Date(moment).toISOString().replace('.000Z', 'Z');
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

/* The pharmacy name the customer typed into the wizard, cleaned for display.
   It is only a suggestion for the first-run screen: an empty value simply means
   the wizard did not write one (an older install, or a portable copy). */
function pharmacyName(record) {
  const text = record && typeof record === 'object' ? record.pharmacy : '';
  const clean = String(text || '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.slice(0, 120);
}

// The answer for one licence: a last valid day, plus the minute of that day
// when the licence ends at a time.
function fromDays(days, options) {
  const now = options.now || new Date();
  const minutes = options.minutes === undefined ? null : options.minutes;
  const today = todayUtc(now);
  const ends = endsAt(days, minutes);
  return {
    found: true, key: '', pharmacy: '', days, minutes,
    expiresOn: expiresOn(days),
    // Empty for a lifetime licence; a full timestamp for a licence that ends
    // at a time of day (a 10-minute licence, for example).
    expiresAt: ends,
    daysLeft: days > 0 ? (minutes === null ? days - today : Math.ceil((Date.parse(ends) - now.getTime()) / DAY_MS)) : null,
    minutesLeft: ends && minutes !== null ? Math.max(0, Math.ceil((Date.parse(ends) - now.getTime()) / 60000)) : null,
    // A whole-day licence lasts through its last day; one that ends at a time
    // ends at that minute.
    expired: ends ? now.getTime() >= Date.parse(ends) : false,
    file: options.file || ''
  };
}

/* { found, key, days, expiresOn, expired, daysLeft, file }
   `found` is false when no setup licence exists (a development run, a portable
   copy, or an installation made before licences carried an expiry). The app
   then behaves exactly as before, so an update never locks anyone out. */
function status(options = {}) {
  const env = options.env || process.env;
  const now = options.now || new Date();
  const files = options.files || candidateFiles(env);
  // The setup writes the same licence in two places, and a machine can collect
  // more than one over time (an older folder, a portable copy, a renewal). The
  // licence that lasts longest is the one the customer paid for, so read them
  // all and keep the best instead of trusting the order of the list: an
  // exhausted copy must never outvote the renewed key beside it.
  let best = null;
  for (const file of files) {
    const record = readFile(file);
    if (!record) continue;
    const parsed = parseKey(record.key);
    if (!parsed) {
      // A damaged or hand-written file is not a licence: ignore it and keep
      // looking, rather than lock a paying customer out of their pharmacy.
      if (options.logger) options.logger(`[licence] ignored ${file}: the key does not check out`);
      continue;
    }
    const candidate = {
      ...fromDays(parsed.days, { now, file, minutes: parsed.minutes }),
      key: record.key,
      pharmacy: pharmacyName(record)
    };
    if (!best || lastsLonger(candidate, best)) best = candidate;
  }
  return best || { found: false, key: '', pharmacy: '', days: 0, minutes: null, expiresOn: '', expiresAt: '', daysLeft: null, minutesLeft: null, expired: false, file: '' };
}

/* Which licence wins when two files disagree: the one that ends later.
   `days` 0 is a lifetime licence, so it beats every dated one. */
function lastsLonger(a, b) {
  if (!a.days) return true;
  if (!b.days) return false;
  const endOf = state => Date.parse(state.expiresAt);
  return endOf(a) > endOf(b);
}

/* The licence file is the only thing the setup writes, but a finished licence
   must not be restarted by deleting it. The application keeps the same last
   valid day in its own database (`licence_days`) the first time it reads a
   licence, and falls back to that when the file is gone.
   `remembered` is null when the database has nothing to say. */
function resolve(state, remembered, options = {}) {
  if (state.found) return state;
  if (remembered === null || remembered === undefined || remembered === '') return state;
  const record = typeof remembered === 'object' ? remembered : { days: remembered, minutes: null };
  const days = Number(record.days);
  if (!Number.isInteger(days) || days < 0) return state;
  const minutes = record.minutes === null || record.minutes === undefined || record.minutes === ''
    ? null : Number(record.minutes);
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 0 || minutes >= MINUTES_PER_DAY)) return state;
  if (options.logger) options.logger('[licence] license.json is missing; using the day stored in the database');
  return fromDays(days, { ...options, minutes });
}

// Thrown by the sign-in handler; the login screen shows error.message as it is.
function assertUsable(options = {}) {
  const base = options.state || status(options);
  const state = resolve(base, options.remembered, options);
  if (!state.expired) return state;
  const error = new Error(EXPIRED_MESSAGE);
  error.code = 'LICENSE_EXPIRED';
  error.licence = state;
  throw error;
}

module.exports = {
  ALPHABET, SALT, MODULUS, DATA_LENGTH, EXPIRY_LENGTH, KEY_LENGTH,
  MINUTE_LENGTH, MINUTE_KEY_LENGTH, MINUTES_PER_DAY,
  SHORT_DATA_LENGTH, SHORT_KEY_LENGTH, LEGACY_KEY_LENGTH, LEGACY_DATA_LENGTH,
  EPOCH, DAY_MS, FILE_NAME, EXPIRED_MESSAGE,
  normaliseKey, pharmacyName, fold, parseKey, daysFromKey, endsAt, lastsLonger, expiresOn, todayUtc,
  candidateFiles, status, fromDays, resolve, assertUsable
};
