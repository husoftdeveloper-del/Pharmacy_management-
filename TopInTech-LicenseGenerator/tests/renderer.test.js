'use strict';
/* Runs the real renderer script (src/scripts/app.js) against a tiny DOM stub
   and a fake preload bridge. Electron cannot start inside a headless test
   runner, so this is the closest thing to opening the window: it proves the
   page wiring, the table rendering, generation, copying, filtering, status
   changes and error toasts all work with the payloads main.js sends.        */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'src/scripts/app.js'), 'utf8');

class Element {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this.dataset = {};
    this.className = '';
    this.value = '';
    this.title = '';
    this.placeholder = '';
    this.hidden = false;
    this.disabled = false;
    this.selected = false;
    this.scrollTop = 0;
    this._text = '';
  }
  get textContent() { return this._text; }
  set textContent(value) { this._text = String(value); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  dispatch(type, extra = {}) {
    const event = { type, target: this, preventDefault() {}, key: '', ...extra };
    for (const handler of this.listeners.get(type) || []) handler(event);
    return event;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name); }
  focus() { this.focused = true; }
  remove() { this.removed = true; }
}

function buildDocument() {
  const elements = new Map();
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) elements.set(match[1], new Element('div'));
  // A browser select uses its first option as the value until the user picks.
  for (const select of html.matchAll(/<select id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const first = select[2].match(/<option value="([^"]*)"/);
    if (first) elements.get(select[1]).value = first[1];
  }
  const documentListeners = new Map();
  const document = {
    elements,
    body: new Element('body'),
    querySelector(selector) {
      const id = selector.startsWith('#') ? selector.slice(1) : '';
      if (!elements.has(id)) throw new Error(`the renderer asked for ${selector}, which the page does not have`);
      return elements.get(id);
    },
    createElement(tag) { return new Element(tag); },
    addEventListener(type, handler) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(handler);
    },
    dispatch(type) {
      for (const handler of documentListeners.get(type) || []) handler({ type });
    },
    execCommand() { return true; }
  };
  return { document, elements };
}

const LICENSE_ROWS = [
  {
    id: 2, serial: 'TIT1AAAA.BBBB', product: 'Pharmacy Management', plan: 'Y',
    issued_on: '2026-11-15', expires_on: '2027-11-15', key_id: 'KID1234567', status: 'unused',
    assigned_to: '', note: '', created_at: '2026-11-15 08:00:00', updated_at: '2026-11-15 08:00:00',
    planId: '1y', planLabel: '1 Year', formatted: 'TIT1AAAAA-BBBBB.CCCCC-DDDDD', plain: 'TIT1AAAA.BBBB'
  },
  {
    id: 1, serial: 'TIT1CCCC.DDDD', product: 'Clinic Manager', plan: 'L',
    issued_on: '2026-10-01', expires_on: '', key_id: 'KID1234567', status: 'assigned',
    assigned_to: 'Kabul Pharmacy', note: 'paid', created_at: '2026-10-01 09:00:00', updated_at: '2026-10-01 09:00:00',
    planId: 'lifetime', planLabel: 'Lifetime', formatted: 'TIT1CCCCC-DDDDD.EEEEE-FFFFF', plain: 'TIT1CCCC.DDDD'
  }
];

function createApp() {
  const { document, elements } = buildDocument();
  const calls = [];
  const clipboard = [];
  const timers = [];
  // Tests flip this to pretend the desktop icon was missing or portable.
  const shortcut = { result: { created: false, reason: 'exists' } };
  const bridge = {
    call(channel, payload) {
      calls.push({ channel, payload });
      const respond = value => Promise.resolve(value);
      switch (channel) {
        case 'status':
          return respond({
            keyId: 'KID1234567',
            publicKey: '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n',
            folder: 'C:\\Data\\keys', privateKeyFile: 'C:\\Data\\keys\\private.pem',
            publicKeyFile: 'C:\\Data\\keys\\public.pem', createdAt: '2026-11-01T06:30:00.000Z',
            created: '2026-11-01T06:30:00.000Z',
            version: '1.0.0', userData: 'C:\\Data', database: 'C:\\Data\\licenses.sqlite',
            counts: { total: 2, unused: 1, assigned: 1, used: 0 }
          });
        case 'licenses':
          return respond({ licenses: LICENSE_ROWS, stats: { total: 2, unused: 1, assigned: 1, used: 0 } });
        case 'generate':
          return respond({
            license: {
              ...LICENSE_ROWS[0], id: 3, product: payload.product, plan: 'Y', status: 'unused',
              issued_on: '2026-11-15', expires_on: '2027-11-15',
              planLabel: '1 Year', formatted: 'TIT1NEWKE-Y1234.ABCDE-FGHJK'
            },
            counts: { total: 3, unused: 2, assigned: 1, used: 0 },
            payload: {}
          });
        case 'verify':
          return respond({ valid: true, reason: '', product: payload.serial.includes('BAD') ? '' : 'Pharmacy Management', plan: '1 Year', issued: '2026-11-15', expires: '2027-11-15' });
        case 'setStatus': {
          assert.equal(payload.status, 'used');
          return respond({ license: { ...LICENSE_ROWS[0], status: 'used' }, counts: {} });
        }
        case 'removeLicense':
          return Promise.reject(new Error('A used license cannot be deleted.'));
        case 'export':
          return respond({ path: 'C:\\Exports\\licenses.csv', count: 2 });
        case 'backupKeys':
          return respond({ path: 'C:\\Backups\\keys' });
        case 'createShortcut':
          return respond(shortcut.result);
        default:
          return respond({});
      }
    }
  };

  const sandbox = {
    window: { generator: bridge },
    document,
    navigator: { clipboard: { writeText: text => { clipboard.push(text); return Promise.resolve(); } } },
    console,
    setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; },
    clearTimeout: () => {},
    __result: undefined
  };
  vm.createContext(sandbox);
  vm.runInContext(rendererSource, sandbox, { filename: 'src/scripts/app.js' });

  const settle = async () => {
    for (let i = 0; i < 6; i += 1) await new Promise(resolve => setImmediate(resolve));
  };

  return { document, elements, calls, clipboard, timers, sandbox, settle, shortcut };
}

test('the renderer boots, fills the key badge, paths and statistics', async () => {
  const app = createApp();
  app.document.dispatch('DOMContentLoaded');
  await app.settle();
  assert.equal(app.elements.get('key-id').textContent, 'KID1234567');
  assert.equal(app.elements.get('app-version').textContent, '1.0.0');
  assert.match(app.elements.get('paths').textContent, /Data: C:\\Data/);
  assert.match(app.elements.get('public-key').value, /BEGIN PUBLIC KEY/);
  assert.match(app.elements.get('key-note').textContent, /Created 2026-11-01/);
  assert.equal(app.elements.get('stat-total').textContent, '2');
  assert.equal(app.elements.get('stat-unused').textContent, '1');
  assert.equal(app.elements.get('stat-assigned').textContent, '1');
  assert.equal(app.elements.get('stat-used').textContent, '0');
  assert.equal(app.elements.get('product').focused, true);
});

test('the table shows one row per license with status, plan and customer', async () => {
  const app = createApp();
  app.document.dispatch('DOMContentLoaded');
  await app.settle();
  const rows = app.elements.get('license-rows').children;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].children.length, 8, 'each row has eight cells');
  // Serial cell holds the grouped key and a copy button.
  assert.equal(rows[0].children[0].children[0].children[0].textContent, LICENSE_ROWS[0].formatted);
  // Duration tag, expiry and status select.
  assert.equal(rows[0].children[2].children[0].textContent, '1 Year');
  assert.equal(rows[0].children[4].textContent, '2027-11-15');
  assert.equal(rows[1].children[4].textContent, 'Never');
  assert.equal(rows[0].children[5].children[0].className, 'status-select');
  assert.equal(rows[1].children[5].children[0].className, 'status-select assigned');
  assert.equal(rows[1].children[6].children[0].value, 'Kabul Pharmacy');
  assert.equal(app.elements.get('empty-state').hidden, true);
  // Products already issued become suggestions for the next key.
  const suggestions = app.elements.get('product-list').children.map(option => option.value);
  assert.equal(JSON.stringify(suggestions), JSON.stringify(['Pharmacy Management', 'Clinic Manager']));
});

test('the customer field is empty-with-placeholder and the row actions are present', async () => {
  const app = createApp();
  app.document.dispatch('DOMContentLoaded');
  await app.settle();
  const first = app.elements.get('license-rows').children[0];
  assert.equal(first.children[6].children[0].value, '');
  assert.equal(first.children[6].children[0].placeholder, 'Unassigned');
  assert.equal(first.children[7].children[0].children.length, 3, 'copy, save and delete');
});

test('generating a license fills the result panel and clears the note', async () => {
  const app = createApp();
  app.document.dispatch('DOMContentLoaded');
  await app.settle();
  app.elements.get('product').value = '  Pharmacy Management  ';
  app.elements.get('plan').value = '1y';
  app.elements.get('assigned-to').value = 'Kabul Pharmacy';
  app.elements.get('note').value = 'invoice 42';
  app.elements.get('generate-form').dispatch('submit');
  await app.settle();

  const generate = app.calls.find(entry => entry.channel === 'generate');
  // The payload object is built inside the vm realm, so compare its JSON.
  assert.equal(JSON.stringify(generate.payload),
    JSON.stringify({ product: 'Pharmacy Management', plan: '1y', assignedTo: 'Kabul Pharmacy', note: 'invoice 42' }));
  assert.equal(app.elements.get('result').hidden, false);
  assert.equal(app.elements.get('result-serial').value, 'TIT1NEWKE-Y1234.ABCDE-FGHJK');
  assert.match(app.elements.get('result-meta').textContent, /Pharmacy Management · 1 Year · expires 2027-11-15/);
  assert.equal(app.elements.get('note').value, '');
  assert.equal(app.elements.get('generate-error').textContent, '');
});

test('a product name shorter than two characters is stopped before any IPC call', async () => {
  const app = createApp();
  app.document.dispatch('DOMContentLoaded');
  await app.settle();
  app.elements.get('product').value = 'x';
  app.elements.get('generate-form').dispatch('submit');
  await app.settle();
  assert.equal(app.calls.some(entry => entry.channel === 'generate'), false);
  assert.match(app.elements.get('generate-error').textContent, /product name/);
  assert.equal(app.elements.get('product').focused, true);
});

test('copy buttons put the grouped and the bare serial on the clipboard', async () => {
  const app = createApp();
  app.document.dispatch('DOMContentLoaded');
  await app.settle();
  app.elements.get('result').hidden = false;
  app.elements.get('result-serial').value = 'TIT1AAAAA-BBBBB.CCCCC';
  app.elements.get('copy-serial').dispatch('click');
  app.elements.get('copy-plain').dispatch('click');
  await app.settle();
  assert.equal(JSON.stringify(app.clipboard), JSON.stringify(['TIT1AAAAA-BBBBB.CCCCC', 'TIT1AAAAABBBBBCCCCC']));
});

test('search and the status filter narrow the table without touching the database', async () => {
  const app = createApp();
  app.document.dispatch('DOMContentLoaded');
  await app.settle();
  const before = app.calls.length;

  app.elements.get('search').value = 'clinic';
  app.elements.get('search').dispatch('input');
  assert.equal(app.elements.get('license-rows').children.length, 1);
  assert.match(app.elements.get('license-rows').children[0].children[1].textContent, /Clinic Manager/);

  app.elements.get('search').value = 'kabul';
  app.elements.get('search').dispatch('input');
  assert.equal(app.elements.get('license-rows').children.length, 1, 'customer names are searchable');

  app.elements.get('search').value = 'zzz-no-match';
  app.elements.get('search').dispatch('input');
  assert.equal(app.elements.get('license-rows').children.length, 0);
  assert.equal(app.elements.get('empty-state').hidden, false);

  app.elements.get('search').value = '';
  app.elements.get('search').dispatch('input');
  app.elements.get('status-filter').value = 'unused';
  app.elements.get('status-filter').dispatch('change');
  assert.equal(app.elements.get('license-rows').children.length, 1);
  assert.equal(app.calls.length, before, 'filtering happens in the window');
});

test('changing a status select saves it and refreshes the list', async () => {
  const app = createApp();
  app.document.dispatch('DOMContentLoaded');
  await app.settle();
  const select = app.elements.get('license-rows').children[0].children[5].children[0];
  select.value = 'used';
  select.dispatch('change');
  await app.settle();
  const call = app.calls.find(entry => entry.channel === 'setStatus');
  assert.equal(JSON.stringify(call.payload), JSON.stringify({ id: 2, status: 'used' }));
  const licenses = app.calls.filter(entry => entry.channel === 'licenses');
  assert.ok(licenses.length >= 2, 'the list is reloaded after the change');
});

test('a refused delete shows a readable error toast and keeps the row', async () => {
  const app = createApp();
  app.document.dispatch('DOMContentLoaded');
  await app.settle();
  const deleteButton = app.elements.get('license-rows').children[0].children[7].children[0].children[2];
  deleteButton.dispatch('click');
  await app.settle();
  const toasts = app.elements.get('toasts').children;
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].className, 'toast error');
  assert.match(toasts[0].children[1].textContent, /used license cannot be deleted/);
  assert.equal(app.elements.get('license-rows').children.length, 2);
});

test('verifying a serial reports it as genuine, and a damaged one as invalid', async () => {
  const app = createApp();
  app.document.dispatch('DOMContentLoaded');
  await app.settle();
  app.elements.get('verify-input').value = 'TIT1AAAAA-BBBBB.CCCCC';
  app.elements.get('verify-input').dispatch('keydown', { key: 'Enter' });
  await app.settle();
  const out = app.elements.get('verify-out');
  assert.equal(out.className, 'verify-out good');
  assert.match(out.textContent, /Genuine · Pharmacy Management · 1 Year · expires 2027-11-15/);

  app.elements.get('verify-input').value = '';
  app.elements.get('verify-button').dispatch('click');
  assert.equal(out.className, 'verify-out bad');
  assert.match(out.textContent, /Paste a serial key first/);
});

test('export and backup report the saved path in a toast', async () => {
  const app = createApp();
  app.document.dispatch('DOMContentLoaded');
  await app.settle();
  app.elements.get('export-csv').dispatch('click');
  app.elements.get('backup-keys').dispatch('click');
  await app.settle();
  const messages = app.elements.get('toasts').children.map(node => node.children[1].textContent);
  assert.ok(messages.some(text => /Exported 2 license\(s\) to C:\\Exports\\licenses\.csv/.test(text)));
  assert.ok(messages.some(text => /Keys backed up to C:\\Backups\\keys/.test(text)));
  assert.ok(app.calls.some(entry => entry.channel === 'export' && entry.payload.format === 'csv'));
});

test('the app checks the desktop icon on start-up and reports one it had to create', async () => {
  const app = createApp();
  app.shortcut.result = { created: true, path: 'C:\\Users\\Owner\\OneDrive\\Desktop\\Top In Tech License Generator.lnk' };
  app.document.dispatch('DOMContentLoaded');
  await app.settle();
  const call = app.calls.find(entry => entry.channel === 'createShortcut');
  assert.ok(call, 'the window must ask main for the shortcut on start-up');
  const messages = app.elements.get('toasts').children.map(node => node.children[1].textContent);
  assert.ok(messages.includes('Desktop icon created'), `toasts were ${JSON.stringify(messages)}`);
});

test('an icon that is already there produces no toast', async () => {
  const app = createApp();
  app.shortcut.result = { created: false, reason: 'exists' };
  app.document.dispatch('DOMContentLoaded');
  await app.settle();
  assert.equal(app.elements.get('toasts').children.length, 0);
});

test('the Desktop shortcut button explains what happened', async () => {
  const app = createApp();
  app.document.dispatch('DOMContentLoaded');
  await app.settle();

  app.shortcut.result = { created: true, path: 'C:\\Users\\Owner\\Desktop\\Top In Tech License Generator.lnk' };
  app.elements.get('desktop-shortcut').dispatch('click');
  await app.settle();

  app.shortcut.result = { created: false, reason: 'exists' };
  app.elements.get('desktop-shortcut').dispatch('click');
  await app.settle();

  app.shortcut.result = { created: false, reason: 'portable' };
  app.elements.get('desktop-shortcut').dispatch('click');
  await app.settle();

  app.shortcut.result = { created: false, reason: 'Windows refused to write the desktop icon.' };
  app.elements.get('desktop-shortcut').dispatch('click');
  await app.settle();

  const messages = app.elements.get('toasts').children.map(node => node.children[1].textContent);
  assert.ok(messages.some(text => text.startsWith('Desktop icon created in C:\\Users\\Owner\\Desktop')));
  assert.ok(messages.includes('The desktop icon is already there'));
  assert.ok(messages.includes('The portable copy does not add a desktop icon'));
  assert.ok(messages.includes('Windows refused to write the desktop icon.'));
});
