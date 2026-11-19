'use strict';
/* The License Generator opens locked. These tests drive the real account module
   against a real temporary SQLite file, so the stored password, the case
   sensitivity, the first-run flow and the lockout are all proven for real —
   not against a stub.                                                       */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const account = require('../lib/account');
const store = require('../lib/database');

function fresh() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tit-account-'));
  const { db } = store.openDatabase(folder);
  return { db, folder, close: () => { try { db.close(); } catch {} fs.rmSync(folder, { recursive: true, force: true }); } };
}

const OWNER = { username: 'mynewpharmacy', password: 'HKDEVELOPER2', confirm: 'HKDEVELOPER2' };

test('a brand-new installation has no owner and asks to create one', () => {
  const app = fresh();
  try {
    const state = account.state(store, app.db);
    assert.equal(state.configured, false);
    assert.equal(state.locked, false);
  } finally { app.close(); }
});

test('creating the owner account signs the first run in and stores only a hash', async () => {
  const app = fresh();
  try {
    const created = await account.register(store, app.db, OWNER);
    assert.equal(created.username, 'mynewpharmacy');
    assert.equal(account.state(store, app.db).configured, true);

    const stored = store.getSetting(app.db, account.SETTING_HASH);
    assert.ok(stored.startsWith('scrypt$'), 'a scrypt hash, not the password');
    assert.equal(stored.includes('HKDEVELOPER2'), false, 'the password itself is never stored');
  } finally { app.close(); }
});

test('the password is accepted exactly, and its case matters', async () => {
  const app = fresh();
  try {
    await account.register(store, app.db, OWNER);
    const good = await account.signIn(store, app.db, { username: 'mynewpharmacy', password: 'HKDEVELOPER2' });
    assert.equal(good.username, 'mynewpharmacy');

    await assert.rejects(
      account.signIn(store, app.db, { username: 'mynewpharmacy', password: 'hkdeveloper2' }),
      /Wrong username or password/,
      'a lower-case copy of the password is refused'
    );
    // Usernames are compared without case (nobody should lose access over a
    // capital letter); the password above stayed case-sensitive.
    const mixedCaseUser = await account.signIn(store, app.db, { username: 'MyNewPharmacy', password: 'HKDEVELOPER2' });
    assert.equal(mixedCaseUser.username, 'mynewpharmacy');
  } finally { app.close(); }
});

test('a wrong password is counted, and the form locks after five attempts', async () => {
  const app = fresh();
  try {
    await account.register(store, app.db, OWNER);
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await assert.rejects(
        account.signIn(store, app.db, { username: 'mynewpharmacy', password: 'wrong-pass' }),
        new RegExp(`${5 - attempt} attempts? left`)
      );
    }
    await assert.rejects(
      account.signIn(store, app.db, { username: 'mynewpharmacy', password: 'wrong-pass' }),
      /Too many attempts/
    );
    const state = account.state(store, app.db);
    assert.equal(state.locked, true);
    assert.ok(state.retryInSeconds > 0);

    // Even the right password waits out the lock.
    await assert.rejects(
      account.signIn(store, app.db, { username: 'mynewpharmacy', password: 'HKDEVELOPER2' }),
      /Too many attempts/
    );
  } finally { app.close(); }
});

test('a short password, a mismatched confirmation and a second account are refused', async () => {
  const app = fresh();
  try {
    await assert.rejects(account.register(store, app.db, { username: 'owner', password: '123', confirm: '123' }), /at least 6 characters/);
    await assert.rejects(account.register(store, app.db, { username: 'owner', password: 'HKDEVELOPER2', confirm: 'HKDEVELOPER3' }), /do not match/);
    await assert.rejects(account.register(store, app.db, { username: '', password: 'HKDEVELOPER2' }), /Enter a username/);

    await account.register(store, app.db, OWNER);
    await assert.rejects(account.register(store, app.db, { ...OWNER, username: 'intruder' }), /already has an owner account/);
  } finally { app.close(); }
});

test('sign-in is refused before an account exists', async () => {
  const app = fresh();
  try {
    await assert.rejects(
      account.signIn(store, app.db, { username: 'anyone', password: 'anything' }),
      /No owner account exists yet/
    );
  } finally { app.close(); }
});

test('the signed-in state survives a restart of the app', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tit-account-'));
  try {
    const first = store.openDatabase(folder);
    await account.register(store, first.db, OWNER);
    first.db.close();

    // A new process opens the same database and only needs the password.
    const second = store.openDatabase(folder);
    assert.equal(account.state(store, second.db).configured, true);
    const signed = await account.signIn(store, second.db, { username: 'mynewpharmacy', password: 'HKDEVELOPER2' });
    assert.equal(signed.username, 'mynewpharmacy');
    second.db.close();
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

/* ---- Settings: changing the password and the username ------------------ */
test('the owner can change the password, and the old one stops working', async () => {
  const app = fresh();
  try {
    await account.register(store, app.db, OWNER);
    const before = store.getSetting(app.db, account.SETTING_HASH);

    const changed = await account.changePassword(store, app.db, {
      current: OWNER.password, password: 'newSecret-2026', confirm: 'newSecret-2026'
    });
    assert.equal(changed.changed, true);

    // A fresh salt: the same password would produce a different hash anyway,
    // and the old hash is gone.
    const after = store.getSetting(app.db, account.SETTING_HASH);
    assert.notEqual(after, before);
    assert.ok(after.startsWith('scrypt$'));

    // The old password no longer signs in; the new one does.
    await assert.rejects(account.signIn(store, app.db, { username: OWNER.username, password: OWNER.password }), /Wrong username or password/);
    const signed = await account.signIn(store, app.db, { username: OWNER.username, password: 'newSecret-2026' });
    assert.equal(signed.username, OWNER.username);

    // The change is in the audit trail, without the password itself.
    const events = app.db.prepare('SELECT action, detail FROM license_events WHERE action=?').all('password_changed');
    assert.equal(events.length, 1);
    const text = JSON.stringify(events);
    assert.match(text, /password_changed/);
    assert.doesNotMatch(text, /newSecret-2026/);
  } finally { app.close(); }
});

test('changing the password needs the current one, a match and a new value', async () => {
  const app = fresh();
  try {
    await account.register(store, app.db, OWNER);
    const hash = store.getSetting(app.db, account.SETTING_HASH);
    await assert.rejects(account.changePassword(store, app.db, { current: '', password: 'abcdef1', confirm: 'abcdef1' }), /current password/i);
    await assert.rejects(account.changePassword(store, app.db, { current: 'wrong-one', password: 'abcdef1', confirm: 'abcdef1' }), /current password is not correct/i);
    await assert.rejects(account.changePassword(store, app.db, { current: OWNER.password, password: 'abcdef1', confirm: 'abcdef2' }), /do not match/i);
    await assert.rejects(account.changePassword(store, app.db, { current: OWNER.password, password: 'abc', confirm: 'abc' }), /at least 6 characters/i);
    // Reusing the same password is refused, so "change" always changes something.
    await assert.rejects(account.changePassword(store, app.db, { current: OWNER.password, password: OWNER.password, confirm: OWNER.password }), /different from the current one/i);
    // Nothing changed, and the account still works.
    assert.equal(store.getSetting(app.db, account.SETTING_HASH), hash);
    assert.equal((await account.signIn(store, app.db, { username: OWNER.username, password: OWNER.password })).username, OWNER.username);
  } finally { app.close(); }
});

test('a password change also clears a lockout left by wrong attempts', async () => {
  const app = fresh();
  try {
    await account.register(store, app.db, OWNER);
    for (let i = 0; i < 5; i += 1) {
      await assert.rejects(account.signIn(store, app.db, { username: OWNER.username, password: `wrong-${i}` }));
    }
    assert.equal(account.state(store, app.db).locked, true);
    await account.changePassword(store, app.db, { current: OWNER.password, password: 'freshPass1', confirm: 'freshPass1' });
    assert.equal(account.state(store, app.db).locked, false, 'the owner is not locked out of their own tool');
    assert.equal((await account.signIn(store, app.db, { username: OWNER.username, password: 'freshPass1' })).username, OWNER.username);
  } finally { app.close(); }
});

test('the username can be changed with the password, and sign-in follows', async () => {
  const app = fresh();
  try {
    await account.register(store, app.db, OWNER);
    const renamed = await account.changeUsername(store, app.db, { username: 'kabul-owner', password: OWNER.password });
    assert.equal(renamed.changed, true);
    assert.equal(renamed.username, 'kabul-owner');
    assert.equal(account.state(store, app.db).username, 'kabul-owner');

    // The old name no longer works; the new one does, with the same password.
    await assert.rejects(account.signIn(store, app.db, { username: OWNER.username, password: OWNER.password }), /Wrong username or password/);
    assert.equal((await account.signIn(store, app.db, { username: 'kabul-owner', password: OWNER.password })).username, 'kabul-owner');

    // Changing it to the same name is a no-op rather than an error.
    assert.equal((await account.changeUsername(store, app.db, { username: 'Kabul-Owner', password: OWNER.password })).changed, false);

    // Bad input is refused and changes nothing.
    await assert.rejects(account.changeUsername(store, app.db, { username: 'x', password: OWNER.password }), /3–40 characters/);
    await assert.rejects(account.changeUsername(store, app.db, { username: 'bad name', password: OWNER.password }), /3–40 characters/);
    await assert.rejects(account.changeUsername(store, app.db, { username: 'someone', password: 'nope-nope' }), /password is not correct/i);
    await assert.rejects(account.changeUsername(store, app.db, { username: 'other', password: '' }), /Enter your password/i);
    assert.equal(account.state(store, app.db).username, 'kabul-owner');
  } finally { app.close(); }
});

test('the settings information never includes the password or its hash', async () => {
  const app = fresh();
  try {
    await account.register(store, app.db, OWNER);
    const info = account.info(store, app.db);
    assert.equal(info.username, OWNER.username);
    assert.match(info.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(info.maxAttempts, 5);
    const text = JSON.stringify(info);
    assert.doesNotMatch(text, /scrypt/);
    assert.doesNotMatch(text, /HKDEVELOPER2/);
    assert.deepEqual(Object.keys(info).sort(), ['createdAt', 'maxAttempts', 'passwordMax', 'passwordMin', 'username']);
  } finally { app.close(); }
});
