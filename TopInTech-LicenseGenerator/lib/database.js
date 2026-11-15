'use strict';
/* The generator's own SQLite database. It is created inside the app's data
   folder and has three tables: licenses, license_events (an audit trail of
   status changes) and settings (which key pair issued the licenses).        */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY,
  serial TEXT NOT NULL UNIQUE,
  product TEXT NOT NULL,
  plan TEXT NOT NULL,
  issued_on TEXT NOT NULL,
  expires_on TEXT NOT NULL DEFAULT '',
  key_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unused' CHECK(status IN ('unused','assigned','used')),
  assigned_to TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS licenses_status ON licenses(status);
CREATE TABLE IF NOT EXISTS license_events (
  id INTEGER PRIMARY KEY,
  license_id INTEGER REFERENCES licenses(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
`;

function openDatabase(folder) {
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, 'licenses.sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec(SCHEMA);
  return { db, file };
}

function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}

function getSetting(db, key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? row.value : fallback;
}

function event(db, licenseId, action, detail = '') {
  db.prepare('INSERT INTO license_events(license_id,action,detail) VALUES(?,?,?)').run(licenseId, action, detail);
}

function insertLicense(db, row) {
  const result = db.prepare(`INSERT INTO licenses(serial,product,plan,issued_on,expires_on,key_id,status,assigned_to,note)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(row.serial, row.product, row.plan, row.issuedOn, row.expiresOn || '', row.keyId,
    row.status || 'unused', row.assignedTo || '', row.note || '');
  const id = Number(result.lastInsertRowid);
  event(db, id, 'generated', `${row.product} · ${row.plan}`);
  return id;
}

const ORDER = "ORDER BY CASE status WHEN 'unused' THEN 0 WHEN 'assigned' THEN 1 ELSE 2 END, id DESC";

function listLicenses(db, options = {}) {
  const status = ['unused', 'assigned', 'used'].includes(options.status) ? options.status : '';
  const term = String(options.search || '').trim();
  let sql = 'SELECT * FROM licenses';
  const params = [];
  const where = [];
  if (status) { where.push('status=?'); params.push(status); }
  if (term) {
    const columns = ['serial', 'product', 'assigned_to', 'note'];
    where.push(`(${columns.map(column => `${column} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
    // A %, _ or backslash typed in the search box is matched as a plain
    // character, not as an SQL wildcard.
    const like = `%${term.replace(/[\\%_]/g, char => `\\${char}`)}%`;
    params.push(like, like, like, like);
  }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ` ${ORDER}`;
  return db.prepare(sql).all(...params);
}

function updateStatus(db, id, status, assignedTo) {
  if (!['unused', 'assigned', 'used'].includes(status)) throw new Error('Unknown license status.');
  const row = db.prepare('SELECT * FROM licenses WHERE id=?').get(Number(id));
  if (!row) throw new Error('License not found.');
  const owner = assignedTo === undefined ? row.assigned_to : String(assignedTo).trim().slice(0, 120);
  // A license handed to a customer is "assigned" unless it has been activated.
  const next = status === 'assigned' && !owner ? 'unused' : status;
  db.prepare("UPDATE licenses SET status=?, assigned_to=?, updated_at=datetime('now') WHERE id=?").run(next, owner, row.id);
  event(db, row.id, 'status', `${row.status} → ${next}${owner ? ` (${owner})` : ''}`);
  return db.prepare('SELECT * FROM licenses WHERE id=?').get(row.id);
}

// Updates the note and, when a customer name is supplied, who the license
// belongs to. Naming a customer marks an unused license as assigned.
function saveNote(db, id, note, assignedTo) {
  const row = db.prepare('SELECT * FROM licenses WHERE id=?').get(Number(id));
  if (!row) throw new Error('License not found.');
  const text = String(note ?? row.note).slice(0, 300);
  const owner = assignedTo === undefined ? row.assigned_to : String(assignedTo).trim().slice(0, 120);
  const status = row.status === 'unused' && owner ? 'assigned' : row.status;
  db.prepare("UPDATE licenses SET note=?, assigned_to=?, status=?, updated_at=datetime('now') WHERE id=?")
    .run(text, owner, status, row.id);
  if (text !== row.note || owner !== row.assigned_to) {
    event(db, row.id, 'note', [owner ? `customer: ${owner}` : '', text ? `note: ${text.slice(0, 80)}` : ''].filter(Boolean).join(' · '));
  }
  return db.prepare('SELECT * FROM licenses WHERE id=?').get(row.id);
}

function deleteLicense(db, id) {
  const row = db.prepare('SELECT * FROM licenses WHERE id=?').get(Number(id));
  if (!row) throw new Error('License not found.');
  if (row.status === 'used') throw new Error('A used license cannot be deleted. Keep the record for the customer.');
  db.prepare('DELETE FROM licenses WHERE id=?').run(row.id);
  return { id: row.id };
}

function stats(db) {
  const rows = db.prepare('SELECT status, COUNT(*) AS count FROM licenses GROUP BY status').all();
  const totals = { total: 0, unused: 0, assigned: 0, used: 0 };
  for (const row of rows) {
    totals[row.status] = row.count;
    totals.total += row.count;
  }
  return totals;
}

function events(db, id) {
  return db.prepare('SELECT action, detail, at FROM license_events WHERE license_id=? ORDER BY id DESC LIMIT 50').all(Number(id));
}

module.exports = { openDatabase, setSetting, getSetting, insertLicense, listLicenses, updateStatus, saveNote, deleteLicense, stats, events, event };
