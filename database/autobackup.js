'use strict';
// Silent local backups: one rolling dated copy per day, one extra copy when the
// app closes, and an automatic clean-up of the oldest copies. Everything here is
// plain Node so the same rules run in the app and in the unit tests.
const fs = require('node:fs');
const path = require('node:path');
const { backupDatabase } = require('./database');

const DEFAULT_COPIES = 14;
const DEFAULT_FOLDER_NAME = 'PharmaCare-Backups';
const COPY_PATTERN = /^pharmacy-[\w.-]+\.sqlite$/;

function defaultFolder(documents) {
  return path.join(documents || '.', DEFAULT_FOLDER_NAME);
}

function two(value) { return String(value).padStart(2, '0'); }
function day(date) { return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`; }

function dailyFile(date = new Date()) {
  return `pharmacy-${day(date)}.sqlite`;
}
function closeFile(date = new Date()) {
  return `pharmacy-close-${day(date)}_${two(date.getHours())}-${two(date.getMinutes())}-${two(date.getSeconds())}.sqlite`;
}
function manualFile(date = new Date()) {
  return `pharmacy-manual-${day(date)}_${two(date.getHours())}-${two(date.getMinutes())}-${two(date.getSeconds())}.sqlite`;
}
// "daily" copies are one per calendar day, so the file name alone decides whether
// today's snapshot already exists. Close and manual copies always add a new file.
function alreadyBackedUpToday(folder, date = new Date()) {
  return fs.existsSync(path.join(folder, dailyFile(date)));
}

function copies(folder) {
  let names = [];
  try { names = fs.readdirSync(folder); } catch { return []; }
  return names
    .filter(name => COPY_PATTERN.test(name))
    .map(name => {
      const full = path.join(folder, name);
      try {
        const stat = fs.statSync(full);
        if (!stat.isFile()) return null;
        return { name, path: full, bytes: stat.size, at: stat.mtimeMs };
      } catch { return null; }
    })
    .filter(Boolean)
    // Newest first. Copies written in the same second share an mtime, so the
    // dated file name breaks the tie and keeps the order predictable.
    .sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
}

// Keep the newest `keep` copies, delete the rest. Never touches files the app
// did not create.
function prune(folder, keep = DEFAULT_COPIES) {
  const limit = Math.max(1, Math.min(365, Number(keep) || DEFAULT_COPIES));
  const all = copies(folder);
  const removed = [];
  for (const item of all.slice(limit)) {
    try { fs.rmSync(item.path, { force: true }); removed.push(item.path); } catch {}
  }
  return { removed, kept: all.slice(0, limit) };
}

async function writeCopy(db, folder, name) {
  fs.mkdirSync(folder, { recursive: true });
  let destination = path.join(folder, name);
  if (fs.existsSync(destination)) {
    // A copy from the same second already exists; keep both but never overwrite.
    destination = destination.replace(/\.sqlite$/, `-${Date.now()}.sqlite`);
  }
  await backupDatabase(db, destination);
  return destination;
}

// One entry point for all three kinds of copy, with the retention rule applied.
async function run(db, folder, kind = 'daily', keep = DEFAULT_COPIES, date = new Date()) {
  const target = kind === 'close' ? closeFile(date) : kind === 'manual' ? manualFile(date) : dailyFile(date);
  if (kind === 'daily' && alreadyBackedUpToday(folder, date)) {
    return { skipped: true, path: path.join(folder, dailyFile(date)) };
  }
  const file = await writeCopy(db, folder, target);
  const { removed } = prune(folder, keep);
  return { skipped: false, path: file, removed };
}

module.exports = { DEFAULT_COPIES, DEFAULT_FOLDER_NAME, defaultFolder, dailyFile, closeFile, manualFile, alreadyBackedUpToday, copies, prune, run };
