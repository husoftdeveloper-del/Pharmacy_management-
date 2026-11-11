'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../database/database');
const { PharmacyService } = require('../database/service');

test('purchase form names are translated to the secure IPC contract and saved', async (t) => {
  const { purchasePayload } = await import('../src/scripts/payloads.js');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pharmacy-payload-'));
  const db = openDatabase(directory), s = new PharmacyService(db);
  t.after(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const setup = s.setup({ username: 'admin', name: 'Admin', password: 'PayloadPassword123!', pharmacyName: 'Payload Pharmacy' });
  const user = s.get('SELECT * FROM users WHERE id=?', setup.user.id);
  const supplier = s.saveEntity(user, 'suppliers', { name: 'Hafiz Ullah', active: 1 });
  const medicine = s.saveEntity(user, 'medicines', { name: 'Panadol', sku: 'PAN-01', unit: 'tablet', price: 10, cost: 6, active: 1 });
  const data = { supplier_id: String(supplier.id), invoice_no: 'PUR-FORM-1', discount: '0', method: 'credit', account_id: '' };
  const lines = [{ medicine_id: String(medicine.id), location_id: '1', batch_no: 'B-FORM-1', expiry: '2030-12-31', quantity: '5', cost: '6' }];
  const payload = purchasePayload(data, lines);
  assert.equal(payload.supplierId, String(supplier.id));
  assert.equal(payload.invoiceNo, 'PUR-FORM-1');
  assert.equal(payload.paymentMethod, 'credit');
  assert.equal(payload.accountId, undefined);
  assert.deepEqual(payload.items, [{ medicineId: String(medicine.id), locationId: '1', batchNo: 'B-FORM-1', expiry: '2030-12-31', quantity: '5', cost: '6' }]);
  const result = s.receivePurchase(user, payload);
  const saved = s.document(user, 'purchase', result.id);
  assert.equal(saved.supplier_id, supplier.id);
  assert.equal(saved.items[0].medicine_id, medicine.id);
  assert.equal(saved.items[0].quantity, 5);
  assert.equal(s.get('SELECT SUM(quantity) AS n FROM batches').n, 5);
  // The old raw form payload must still be rejected; validation is not weakened.
  assert.throws(() => s.receivePurchase(user, { ...data, items: lines }), /Invalid supplier ID/);
});

test('transaction form helpers preserve IDs, accounts and optional salary gross', async () => {
  const m = await import('../src/scripts/payloads.js');
  assert.deepEqual(m.paymentPayload({ party_type: 'supplier', party_id: '7', amount: '50', method: 'bank', account_id: '2', reference: 'R' }), { partyType: 'supplier', partyId: '7', amount: '50', method: 'bank', accountId: '2', reference: 'R' });
  assert.deepEqual(m.expensePayload({ category: 'Rent', description: 'Shop', amount: '100', method: 'cash', account_id: '1' }), { category: 'Rent', description: 'Shop', amount: '100', method: 'cash', accountId: '1' });
  assert.deepEqual(m.staffPaymentPayload('advance', { staff_id: '3', amount: '20', note: 'Advance', method: 'cash', account_id: '1' }), { staffId: '3', amount: '20', note: 'Advance', method: 'cash', accountId: '1' });
  assert.deepEqual(m.staffPaymentPayload('salary', { staff_id: '3', month: '2030-01', gross: '', method: 'cash', account_id: '1' }), { staffId: '3', month: '2030-01', method: 'cash', accountId: '1' });
  assert.deepEqual(m.inventoryPayload('transfer', { batch_id: '4', to_location: '2', quantity: '3', reason: 'Refill' }), { batchId: '4', toLocation: '2', quantity: '3', reason: 'Refill' });
  assert.deepEqual(m.inventoryPayload('adjustment', { batch_id: '4', quantity: '-2', reason: 'Broken' }), { batchId: '4', quantity: '-2', reason: 'Broken' });
  assert.deepEqual(m.stockCountPayload({ location_id: '1', note: 'Monthly' }), { action: 'create', locationId: '1', note: 'Monthly' });
  assert.deepEqual(m.prescriptionPayload({ patient_id: '8', doctor: 'Dr', date: '2030-01-01', notes: '' }, 'AA==', 'image/png'), { patientId: '8', doctor: 'Dr', date: '2030-01-01', notes: '', attachment: 'AA==', mime: 'image/png' });
  assert.deepEqual(m.returnPayload('purchase', 9, { reason: 'Damaged', method: 'credit', account_id: '' }, [{ itemId: 1, quantity: 2 }]), { type: 'purchase', documentId: 9, items: [{ itemId: 1, quantity: 2 }], reason: 'Damaged', method: 'credit', accountId: undefined });
});
