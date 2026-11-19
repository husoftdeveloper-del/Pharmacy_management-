'use strict';
/* Checks the payload that the Windows setup installs.

   The installed application is one `app.asar`, built from the "files" list in
   package.json. Anything that list forgets is missing only after installation:
   `npm start`, `npm test` and the Electron smoke test all read the source tree,
   so a release once shipped without `license.js` and every customer saw

       A JavaScript error occurred in the main process
       Error: Cannot find module './license'

   before the window ever appeared. This script opens the real asar and compares
   it with the modules the application loads.

   Usage:
       node scripts/payload-check.js release/win-unpacked/resources/app.asar

   Exit code 0 when every module is inside, 1 (with the missing names) when not.
   The asar header is read directly: no dependency, no npx, no network. */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

// The header is: uint32 "4", uint32 header size, uint32 padding, uint32 JSON
// length, then the JSON itself.
function readAsarHeader(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const sizeBuffer = Buffer.alloc(16);
    fs.readSync(fd, sizeBuffer, 0, 16, 0);
    const jsonLength = sizeBuffer.readUInt32LE(12);
    if (jsonLength <= 0 || jsonLength > 64 * 1024 * 1024) {
      throw new Error(`the header length is ${jsonLength}, so this is not an asar file`);
    }
    const json = Buffer.alloc(jsonLength);
    fs.readSync(fd, json, 0, jsonLength, 16);
    return JSON.parse(json.toString('utf8'));
  } finally {
    fs.closeSync(fd);
  }
}

// Every path inside the archive, with forward slashes and a leading slash.
function listPayload(header) {
  const out = [];
  const walk = (node, prefix) => {
    for (const [name, child] of Object.entries(node.files || {})) {
      const full = `${prefix}/${name}`;
      if (child.files) walk(child, full);
      else out.push(full);
    }
  };
  walk(header, '');
  return out;
}

// require('./x') / requireLocal('../y') targets, resolved from the project root.
function localRequires(relative) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  const targets = [];
  for (const match of text.matchAll(/(?:requireLocal|require)\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
    const resolved = path.relative(root, path.resolve(root, path.dirname(relative), match[1]));
    const target = resolved.split(path.sep).join('/');
    targets.push(/\.(js|cjs|json)$/.test(target) ? target : `${target}.js`);
  }
  return targets;
}

function sources() {
  const list = ['main.js', 'preload.js'];
  for (const folder of ['database', 'src/scripts']) {
    const full = path.join(root, folder);
    if (!fs.existsSync(full)) continue;
    for (const name of fs.readdirSync(full)) {
      if (name.endsWith('.js')) list.push(`${folder}/${name}`);
    }
  }
  return list;
}

function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('usage: node scripts/payload-check.js <app.asar>');
    process.exit(2);
  }
  if (!fs.existsSync(target)) {
    console.error(`FAIL  ${target} does not exist: the build produced no installed payload`);
    process.exit(1);
  }

  const payload = new Set(listPayload(readAsarHeader(target)));
  console.log(`payload: ${target}`);
  console.log(`entries: ${payload.size}`);

  const required = new Set(['/main.js', '/preload.js', '/license.js', '/package.json']);
  for (const file of sources()) {
    required.add(`/${file}`);
    for (const dependency of localRequires(file)) required.add(`/${dependency}`);
  }
  // The renderer is loaded through the pharmacy:// protocol, not by require, so
  // the entry page is listed by hand: it is the file the window opens first.
  required.add('/src/pages/index.html');

  const missing = [...required].filter(file => !payload.has(file)).sort();
  for (const file of missing) console.log(`FAIL  ${file} is loaded at runtime but is not in the payload`);

  if (missing.length) {
    console.log(`${missing.length} file(s) missing. Add them to "build"."files" in package.json.`);
    process.exit(1);
  }
  console.log(`ok    ${required.size} required files are inside the payload`);
  process.exit(0);
}

if (require.main === module) main();

module.exports = { readAsarHeader, listPayload };
