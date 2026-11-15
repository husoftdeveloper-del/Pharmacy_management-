'use strict';
/* Desktop shortcut creation, kept away from Electron so it can be tested.

   Windows hides the icon created by an installer whenever the Desktop folder
   has been redirected (OneDrive does this on most laptops): setup writes the
   .lnk into the old path, the shell shows the new one, and the user sees no
   icon. The app therefore asks Windows for its *current* desktop folder and
   creates the shortcut itself when it is missing.                          */
const path = require('node:path');

const REASONS = {
  portable: 'The portable copy does not add a desktop icon.',
  exists: 'The desktop icon is already there.',
  platform: 'This build only makes Windows shortcuts.',
  refused: 'Windows refused to write the desktop icon.',
  missingDesktop: 'Windows did not report a Desktop folder.'
};

/**
 * Creates `<desktop>/<name>.lnk` when it is missing.
 * All effects are injectable so a test can run without Electron or Windows.
 */
function ensureDesktopShortcut(options = {}) {
  const {
    platform = process.platform,
    portable = false,
    desktopFolder = '',
    name = 'Top In Tech License Generator',
    target = process.execPath,
    appUserModelId = 'com.topintech.licensegenerator',
    fs,
    writeShortcutLink
  } = options;

  if (platform !== 'win32') return { created: false, reason: REASONS.platform };
  if (portable) return { created: false, reason: REASONS.portable };
  if (!desktopFolder) return { created: false, reason: REASONS.missingDesktop };
  if (!fs || typeof writeShortcutLink !== 'function') {
    return { created: false, reason: REASONS.refused };
  }

  const file = path.join(desktopFolder, `${name}.lnk`);
  try {
    if (fs.existsSync(file)) return { created: false, reason: REASONS.exists, path: file };
    if (!fs.existsSync(desktopFolder)) fs.mkdirSync(desktopFolder, { recursive: true });
    const written = writeShortcutLink(file, {
      target,
      cwd: path.dirname(target),
      description: name,
      icon: target,
      iconIndex: 0,
      appUserModelId
    });
    if (!written) return { created: false, reason: REASONS.refused, path: file };
    return { created: true, path: file };
  } catch (error) {
    return { created: false, reason: error.message, path: file };
  }
}

module.exports = { ensureDesktopShortcut, REASONS };
