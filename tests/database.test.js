'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase, verifyPassword, backupDatabase, validateBackup } = require('../database/database');
const { PharmacyService } = require('../database/service');
const { code128 } = require('../database/barcode');
function fixture(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pharmacy-test-'));
  const db=openDatabase(directory),s=new PharmacyService(db);
  const setup=s.setup({username:'admin',name:'Administrator',password:'CorrectHorse42!',pharmacyName:'Test Pharmacy'});
  const admin=s.get('SELECT * FROM users WHERE id=?',setup.user.id);
  t.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true});});
  s.register(admin,'open',{opening:1000});
  return {db,s,admin,directory};
}
function stock(s,user,quantity=30,price=10,cost=6,extra={}) {
  const medicine=s.saveEntity(user,'medicines',{name:'Paracetamol 500mg',sku:'PAR-500',barcode:'PAR50001',unit:'tablet',price,cost,reorder_level:5,active:1,...extra});
  s.receivePurchase(user,{supplierId:supplier(s,user),invoiceNo:'PUR-001',paymentMethod:'credit',items:[{medicineId:medicine.id,locationId:1,batchNo:'B001',expiry:'2030-12-31',quantity,cost}]});
  return medicine;
}
function supplier(s,user){return s.saveEntity(user,'suppliers',{name:'Health Supplies',opening_balance:0,active:1}).id;}
function balanced(s){assert.deepEqual(s.all('SELECT j.id,SUM(l.debit) AS debit,SUM(l.credit) AS credit FROM journals j JOIN journal_lines l ON l.journal_id=j.id GROUP BY j.id HAVING ABS(SUM(l.debit)-SUM(l.credit))>0.005'),[]);assert.deepEqual(s.all('PRAGMA foreign_key_check'),[]);}
test('first-run setup, salted password hashing, login and role permissions',(t)=>{
 const {s,admin}=fixture(t);assert.throws(()=>s.setup({username:'other',name:'Other',password:'AnotherPassword1',pharmacyName:'X'}),/already/);
 assert.ok(verifyPassword('CorrectHorse42!',admin.password_hash));assert.ok(!verifyPassword('wrong',admin.password_hash));assert.ok(!admin.password_hash.includes('CorrectHorse'));
 assert.equal(s.login({username:'ADMIN',password:'CorrectHorse42!'}).user.id,admin.id);
 assert.throws(()=>s.login({username:'admin',password:'wrong'}),/Invalid/);
 const cashierId=s.saveUser(admin,{username:'cashier',name:'Cashier',password:'CashierPassword1',role:'cashier',active:1,permissions:{}}).id;
 const cashier=s.get('SELECT * FROM users WHERE id=?',cashierId);assert.throws(()=>s.list(cashier,'audit'),/Unknown module|permission/);assert.throws(()=>s.saveEntity(cashier,'medicines',{name:'X',sku:'X',price:1}),/permission/);
 assert.throws(()=>s.saveUser(admin,{...admin,id:admin.id,role:'cashier',active:1}),/own account/);
});
test('purchase, FEFO sale, exact payment, stock ledger and balanced accounting',(t)=>{
 const {s,admin}=fixture(t);const m=stock(s,admin);const result=s.sale(admin,{items:[{medicineId:m.id,quantity:7}],paymentMethod:'cash',accountId:1});
 assert.equal(result.total,70);assert.equal(s.get('SELECT SUM(quantity) AS n FROM batches').n,23);assert.equal(s.get("SELECT SUM(quantity) AS n FROM stock_movements WHERE reason='sale'").n,-7);
 assert.equal(s.register(admin,'status').expected,1070);assert.equal(s.dashboard(admin).today.sales,70);balanced(s);
 assert.throws(()=>s.sale(admin,{items:[{medicineId:m.id,quantity:100}],paymentMethod:'cash'}),/Insufficient/);assert.equal(s.get('SELECT SUM(quantity) AS n FROM batches').n,23);
});
test('credit limits, customer payment allocation and receivable balance',(t)=>{
 const {s,admin}=fixture(t);const m=stock(s,admin);const customer=s.saveEntity(admin,'customers',{name:'Patient Customer',opening_balance:20,credit_limit:100,active:1}).id;
 assert.throws(()=>s.sale(admin,{customerId:customer,items:[{medicineId:m.id,quantity:10}],paymentMethod:'credit'}),/credit limit/);
 s.sale(admin,{customerId:customer,items:[{medicineId:m.id,quantity:5}],paymentMethod:'credit'});assert.equal(s.party('customer',customer).balance,70);
 s.partyPayment(admin,{partyType:'customer',partyId:customer,amount:70,method:'cash',accountId:1});assert.equal(s.party('customer',customer).balance,0);assert.equal(s.get('SELECT SUM(amount) AS n FROM payment_allocations').n,50);assert.throws(()=>s.partyPayment(admin,{partyType:'customer',partyId:customer,amount:1,method:'cash'}),/exceeds/);balanced(s);
});
test('sales returns restore stock only when requested and respect original quantities',(t)=>{
 const {s,admin}=fixture(t);const m=stock(s,admin);const sale=s.sale(admin,{items:[{medicineId:m.id,quantity:5}],paymentMethod:'cash',discount:10});
 const item=s.get('SELECT * FROM sale_items WHERE sale_id=?',sale.id);
 s.returnDocument(admin,'sale',{documentId:sale.id,items:[{itemId:item.id,quantity:2,restock:1}],reason:'Duplicate purchase',method:'cash'});
 assert.equal(s.get('SELECT SUM(quantity) AS n FROM batches').n,27);assert.equal(s.register(admin,'status').expected,1000+40-16);
 s.returnDocument(admin,'sale',{documentId:sale.id,items:[{itemId:item.id,quantity:1,restock:0}],reason:'Damaged',method:'cash'});assert.equal(s.get('SELECT SUM(quantity) AS n FROM batches').n,27);
 assert.throws(()=>s.returnDocument(admin,'sale',{documentId:sale.id,items:[{itemId:item.id,quantity:3,restock:1}],reason:'Too much'}),/exceeds/);balanced(s);
});
test('purchase returns remove batch stock and reduce supplier payable',(t)=>{
 const {s,admin}=fixture(t);const m=stock(s,admin,30,10,6);const purchase=s.get('SELECT * FROM purchases ORDER BY id DESC');const item=s.get('SELECT * FROM purchase_items WHERE purchase_id=?',purchase.id);
 s.returnDocument(admin,'purchase',{documentId:purchase.id,items:[{itemId:item.id,quantity:5}],reason:'Damaged delivery',method:'credit'});
 assert.equal(s.get('SELECT SUM(quantity) AS n FROM batches').n,25);assert.equal(s.party('supplier',purchase.supplier_id).balance,150);balanced(s);
});
test('supplier payment and operating expenses',(t)=>{
 const {s,admin}=fixture(t);stock(s,admin);const party=s.all('SELECT * FROM suppliers')[0];s.partyPayment(admin,{partyType:'supplier',partyId:party.id,amount:80,method:'bank',accountId:2});assert.equal(s.party('supplier',party.id).balance,100);
 s.expense(admin,{category:'Rent',description:'Monthly rent',amount:50,method:'cash',accountId:1});assert.equal(s.register(admin,'status').expected,950);const report=s.report(admin,{kind:'profit'});assert.equal(report.rows.at(-1).amount,-50);balanced(s);
});
test('salary advances are deducted once and monthly payroll is unique',(t)=>{
 const {s,admin}=fixture(t);const staff=s.saveEntity(admin,'staff',{name:'Pharmacist',salary:500,active:1}).id;
 s.advance(admin,{staffId:staff,amount:100,method:'cash',note:'Advance'});const salary=s.salary(admin,{staffId:staff,month:'2030-01',method:'cash'});assert.equal(salary.net,400);assert.equal(salary.deduction,100);assert.equal(s.register(admin,'status').expected,500);
 assert.throws(()=>s.salary(admin,{staffId:staff,month:'2030-01',method:'cash'}),/already/);assert.equal(s.get('SELECT repaid FROM advances').repaid,100);balanced(s);
});
test('transfer conserves stock; adjustment and physical count create audit trails',(t)=>{
 const {s,admin}=fixture(t);stock(s,admin);const batch=s.get('SELECT * FROM batches');const to=s.saveEntity(admin,'locations',{name:'Branch',active:1}).id;
 s.inventoryOperation(admin,'transfer',{batchId:batch.id,toLocation:to,quantity:10,reason:'Branch refill'});assert.equal(s.get('SELECT SUM(quantity) AS n FROM batches').n,30);
 s.inventoryOperation(admin,'adjustment',{batchId:batch.id,quantity:-2,reason:'Breakage'});assert.equal(s.get('SELECT SUM(quantity) AS n FROM batches').n,28);
 const count=s.stockCount(admin,'create',{locationId:1,note:'Monthly'}).id;const sheet=s.document(admin,'stockcount',count);s.stockCount(admin,'save',{countId:count,items:sheet.items.map(i=>({batchId:i.batch_id,counted:15}))});s.stockCount(admin,'complete',{countId:count});assert.equal(s.get('SELECT SUM(quantity) AS n FROM batches').n,25);assert.throws(()=>s.stockCount(admin,'complete',{countId:count}),/not found/);balanced(s);
});
test('offers are validated on the server and never trust a renderer total',(t)=>{
 const {s,admin}=fixture(t);const m=stock(s,admin);const offer=s.saveEntity(admin,'offers',{name:'10% off',kind:'percent',value:10,min_total:20,starts:'2020-01-01',ends:'2099-01-01',active:1}).id;
 const sale=s.sale(admin,{items:[{medicineId:m.id,quantity:3}],paymentMethod:'cash',offerId:offer,discount:0,total:0.01});assert.equal(sale.total,27);balanced(s);
});
test('prescription attachment validation and Rx enforcement',(t)=>{
 const {s,admin}=fixture(t);const m=stock(s,admin,30,10,6,{rx_required:1});const patient=s.saveEntity(admin,'patients',{name:'Patient',active:1}).id;
 assert.throws(()=>s.sale(admin,{items:[{medicineId:m.id,quantity:1}],paymentMethod:'cash'}),/prescription/);
 assert.throws(()=>s.savePrescription(admin,{patientId:patient,mime:'application/pdf',attachment:Buffer.from('<script>').toString('base64')}),/contents/);
 const rx=s.savePrescription(admin,{patientId:patient,doctor:'Doctor',mime:'application/pdf',attachment:Buffer.from('%PDF-1.4 test').toString('base64')}).id;
 s.sale(admin,{patientId:patient,prescriptionId:rx,items:[{medicineId:m.id,quantity:1}],paymentMethod:'cash'});assert.equal(s.get('SELECT status FROM prescriptions WHERE id=?',rx).status,'dispensed');
});
test('cash close reconciles counted cash and records over/short',(t)=>{
 const {s,admin}=fixture(t);s.register(admin,'move',{direction:'out',amount:50,reason:'Bank deposit'});const result=s.register(admin,'close',{counted:945,note:'Counted'});assert.equal(result.expected,950);assert.equal(result.variance,-5);assert.equal(s.get('SELECT SUM(debit-credit) AS n FROM journal_lines WHERE account_id=1').n,945);balanced(s);
});
test('audit immutability, SQL search escaping and barcode checksum',(t)=>{
 const {s,db,admin}=fixture(t);assert.throws(()=>db.prepare('UPDATE audit_logs SET action=? WHERE id=1').run('tampered'),/immutable/);assert.throws(()=>db.prepare('DELETE FROM audit_logs WHERE id=1').run(),/immutable/);
 s.saveEntity(admin,'categories',{name:'100% care',active:1});assert.equal(s.list(admin,'categories',{search:'%'}).total,1);assert.equal(s.list(admin,'categories',{search:"' OR 1=1 --"}).total,0);
 const svg=code128('PAR50001');assert.ok(svg.startsWith('<svg'));assert.ok(svg.includes('PAR50001'));assert.ok(!code128('<abc>').includes('<abc>'));
});
test('online backup is consistent and validates before restore',async(t)=>{
 const {s,admin,directory}=fixture(t);stock(s,admin);const filename=path.join(directory,'backup.sqlite');await backupDatabase(s.db,filename);validateBackup(filename);assert.throws(()=>validateBackup(path.join(directory,'missing.sqlite')),/not found/);assert.ok(fs.statSync(filename).size>10000);
});
