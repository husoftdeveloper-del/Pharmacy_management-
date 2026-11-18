'use strict';
// Employees page: the pencil must EDIT the row it belongs to (not create a
// second employee) and the trash icon must remove that employee while keeping
// the salary and advance history that already went through the books.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../database/database');
const { PharmacyService } = require('../database/service');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'src/pages/employees.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src/components/ui.js'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'src/scripts/i18n.js'), 'utf8');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-employees-'));
  const db = openDatabase(directory), s = new PharmacyService(db);
  const setup = s.setup({ username: 'admin', name: 'Administrator', password: 'CorrectHorse42!', pharmacyName: 'Test Pharmacy' });
  const admin = s.get('SELECT * FROM users WHERE id=?', setup.user.id);
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  s.register(admin, 'open', { opening: 1000 });
  return { s, admin };
}

test('editing an employee updates the same row instead of adding a duplicate', (t) => {
  const { s, admin } = fixture(t);
  const created = s.saveEntity(admin, 'staff', { name: 'Ali', position: 'Pharmacist', phone: '0700', salary: 500, hired_on: '2025-01-05', active: 1 });
  assert.equal(s.employeeBook(admin).rows.length, 1);

  // This is exactly the payload the pencil now sends: the id travels inside
  // the record, which is the object main.js forwards to saveEntity().
  const saved = s.saveEntity(admin, 'staff', { name: 'Ali Ahmad', position: 'Senior Pharmacist', phone: '0701', salary: 650, hired_on: '2025-01-05', active: 1, id: created.id });
  assert.equal(saved.id, created.id, 'the edit keeps the original id');

  const book = s.employeeBook(admin);
  assert.equal(book.rows.length, 1, 'no duplicate employee row');
  assert.equal(book.rows[0].name, 'Ali Ahmad');
  assert.equal(book.rows[0].salary, 650);
  assert.equal(book.totals.payroll, 650);
  assert.equal(book.totals.active, 1);
});

test('removing an employee hides the row from the payroll but keeps paid history', (t) => {
  const { s, admin } = fixture(t);
  const ali = s.saveEntity(admin, 'staff', { name: 'Ali', position: 'Pharmacist', salary: 500, active: 1 });
  s.saveEntity(admin, 'staff', { name: 'Sara', position: 'Cashier', salary: 300, active: 1 });
  s.advance(admin, { staffId: ali.id, amount: 100, method: 'cash', note: 'Travel' });
  s.salary(admin, { staffId: ali.id, month: '2030-01', method: 'cash' });

  // The trash icon sends the whole record back with active = 0.
  s.saveEntity(admin, 'staff', { id: ali.id, name: 'Ali', position: 'Pharmacist', salary: 500, phone: '', hired_on: '', active: 0 });

  const book = s.employeeBook(admin);
  assert.equal(book.rows.length, 2, 'the employee stays in the book as inactive');
  assert.equal(book.rows.find(row => row.id === ali.id).active, 0);
  assert.equal(book.totals.active, 1, 'only one active employee left');
  assert.equal(book.totals.payroll, 300, 'payroll excludes the removed employee');
  assert.equal(s.get('SELECT COUNT(*) AS n FROM salaries WHERE staff_id=?', ali.id).n, 1, 'salary history survives');
  assert.equal(s.get('SELECT COUNT(*) AS n FROM advances WHERE staff_id=?', ali.id).n, 1, 'advance history survives');
});

test('the page sends the edit id inside the record and offers a delete icon', () => {
  // Regression guard: `{entity,id,record}` lost the id (main.js forwards only
  // p.record) and silently created a duplicate employee on every save.
  assert.doesNotMatch(page, /api\('save',\{entity:'staff',id:/, 'the id must not sit beside the record');
  assert.match(page, /api\('save',\{entity:'staff',record:\{\.\.\.data,id:record\?\.id\?\?undefined/, 'edit payload keeps the id');

  // Row actions: a pencil opens the edit form for that row, a trash icon
  // removes it, both wired per rendered row.
  assert.match(page, /data-edit="\$\{row\.id\}"[^>]*>\$\{icon\('pencil'/, 'edit is a pencil icon');
  assert.match(page, /data-remove="\$\{row\.id\}"[^>]*>\$\{icon\('trash'/, 'remove is a trash icon');
  assert.match(page, /querySelectorAll\('\[data-edit\]'\)[^\n]*openEmployee\(/, 'the pencil opens that employee');
  assert.match(page, /querySelectorAll\('\[data-remove\]'\)[^\n]*removeEmployee\(/, 'the trash icon removes that employee');

  // A delete asks first, reports the result and refreshes the table.
  assert.match(page, /const ok=await confirmAction\(/, 'removal asks for confirmation');
  assert.match(page, /if\(!ok\)return;/, 'cancelling leaves the employee alone');
  assert.match(page, /toast\(t\('employeeRemoved'\)\);\s*\n\s*await load\(\);/, 'the table is refreshed and a toast is shown');

  // The icons exist and the styles keep them subtle + touch friendly.
  assert.match(ui, /pencil:'/);
  assert.match(ui, /trash:'/);
  const css = fs.readFileSync(path.join(root, 'src/styles/employees.css'), 'utf8');
  assert.match(css, /\.row-icon\.danger:hover/);
  assert.match(css, /@media\(hover:none\)\{\.row-icon\{width:36px;height:36px\}\}/);
});

test('the new employee strings exist in English, Pashto and Dari', () => {
  for (const key of ['removeEmployee', 'removeEmployeeConfirm', 'employeeRemoved']) {
    const found = i18n.match(new RegExp(`${key}:'`, 'g')) || [];
    assert.equal(found.length, 3, `${key} must be translated in all three languages`);
  }
});
