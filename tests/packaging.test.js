'use strict';
// What electron-builder actually puts inside the installed application.
//
// The installed app is a single app.asar built from the "files" list in
// package.json. A module that main.js requires but the list forgets is only
// missing after installation: `npm start` and the Electron smoke test read the
// source tree, so neither notices. That is exactly how a release shipped with
// license.js left out and every customer saw
//
//     A JavaScript error occurred in the main process
//     Error: Cannot find module './license'
//
// on launch. These tests make the "files" list and the require() graph agree.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const includes = pkg.build.files.filter(pattern => !pattern.startsWith('!'));
const excludes = pkg.build.files.filter(pattern => pattern.startsWith('!')).map(pattern => pattern.slice(1));

// "database/**/*" -> every path under database/. Only the shapes this project
// actually uses are implemented, so a new shape fails loudly instead of
// silently matching nothing.
function globToRegExp(pattern) {
  assert.ok(!pattern.includes('?'), `unsupported glob: ${pattern}`);
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*' && pattern[i + 1] === '*') {
      // "**/" may match no folder at all, "**" matches across folders.
      if (pattern[i + 2] === '/') {
        source += '(?:.*/)?';
        i += 2;
      } else {
        source += '.*';
        i += 1;
      }
    } else if (char === '*') {
      source += '[^/]*';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

const isPacked = relative => {
  const file = relative.split(path.sep).join('/');
  if (excludes.some(pattern => globToRegExp(pattern).test(file))) return false;
  return includes.some(pattern => globToRegExp(pattern).test(file));
};

// Every require('./x') and require('../x') in a file, resolved to a path
// relative to the project root.
function localRequires(file) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const found = [];
  // The main process loads its own modules through requireLocal(), which is a
  // require() with a readable failure; both spellings count here.
  for (const match of text.matchAll(/(?:requireLocal|require)\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
    const target = path.relative(root, path.resolve(root, path.dirname(file), match[1])).split(path.sep).join('/');
    found.push(/\.(js|cjs|json)$/.test(target) ? target : `${target}.js`);
  }
  return found;
}

const entryFiles = ['main.js', 'preload.js'];
const sourceFiles = [
  ...entryFiles,
  ...fs.readdirSync(path.join(root, 'database')).filter(name => name.endsWith('.js')).map(name => `database/${name}`),
  ...fs.readdirSync(path.join(root, 'src', 'scripts')).filter(name => name.endsWith('.js')).map(name => `src/scripts/${name}`)
];

test('every module the main process requires is packed into the installer', () => {
  const missing = [];
  for (const file of sourceFiles) {
    if (!isPacked(file)) {
      missing.push(`${file} (the file itself)`);
      continue;
    }
    for (const target of localRequires(file)) {
      if (!isPacked(target)) missing.push(`${target} (required by ${file})`);
    }
  }
  assert.deepEqual(missing, [], `electron-builder would leave these out of the installed app: ${missing.join(', ')}`);
});

test('the licence module that the sign-in gate lives in is packed', () => {
  // The installed app crashed on launch without this one line.
  assert.ok(pkg.build.files.includes('license.js'), 'license.js must be in build.files');
  assert.ok(isPacked('license.js'));
  assert.match(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), /requireLocal\('\.\/license'\)/);
  // Every file the main process opens by name is packed as well.
  for (const file of ['main.js', 'preload.js', 'license.js', 'package.json', 'src/index.html', 'database/schema.sql']) {
    assert.ok(isPacked(file), `${file} must be packed`);
  }
});

test('the installer still leaves the setup executable out of the payload', () => {
  // src/pages/Pharmacy-Setup.exe is committed for the download page; packing it
  // into app.asar would add 100 MB to every installed copy.
  assert.ok(excludes.includes('src/pages/*.exe'));
  assert.equal(isPacked('src/pages/Pharmacy-Setup.exe'), false);
});

test('a missing module shows a sentence, not Electron’s error box', () => {
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  // The require wrapper explains the problem and points at the fix, so an old
  // install can never look like a crash without a reason.
  assert.match(main, /function requireLocal\(/, 'the app loads its own modules through one guarded helper');
  assert.match(main, /requireLocal\('\.\/license'\)/, 'the licence module goes through it');
  assert.match(main, /incomplete|reinstall|run the setup again/i, 'the message tells the customer what to do');
});

test('the payload checker reads a real asar and names a missing module', () => {
  // The checker parses the asar header itself, so this pins the format rather
  // than trusting a reviewer to remember it. A tiny archive is written here in
  // the same layout electron-builder produces.
  const os = require('node:os');
  const { readAsarHeader, listPayload } = require('../scripts/payload-check.js');
  const header = {
    files: {
      'main.js': { size: 4, offset: '0' },
      'src': { files: { 'pages': { files: { 'index.html': { size: 2, offset: '4' } } } } }
    }
  };
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const padding = (4 - (json.length % 4)) % 4;
  const headerSize = 4 + json.length + padding;
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(headerSize, 4);
  prefix.writeUInt32LE(headerSize - 4, 8);
  prefix.writeUInt32LE(json.length, 12);
  const file = path.join(os.tmpdir(), `payload-check-${process.pid}.asar`);
  fs.writeFileSync(file, Buffer.concat([prefix, json, Buffer.alloc(padding), Buffer.from('node'), Buffer.from('{}')]));
  try {
    assert.deepEqual(listPayload(readAsarHeader(file)).sort(), ['/main.js', '/src/pages/index.html']);
  } finally {
    fs.rmSync(file, { force: true });
  }
  // A file that is not an asar is reported, not guessed at.
  fs.writeFileSync(file, 'not an asar');
  try {
    assert.throws(() => readAsarHeader(file));
  } finally {
    fs.rmSync(file, { force: true });
  }
});
