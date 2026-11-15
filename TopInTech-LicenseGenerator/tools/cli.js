#!/usr/bin/env node
'use strict';
/* Command-line side of the generator, for issuing keys from a terminal or a
   script. It uses exactly the same lib modules as the window, so a serial made
   here is identical to one made in the app.

   Usage:
     node tools/cli.js keys                 show (and create) the key pair
     node tools/cli.js new "Product" 1y     issue a serial key
     node tools/cli.js verify <serial>      check a serial key
     node tools/cli.js list                 list saved licenses

   The data folder defaults to the same one the app uses on this platform:
     Windows  %APPDATA%\Top In Tech License Generator
     macOS    ~/Library/Application Support/Top In Tech License Generator
     Linux    ~/.config/Top In Tech License Generator
   Override it with TIT_HOME for tests or a portable install.               */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const keys = require('../lib/keys');
const serial = require('../lib/serial');
const store = require('../lib/database');

const APP_FOLDER = 'Top In Tech License Generator';

function dataFolder() {
  if (process.env.TIT_HOME) return path.resolve(process.env.TIT_HOME);
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), APP_FOLDER);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', APP_FOLDER);
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), APP_FOLDER);
}

function openAll() {
  const folder = dataFolder();
  const keyFolder = path.join(folder, 'keys');
  keys.ensureKeyPair(keyFolder);
  const opened = store.openDatabase(folder);
  return { folder, keyFolder, ...opened };
}

function newId() {
  return require('node:crypto').randomBytes(6).toString('hex').toUpperCase().slice(0, 9);
}

const commands = {
  keys() {
    const { keyFolder } = openAll();
    const info = keys.describe(keyFolder);
    console.log('Key id     :', info.keyId);
    console.log('Private key:', info.privateKeyFile, '(SECRET — never ship this file)');
    console.log('Public key :', info.publicKeyFile, '(safe to embed in customer apps)');
    console.log('Created    :', info.createdAt);
    console.log('\nPublic key:\n' + info.publicKey);
  },

  new(product, plan = 'lifetime', customer = '') {
    if (!product) {
      console.error('Usage: node tools/cli.js new "Product name" [lifetime|1y|6m] ["Customer"]');
      process.exitCode = 1;
      return;
    }
    const id = Object.keys(serial.PLANS).includes(plan) ? plan : (serial.PLAN_BY_KEY[String(plan).toUpperCase()]?.id || 'lifetime');
    const { keyFolder, db } = openAll();
    const kid = keys.describe(keyFolder).keyId;
    const payload = serial.buildPayload({ product, plan: id, licenseId: newId(), kid });
    const key = serial.signPayload(payload, keys.readPrivate(keyFolder));
    const check = serial.verifySerial(key, keys.readPublic(keyFolder));
    if (!check.valid) throw new Error(`The serial did not verify: ${check.reason}`);
    store.insertLicense(db, {
      serial: key,
      product: payload.pr,
      plan: serial.PLANS[id].key,
      issuedOn: payload.i,
      expiresOn: payload.x,
      keyId: kid,
      assignedTo: customer,
      status: customer ? 'assigned' : 'unused'
    });
    console.log(serial.formatSerial(key));
    console.log(`\nProduct : ${payload.pr}`);
    console.log(`Duration: ${serial.PLANS[id].label}`);
    console.log(`Issued  : ${payload.i}`);
    console.log(`Expires : ${payload.x || 'never'}`);
    console.log(`Saved in: ${path.join(dataFolder(), 'licenses.sqlite')}`);
  },

  verify(input) {
    if (!input) {
      console.error('Usage: node tools/cli.js verify "TIT1…"');
      process.exitCode = 1;
      return;
    }
    const { keyFolder } = openAll();
    const result = serial.verifySerial(serial.unformatSerial(input), keys.readPublic(keyFolder));
    if (!result.valid) {
      console.log('NOT VALID:', result.reason);
      process.exitCode = 2;
      return;
    }
    console.log('VALID');
    console.log('Product :', result.payload.pr);
    console.log('Duration:', result.plan.label);
    console.log('Issued  :', result.payload.i);
    console.log('Expires :', result.payload.x || 'never');
  },

  list() {
    const { db } = openAll();
    const rows = store.listLicenses(db, {});
    if (!rows.length) {
      console.log('No licenses saved yet.');
      return;
    }
    for (const row of rows) {
      const plan = Object.values(serial.PLANS).find(item => item.key === row.plan);
      console.log([
        serial.formatSerial(row.serial),
        row.status.padEnd(8),
        (plan ? plan.label : row.plan).padEnd(8),
        row.issued_on,
        row.expires_on || 'never',
        row.product,
        row.assigned_to ? `→ ${row.assigned_to}` : ''
      ].join('  '));
    }
  },

  help() {
    console.log(`Top In Tech License Generator — command line

  node tools/cli.js keys                        show or create the key pair
  node tools/cli.js new "Product" [1y|6m] [who] issue a serial key
  node tools/cli.js verify "TIT1…"              check a serial key
  node tools/cli.js list                        list saved licenses

Data folder: ${dataFolder()}
Set TIT_HOME to use another folder.`);
  }
};

function main(argv) {
  const [command, ...rest] = argv;
  const run = commands[command] || (fs.existsSync(dataFolder()) ? commands.help : commands.help);
  try {
    run(...rest);
  } catch (error) {
    console.error('Error:', error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { dataFolder, commands, APP_FOLDER };
