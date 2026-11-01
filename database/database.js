'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function openDatabase(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, 'pharmacy.sqlite');
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  return db;
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex');
  return `scrypt:32768:${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [scheme, n, salt, hash] = String(stored).split(':');
  if (scheme !== 'scrypt' || Number(n) !== 32768 || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(hash || '')) return false;
  const actual = crypto.scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return crypto.timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
const transactionDepths = new WeakMap();
function transaction(db, fn) {
  const depth = transactionDepths.get(db) || 0;
  if (depth) { transactionDepths.set(db, depth + 1); try { return fn(); } finally { transactionDepths.set(db, depth); } }
  db.exec('BEGIN IMMEDIATE');
  transactionDepths.set(db, 1);
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; } finally { transactionDepths.delete(db); }
}
function audit(db, user, action, entity = '', entityId = '', details = '') {
  db.prepare('INSERT INTO audit_logs(user_id,username,action,entity,entity_id,details) VALUES(?,?,?,?,?,?)')
    .run(user?.id || null, user?.username || 'system', action, entity, String(entityId), typeof details === 'string' ? details : JSON.stringify(details));
}
async function backupDatabase(db, destination) {
  if (!path.isAbsolute(destination) || !destination.endsWith('.sqlite')) throw new Error('Choose an absolute .sqlite backup path.');
  if (fs.existsSync(destination)) throw new Error('Backup destination already exists. Choose a new filename.');
  const { backup } = require('node:sqlite');
  await backup(db, destination);
  const check = new DatabaseSync(destination, { readOnly: true });
  try {
    const result = check.prepare('PRAGMA integrity_check').get();
    if (result.integrity_check !== 'ok') throw new Error('Backup integrity check failed.');
  } finally { check.close(); }
}
function validateBackup(filename) {
  if (!fs.existsSync(filename)) throw new Error('Backup file not found.');
  const candidate = new DatabaseSync(filename, { readOnly: true });
  try {
    if (candidate.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('The backup is corrupt.');
    const tables = candidate.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name);
    for (const name of ['users','medicines','batches','sales','sale_items','purchases','journals','journal_lines','settings','audit_logs']) {
      if (!tables.includes(name)) throw new Error('This is not a compatible pharmacy backup.');
    }
    if (!candidate.prepare('SELECT id FROM users WHERE active=1 AND role=?').get('admin')) throw new Error('Backup has no active administrator.');
    if (candidate.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Backup contains broken record relationships.');
    const balanced = candidate.prepare('SELECT j.id FROM journals j JOIN journal_lines l ON l.journal_id=j.id GROUP BY j.id HAVING ABS(SUM(l.debit)-SUM(l.credit))>0.005 OR COUNT(*)<2').all();
    if (balanced.length) throw new Error('Backup contains unbalanced accounting entries.');
  } finally { candidate.close(); }
}
module.exports = { openDatabase, hashPassword, verifyPassword, transaction, audit, backupDatabase, validateBackup };
