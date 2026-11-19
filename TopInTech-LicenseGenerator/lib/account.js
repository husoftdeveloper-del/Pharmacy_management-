'use strict';
/* Owner sign-in for the License Generator.

   The application window opens locked: nothing can be generated, listed or
   exported until the owner signs in. Credentials live in the generator's own
   SQLite database as a scrypt hash — the password itself is never stored, never
   logged and never leaves the main process.

   The first run has no account yet, so the screen asks the owner to create one;
   every later start asks for that username and password. After five wrong
   attempts the form locks for a minute, which keeps a shared desk honest
   without getting in the owner's way.                                        */
const crypto = require('node:crypto');

const SETTING_USER = 'owner_username';
const SETTING_HASH = 'owner_password_hash';
const SETTING_CREATED = 'owner_created_at';
const SETTING_FAILURES = 'owner_failures';
const SETTING_LOCKED_UNTIL = 'owner_locked_until';

const MAX_FAILURES = 5;
const LOCK_MS = 60 * 1000;
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,40}$/;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 128;

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function normalize(username) {
  return String(username == null ? '' : username).trim().toLowerCase();
}

function scrypt(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

async function hash(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt);
  // Stored as: scrypt$<N>$<r>$<p>$<salt hex>$<key hex>
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function matches(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltHex, keyHex] = parts;
  const expected = Buffer.from(keyHex, 'hex');
  const salt = Buffer.from(saltHex, 'hex');
  let key;
  try {
    key = await new Promise((resolve, reject) => {
      crypto.scrypt(String(password), salt, expected.length, { N: Number(N), r: Number(r), p: Number(p) }, (error, value) => {
        if (error) reject(error);
        else resolve(value);
      });
    });
  } catch {
    return false;
  }
  // Constant-time compare: same length here, so the timing says nothing.
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

/* ---- validation ------------------------------------------------------- */
function checkUsername(username) {
  const value = String(username == null ? '' : username).trim();
  if (!value) throw new Error('Enter a username.');
  return value;
}

function checkPassword(password, username) {
  const value = String(password == null ? '' : password);
  if (value.length < PASSWORD_MIN) throw new Error(`The password must be at least ${PASSWORD_MIN} characters.`);
  if (value.length > PASSWORD_MAX) throw new Error(`The password must be at most ${PASSWORD_MAX} characters.`);
  const lowered = value.toLowerCase();
  if (lowered === normalize(username)) throw new Error('The password cannot be the same as the username.');
  return value;
}

/* Whether an account exists, and whether the form is currently locked. */
function state(store, db) {
  const username = store.getSetting(db, SETTING_USER, '');
  const lockedUntil = Number(store.getSetting(db, SETTING_LOCKED_UNTIL, '0')) || 0;
  const now = Date.now();
  return {
    configured: Boolean(username),
    // The stored username is shown back so the owner is not guessing — it is not
    // a secret, and the password is what protects the tool.
    username: username || '',
    locked: lockedUntil > now,
    retryInSeconds: lockedUntil > now ? Math.ceil((lockedUntil - now) / 1000) : 0,
    maxAttempts: MAX_FAILURES
  };
}

/* First run: create the owner account. Fails once an account exists. */
async function register(store, db, payload) {
  if (store.getSetting(db, SETTING_USER, '')) throw new Error('This computer already has an owner account. Sign in instead.');
  const username = checkUsername(payload?.username);
  const password = checkPassword(payload?.password, username);
  const confirmation = String(payload?.confirm == null ? password : payload.confirm);
  if (password !== confirmation) throw new Error('The two passwords do not match.');
  const storedHash = await hash(password);

  // node:sqlite's DatabaseSync has no transaction helper, so drive it directly.
  db.exec('BEGIN IMMEDIATE');
  try {
    store.setSetting(db, SETTING_USER, username);
    store.setSetting(db, SETTING_HASH, storedHash);
    store.setSetting(db, SETTING_CREATED, new Date().toISOString());
    store.setSetting(db, SETTING_FAILURES, '0');
    store.setSetting(db, SETTING_LOCKED_UNTIL, '0');
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  store.event(db, null, 'owner_created', username);
  return { username, created: true };
}

/* Every later start: username + password. */
async function signIn(store, db, payload) {
  const storedUser = store.getSetting(db, SETTING_USER, '');
  if (!storedUser) throw new Error('No owner account exists yet. Create one to continue.');

  const lockUntil = Number(store.getSetting(db, SETTING_LOCKED_UNTIL, '0')) || 0;
  if (lockUntil > Date.now()) {
    const seconds = Math.ceil((lockUntil - Date.now()) / 1000);
    throw new Error(`Too many attempts. Try again in ${seconds} seconds.`);
  }

  const username = normalize(payload?.username);
  const password = String(payload?.password == null ? '' : payload.password);
  const ok = username === normalize(storedUser) && (await matches(password, store.getSetting(db, SETTING_HASH, '')));

  if (!ok) {
    const failures = (Number(store.getSetting(db, SETTING_FAILURES, '0')) || 0) + 1;
    store.setSetting(db, SETTING_FAILURES, String(failures));
    if (failures >= MAX_FAILURES) {
      store.setSetting(db, SETTING_LOCKED_UNTIL, String(Date.now() + LOCK_MS));
      store.setSetting(db, SETTING_FAILURES, '0');
      store.event(db, null, 'owner_locked', 'five wrong attempts');
      throw new Error(`Too many attempts. Try again in ${Math.ceil(LOCK_MS / 1000)} seconds.`);
    }
    const left = MAX_FAILURES - failures;
    store.event(db, null, 'owner_login_failed', `attempt ${failures}`);
    throw new Error(`Wrong username or password. ${left} attempt${left === 1 ? '' : 's'} left.`);
  }

  store.setSetting(db, SETTING_FAILURES, '0');
  store.setSetting(db, SETTING_LOCKED_UNTIL, '0');
  store.event(db, null, 'owner_login', storedUser);
  return { username: storedUser, locked: false };
}

/* ---- Settings ---------------------------------------------------------- */

/* What the Settings window shows. The password hash never leaves this process,
   and the username and creation date are not secrets. */
function info(store, db) {
  return {
    username: store.getSetting(db, SETTING_USER, ''),
    createdAt: store.getSetting(db, SETTING_CREATED, ''),
    maxAttempts: MAX_FAILURES,
    passwordMin: PASSWORD_MIN,
    passwordMax: PASSWORD_MAX
  };
}

/* Change the owner password. The current password is required even though the
   window is already unlocked: an unattended computer must not be enough to take
   the tool over. The new password gets a fresh salt, so the old hash is useless
   even if the database was copied before the change. */
async function changePassword(store, db, payload) {
  const storedUser = store.getSetting(db, SETTING_USER, '');
  if (!storedUser) throw new Error('No owner account exists yet.');
  const current = String(payload?.current == null ? '' : payload.current);
  if (!current) throw new Error('Enter your current password.');
  if (!(await matches(current, store.getSetting(db, SETTING_HASH, '')))) {
    store.event(db, null, 'password_change_failed', 'wrong current password');
    throw new Error('The current password is not correct.');
  }
  const username = String(payload?.username == null ? storedUser : payload.username).trim();
  const password = checkPassword(payload?.password, username || storedUser);
  const confirmation = String(payload?.confirm == null ? password : payload.confirm);
  if (password !== confirmation) throw new Error('The two new passwords do not match.');
  if (await matches(password, store.getSetting(db, SETTING_HASH, ''))) {
    throw new Error('The new password must be different from the current one.');
  }
  store.setSetting(db, SETTING_HASH, await hash(password));
  // A password change also clears any leftover lockout.
  store.setSetting(db, SETTING_FAILURES, '0');
  store.setSetting(db, SETTING_LOCKED_UNTIL, '0');
  store.event(db, null, 'password_changed', storedUser);
  return { username: storedUser, changed: true };
}

/* Rename the owner account. Requires the password, because the username is half
   of the credentials the sign-in screen asks for. */
async function changeUsername(store, db, payload) {
  const storedUser = store.getSetting(db, SETTING_USER, '');
  if (!storedUser) throw new Error('No owner account exists yet.');
  const password = String(payload?.password == null ? '' : payload.password);
  if (!password) throw new Error('Enter your password to change the username.');
  if (!(await matches(password, store.getSetting(db, SETTING_HASH, '')))) {
    store.event(db, null, 'username_change_failed', 'wrong password');
    throw new Error('The password is not correct.');
  }
  const username = checkUsername(payload?.username);
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error('The username must be 3–40 characters: letters, numbers, dot, dash or underscore.');
  }
  if (normalize(username) === normalize(storedUser)) return { username: storedUser, changed: false };
  // Changing the username also changes the password rule ("not the same as the
  // username"), so refuse a rename that would make the current password invalid.
  if (normalize(password) === normalize(username)) throw new Error('The password cannot be the same as the username.');
  store.setSetting(db, SETTING_USER, username);
  store.event(db, null, 'username_changed', `${storedUser} → ${username}`);
  return { username, previous: storedUser, changed: true };
}

module.exports = {
  register, signIn, state, info, changePassword, changeUsername, matches, hash,
  SETTING_USER, SETTING_HASH, SETTING_CREATED,
  MAX_FAILURES, PASSWORD_MIN
};
