'use strict';
/* Installer key for the customer's setup.

   The owner generates a serial in this tool and hands the customer a short key
   to type into the setup wizard. Typing the full 170-character serial would be
   impractical, so the wizard takes a 9-character key:

       ABC-123-456

       ABC 12   five characters derived from the serial (which license)
       3 45     three characters holding the expiry day (when it ends)
       6        one check character (proves the rest was typed correctly)

   The expiry is counted in whole days from 2025-01-01 (UTC); 000 means a
   lifetime licence that never expires. 999 base32 is 32767 days, so a key can
   say "valid until" any day before 2114.

   The installer has no cryptography available (NSIS ships no crypto library),
   so the check is the same small arithmetic both sides run:

       a = fold(everything before the check character)
       check = alphabet[a % 32]

   build/installer.nsh in the Pharmacy app implements exactly these lines, and
   the Pharmacy application reads the same number again in license.js to lock
   its sign-in screen when the day has passed.

   The signed serial stays the real licence: the wizard only unlocks the
   installation, and the serial in this database is still the record of what was
   sold. Keep SALT below and SETUP_SALT in the installer identical.  */
const crypto = require('node:crypto');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O, U
const SALT = '7Q2M9K4X1B8T'; // identical in build/installer.nsh
const MODULUS = 100003;
const DATA_LENGTH = 5; // characters taken from the serial
const EXPIRY_LENGTH = 3; // characters holding the last valid day
const CHECK_LENGTH = 1; // characters that prove the rest was typed correctly
const GROUPS = 3; // ABC-123-456, so nine characters read as three small pieces
// A licence shorter than a day ends at a time, so its key adds a third piece:
// the minute of that day. ABC-123-456-789: five data, three day, three minute,
// one check. Day and minute together are the exact moment the licence ends.
const MINUTE_LENGTH = 3;
const MINUTE_KEY_LENGTH = DATA_LENGTH + EXPIRY_LENGTH + MINUTE_LENGTH + CHECK_LENGTH;
const MINUTE_GROUPS = 4;
const MINUTES_PER_DAY = 1440;
const EPOCH = Date.UTC(2025, 0, 1); // day 0 of the expiry counter
const DAY_MS = 86400000;

// Older keys are still accepted by the setup, so they are still recognised here.
const LEGACY_DATA_LENGTH = 12; // version 2.3.2: WXYZ-1234-5678-9ABC
const LEGACY_CHECK_LENGTH = 4;
const SHORT_DATA_LENGTH = 5; // versions 2.3.3 - 2.3.5: ABC-123, no expiry
const SHORT_CHECK_LENGTH = 1;

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

// The single check character for the eight characters in front of it.
function checkGroups(data) {
  return ALPHABET[fold(data) % 32];
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

// Days between 2025-01-01 and an ISO date (YYYY-MM-DD). 0 means "never ends".
function dayNumber(expiresOn) {
  const text = String(expiresOn || '').trim().slice(0, 10);
  if (!text) return 0;
  const parsed = Date.parse(`${text}T00:00:00Z`);
  if (!Number.isFinite(parsed)) throw new Error('The expiry date is not a date.');
  const days = Math.round((parsed - EPOCH) / DAY_MS);
  if (days < 0) throw new Error('The expiry date is before 2025-01-01.');
  if (days > 32767) throw new Error('The expiry date is too far in the future.');
  return days;
}

function encodeDays(days) {
  const value = Math.max(0, Math.min(32767, Math.round(Number(days) || 0)));
  return ALPHABET[Math.floor(value / 1024) % 32] + ALPHABET[Math.floor(value / 32) % 32] + ALPHABET[value % 32];
}

function decodeDays(text) {
  let days = 0;
  for (const char of String(text || '')) days = days * 32 + indexOf(char);
  return days;
}

function isoFromDays(days) {
  return days > 0 ? new Date(EPOCH + days * DAY_MS).toISOString().slice(0, 10) : '';
}

// The minute of the day (UTC) an expiry timestamp falls on, or null for a
// plain date (lifetime, or a plan measured in whole days).
function minuteOfDay(expiresOn) {
  const text = String(expiresOn || '').trim();
  if (!text.includes('T')) return null;
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) throw new Error('The expiry time is not a moment in time.');
  return Math.floor((((parsed % DAY_MS) + DAY_MS) % DAY_MS) / 60000) % MINUTES_PER_DAY;
}

function encodeMinutes(minutes) {
  const value = Math.max(0, Math.min(32767, Math.round(Number(minutes) || 0)));
  return ALPHABET[Math.floor(value / 1024) % 32] + ALPHABET[Math.floor(value / 32) % 32] + ALPHABET[value % 32];
}

function decodeMinutes(text) {
  return decodeDays(text);
}

// The exact moment a day + minute pair ends, as an ISO timestamp.
function momentFromParts(days, minutes) {
  return new Date(EPOCH + days * DAY_MS + minutes * 60000).toISOString().replace('.000Z', 'Z');
}

function daysFromIso(expiresOn) {
  return dayNumber(expiresOn);
}

function group(text, size = GROUPS) {
  return String(text || '').replace(new RegExp(`(.{${size}})(?=.)`, 'g'), '$1-');
}

/* The key the owner copies and the customer types: ABC-123-456.
   Pass the licence expiry (YYYY-MM-DD) so the setup, and then the application,
   know the last day the customer may use the software. No date = lifetime. */
function makeInstallKey(serial, expiresOn) {
  const data = dataFor(serial);
  const minutes = minuteOfDay(expiresOn);
  if (minutes === null) {
    // Whole-day (or lifetime) licence: ABC-123-456.
    const body = data + encodeDays(dayNumber(expiresOn));
    return group(body + checkGroups(body));
  }
  // A licence that ends at a time: ABC-123-456-789, day and minute together.
  const day = dayNumber(String(expiresOn).slice(0, 10));
  const body = data + encodeDays(day) + encodeMinutes(minutes);
  return group(body + checkGroups(body)); // ABC-123-456-789
}

// The whole key exactly as version 2.3.2 printed it, for a customer who still
// holds the old paper slip. Those keys carry no expiry.
function legacyMakeInstallKey(serial) {
  const data = dataSlice(serial, LEGACY_DATA_LENGTH);
  return (data + legacyCheckGroups(data)).replace(/(.{4})(?=.)/g, '$1-');
}

// The key exactly as versions 2.3.3 - 2.3.5 printed it: ABC-123, no expiry.
function shortMakeInstallKey(serial) {
  const data = dataFor(serial);
  return group(data + checkGroups(data));
}

function normalise(key) {
  return String(key || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

/* { valid, reason, days, expiresOn }. Never throws, because the wizard and the
   application call it on whatever was typed. */
function verifyInstallKey(key) {
  const clean = normalise(key);
  if (!clean) return { valid: false, reason: 'Please enter your serial key to continue.' };
  const refuse = { valid: false, reason: 'The key you entered is not valid. Check it and try again.' };
  try {
    if (clean.length === DATA_LENGTH + EXPIRY_LENGTH + CHECK_LENGTH) {
      const body = clean.slice(0, DATA_LENGTH + EXPIRY_LENGTH);
      if (checkGroups(body) !== clean.slice(DATA_LENGTH + EXPIRY_LENGTH)) return refuse;
      const days = decodeDays(body.slice(DATA_LENGTH));
      return {
        valid: true, reason: '', days, minutes: null,
        expiresOn: isoFromDays(days),
        // A whole-day licence is valid through the end of its last day.
        expiresAt: days > 0 ? momentFromParts(days + 1, 0) : ''
      };
    }
    if (clean.length === MINUTE_KEY_LENGTH) {
      // ABC-123-456-789: a licence that ends at a time of day.
      const body = clean.slice(0, MINUTE_KEY_LENGTH - CHECK_LENGTH);
      if (checkGroups(body) !== clean.slice(MINUTE_KEY_LENGTH - CHECK_LENGTH)) return refuse;
      const days = decodeDays(clean.slice(DATA_LENGTH, DATA_LENGTH + EXPIRY_LENGTH));
      const minutes = decodeMinutes(clean.slice(DATA_LENGTH + EXPIRY_LENGTH, DATA_LENGTH + EXPIRY_LENGTH + MINUTE_LENGTH));
      if (minutes >= MINUTES_PER_DAY) return refuse;
      return {
        valid: true, reason: '', days, minutes,
        expiresOn: isoFromDays(days),
        expiresAt: momentFromParts(days, minutes)
      };
    }
    if (clean.length === SHORT_DATA_LENGTH + SHORT_CHECK_LENGTH) {
      const data = clean.slice(0, SHORT_DATA_LENGTH);
      if (checkGroups(data) !== clean.slice(SHORT_DATA_LENGTH)) return refuse;
      return { valid: true, reason: '', days: 0, minutes: null, expiresOn: '', expiresAt: '' };
    }
    if (clean.length === LEGACY_DATA_LENGTH + LEGACY_CHECK_LENGTH) {
      const data = clean.slice(0, LEGACY_DATA_LENGTH);
      if (legacyCheckGroups(data) === clean.slice(LEGACY_DATA_LENGTH)) {
        return { valid: true, reason: '', days: 0, minutes: null, expiresOn: '', expiresAt: '' };
      }
      return refuse;
    }
  } catch {
    return refuse;
  }
  return refuse;
}

// The last valid day of a key, as YYYY-MM-DD (empty for lifetime and for the
// older keys that never carried an expiry).
function expiryOfInstallKey(key) {
  const result = verifyInstallKey(key);
  return result.valid ? result.expiresOn : '';
}

// The moment a licence ends, as the card should print it: "2026-11-28" for a
// whole-day plan, "2026-11-19 07:40 UTC" for one measured in minutes, and ""
// for a lifetime licence.
function expiryOfKey(expiresOn) {
  const text = String(expiresOn || '').trim();
  if (!text) return '';
  if (!text.includes('T')) return text;
  return text.replace('T', ' ').replace(/(:\d\d)(\.\d+)?(Z)?$/, '$1 UTC');
}

module.exports = {
  ALPHABET, SALT, MODULUS, DATA_LENGTH, EXPIRY_LENGTH, CHECK_LENGTH, GROUPS,
  MINUTE_LENGTH, MINUTE_KEY_LENGTH, MINUTE_GROUPS, MINUTES_PER_DAY,
  EPOCH, DAY_MS, LEGACY_DATA_LENGTH, LEGACY_CHECK_LENGTH,
  indexOf, fold, checkGroups, legacyCheckGroups, dataFor, dataSlice, group,
  dayNumber, encodeDays, decodeDays, isoFromDays, daysFromIso,
  minuteOfDay, encodeMinutes, decodeMinutes, momentFromParts,
  makeInstallKey, legacyMakeInstallKey, shortMakeInstallKey,
  verifyInstallKey, expiryOfInstallKey, expiryOfKey, normalise
};
