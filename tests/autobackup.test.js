'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../database/database');
const autoBackup = require('../database/autobackup');

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-backup-'));
  const folder = path.join(root, 'Documents', 'PharmaCare-Backups');
  const db = openDatabase(path.join(root, 'data'));
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, folder, db };
}

test('the default folder sits inside the user Documents folder', () => {
  assert.equal(autoBackup.defaultFolder(path.join('C:', 'Users', 'A', 'Documents')), path.join('C:', 'Users', 'A', 'Documents', 'PharmaCare-Backups'));
});

test('file names carry the day, and a close copy is unique to the second', () => {
  const date = new Date(2026, 9, 28, 12, 28, 26);
  assert.equal(autoBackup.dailyFile(date), 'pharmacy-2026-10-28.sqlite');
  assert.equal(autoBackup.closeFile(date), 'pharmacy-close-2026-10-28_12-28-26.sqlite');
  assert.equal(autoBackup.manualFile(date), 'pharmacy-manual-2026-10-28_12-28-26.sqlite');
  for (const name of [autoBackup.dailyFile(date), autoBackup.closeFile(date), autoBackup.manualFile(date)]) {
    assert.match(name, /^pharmacy-[\w.-]+\.sqlite$/);
  }
});

test('the daily copy runs once per calendar day', async t => {
  const { folder, db } = workspace(t);
  const date = new Date(2026, 9, 28, 9, 0, 0);
  assert.equal(autoBackup.alreadyBackedUpToday(folder, date), false);
  const first = await autoBackup.run(db, folder, 'daily', 14, date);
  assert.equal(first.skipped, false);
  assert.equal(path.basename(first.path), 'pharmacy-2026-10-28.sqlite');
  assert.equal(fs.statSync(first.path).size > 0, true);
  assert.equal(autoBackup.alreadyBackedUpToday(folder, date), true);
  const again = await autoBackup.run(db, folder, 'daily', 14, new Date(2026, 9, 28, 18, 0, 0));
  assert.equal(again.skipped, true, 'a second run on the same day is skipped');
  const nextDay = await autoBackup.run(db, folder, 'daily', 14, new Date(2026, 9, 29, 8, 0, 0));
  assert.equal(nextDay.skipped, false);
  assert.equal(autoBackup.copies(folder).length, 2);
});

test('closing and manual copies are always new files', async t => {
  const { folder, db } = workspace(t);
  const date = new Date(2026, 9, 28, 12, 0, 0);
  const a = await autoBackup.run(db, folder, 'close', 14, date);
  const b = await autoBackup.run(db, folder, 'close', 14, new Date(2026, 9, 28, 12, 0, 0));
  const c = await autoBackup.run(db, folder, 'manual', 14, date);
  assert.equal(new Set([a.path, b.path, c.path]).size, 3, 'no copy overwrites another');
  for (const file of [a.path, b.path, c.path]) assert.equal(fs.existsSync(file), true);
});

test('old copies are pruned and foreign files are never touched', async t => {
  const { folder, db } = workspace(t);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'notes.txt'), 'keep me');
  fs.writeFileSync(path.join(folder, 'invoice.sqlite'), 'keep me too');
  for (let day = 1; day <= 20; day += 1) {
    await autoBackup.run(db, folder, 'daily', 365, new Date(2026, 8, day, 7, 0, 0));
  }
  assert.equal(autoBackup.copies(folder).length, 20);
  const { removed } = autoBackup.prune(folder, 5);
  assert.equal(removed.length, 15);
  const left = autoBackup.copies(folder).map(item => item.name);
  assert.equal(left.length, 5);
  assert.deepEqual(left, [
    'pharmacy-2026-09-20.sqlite', 'pharmacy-2026-09-19.sqlite',
    'pharmacy-2026-09-18.sqlite', 'pharmacy-2026-09-17.sqlite',
    'pharmacy-2026-09-16.sqlite'
  ]);
  assert.equal(fs.existsSync(path.join(folder, 'notes.txt')), true);
  assert.equal(fs.existsSync(path.join(folder, 'invoice.sqlite')), true);
});

test('copies to keep is clamped to a sane range', () => {
  assert.equal(autoBackup.DEFAULT_COPIES, 14);
  assert.equal(autoBackup.prune('/definitely/missing', 0).removed.length, 0, 'a missing folder is not an error');
});

test('a backup of the real database can be validated as a restore source', async t => {
  const { folder, db } = workspace(t);
  const { validateBackup } = require('../database/database');
  db.exec("INSERT INTO settings(key,value) VALUES ('pharmacy_name','Kabul Care') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  const result = await autoBackup.run(db, folder, 'manual', 14);
  const { DatabaseSync } = require('node:sqlite');
  const copy = new DatabaseSync(result.path, { readOnly: true });
  try {
    assert.equal(copy.prepare("SELECT value FROM settings WHERE key='pharmacy_name'").get().value, 'Kabul Care');
  } finally { copy.close(); }
  assert.equal(typeof validateBackup, 'function');
});
