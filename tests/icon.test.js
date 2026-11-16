'use strict';
// The Pharmacy logo is the only application icon: the window, the installed
// exe, the setup/uninstaller, the shortcuts and the taskbar all take it from
// build/icon.ico. These tests fail loudly if the Electron default icon could
// ever come back (for example by re-disabling executable resource editing).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function readIco(file) {
  const ico = fs.readFileSync(path.join(root, file));
  assert.equal(ico.readUInt16LE(0), 0, 'reserved field');
  assert.equal(ico.readUInt16LE(2), 1, 'type 1 = icon');
  const count = ico.readUInt16LE(4);
  const frames = [];
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16;
    const size = ico[entry] || 256;
    frames.push({
      size,
      bytes: ico.readUInt32LE(entry + 8),
      offset: ico.readUInt32LE(entry + 12),
      bits: ico.readUInt16LE(entry + 6),
    });
  }
  return { ico, frames };
}

test('the icon file holds every Windows resolution the logo needs', () => {
  const { ico, frames } = readIco('build/icon.ico');
  const sizes = frames.map(frame => frame.size);
  for (const size of [16, 32, 48, 256]) assert.ok(sizes.includes(size), `missing the ${size}x${size} frame`);
  for (const frame of frames) {
    assert.equal(frame.bits, 32, `${frame.size}px must keep the full colour depth`);
    assert.ok(frame.offset + frame.bytes <= ico.length, `${frame.size}px frame points outside the file`);
  }
});

test('every frame of the icon is drawn from the uploaded logo, not a placeholder', () => {
  const { ico, frames } = readIco('build/icon.ico');
  const coloured = frames.filter(frame => {
    const start = frame.offset + 40;
    let hits = 0;
    for (let pixel = 0; pixel < frame.size * frame.size; pixel += 1) {
      const blue = ico[start + pixel * 4];
      const green = ico[start + pixel * 4 + 1];
      const red = ico[start + pixel * 4 + 2];
      // The logo's greens (#0f8a3c-ish), navy cross and orange capsule.
      if ((green > red + 30 && green > blue + 30) || (blue > red + 40 && blue > 60)
        || (red > green + 60 && red > blue + 60)) hits += 1;
    }
    return hits > frame.size * frame.size * 0.05;
  });
  assert.equal(coloured.length, frames.length, 'every frame carries the pharmacy colours');

  const png = fs.readFileSync(path.join(root, 'build/icon.png'));
  assert.equal(png.slice(0, 8).toString('hex'), '89504e470d0a1a0a', 'build/icon.png is a PNG');
  assert.equal(png.readUInt32BE(16), 512);
  assert.equal(png.readUInt32BE(20), 512);
});

test('the window, the setup, the uninstaller and the shortcuts all use that icon', () => {
  assert.equal(pkg.build.win.icon, 'build/icon.ico');
  assert.equal(pkg.build.nsis.installerIcon, 'build/icon.ico');
  assert.equal(pkg.build.nsis.uninstallerIcon, 'build/icon.ico');
  assert.equal(pkg.build.nsis.installerHeaderIcon, 'build/icon.ico');
  assert.equal(pkg.build.nsis.createDesktopShortcut, true);
  assert.equal(pkg.build.nsis.createStartMenuShortcut, true);

  // Electron stamps the icon into the exe only while resource editing is on.
  // `signAndEditExecutable: false` would leave the default Electron icon.
  assert.notEqual(pkg.build.win.signAndEditExecutable, false, 'resource editing must stay enabled for the icon');
  assert.equal(pkg.build.win.signExecutable, false, 'signing is skipped, nothing else');

  // The window icon is read from build/icon.png at runtime, so it has to ship.
  assert.ok(pkg.build.files.includes('build/icon.png'), 'the packaged app must contain build/icon.png');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  assert.match(main, /icon:path\.join\(__dirname,'build','icon\.png'\)/);
});
