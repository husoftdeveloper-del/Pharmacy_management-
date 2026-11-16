'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('../lib/database');
const serial = require('../lib/serial');
const keys = require('../lib/keys');

function fresh() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tit-db-'));
  const opened = store.openDatabase(folder);
  const keyFolder = path.join(folder, 'keys');
  keys.ensureKeyPair(keyFolder);
  const kid = keys.describe(keyFolder).keyId;
  return { folder, ...opened, keyFolder, kid };
}

function issue(ctx, overrides = {}) {
  const plan = overrides.plan || '1y';
  const payload = serial.buildPayload({
    product: overrides.product || 'Pharmacy Management',
    plan,
    licenseId: overrides.licenseId || Math.random().toString(16).slice(2, 11).toUpperCase(),
    kid: ctx.kid
  });
  const key = serial.signPayload(payload, keys.readPrivate(ctx.keyFolder));
  const id = store.insertLicense(ctx.db, {
    serial: key,
    product: payload.pr,
    plan: serial.PLANS[plan].key,
    issuedOn: payload.i,
    expiresOn: payload.x,
    keyId: ctx.kid,
    assignedTo: overrides.assignedTo || '',
    status: overrides.status || 'unused'
  });
  return { id, key, payload };
}

test('opening the database creates the three tables and a file next to the keys', () => {
  const ctx = fresh();
  const tables = ctx.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name);
  assert.deepEqual(tables.filter(name => !name.startsWith('sqlite_')), ['license_events', 'licenses', 'settings']);
  assert.equal(path.basename(ctx.file), 'licenses.sqlite');
  assert.equal(fs.existsSync(ctx.file), true);
  ctx.db.close();
});

test('a license is saved once and listed with its status', () => {
  const ctx = fresh();
  const { id, key, payload } = issue(ctx);
  const rows = store.listLicenses(ctx.db, {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, id);
  assert.equal(rows[0].serial, key);
  assert.equal(rows[0].product, 'Pharmacy Management');
  assert.equal(rows[0].plan, 'Y');
  assert.equal(rows[0].status, 'unused');
  assert.equal(rows[0].issued_on, payload.i);
  assert.equal(rows[0].expires_on, payload.x);
  assert.equal(store.stats(ctx.db).total, 1);
  ctx.db.close();
});

test('the same serial cannot be stored twice', () => {
  const ctx = fresh();
  const { key, payload } = issue(ctx);
  assert.throws(() => store.insertLicense(ctx.db, {
    serial: key, product: payload.pr, plan: 'Y', issuedOn: payload.i,
    expiresOn: payload.x, keyId: ctx.kid
  }), /UNIQUE/);
  ctx.db.close();
});

test('status moves unused → assigned → used and is audited', () => {
  const ctx = fresh();
  const { id } = issue(ctx);
  const assigned = store.updateStatus(ctx.db, id, 'assigned', 'Kabul Pharmacy');
  assert.equal(assigned.status, 'assigned');
  assert.equal(assigned.assigned_to, 'Kabul Pharmacy');
  const used = store.updateStatus(ctx.db, id, 'used');
  assert.equal(used.status, 'used');
  assert.equal(used.assigned_to, 'Kabul Pharmacy');
  const log = store.events(ctx.db, id).map(row => row.action);
  assert.deepEqual(log.sort(), ['generated', 'status', 'status']);
  const counts = store.stats(ctx.db);
  assert.deepEqual(counts, { total: 1, unused: 0, assigned: 0, used: 1 });
  ctx.db.close();
});

test('assigning without a customer falls back to unused', () => {
  const ctx = fresh();
  const { id } = issue(ctx);
  const row = store.updateStatus(ctx.db, id, 'assigned', '');
  assert.equal(row.status, 'unused');
  ctx.db.close();
});

test('an unknown status is refused', () => {
  const ctx = fresh();
  const { id } = issue(ctx);
  assert.throws(() => store.updateStatus(ctx.db, id, 'sold'), /Unknown license status/);
  assert.throws(() => store.updateStatus(ctx.db, 9999, 'used'), /not found/);
  ctx.db.close();
});

test('naming a customer marks an unused license as assigned', () => {
  const ctx = fresh();
  const { id } = issue(ctx);
  const row = store.saveNote(ctx.db, id, 'paid by transfer', 'Herat Clinic');
  assert.equal(row.status, 'assigned');
  assert.equal(row.assigned_to, 'Herat Clinic');
  assert.equal(row.note, 'paid by transfer');
  const cleared = store.saveNote(ctx.db, id, 'paid by transfer', '');
  assert.equal(cleared.assigned_to, '');
  assert.equal(cleared.status, 'assigned', 'a license already handed out stays assigned');
  ctx.db.close();
});

test('a used license cannot be deleted, an unused one can', () => {
  const ctx = fresh();
  const keep = issue(ctx);
  const drop = issue(ctx);
  store.updateStatus(ctx.db, keep.id, 'used');
  assert.throws(() => store.deleteLicense(ctx.db, keep.id), /used license cannot be deleted/);
  assert.deepEqual(store.deleteLicense(ctx.db, drop.id), { id: drop.id });
  assert.equal(store.listLicenses(ctx.db, {}).length, 1);
  ctx.db.close();
});

test('search and status filters narrow the list', () => {
  const ctx = fresh();
  issue(ctx, { product: 'Pharmacy Management', assignedTo: 'Kabul Pharmacy' });
  issue(ctx, { product: 'Clinic Manager', status: 'used' });
  issue(ctx, { product: 'Pharmacy Management', status: 'unused' });
  assert.equal(store.listLicenses(ctx.db, { search: 'clinic' }).length, 1);
  assert.equal(store.listLicenses(ctx.db, { search: 'kabul' }).length, 1);
  assert.equal(store.listLicenses(ctx.db, { status: 'used' }).length, 1);
  assert.equal(store.listLicenses(ctx.db, { status: 'unused' }).length, 2);
  // LIKE wildcards typed by a user are matched literally, not as SQL patterns.
  assert.equal(store.listLicenses(ctx.db, { search: '%' }).length, 0);
  ctx.db.close();
});

test('unused licenses sort before assigned and used ones', () => {
  const ctx = fresh();
  issue(ctx, { product: 'A', status: 'used' });
  issue(ctx, { product: 'B', status: 'assigned', assignedTo: 'X' });
  issue(ctx, { product: 'C' });
  const order = store.listLicenses(ctx.db, {}).map(row => row.product);
  assert.deepEqual(order, ['C', 'B', 'A']);
  ctx.db.close();
});

test('settings survive a reopen and the license rows are still there', () => {
  const ctx = fresh();
  issue(ctx);
  store.setSetting(ctx.db, 'key_id', ctx.kid);
  ctx.db.close();
  const again = store.openDatabase(ctx.folder);
  assert.equal(store.getSetting(again.db, 'key_id'), ctx.kid);
  assert.equal(store.getSetting(again.db, 'missing', 'fallback'), 'fallback');
  assert.equal(store.listLicenses(again.db, {}).length, 1);
  again.db.close();
});

test('an invalid status is rejected by the schema itself', () => {
  const ctx = fresh();
  assert.throws(() => ctx.db.prepare(`INSERT INTO licenses(serial,product,plan,issued_on,expires_on,key_id,status)
    VALUES('X','P','L','2026-01-01','','K','archived')`).run(), /CHECK/);
  ctx.db.close();
});

test('events for one license do not leak into another', () => {
  const ctx = fresh();
  const first = issue(ctx);
  const second = issue(ctx);
  store.updateStatus(ctx.db, first.id, 'assigned', 'One');
  store.updateStatus(ctx.db, second.id, 'assigned', 'Two');
  const details = store.events(ctx.db, first.id).map(row => row.detail).join(' ');
  assert.match(details, /One/);
  assert.doesNotMatch(details, /Two/);
  ctx.db.close();
});
