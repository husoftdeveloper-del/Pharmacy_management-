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
test('purchase book, supplier book and supplier accounts share one ledger',(t)=>{
 const {s,admin}=fixture(t);const m=stock(s,admin,30,10,6);
 const supplierId=s.get('SELECT supplier_id FROM purchases ORDER BY id DESC LIMIT 1').supplier_id;
 s.saveEntity(admin,'suppliers',{id:supplierId,name:'Health Supplies',contact_person:'Ahmad Khan',phone:'0700111222',opening_balance:0,active:1});
 const purchases=s.purchaseBook(admin);const row=purchases.rows[0];
 assert.equal(purchases.rows.length,1);assert.equal(row.invoice_no,'PUR-001');assert.equal(row.supplier,'Health Supplies');assert.equal(row.recorded_by,'Administrator');
 assert.equal(row.total,180);assert.equal(row.paid,0);assert.equal(row.due,180);assert.equal(row.returned,0);
 assert.equal(purchases.totals.purchases,1);assert.equal(purchases.totals.due,180);
 const book=s.supplierBook(admin);const supplier=book.rows.find(r=>r.id===supplierId);
 assert.equal(supplier.contact_person,'Ahmad Khan');assert.equal(supplier.purchases,1);assert.equal(supplier.spent,180);assert.ok(supplier.last_purchase);assert.equal(supplier.balance,180);
 const accounts=s.supplierAccounts(admin);const account=accounts.rows.find(r=>r.id===supplierId);
 assert.equal(account.purchased,180);assert.equal(account.paid,0);assert.equal(account.credited,0);assert.equal(account.balance,180);assert.equal(account.contact,'Ahmad Khan');
 assert.deepEqual(accounts.totals,{purchased:180,paid:0,credited:0,owed:180});
 s.partyPayment(admin,{partyType:'supplier',partyId:supplierId,amount:80,method:'cash',accountId:1});
 const after=s.supplierAccounts(admin);assert.equal(after.rows.find(r=>r.id===supplierId).paid,80);assert.equal(after.totals.owed,100);assert.ok(after.rows.find(r=>r.id===supplierId).lastPayment);
 assert.equal(s.purchaseBook(admin).rows[0].due,100);
 const history=s.documents(admin,'supplierpayments');assert.equal(history.length,1);assert.equal(history[0].supplier,'Health Supplies');assert.equal(history[0].amount,80);assert.equal(history[0].user,'Administrator');
 const cashierId=s.saveUser(admin,{username:'buys',name:'Buys',password:'BuysPass1234',role:'cashier',active:1,permissions:{}}).id;
 const cashier=s.get('SELECT * FROM users WHERE id=?',cashierId);
 for(const call of [()=>s.purchaseBook(cashier),()=>s.supplierBook(cashier),()=>s.supplierAccounts(cashier)])assert.throws(call,/permission/i);
 assert.throws(()=>s.partyPayment(cashier,{partyType:'supplier',partyId:supplierId,amount:1,method:'cash'}),/permission/i);
 balanced(s);
});
test('label book lists medicines and printing validates copies and barcodes',(t)=>{
 const {s,admin}=fixture(t);const m=stock(s,admin,30,10,6);
 s.saveMedicine(admin,{name:'No Barcode',sku:'NB-1',unit:'tablet',cost:2,price:4,reorder_level:0,active:1,opening_stock:{quantity:4,expiry:'2031-01-31',cost:2,price:4}});
 const book=s.labelBook(admin);
 assert.equal(book.rows.length,2);assert.equal(book.currency,s.setting('currency'));
 const paracetamol=book.rows.find(r=>r.id===m.id);assert.equal(paracetamol.barcode,'PAR50001');assert.equal(paracetamol.stock,30);assert.equal(paracetamol.expiry,'2030-12-31');assert.equal(paracetamol.price,10);
 assert.equal(book.rows.find(r=>r.name==='No Barcode').out,false);
 assert.deepEqual(book.categories,[]);
 const printed=s.printLabels(admin,{items:[{id:m.id,copies:3},{id:book.rows.find(r=>r.name==='No Barcode').id,copies:2}]});
 assert.equal(printed.total,5);assert.equal(printed.items[0].copies,3);assert.equal(printed.items[0].barcode,'PAR50001');assert.match(printed.items[0].svg,/<svg/);
 assert.equal(printed.items[1].barcode,'NB-1','a medicine without a barcode prints its SKU');
 assert.equal(printed.currency,s.setting('currency'));
 assert.throws(()=>s.printLabels(admin,{items:[]}),/at least one medicine/);
 assert.throws(()=>s.printLabels(admin,{items:[{id:m.id,copies:0}]}),/copies/i);
 assert.throws(()=>s.printLabels(admin,{items:[{id:m.id,copies:201}]}),/200 labels/);
 assert.throws(()=>s.printLabels(admin,{items:Array.from({length:3},()=>({id:m.id,copies:200}))}),/500 labels/);
 assert.throws(()=>s.printLabels(admin,{items:[{id:999999,copies:1}]}),/not found/);
 const cashierId=s.saveUser(admin,{username:'labels',name:'Labels',password:'LabelsPass123',role:'cashier',active:1,permissions:{}}).id;
 const cashier=s.get('SELECT * FROM users WHERE id=?',cashierId);
 assert.throws(()=>s.labelBook(cashier),/permission/i);assert.throws(()=>s.printLabels(cashier,{items:[{id:m.id,copies:1}]}),/permission/i);
});
test('price list shows shelf quantity, both prices and profit per medicine',(t)=>{
 const {s,admin}=fixture(t);const m=stock(s,admin,30,10,6);
 s.saveMedicine(admin,{name:'Panadol',unit:'tablet',cost:4,price:7,active:1,opening_stock:{quantity:12,expiry:'2032-01-31',cost:4,price:7}});
 const book=s.priceList(admin);const paracetamol=book.rows.find(r=>r.id===m.id);const panadol=book.rows.find(r=>r.name==='Panadol');
 assert.equal(book.rows.length,2);assert.equal(paracetamol.stock,30);assert.equal(paracetamol.cost,6);assert.equal(paracetamol.price,10);assert.equal(paracetamol.profit,4);
 assert.equal(panadol.stock,12);assert.equal(panadol.unit,'tablet');assert.equal(panadol.profit,3);
 assert.equal(book.totals.medicines,2);assert.equal(book.totals.stockValue,30*6+12*4);assert.equal(book.totals.profit,7);
 const doc=s.priceListDocument(admin);
 assert.deepEqual(doc.columns,['name','stock','purchasePrice','sellingPrice','profit']);
 assert.equal(doc.rows.find(r=>r.name==='Paracetamol 500mg').stock,'30 tablet');assert.equal(doc.rows.find(r=>r.name==='Panadol').sellingPrice,`${doc.currency} 7.00`);
 assert.equal(doc.kind,'pricelist');
 const updated=s.updateMedicinePrice(admin,{id:panadol.id,price:9.5});
 assert.equal(updated.price,9.5);assert.equal(s.get('SELECT price FROM medicines WHERE id=?',panadol.id).price,9.5);
 assert.equal(s.priceList(admin).rows.find(r=>r.id===panadol.id).profit,5.5);
 assert.equal(s.get("SELECT details FROM audit_logs WHERE action='price_change' ORDER BY id DESC LIMIT 1").details.includes('9.5'),true);
 assert.throws(()=>s.updateMedicinePrice(admin,{id:panadol.id,price:0}),/greater than zero/);
 assert.throws(()=>s.updateMedicinePrice(admin,{id:999999,price:5}),/not found/);
 const cashierId=s.saveUser(admin,{username:'price',name:'Price',password:'PricePass123',role:'cashier',active:1,permissions:{}}).id;
 const cashier=s.get('SELECT * FROM users WHERE id=?',cashierId);
 assert.throws(()=>s.priceList(cashier),/permission/i);
 assert.throws(()=>s.updateMedicinePrice(cashier,{id:panadol.id,price:11}),/permission/i);
 assert.equal(s.permissions(s.get('SELECT * FROM users WHERE id=?',admin.id)).includes('pricelist'),true);
});
test('new medicine form saves the catalogue entry with its opening stock',(t)=>{
 const {s,admin}=fixture(t);
 const saved=s.saveMedicine(admin,{name:'Panadol',barcode:'2040798152855',barcode_type:'internal',generic_name:'Paracetamol',brand:'GSK',dosage_form:'tablet',unit:'tablet',cost:6,price:12,reorder_level:20,reorder_qty:100,manufacturer_id:null,category_id:null,active:1,
   opening_stock:{quantity:40,batch_no:'OPEN-1',expiry:'2031-05-31',location_id:1}});
 const medicine=s.get('SELECT * FROM medicines WHERE id=?',saved.id);
 assert.equal(medicine.name,'Panadol');assert.equal(medicine.brand,'GSK');assert.equal(medicine.dosage_form,'tablet');assert.equal(medicine.barcode_type,'internal');
 assert.equal(medicine.reorder_qty,100);assert.equal(medicine.reorder_level,20);assert.equal(medicine.created_by,admin.id);
 assert.match(medicine.sku,/^MED-\d{5}$/,'a missing SKU is generated');
 const batch=s.get('SELECT * FROM batches WHERE medicine_id=?',saved.id);
 assert.equal(batch.quantity,40);assert.equal(batch.batch_no,'OPEN-1');assert.equal(batch.expiry,'2031-05-31');assert.equal(batch.cost,6);
 assert.equal(s.get("SELECT quantity FROM stock_movements WHERE batch_id=? AND reason='opening'",batch.id).quantity,40);
 assert.equal(s.medicineBook(admin).rows[0].stock,40);
 const lines=s.all('SELECT account_id,debit,credit FROM journal_lines WHERE journal_id=(SELECT id FROM journals WHERE description=\'Opening stock\')');
 assert.equal(lines.length,2);assert.equal(lines.find(l=>l.account_id===4).debit,240);assert.equal(lines.find(l=>l.account_id===8).credit,240);
 balanced(s);
 assert.throws(()=>s.saveMedicine(admin,{...medicine,id:saved.id,price:12,opening_stock:{quantity:5,expiry:'2032-01-01'}}),/only entered when the medicine is created/);
 assert.throws(()=>s.saveMedicine(admin,{name:'No expiry',unit:'tablet',price:1,cost:1,opening_stock:{quantity:5}}),/date/i);
 const priced=s.saveMedicine(admin,{name:'Brufen',unit:'tablet',cost:2,price:0,active:1,opening_stock:{quantity:5,expiry:'2032-03-31',cost:3,price:7}});
 assert.equal(s.get('SELECT price FROM medicines WHERE id=?',priced.id).price,7,'opening stock selling price is stored on the medicine');
 const pricedBatch=s.get('SELECT cost,quantity,expiry FROM batches WHERE medicine_id=?',priced.id);assert.equal(pricedBatch.cost,3);assert.equal(pricedBatch.quantity,5);assert.equal(pricedBatch.expiry,'2032-03-31');
 assert.equal(s.get('SELECT batch_no FROM batches WHERE medicine_id=?',priced.id).batch_no,'OPEN-1');
 assert.match(s.get('SELECT sku FROM medicines WHERE id=?',priced.id).sku,/^MED-\d{5}$/);
 const cashierId=s.saveUser(admin,{username:'stock',name:'Stock',password:'StockPassword1',role:'cashier',active:1,permissions:{}}).id;
 const cashier=s.get('SELECT * FROM users WHERE id=?',cashierId);
 assert.throws(()=>s.saveMedicine(cashier,{name:'Denied',price:1,cost:1}),/permission/i);
});
test('medicine catalogue and inventory stock are separate views of the same data',(t)=>{
 const {s,admin}=fixture(t);const m=stock(s,admin,30,10,6);
 const book=s.medicineBook(admin);const row=book.rows.find(r=>r.id===m.id);
 assert.equal(book.rows.length,1);assert.equal(row.name,'Paracetamol 500mg');assert.equal(row.sku,'PAR-500');assert.equal(row.stock,30);assert.equal(row.price,10);assert.equal(row.reorder_level,5);
 assert.equal(row.recorded_by,'Administrator');assert.equal(row.expiry,'2030-12-31');assert.ok(row.category_id===null||Number.isInteger(row.category_id));
 assert.equal(book.totals.medicines,1);assert.equal(book.totals.active,1);assert.equal(book.totals.lowStock,0);assert.equal(book.totals.value,180);
 const stockView=s.inventoryBook(admin);const stockRow=stockView.rows[0];
 assert.equal(stockView.rows.length,1);assert.equal(stockRow.name,'Paracetamol 500mg');assert.equal(stockRow.barcode,'PAR50001');assert.equal(stockRow.stock,30);assert.equal(stockRow.unit,'tablet');assert.equal(stockRow.expiry,'2030-12-31');
 assert.equal(stockRow.low,false);assert.equal(stockRow.out,false);assert.equal(stockRow.expiring,false);
 assert.deepEqual(stockView.totals,{medicines:1,low:0,out:0,expiring:0,warningDays:90});
 s.saveEntity(admin,'medicines',{...row,id:m.id,reorder_level:40,active:1});
 assert.equal(s.medicineBook(admin).totals.lowStock,1);assert.equal(s.inventoryBook(admin).totals.low,1);assert.equal(s.inventoryBook(admin).rows[0].low,true);
 const soon=new Date(Date.now()+10*86400000).toISOString().slice(0,10);
 const fresh=s.saveMedicine(admin,{name:'Zzz Empty',unit:'tablet',cost:1,price:2,reorder_level:5,active:1});
 const near=s.saveMedicine(admin,{name:'Near Expiry',unit:'vial',cost:1,price:2,reorder_level:0,active:1,opening_stock:{quantity:3,expiry:soon,cost:1,price:2}});
 const view=s.inventoryBook(admin);const empty=view.rows.find(r=>r.id===fresh.id);const expiring=view.rows.find(r=>r.id===near.id);
 assert.equal(empty.out,true);assert.equal(empty.stock,0);assert.equal(empty.expiry,null);assert.equal(expiring.expiring,true);assert.equal(expiring.low,false);
 assert.deepEqual(view.totals,{medicines:3,low:1,out:1,expiring:1,warningDays:90});
 const cashierId=s.saveUser(admin,{username:'counter',name:'Counter',password:'CounterPassword1',role:'cashier',active:1,permissions:{}}).id;
 const cashier=s.get('SELECT * FROM users WHERE id=?',cashierId);
 assert.throws(()=>s.medicineBook(cashier),/permission/);assert.throws(()=>s.inventoryBook(cashier),/permission/);
 assert.throws(()=>s.inventoryBook(null),/sign in/i);
});
test('customer book lists email, status and ledger balance for every customer',(t)=>{
 const {s,admin}=fixture(t);const m=stock(s,admin);
 const created=s.saveEntity(admin,'customers',{name:'Walk In Plus',phone:'0700111222',email:'plus@example.com',opening_balance:10,credit_limit:0,active:1});
 assert.equal(s.get('SELECT email FROM customers WHERE id=?',created.id).email,'plus@example.com');
 s.sale(admin,{customerId:created.id,items:[{medicineId:m.id,quantity:2}],paymentMethod:'credit'});
 const book=s.customerBook(admin);const row=book.rows.find(r=>r.id===created.id);
 assert.equal(row.email,'plus@example.com');assert.equal(row.phone,'0700111222');assert.equal(row.balance,30);assert.equal(row.active,1);
 assert.equal(book.totals.customers,1);assert.equal(book.totals.active,1);assert.equal(book.totals.outstanding,30);
 const disabled=s.saveEntity(admin,'customers',{...row,active:0});
 assert.equal(s.get('SELECT active FROM customers WHERE id=?',created.id).active,0);
 const after=s.customerBook(admin);assert.equal(after.totals.customers,1);assert.equal(after.totals.active,0);assert.equal(after.rows[0].active,0);assert.ok(disabled.id);
 assert.throws(()=>s.customerBook(null),/sign in|permission/i);
});
test('existing databases gain the customer email column without losing data',(t)=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pharmacy-migrate-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const first=openDatabase(directory);first.exec("INSERT INTO customers(name,phone,opening_balance,credit_limit,active) VALUES('Legacy Customer','0700000001',5,0,1)");first.close();
 const reopened=openDatabase(directory);const column=reopened.prepare('PRAGMA table_info(customers)').all().some(c=>c.name==='email');assert.ok(column);
 for(const column of ['created_by','brand','dosage_form','barcode_type','reorder_qty'])assert.ok(reopened.prepare('PRAGMA table_info(medicines)').all().some(c=>c.name===column),`medicines.${column} migrated`);
 const row=reopened.prepare("SELECT name,email,opening_balance FROM customers").get();assert.equal(row.name,'Legacy Customer');assert.equal(row.email,'');assert.equal(row.opening_balance,5);reopened.close();
});
test('credit limits, customer payment allocation and receivable balance',(t)=>{
 const {s,admin}=fixture(t);const m=stock(s,admin);const customer=s.saveEntity(admin,'customers',{name:'Patient Customer',opening_balance:20,credit_limit:100,active:1}).id;
 assert.throws(()=>s.sale(admin,{customerId:customer,items:[{medicineId:m.id,quantity:10}],paymentMethod:'credit'}),/credit limit/);
 s.sale(admin,{customerId:customer,items:[{medicineId:m.id,quantity:5}],paymentMethod:'credit'});assert.equal(s.party('customer',customer).balance,70);
 s.partyPayment(admin,{partyType:'customer',partyId:customer,amount:70,method:'cash',accountId:1});assert.equal(s.party('customer',customer).balance,0);
 const cpay=s.documents(admin,'customerpayments');assert.equal(cpay.length,1);assert.equal(cpay[0].customer,'Patient Customer');assert.equal(cpay[0].amount,70);assert.equal(cpay[0].allocated,50);assert.equal(cpay[0].account,'Cash');assert.equal(s.documents(admin,'customerpayments',{from:'2000-01-01',to:'2000-01-02'}).length,0);
 const board=s.customerAccounts(admin);const row=board.rows.find(r=>r.id===customer);assert.ok(row);assert.equal(row.creditSales,50);assert.equal(row.paid,70);assert.equal(row.balance,0);assert.ok(row.lastPayment);assert.equal(board.totals.paid,70);assert.equal(board.totals.creditSales,50);assert.equal(board.totals.owed,0);assert.equal(s.get('SELECT SUM(amount) AS n FROM payment_allocations').n,50);assert.throws(()=>s.partyPayment(admin,{partyType:'customer',partyId:customer,amount:1,method:'cash'}),/exceeds/);balanced(s);
});
test('sales returns restore stock only when requested and respect original quantities',(t)=>{
 const {s,admin}=fixture(t);const m=stock(s,admin);const sale=s.sale(admin,{items:[{medicineId:m.id,quantity:5}],paymentMethod:'cash',discount:10});
 const item=s.get('SELECT * FROM sale_items WHERE sale_id=?',sale.id);
 s.returnDocument(admin,'sale',{documentId:sale.id,items:[{itemId:item.id,quantity:2,restock:1}],reason:'Duplicate purchase',method:'cash'});
 assert.equal(s.get('SELECT SUM(quantity) AS n FROM batches').n,27);assert.equal(s.register(admin,'status').expected,1000+40-16);
 s.returnDocument(admin,'sale',{documentId:sale.id,items:[{itemId:item.id,quantity:1,restock:0}],reason:'Damaged',method:'cash'});assert.equal(s.get('SELECT SUM(quantity) AS n FROM batches').n,27);
 assert.throws(()=>s.returnDocument(admin,'sale',{documentId:sale.id,items:[{itemId:item.id,quantity:3,restock:1}],reason:'Too much'}),/exceeds/);balanced(s);
 const returns=s.documents(admin,'salereturns');assert.equal(returns.length,2);assert.ok(returns[0].invoice_no.startsWith('INV-'));assert.equal(returns[0].customer,'Walk-in');assert.equal(returns.reduce((a,r)=>a+r.total,0),16+8);assert.equal(s.documents(admin,'salereturns',{from:'2000-01-01',to:'2000-01-02'}).length,0);
});
test('purchase returns remove batch stock and reduce supplier payable',(t)=>{
 const {s,admin}=fixture(t);const m=stock(s,admin,30,10,6);const purchase=s.get('SELECT * FROM purchases ORDER BY id DESC');const item=s.get('SELECT * FROM purchase_items WHERE purchase_id=?',purchase.id);
 s.returnDocument(admin,'purchase',{documentId:purchase.id,items:[{itemId:item.id,quantity:5}],reason:'Damaged delivery',method:'credit'});
 assert.equal(s.get('SELECT SUM(quantity) AS n FROM batches').n,25);assert.equal(s.party('supplier',purchase.supplier_id).balance,150);balanced(s);
 const prets=s.documents(admin,'purchasereturns');assert.equal(prets.length,1);assert.equal(prets[0].invoice_no,'PUR-001');assert.equal(prets[0].supplier,'Health Supplies');assert.equal(prets[0].items,5);assert.equal(prets[0].total,30);assert.equal(s.documents(admin,'purchasereturns',{from:'2000-01-01',to:'2000-01-02'}).length,0);assert.equal(s.documents(admin,'salereturns').length,0);
});
test('supplier payment and operating expenses',(t)=>{
 const {s,admin}=fixture(t);stock(s,admin);const party=s.all('SELECT * FROM suppliers')[0];s.partyPayment(admin,{partyType:'supplier',partyId:party.id,amount:80,method:'bank',accountId:2});assert.equal(s.party('supplier',party.id).balance,100);
 s.expense(admin,{category:'Rent',description:'Monthly rent',amount:50,method:'cash',accountId:1});assert.equal(s.register(admin,'status').expected,950);const report=s.report(admin,{kind:'profit'});assert.equal(report.rows.at(-1).amount,-50);balanced(s);
 const board=s.dashboard(admin);assert.equal(board.expenses.today,50);assert.equal(board.expenses.month.total,50);assert.equal(board.expenses.month.count,1);assert.equal(board.expenses.recent[0].category,'Rent');assert.ok(board.expenses.recent[0].id>0);assert.equal(board.lowCount,0);assert.equal(board.expiringCount,0);
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

test('multiple medicines can omit optional barcodes', (t) => {
 const {s,admin}=fixture(t);s.saveEntity(admin,'medicines',{name:'One',sku:'ONE',unit:'piece',price:1});s.saveEntity(admin,'medicines',{name:'Two',sku:'TWO',unit:'piece',price:2});assert.equal(s.list(admin,'medicines').total,2);
});
test('one-click barcode generation is unique, valid and not assigned until saved',(t)=>{
 const {s,admin}=fixture(t);const m=stock(s,admin);
 const first=s.generateBarcode(admin),second=s.generateBarcode(admin);
 assert.match(first.value,/^MED-[A-Z0-9]+-[A-F0-9]{12}$/);assert.notEqual(first.value,second.value);assert.ok(first.svg.includes(first.value));
 assert.equal(s.get('SELECT barcode FROM medicines WHERE id=?',m.id).barcode,'PAR50001');
 s.barcode(admin,{value:first.value,medicineId:m.id});assert.equal(s.get('SELECT barcode FROM medicines WHERE id=?',m.id).barcode,first.value);
 const cashierId=s.saveUser(admin,{username:'cashier2',name:'Cashier',password:'CashierPassword1',role:'cashier',active:1,permissions:{barcodes:false}}).id;
 const cashier=s.get('SELECT * FROM users WHERE id=?',cashierId);assert.throws(()=>s.generateBarcode(cashier),/permission/);
});

test('finance pages read expenses, the profit statement and the report overview',(t)=>{
 const {s,admin}=fixture(t);const m=stock(s,admin);
 s.sale(admin,{items:[{medicineId:m.id,quantity:4}],paymentMethod:'cash',accountId:1});
 s.expense(admin,{category:'Rent',description:'Shop rent',amount:40,method:'cash',accountId:1});
 const expenses=s.expenseBook(admin);
 assert.equal(expenses.rows.length,1);assert.equal(expenses.rows[0].category,'Rent');assert.equal(expenses.rows[0].recorded_by,'Administrator');
 assert.deepEqual(expenses.categories,['Rent']);assert.equal(expenses.totals.entries,1);assert.equal(expenses.totals.total,40);assert.equal(expenses.totals.thisMonth,40);
 const ledger=s.ledgerBook(admin,{from:'2000-01-01',to:'2999-12-31'});
 assert.equal(ledger.statement.salesRevenue,40);assert.equal(ledger.statement.netRevenue,40);assert.equal(ledger.statement.cogs,24);
 assert.equal(ledger.statement.expenses,40);assert.equal(ledger.statement.netProfit,-24);
 assert.equal(ledger.cash.cashIn,1040);assert.equal(ledger.cash.cashOut,40);assert.equal(ledger.cash.netCashFlow,1000);assert.equal(ledger.cash.purchaseCount,1);
 assert.ok(ledger.transactions.length>=2);assert.equal(ledger.transactions[0].user,'Administrator');
 const overview=s.reportOverview(admin,{from:'2000-01-01',to:'2999-12-31'});
 assert.equal(overview.totals.revenue,40);assert.equal(overview.totals.grossProfit,16);assert.equal(overview.totals.expenses,40);
 assert.equal(overview.totals.netProfit,-24);assert.equal(overview.totals.orders,1);assert.equal(overview.totals.itemsSold,4);
 assert.equal(overview.totals.cogs,24);assert.equal(overview.totals.averageOrder,40);assert.equal(overview.totals.expenseEntries,1);
 assert.ok(overview.trend.length>0);assert.equal(overview.trend.reduce((sum,row)=>sum+row.revenue,0),40);
 const cashierId=s.saveUser(admin,{username:'cashier3',name:'Cashier',password:'CashierPassword1',role:'cashier',active:1,permissions:{expenses:false,ledger:false,reports:false}}).id;
 const cashier=s.get('SELECT * FROM users WHERE id=?',cashierId);
 assert.throws(()=>s.expenseBook(cashier),/permission/);assert.throws(()=>s.ledgerBook(cashier,{}),/permission/);assert.throws(()=>s.reportOverview(cashier,{}),/permission/);
});

test('every report tab has its own filters, KPI boxes and rows',(t)=>{
 const {s,admin}=fixture(t);const m=stock(s,admin);
 const customer=s.saveEntity(admin,'customers',{name:'Report Customer',opening_balance:0,credit_limit:0,active:1}).id;
 const sale=s.sale(admin,{items:[{medicineId:m.id,quantity:4}],paymentMethod:'cash',accountId:1});
 s.sale(admin,{customerId:customer,items:[{medicineId:m.id,quantity:2}],paymentMethod:'credit'});
 s.returnDocument(admin,'sale',{documentId:sale.id,items:[{itemId:s.get('SELECT id FROM sale_items WHERE sale_id=?',sale.id).id,quantity:1,restock:1}],reason:'Smoke',method:'cash'});
 s.expense(admin,{category:'Rent',description:'Shop rent',amount:40,method:'cash',accountId:1});
 const book=(kind,extra={})=>s.reportBook(admin,{from:'2000-01-01',to:'2999-12-31',kind,...extra});

 const sales=book('sales');
 assert.equal(sales.kpis.map(k=>k.key).join(','),'revenue,discount,saleReturns,orders');
 assert.equal(sales.kpis.find(k=>k.key==='revenue').value,60);assert.equal(sales.kpis.find(k=>k.key==='orders').value,2);
 assert.equal(sales.kpis.find(k=>k.key==='saleReturns').value,10);
 assert.equal(sales.filters.map(f=>f.key).join(','),'cashier,customer,status');
 assert.equal(sales.columns.join(','),'invoice_no,date,customer,cashier,total,discount,returned,status');
 assert.equal(book('sales',{search:'nothing'}).rows.length,0);assert.equal(book('sales',{search:'nothing'}).kpis[0].value,0);
 assert.equal(book('sales',{customer:String(customer)}).rows.length,1);assert.equal(book('sales',{status:'nope'}).rows.length,0);

 const profit=book('profit');
 assert.equal(profit.kpis.map(k=>k.key).join(','),'revenue,costOfGoods,grossProfit,margin,returnedValue');
 assert.equal(profit.kpis.find(k=>k.key==='revenue').value,50);assert.equal(profit.kpis.find(k=>k.key==='costOfGoods').value,30);
 assert.equal(profit.kpis.find(k=>k.key==='grossProfit').value,20);assert.equal(profit.kpis.find(k=>k.key==='margin').value,40);
 assert.equal(profit.kpis.find(k=>k.key==='returnedValue').value,10);assert.equal(profit.rows[0].name,'Paracetamol 500mg');
 assert.equal(book('profit',{search:'nothing'}).rows.length,0);

 const inventory=book('inventory');
 assert.equal(inventory.kpis.map(k=>k.key).join(','),'batches,units,stockValueLabel,lowStockItems');
 assert.equal(inventory.kpis.find(k=>k.key==='units').value,25);assert.equal(inventory.rows.length,1);

 const expiry=book('expiry');
 assert.equal(expiry.kpis.map(k=>k.key).join(','),'expired,expiring30,expiring90,valueAtRisk');
 assert.ok(expiry.filters.some(f=>f.key==='expiry'));

 const purchases=book('purchases');
 assert.equal(purchases.kpis.map(k=>k.key).join(','),'invoices,totalPurchases,paid,balanceDue');
 assert.equal(purchases.kpis.find(k=>k.key==='invoices').value,1);

 const expenses=book('expenses');
 assert.equal(expenses.kpis.find(k=>k.key==='total').value,40);assert.equal(expenses.kpis.find(k=>k.key==='entries').value,1);
 assert.equal(expenses.filters[0].key,'category');assert.ok(expenses.filters[0].options.some(option=>option.value==='Rent'));
 assert.equal(book('expenses',{category:'Rent'}).rows.length,1);assert.equal(book('expenses',{category:'Other'}).rows.length,0);

 const customers=book('customers');
 assert.equal(customers.kpis.find(k=>k.key==='customers').value,1);assert.equal(customers.kpis.find(k=>k.key==='creditSales').value,20);
 const suppliers=book('suppliers');
 assert.equal(suppliers.kpis.map(k=>k.key).join(','),'suppliers,totalPurchases,paid,balanceDue');
 assert.equal(suppliers.kpis.find(k=>k.key==='totalPurchases').value,180);

 const cashier=s.get('SELECT * FROM users WHERE id=?',s.saveUser(admin,{username:'cashier4',name:'Cashier',password:'CashierPassword1',role:'cashier',active:1,permissions:{reports:false}}).id);
 assert.throws(()=>s.reportBook(cashier,{kind:'sales'}),/permission/);
});

test('the staff section reads employees, monthly salaries and advances',(t)=>{
 const {s,admin}=fixture(t);
 assert.deepEqual(s.employeeBook(admin).totals,{active:0,payroll:0});
 const ali=s.saveEntity(admin,'staff',{name:'Ali',position:'Pharmacist',phone:'0700',salary:500,hired_on:'2025-01-05',active:1});
 const sara=s.saveEntity(admin,'staff',{name:'Sara',position:'Cashier',phone:'0701',salary:300,active:1});
 let employees=s.employeeBook(admin);
 assert.equal(employees.rows.length,2);assert.deepEqual(employees.totals,{active:2,payroll:800});
 const month='2030-01';
 let salaries=s.salaryBook(admin,{month});
 assert.equal(salaries.rows.length,2,'every active employee is listed while unpaid');
 assert.equal(salaries.rows.every(row=>row.status==='pending'),true);
 assert.equal(salaries.totals.pending,2);assert.equal(salaries.totals.payroll,800);
 s.advance(admin,{staffId:ali.id,amount:100,note:'Travel',method:'cash',accountId:1});
 const paid=s.salary(admin,{staffId:ali.id,month,gross:500,additions:50,deductions:20,method:'cash',accountId:1});
 assert.equal(paid.net,430);assert.equal(paid.deduction,100);
 salaries=s.salaryBook(admin,{month});
 const aliRow=salaries.rows.find(row=>row.staff==='Ali');
 assert.equal(aliRow.status,'paid');assert.equal(aliRow.base,500);assert.equal(aliRow.additions,50);assert.equal(aliRow.deductions,20);
 assert.equal(aliRow.advance_deduction,100);assert.equal(aliRow.net,430);assert.equal(aliRow.account,'Cash');
 assert.equal(salaries.totals.pending,1);assert.equal(salaries.totals.netPaid,430);
 assert.deepEqual(s.salaryBook(admin,{month,status:'paid'}).rows.map(row=>row.staff),['Ali']);
 assert.deepEqual(s.salaryBook(admin,{month,status:'pending'}).rows.map(row=>row.staff),['Sara']);
 assert.equal(s.salaryBook(admin,{month,year:'2030'}).rows.length,2);
 assert.equal(s.salaryBook(admin,{month,year:'2031'}).rows.filter(row=>row.status==='paid').length,0);
 let advances=s.advanceBook(admin,{});
 assert.equal(advances.rows.length,1);assert.equal(advances.totals.outstanding,0);assert.equal(advances.totals.recovered,100);
 assert.equal(advances.rows[0].status,'settled');assert.equal(advances.totals.activeEmployees,2);
 s.advance(admin,{staffId:sara.id,amount:60,note:'Books',method:'cash',accountId:1});
 advances=s.advanceBook(admin,{});
 assert.equal(advances.totals.outstanding,60);assert.equal(advances.rows[0].status,'active');
 assert.deepEqual(s.advanceBook(admin,{status:'active'}).rows.map(row=>row.staff),['Sara']);
 assert.deepEqual(s.advanceBook(admin,{status:'settled'}).rows.map(row=>row.staff),['Ali']);
 assert.throws(()=>s.salary(admin,{staffId:sara.id,month,gross:300,deductions:900,method:'cash',accountId:1}),/Deductions/);
 balanced(s);
 const cashier=s.get('SELECT * FROM users WHERE id=?',s.saveUser(admin,{username:'cashier5',name:'Cashier',password:'CashierPassword1',role:'cashier',active:1}).id);
 assert.throws(()=>s.employeeBook(cashier),/permission/);assert.throws(()=>s.salaryBook(cashier,{}),/permission/);assert.throws(()=>s.advanceBook(cashier,{}),/permission/);
});

test('a saved permission set can never lock the administrator out of the app',(t)=>{
 const {s,admin}=fixture(t);
 // An older build saved a permission set before newer modules existed, and the
 // administrator is the account that has to be able to sign in and fix anything.
 s.db.prepare('UPDATE users SET permissions=? WHERE id=?').run(JSON.stringify({dashboard:false,employees:false,reports:false}),admin.id);
 const reloaded=s.get('SELECT * FROM users WHERE id=?',admin.id);
 const permissions=s.permissions(reloaded);
 for(const module of ['dashboard','employees','salaries','advances','reports','users','settings'])assert.ok(permissions.includes(module),module+' stays available to the administrator');
 assert.ok(s.login({username:'admin',password:'CorrectHorse42!'}).permissions.includes('dashboard'));
 // Shell calls work for any signed-in account, even one with every module off.
 const cashierId=s.saveUser(admin,{username:'cashier6',name:'Cashier',password:'CashierPassword1',role:'cashier',active:1,permissions:Object.fromEntries(['dashboard','pos','sales','returns','customers','customerpayments','patients','prescriptions','register','barcodes'].map(key=>[key,false]))}).id;
 const cashier=s.get('SELECT * FROM users WHERE id=?',cashierId);
 assert.deepEqual(s.permissions(cashier),[]);
 assert.ok(s.preferences(cashier).currency);
 assert.ok(s.options(cashier).accounts.length>0);
 assert.throws(()=>s.dashboard(cashier),/permission/);
 assert.throws(()=>s.employeeBook(cashier),/permission/);
 // A corrupt permission payload must not break signing in either.
 s.db.prepare('UPDATE users SET permissions=? WHERE id=?').run('not json',cashierId);
 assert.deepEqual(s.permissions(s.get('SELECT * FROM users WHERE id=?',cashierId)),['dashboard','pos','sales','returns','customers','customerpayments','barcodes','register','prescriptions','patients'],'a corrupt payload falls back to the role defaults instead of crashing');
});

test('settings: profile, password and notification preferences',(t)=>{
 const {s,admin}=fixture(t);
 const updated=s.profile(admin,{name:'Renamed Administrator',username:'admin'});
 assert.equal(updated.name,'Renamed Administrator');
 const staff=s.saveEntity(admin,'staff',{name:'Cashier Person',active:1}).id;
 assert.ok(staff);
 const second=s.saveUser(admin,{username:'second.user',name:'Second',password:'SecondPassword1',role:'pharmacist',active:1}).id;
 assert.throws(()=>s.profile(s.get('SELECT * FROM users WHERE id=?',second),{name:'X',username:'admin'}),/already taken/);
 assert.throws(()=>s.profile(admin,{name:'',username:'admin'}),/Invalid name/);
 assert.throws(()=>s.changePassword(admin,{currentPassword:'WrongPassword1',newPassword:'NewPassword123'}),/current password/);
 assert.throws(()=>s.changePassword(admin,{currentPassword:'CorrectHorse42!',newPassword:'fives'}),/6–128/);
 assert.deepEqual(s.changePassword(admin,{currentPassword:'CorrectHorse42!',newPassword:'SixSix'}),{ok:true});
 assert.ok(s.login({username:'admin',password:'SixSix'}).user.id);
 assert.deepEqual(s.changePassword(admin,{currentPassword:'SixSix',newPassword:'CorrectHorse42!'}),{ok:true});
 assert.throws(()=>s.changePassword(admin,{currentPassword:'CorrectHorse42!',newPassword:'CorrectHorse42!'}),/different/);
 assert.deepEqual(s.changePassword(admin,{currentPassword:'CorrectHorse42!',newPassword:'NewPassword123'}),{ok:true});
 assert.ok(s.login({username:'admin',password:'NewPassword123'}).user.id);
 assert.throws(()=>s.login({username:'admin',password:'CorrectHorse42!'}),/Invalid/);
 s.settings(admin,{notify_low_stock:1,notify_expiry:0,notify_register:true,low_stock_days:45,receipt_footer:'Thank you'});
 const prefs=s.preferences(admin);
 assert.equal(prefs.notify_low_stock,'1');assert.equal(prefs.notify_expiry,'0');assert.equal(prefs.notify_register,'1');
 assert.equal(prefs.low_stock_days,'45');assert.equal(prefs.receipt_footer,'Thank you');
 // Receipt layout: template, paper and copy count feed the printed receipt.
 assert.equal(prefs.receipt_template,'classic');assert.equal(prefs.receipt_paper,'80mm');assert.equal(prefs.receipt_copies,'1');
 s.settings(admin,{receipt_template:'boxed',receipt_paper:'58mm',receipt_copies:3});
 assert.equal(s.preferences(admin).receipt_template,'boxed');assert.equal(s.preferences(admin).receipt_paper,'58mm');assert.equal(s.preferences(admin).receipt_copies,'3');
 s.settings(admin,{theme:'system'});assert.equal(s.preferences(admin).theme,'system');s.settings(admin,{theme:'dark'});assert.equal(s.preferences(admin).theme,'dark');
 s.settings(admin,{auto_backup:0,backup_on_close:0,backup_copies:7});
 assert.equal(s.preferences(admin).auto_backup,'0');assert.equal(s.preferences(admin).backup_on_close,'0');assert.equal(s.preferences(admin).backup_copies,'7');
 s.settings(admin,{backup_folder:'C:\\Users\\A\\Documents\\PharmaCare-Backups'});assert.equal(s.preferences(admin).backup_folder,'C:\\Users\\A\\Documents\\PharmaCare-Backups');
 assert.throws(()=>s.settings(admin,{backup_folder:'relative\\folder'}),/backup folder/);
 assert.throws(()=>s.settings(admin,{backup_copies:0}),/[Cc]opies/);
 assert.throws(()=>s.settings(admin,{backup_copies:999}),/[Cc]opies/);
 assert.throws(()=>s.settings(admin,{theme:'neon'}),/theme/);
 assert.throws(()=>s.preference(admin,{theme:'neon'}),/theme/);
 assert.throws(()=>s.settings(admin,{receipt_template:'fancy'}),/receipt template/);
 assert.throws(()=>s.settings(admin,{receipt_paper:'A5'}),/paper size/);
 assert.throws(()=>s.settings(admin,{receipt_copies:9}),/copies/);
 // Notification switches from the Settings panel, including the newer ones.
 s.settings(admin,{notify_out_of_stock:0,notify_daily_summary:1,notify_sound:1,notify_desktop:1});
 const alerts=s.preferences(admin);
 assert.equal(alerts.notify_out_of_stock,'0');assert.equal(alerts.notify_daily_summary,'1');
 assert.equal(alerts.notify_sound,'1');assert.equal(alerts.notify_desktop,'1');
 s.settings(admin,{notify_sound:'true',notify_desktop:0});
 assert.equal(s.preferences(admin).notify_sound,'1');assert.equal(s.preferences(admin).notify_desktop,'0');
 // Everyone may change their own profile, even without the users module.
 const cashierUser=s.saveUser(admin,{username:'cashier7',name:'Cashier Seven',password:'CashierPassword1',role:'cashier',active:1,permissions:{users:false}}).id;
 const cashier=s.get('SELECT * FROM users WHERE id=?',cashierUser);
 assert.equal(s.profile(cashier,{name:'Cashier Renamed',username:'cashier7'}).name,'Cashier Renamed');
 assert.throws(()=>s.saveUser(cashier,{username:'cashier7',name:'x',role:'cashier',active:1}),/permission/);
});

test('receipt renderer: the printed bill, templates, paper and copies',()=>{
 const {receiptHTML}=require('../database/pdf');
 const {amountInWords}=require('../database/words');
 const data={invoice_no:'INV-1001',date:'2026-10-28 13:11:00',cashier:'Ahmad Nadeem',doctor:'Dr. Karimi',patientName:'Bilal',items:[{name:'ZEDSON 0.4mg(10)',quantity:1,price:70},{name:'CRANBERRY',quantity:1,price:70},{name:'SNOBUFEN 400MG',quantity:1,price:20},{name:'CLARITEC 500MG',quantity:1,price:110}],subtotal:270,discount:0,total:270};
 const preferences={pharmacy_name:'Ibne Sina Pharmacy',phone:'493 711900100',address:'Arzan Qemat',currency:'AFN',receipt_template:'classic',receipt_paper:'80mm',receipt_copies:1,receipt_footer:'Get well soon'};
 const bill=receiptHTML(data,preferences);
 // Header: pharmacy name and phone, like the paper bill.
 assert.ok(bill.includes('Ibse Sina Pharmacy'.replace('Ibse','Ibne')),'pharmacy name in the header');
 assert.ok(bill.includes('Phone: 493 711900100'));
 assert.ok(bill.includes('Arzan Qemat'));
 // Meta block: #, Name, Date, Time, Dr, Item.
 for(const label of ['#:','Name:','Date:','Time:','Dr:','Item:'])assert.ok(bill.includes(label),label+' label');
 assert.ok(bill.includes('INV-1001'));assert.ok(bill.includes('2026-10-28'));assert.ok(bill.includes('13:11'));
 assert.ok(bill.includes('Dr. Karimi'));assert.ok(bill.includes('Bilal'));
 // Four-column item table with the quantities and line totals.
 for(const head of ['Description','Qty','Price','Total'])assert.ok(bill.includes('>'+head+'<'),head+' column');
 assert.ok(bill.includes('ZEDSON 0.4mg(10)'));
 assert.ok(bill.includes('<td class="num">110.00</td>'));
 // Totals with the currency after the amount, then the amount in words.
 assert.ok(bill.includes('Total Amount:'));
 assert.ok(bill.includes('Total Discount:'));
 assert.ok(bill.includes('Grand Total:'));
 assert.ok(bill.includes('270.00 AFN'));
 assert.ok(bill.includes('Two Hundred Seventy Only'));
 assert.ok(bill.includes('Printed By:'));assert.ok(bill.includes('Ahmad Nadeem'));
 assert.ok(bill.includes('Get well soon'));
 // Copies repeat the whole bill, one page each.
 const copies=receiptHTML({...data,total:40,subtotal:40},{...preferences,receipt_copies:3});
 assert.equal(copies.match(/<section class="receipt/g).length,3);
 // Templates: classic is the boxed bill, compact drops the borders, boxed frames.
 assert.ok(receiptHTML(data,{...preferences,receipt_template:'compact'}).includes('t-compact p-80mm'));
 assert.ok(receiptHTML(data,{...preferences,receipt_template:'boxed',receipt_paper:'58mm'}).includes('t-boxed p-58mm'));
 const fallback=receiptHTML(data,{receipt_template:'fancy',receipt_paper:'A5',receipt_copies:0});
 assert.ok(fallback.includes('t-classic'));assert.ok(fallback.includes('p-80mm'));
 assert.equal(fallback.match(/<section class="receipt/g).length,1,'unknown copies fall back to one');
 // A database-created receipt without a doctor or patient still prints its labels.
 const plain=receiptHTML({invoice_no:'INV-2',date:'2026-01-01 09:00:00',items:[],subtotal:0,discount:0,total:0},{receipt_template:'classic'});
 assert.ok(plain.includes('Dr:</span><b>General</b>'));
 assert.ok(plain.includes('Name:</span><b>Walk-in</b>'));
 assert.ok(plain.includes('Zero Only'));
 // Amount in words.
 assert.equal(amountInWords(0),'Zero');assert.equal(amountInWords(7),'Seven');assert.equal(amountInWords(18),'Eighteen');
 assert.equal(amountInWords(270),'Two Hundred Seventy');assert.equal(amountInWords(1005),'One Thousand Five');
 assert.equal(amountInWords(1234),'One Thousand Two Hundred Thirty-Four');assert.equal(amountInWords(100000),'One Hundred Thousand');
 // Escaping.
 const escaped=receiptHTML({...data,items:[{name:'<script>x</script>',quantity:1,price:1}]},preferences);
 assert.ok(!escaped.includes('<script>'),'item names are escaped');
});