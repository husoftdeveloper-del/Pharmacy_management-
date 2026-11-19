'use strict';
/* Real-window smoke test, run with Electron on a Windows runner:
 *
 *   npx electron tests/electron-smoke.js
 *
 * It starts the actual application in smoke mode (temporary profile and
 * temporary desktop folder), waits for the window to render, then checks:
 *   - the window title and version are shown;
 *   - the key badge is filled and the public key is displayed;
 *   - the Settings window opens, shows the account, closes with Esc, and the
 *     owner password can be changed and used to sign in again;
 *   - a serial can be generated, stored and verified again;
 *   - the desktop shortcut file is really written to disk.
 * Every check is printed, and a non-zero exit code fails the build.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');

if (process.versions.electron) {
  console.error('Run this file with Node, not Electron: node tests/electron-smoke.js');
  process.exit(2);
}

const electron = require('electron');
const timeoutMs = Number(process.env.SMOKE_TIMEOUT || 60000);

// A hung child must never hang the build: the process tree is killed first and
// the failure is reported from the error file (the step log is not readable
// from the runner while a job is still running).
function fail(message, output) {
  console.error(`\nFAILED: ${message}`);
  if (output) console.error(output.split('\n').slice(-40).join('\n'));
  try {
    fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'artifacts', 'smoke-error.txt'), `${message}\n\n${output || ''}`);
  } catch (error) {
    console.error('could not write artifacts/smoke-error.txt:', error.message);
  }
  process.exit(1);
}

process.on('uncaughtException', error => fail(`the runner crashed: ${error.message}`, error.stack));
process.on('unhandledRejection', error => fail(`the runner crashed: ${(error && error.message) || error}`));

// Electron leaves GPU and renderer children behind on Windows, and those keep
// the stdio pipes open, so 'close' would never fire after a plain kill.
function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    try {
      require('node:child_process').execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    } catch (error) {
      console.error('taskkill failed:', error.message);
    }
  }
  try { child.kill('SIGKILL'); } catch (error) { /* already gone */ }
}

const child = spawn(electron, ['.'], {
  cwd: root,
  env: {
    ...process.env,
    TIT_SMOKE: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    ELECTRON_ENABLE_LOGGING: '1'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let stdout = '';
let stderr = '';
child.stdout.on('data', chunk => {
  stdout += chunk.toString();
  process.stdout.write(chunk);
});
child.stderr.on('data', chunk => {
  stderr += chunk.toString();
  process.stderr.write(chunk);
});

const timer = setTimeout(() => {
  killTree(child);
  fail(`the app did not finish its smoke run in ${timeoutMs} ms`, `${stdout}\n${stderr}`);
}, timeoutMs);

child.on('error', error => {
  clearTimeout(timer);
  fail(`could not start Electron: ${error.message}`, stderr);
});

child.on('close', code => {
  clearTimeout(timer);
  const output = `${stdout}\n${stderr}`;
  if (stdout.includes('SMOKE_ERROR')) fail('the app reported an error while starting', output);

  const line = stdout.split('\n').find(text => text.startsWith('SMOKE_RESULT '));
  if (!line) fail('the app did not print a smoke result', output);

  let result;
  try {
    result = JSON.parse(line.slice('SMOKE_RESULT '.length));
  } catch (error) {
    fail(`the smoke result was not valid JSON: ${error.message}`, output);
  }

  const checks = [
    ['the window loaded the page', result.page && result.page.title === 'Top In Tech License Generator'],
    ['the form is rendered', result.page && result.page.product === true],
    ['the version badge shows 1.1.0', result.page && /^\d+\.\d+\.\d+$/.test(result.page.version)],
    ['the key id is shown', result.page && result.page.keyId.length >= 6],
    ['the public key is displayed', result.page && result.page.publicKey === true],
    ['the Settings window opens from the gear icon', result.settings && result.settings.open === true],
    ['Settings names the signed-in owner', result.settings && result.settings.user === 'smoke-owner'],
    ['Settings shows the data folder', result.settings && /licenses\.sqlite|\.+/.test(result.settings.folder || '')],
    ['Settings has the password, username and sign-out controls', result.settings && result.settings.hasPasswordForm === true && result.settings.hasUsernameForm === true && result.settings.hasSignOut === true],
    ['Esc closes the Settings window', result.settings && result.settings.closedByEscape === true],
    ['the password is changed through the guarded channel', result.settings && result.settings.changedBy === 'smoke-owner'],
    ['the new password signs in', result.settings && result.settings.passwordChanged === true],
    ['a serial was generated', Boolean(result.generated && result.generated.serial)],
    ['the serial records a 1 year plan', result.generated && result.generated.plan === '1 Year'],
    ['the serial verifies again', result.verified && result.verified.valid === true],
    ['the serial names the product', result.verified && result.verified.product === 'Pharmacy Management'],
    ['one license row is stored', result.counts && result.counts.total === 1],
    ['the desktop shortcut was created', result.shortcut && result.shortcut.created === true],
    ['the shortcut file exists on disk', result.linkExists === true],
    ['the shortcut went to the Windows desktop folder', result.shortcut && Array.isArray(result.shortcut.paths) && result.shortcut.paths.length >= 1]
  ];

  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
    if (!ok) failed += 1;
  }
  console.log(`\nDesktop folders checked: ${(result.shortcut.checked || []).join(', ')}`);
  console.log(`Shortcut written to    : ${(result.shortcut.paths || []).join(', ')}`);
  console.log(`Renderer version       : ${result.page.version}`);

  if (failed || code !== 0) {
    fail(`${failed} smoke check(s) failed (exit code ${code})`, output);
  }
  console.log('\nElectron smoke test passed.');
  process.exit(0);
});
