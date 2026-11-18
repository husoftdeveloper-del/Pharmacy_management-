'use strict';
// Customers page: the owner walks through the exact case he described —
// one customer buys for 100 and pays 50, buys another 100 on credit (the
// balance must be 150, not 100), then returns goods and the balance drops.
// The four totals (Paid / Credit Sales / Returned / Owed) have to agree with
// the balance after every step, on the Customers page, on the Customer Payments
// balances tab and in the customer's own statement.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../database/database');
const { PharmacyService } = require('../database/service');

const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'src/pages/customers.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-customers-'));
  const db = openDatabase(directory), s = new PharmacyService(db);
  const setup = s.setup({ username: 'admin', name: 'Administrator', password: 'CorrectHorse42!', pharmacyName: 'Test Pharmacy' });
  const admin = s.get('SELECT * FROM users WHERE id=?', setup.user.id);
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  s.register(admin, 'open', { opening: 5000 });
  const supplier = s.saveEntity(admin, 'suppliers', { name: 'Health Supplies', active: 1 }).id;
  const medicine = s.saveEntity(admin, 'medicines', { name: 'Panadol 500mg', sku: 'PAN-500', unit: 'tablet', price: 10, cost: 6, active: 1 }).id;
  s.receivePurchase(admin, { supplierId: supplier, invoiceNo: 'PUR-1', paymentMethod: 'credit', items: [{ medicineId: medicine, batchNo: 'B-1', expiry: '2030-12-31', quantity: 200, cost: 6, locationId: 1 }] });
  const customer = s.saveEntity(admin, 'customers', { name: 'Ahmad Jan', phone: '0700111222', opening_balance: 0, credit_limit: 0, active: 1 }).id;
  return { db, s, admin, medicine, customer };
}

const sell = (s, admin, customer, quantity, extra = {}) =>
  s.sale(admin, { customerId: customer, items: [{ medicineId: extra.medicineId, quantity }], ...extra });

test('100 sale with 50 paid, 100 more on credit, then a return — the balance runs 50 → 150 → 110', (t) => {
  const { s, admin, medicine, customer } = fixture(t);

  const first = s.sale(admin, { customerId: customer, items: [{ medicineId: medicine, quantity: 10 }], paymentMethod: 'cash', accountId: 1, paid: 50 });
  assert.equal(first.total, 100);
  assert.equal(first.paid, 50);

  let book = s.customerBook(admin);
  let row = book.rows.find(r => r.id === customer);
  assert.equal(row.balance, 50, 'the unpaid half of the invoice is owed');
  assert.equal(row.creditSales, 50, 'credit sales count only the part left on account');
  assert.equal(row.paid, 50, 'the 50 handed over at the counter counts as paid');
  assert.equal(row.owed, 50);
  assert.deepEqual(
    { paid: book.totals.paid, creditSales: book.totals.creditSales, returned: book.totals.returned, owed: book.totals.owed },
    { paid: 50, creditSales: 50, returned: 0, owed: 50 }
  );

  const second = s.sale(admin, { customerId: customer, items: [{ medicineId: medicine, quantity: 10 }], paymentMethod: 'credit' });
  assert.equal(second.total, 100);

  book = s.customerBook(admin); row = book.rows.find(r => r.id === customer);
  assert.equal(row.balance, 150, 'a second 100 on credit makes the balance 150');
  assert.equal(row.creditSales, 150);
  assert.equal(row.paid, 50);
  assert.equal(book.totals.owed, 150);

  // Return 4 tablets from the credit invoice: 40 cancels debt (no cash moves).
  const item = s.get('SELECT * FROM sale_items WHERE sale_id=?', second.id);
  const returned = s.returnDocument(admin, 'sale', { documentId: second.id, items: [{ itemId: item.id, quantity: 4, restock: 1 }], reason: 'Damaged pack', method: 'cash' });
  assert.equal(returned.total, 40);
  assert.equal(returned.credit, 40);
  assert.equal(returned.refund, 0);

  book = s.customerBook(admin); row = book.rows.find(r => r.id === customer);
  assert.equal(row.balance, 110, 'the return reduces the balance');
  assert.equal(row.returned, 40);
  assert.equal(row.refunded, 0);
  assert.deepEqual(
    { paid: book.totals.paid, creditSales: book.totals.creditSales, returned: book.totals.returned, owed: book.totals.owed },
    { paid: 50, creditSales: 150, returned: 40, owed: 110 }
  );
  // opening + credit sales - returned - payments = balance
  assert.equal(0 + 150 - 40 - 0, row.balance);

  // The Balances tab of Customer Payments shows the same numbers.
  const board = s.customerAccounts(admin);
  const tab = board.rows.find(r => r.id === customer);
  assert.equal(tab.balance, 110);
  assert.equal(tab.creditSales, 150);
  assert.equal(tab.paid, 50);
  assert.equal(tab.returned, 40);
  assert.deepEqual(board.totals, {
    customers: 1, creditSales: 150, paid: 50, paidAtSale: 50, payments: 0,
    returned: 40, refunded: 0, owed: 110, withDues: 1
  });

  // The statement lists every movement with a running balance.
  const statement = s.customerStatement(admin, { customerId: customer });
  assert.equal(statement.closing, 110);
  assert.equal(statement.totals.creditSales, 150);
  assert.equal(statement.totals.paid, 50);
  assert.equal(statement.totals.returned, 40);
  const saleLines = statement.movements.filter(line => line.kind === 'sale');
  assert.equal(saleLines.length, 2);
  // Each line shows the invoice amount and the money paid against it.
  assert.deepEqual(saleLines.map(line => [line.credit, line.paid, line.balance]), [[100, 50, 50], [100, 0, 150]]);
  const returnLine = statement.movements.find(line => line.kind === 'return');
  assert.equal(returnLine.paid, 40);
  assert.equal(returnLine.balance, 110);
  assert.equal(returnLine.reference, second.invoice);
  // Every line keeps the running balance consistent with the line before it.
  let running = statement.totals.opening;
  for (const line of statement.movements) {
    running = Math.round((running + line.credit - line.paid) * 100) / 100;
    assert.equal(line.balance, running);
  }
});

test('a later payment and a cash refund land in the right totals', (t) => {
  const { s, admin, medicine, customer } = fixture(t);
  s.sale(admin, { customerId: customer, items: [{ medicineId: medicine, quantity: 10 }], paymentMethod: 'credit' });
  // Pay 60 of the 100 later from the Customer Payments screen.
  s.partyPayment(admin, { partyType: 'customer', partyId: customer, amount: 60, method: 'cash', accountId: 1 });
  let row = s.customerBook(admin).rows.find(r => r.id === customer);
  assert.equal(row.balance, 40);
  assert.equal(row.paid, 60);
  assert.equal(row.creditSales, 100);
  assert.ok(row.lastPayment);

  // Clear the rest, then return goods: nothing is owed, so it is refunded in cash.
  s.partyPayment(admin, { partyType: 'customer', partyId: customer, amount: 40, method: 'cash', accountId: 1 });
  const sale = s.get('SELECT * FROM sales WHERE customer_id=?', customer);
  const item = s.get('SELECT * FROM sale_items WHERE sale_id=?', sale.id);
  const back = s.returnDocument(admin, 'sale', { documentId: sale.id, items: [{ itemId: item.id, quantity: 2, restock: 1 }], reason: 'Not needed', method: 'cash', accountId: 1 });
  assert.equal(back.total, 20);
  assert.equal(back.credit, 0, 'nothing left to cancel');
  assert.equal(back.refund, 20, 'the customer gets 20 back in cash');

  row = s.customerBook(admin).rows.find(r => r.id === customer);
  assert.equal(row.balance, 0);
  assert.equal(row.returned, 0, 'a refund never touches the balance');
  assert.equal(row.refunded, 20, 'the refund is tracked separately');
  assert.equal(row.paid, 100);

  const statement = s.customerStatement(admin, { customerId: customer });
  assert.equal(statement.closing, 0);
  const returnLine = statement.movements.find(line => line.kind === 'return');
  assert.equal(returnLine.refund, 20);
  // A refund moves no money against the debt, and the statement ends at zero.
  let running = statement.totals.opening;
  for (const line of statement.movements) {
    running = Math.round((running + line.credit - line.paid) * 100) / 100;
    assert.equal(line.balance, running);
  }
});

test('an opening balance is part of the balance and the statement starts with it', (t) => {
  const { s, admin } = fixture(t);
  const customer = s.saveEntity(admin, 'customers', { name: 'Old Customer', opening_balance: 200, credit_limit: 0, active: 1 }).id;
  const row = s.customerBook(admin).rows.find(r => r.id === customer);
  assert.equal(row.balance, 200);
  assert.equal(row.owed, 200);
  const statement = s.customerStatement(admin, { customerId: customer });
  assert.equal(statement.movements[0].kind, 'opening');
  assert.equal(statement.movements[0].credit, 200);
  assert.equal(statement.closing, 200);
});

test('the Customers page shows the four totals, the statement and its own IPC channel', () => {
  for (const key of ['totalPaid', 'totalCreditSales', 'totalReturned', 'totalOwed']) {
    assert.match(page, new RegExp(`t\\('${key}'\\)`), `${key} is one of the boxes`);
  }
  assert.match(page, /class="stat-grid customer-stats"/);
  assert.match(page, /api\('customerStatement',\{customerId:row\.id\}\)/, 'the statement is read from the server ledger');
  assert.match(page, /data-statement="\$\{row\.id\}"/, 'every row has a statement button');
  assert.match(page, /\['date','type','reference','credit','paid','runningBalance'\]/, 'the ledger shows a running balance');
  assert.match(page, /settleLabel/, 'movement kinds are translated');
  assert.match(preload, /'customerStatement'/, 'preload exposes the statement channel');
  assert.match(main, /c==='customerStatement'\)return service\.customerStatement\(user,p\)/, 'main.js routes the statement channel');
  // The old page computed its own numbers on the client; it must not any more.
  assert.doesNotMatch(page, /invoiceTotal|balance \+/);
});
