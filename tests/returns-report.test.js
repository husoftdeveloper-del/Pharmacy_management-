'use strict';
// Reports: a return must take the whole value out of Revenue but only the
// profit inside those goods out of Gross Profit.
//   10 tablets sold for 100 at a cost of 80  → revenue 100, gross profit 20
//   5 tablets returned (value 50, cost 40)   → revenue  50, gross profit 10
// The same numbers have to appear on the Reports page (reportOverview), in the
// daily trend chart and in the P&L statement (ledgerBook).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../database/database');
const { PharmacyService } = require('../database/service');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-returns-report-'));
  const db = openDatabase(directory), s = new PharmacyService(db);
  const setup = s.setup({ username: 'admin', name: 'Administrator', password: 'CorrectHorse42!', pharmacyName: 'Test Pharmacy' });
  const admin = s.get('SELECT * FROM users WHERE id=?', setup.user.id);
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  s.register(admin, 'open', { opening: 5000 });
  const supplier = s.saveEntity(admin, 'suppliers', { name: 'Health Supplies', active: 1 }).id;
  // 10.00 per tablet, 8.00 cost: ten tablets sell for 100 with 20 profit.
  const medicine = s.saveEntity(admin, 'medicines', { name: 'Amoxil 500mg', sku: 'AMX-500', unit: 'tablet', price: 10, cost: 8, active: 1 }).id;
  s.receivePurchase(admin, { supplierId: supplier, invoiceNo: 'PUR-R1', paymentMethod: 'credit', items: [{ medicineId: medicine, batchNo: 'B-R1', expiry: '2030-12-31', quantity: 50, cost: 8, locationId: 1 }] });
  return { s, admin, medicine };
}

const today = () => new Date().toISOString().slice(0, 10);
const overview = (s, admin) => s.reportOverview(admin, { from: today(), to: today() });
const pl = (s, admin) => s.ledgerBook(admin, { from: today(), to: today() }).statement;

test('a return lowers Revenue by its value and Gross Profit only by its profit', (t) => {
  const { s, admin, medicine } = fixture(t);
  const sale = s.sale(admin, { items: [{ medicineId: medicine, quantity: 10 }], paymentMethod: 'cash', accountId: 1 });

  let report = overview(s, admin);
  assert.equal(sale.total, 100);
  assert.equal(report.totals.revenue, 100, 'the sale is the whole revenue');
  assert.equal(report.totals.cogs, 80, 'cost of the ten tablets sold');
  assert.equal(report.totals.grossProfit, 20, 'profit on the sale');
  assert.equal(report.totals.margin, 20);

  // The customer brings back five tablets. They go back on the shelf.
  const item = s.get('SELECT * FROM sale_items WHERE sale_id=?', sale.id);
  const returned = s.returnDocument(admin, 'sale', { documentId: sale.id, items: [{ itemId: item.id, quantity: 5, restock: 1 }], reason: 'Wrong strength', method: 'cash', accountId: 1 });
  assert.equal(returned.total, 50, 'five tablets are worth 50');
  assert.equal(returned.refund, 50, 'a paid invoice is refunded in cash');

  report = overview(s, admin);
  assert.equal(report.totals.revenue, 50, 'revenue drops by the whole returned value');
  assert.equal(report.totals.returnedValue, 50);
  assert.equal(report.totals.returnedCost, 40, 'the returned tablets cost 40');
  assert.equal(report.totals.cogs, 40, 'only the five tablets kept by the customer stay in COGS');
  assert.equal(report.totals.grossProfit, 10, 'gross profit drops by the 10 profit in the returned goods');
  assert.equal(report.totals.netProfit, 10);
  assert.equal(report.totals.margin, 20, 'the margin of the remaining sale is unchanged');

  // The daily trend adds up to the same headline numbers.
  const sum = key => Math.round(report.trend.reduce((total, day) => total + day[key], 0) * 100) / 100;
  assert.equal(sum('revenue'), report.totals.revenue);
  assert.equal(sum('profit'), report.totals.grossProfit);

  // The P&L statement agrees: revenue 50, cost 80 - 40 returned = 40, profit 10.
  const statement = pl(s, admin);
  assert.equal(statement.salesRevenue, 100);
  assert.equal(statement.saleReturns, 50);
  assert.equal(statement.netRevenue, 50);
  assert.equal(statement.cogs, 80, 'gross cost of everything sold');
  assert.equal(statement.cogsReturned, 40, 'cost of the goods that came back');
  assert.equal(statement.netCogs, 40);
  assert.equal(statement.grossProfit, 10, 'the P&L does not subtract the returned cost twice');
  assert.equal(statement.netProfit, 10);
});

test('a full return leaves no revenue and no profit', (t) => {
  const { s, admin, medicine } = fixture(t);
  const sale = s.sale(admin, { items: [{ medicineId: medicine, quantity: 10 }], paymentMethod: 'cash', accountId: 1 });
  const item = s.get('SELECT * FROM sale_items WHERE sale_id=?', sale.id);
  s.returnDocument(admin, 'sale', { documentId: sale.id, items: [{ itemId: item.id, quantity: 10, restock: 1 }], reason: 'Everything back', method: 'cash', accountId: 1 });

  const report = overview(s, admin);
  assert.equal(report.totals.revenue, 0);
  assert.equal(report.totals.cogs, 0);
  assert.equal(report.totals.grossProfit, 0);
  assert.equal(report.totals.netProfit, 0);
  assert.equal(report.totals.margin, 0);

  const statement = pl(s, admin);
  assert.equal(statement.netRevenue, 0);
  assert.equal(statement.netCogs, 0);
  assert.equal(statement.grossProfit, 0);
});

test('goods returned damaged are not restocked, so their cost stays in the profit', (t) => {
  const { s, admin, medicine } = fixture(t);
  const sale = s.sale(admin, { items: [{ medicineId: medicine, quantity: 10 }], paymentMethod: 'cash', accountId: 1 });
  const item = s.get('SELECT * FROM sale_items WHERE sale_id=?', sale.id);
  // restock = 0: the boxes came back crushed and went in the bin.
  s.returnDocument(admin, 'sale', { documentId: sale.id, items: [{ itemId: item.id, quantity: 5, restock: 0 }], reason: 'Crushed boxes', method: 'cash', accountId: 1 });

  const report = overview(s, admin);
  assert.equal(report.totals.revenue, 50, 'the money still went back to the customer');
  assert.equal(report.totals.returnedCost, 0, 'nothing came back to the shelf');
  assert.equal(report.totals.cogs, 80, 'the cost of the ruined tablets stays in COGS');
  assert.equal(report.totals.grossProfit, -30, 'refunded 50 and lost 40 of stock');

  const statement = pl(s, admin);
  assert.equal(statement.netRevenue, 50);
  assert.equal(statement.cogsReturned, 0);
  assert.equal(statement.netCogs, 80);
  assert.equal(statement.grossProfit, -30, 'the P&L tells the same story');
});

test('the Reports page reads Revenue and Gross Profit from the fixed totals', () => {
  const root = path.resolve(__dirname, '..');
  const page = fs.readFileSync(path.join(root, 'src/pages/reports.js'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'database/service.js'), 'utf8');
  // The page keeps its KPI cards; the numbers behind them come from the service.
  assert.match(page, /totals\.revenue/);
  assert.match(page, /totals\.grossProfit/);
  assert.match(service, /const revenue = round\(Number\(sales\.total\) - Number\(returns\.total\)\)/);
  assert.match(service, /const cogs = round\(Number\(items\.cogs\) - Number\(returnedCost\.cost\)\)/);
  // The returned cost is only removed when the goods went back on the shelf.
  assert.match(service, /WHERE sri\.restock=1 AND date\(r\.date\) BETWEEN/);
  // No double subtraction in the P&L: gross cost comes from the sale lines.
  assert.match(service, /SELECT COALESCE\(SUM\(i\.cost\*i\.quantity\),0\) AS cost FROM sale_items i/);
});
