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
