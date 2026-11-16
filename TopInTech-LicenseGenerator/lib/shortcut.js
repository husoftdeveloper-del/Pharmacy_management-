'use strict';
/* Desktop shortcut creation, kept away from Electron so it can be tested.

   Windows can hide a desktop icon for several reasons, and the owner only sees
   "the icon did not come":
     * OneDrive redirects the Desktop folder, so a shortcut written to
       %USERPROFILE%\Desktop sits in a folder nobody looks at;
     * a company profile can point the shell at yet another folder;
     * `shell.writeShortcutLink` can fail silently for the current user.

   This module therefore writes the shortcut into every Desktop folder that
   exists on the machine (deduplicated), verifies that the file really appeared,
   and can fall back to PowerShell + WScript.Shell, which is the same mechanism
   Explorer itself uses. A test runs all of it against real temporary folders.  */
const path = require('node:path');

const NAME = 'Top In Tech License Generator';
const REASONS = {
  portable: 'The portable copy does not add a desktop icon.',
  exists: 'The desktop icon is already there.',
  platform: 'This build only makes Windows shortcuts.',
  refused: 'Windows refused to write the desktop icon.',
  missingDesktop: 'Windows did not report a Desktop folder.',
  failed: 'The desktop icon could not be written.'
};

function uniqueFolders(list) {
  const seen = new Set();
  const folders = [];
  for (const folder of list) {
    if (!folder) continue;
    const clean = path.normalize(String(folder));
    const key = clean.toLowerCase().replace(/[\\/]+$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    folders.push(clean);
  }
  return folders;
}

/**
 * Writes `<folder>/<name>.lnk` into every candidate folder that exists.
 *
 * options:
 *   platform, portable          — skip everything outside Windows / for portable
 *   desktopFolders[]            — candidate Desktop folders, most likely first
 *   name, target                — shortcut text and the exe it points at
 *   fs                          — injectable for tests
 *   writeShortcutLink(file, d)  — shell.writeShortcutLink
 *   powerShell(file, data)      — optional fallback, returns true when it wrote
 *
 * Returns { created, path, paths[], reason, checked[] }.
 */
function ensureDesktopShortcut(options = {}) {
  const {
    platform = process.platform,
    portable = false,
    desktopFolders = [],
    name = NAME,
    target = process.execPath,
    appUserModelId = 'com.topintech.licensegenerator',
    fs,
    writeShortcutLink,
    powerShell
  } = options;

  if (platform !== 'win32') return { created: false, reason: REASONS.platform, paths: [] };
  if (portable) return { created: false, reason: REASONS.portable, paths: [] };
  if (!fs) return { created: false, reason: REASONS.failed, paths: [] };

  const candidates = uniqueFolders(desktopFolders);
  if (!candidates.length) return { created: false, reason: REASONS.missingDesktop, paths: [] };

  const data = {
    target,
    cwd: path.dirname(target),
    description: name,
    icon: target,
    iconIndex: 0,
    appUserModelId
  };

  const written = [];
  const checked = [];
  let refused = false;
  let error = '';

  for (const [index, folder] of candidates.entries()) {
    const file = path.join(folder, `${name}.lnk`);
    checked.push(file);

    let exists = true;
    try { exists = fs.existsSync(folder); } catch { exists = false; }
    if (!exists && index === 0) {
      // The folder Windows itself reported is the real desktop: create it when
      // a fresh profile has none yet. Other candidates that do not exist are
      // simply not desktops the user can see, so they are skipped.
      try { fs.mkdirSync(folder, { recursive: true }); exists = true; } catch { exists = false; }
    }
    if (!exists) continue;

    if (fs.existsSync(file)) {
      written.push(file);
      continue;
    }

    let ok = false;
    try {
      ok = typeof writeShortcutLink === 'function' ? Boolean(writeShortcutLink(file, data)) : false;
    } catch (thrown) {
      error = thrown.message;
      ok = false;
    }

    // Trust the file, not the return value: some Windows builds report success
    // without writing anything, and the opposite has been seen too.
    let verified = false;
    try { verified = fs.existsSync(file); } catch { verified = false; }

    if (!verified && typeof powerShell === 'function') {
      try {
        const fallback = awaitless(powerShell, file, data);
        if (fallback) {
          try { verified = fs.existsSync(file); } catch { verified = false; }
        }
      } catch (thrown) {
        error = thrown.message;
      }
    }

    if (verified) written.push(file);
    else if (!ok) refused = true;
  }

  if (written.length) {
    return {
      created: true,
      allExisted: checked.every(file => fs.existsSync(file)),
      path: written[0],
      paths: written,
      checked
    };
  }
  return {
    created: false,
    reason: refused ? (error || REASONS.refused) : (error || REASONS.failed),
    paths: [],
    checked
  };
}

// The PowerShell fallback is synchronous in the main process; this helper keeps
// the module free of Electron and of async plumbing in the tests.
function awaitless(powerShell, file, data) {
  return powerShell(file, data);
}

module.exports = { ensureDesktopShortcut, uniqueFolders, REASONS, NAME };
