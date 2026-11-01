'use strict';
const { entities, modules, rolePermissions, cleanEntity } = require('./catalog');
const { hashPassword, verifyPassword, transaction, audit } = require('./database');
const crypto = require('node:crypto');
const round = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const fail = message => { throw new Error(message); };
const id = (v,label='record') => { const n = Number(v); if (!Number.isSafeInteger(n) || n < 1) fail(`Invalid ${label} ID.`); return n; };
const number = (v, label, min = 0, max = 1e10) => { const n = Number(v); if (!Number.isFinite(n) || n < min || n > max) fail(`Invalid ${label}.`); return n; };
const integer = (v, label, min = 1) => { const n = number(v, label, min, 1000000); if (!Number.isSafeInteger(n)) fail(`${label} must be a whole number.`); return n; };
const text = (v, label, required = false, max = 2000) => { const s = String(v ?? '').trim(); if ((required && !s) || s.length > max) fail(`Invalid ${label}.`); return s; };
const date = v => { const s = text(v, 'date', true, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s)) || new Date(s).toISOString().slice(0,10) !== s) fail('Invalid date.'); return s; };
const method = v => { if (!['cash','bank','credit'].includes(v)) fail('Invalid payment method.'); return v; };
const bool = v => Number(v) ? 1 : 0;
const sum = (rows, key) => round(rows.reduce((a,r) => a + Number(r[key] || 0), 0));

class PharmacyService {
  constructor(db) { this.db = db; }
  get(sql, ...params) { return this.db.prepare(sql).get(...params); }
  all(sql, ...params) { return this.db.prepare(sql).all(...params); }
  run(sql, ...params) { return this.db.prepare(sql).run(...params); }
  setting(key) { return this.get('SELECT value FROM settings WHERE key=?', key)?.value || ''; }
  permissions(user) {
    if (!user) return [];
    const overrides = JSON.parse(user.permissions || '{}');
    return modules.filter(m => overrides[m] === undefined ? rolePermissions[user.role].includes(m) : overrides[m] === true);
  }
  require(user, permission, write = false) {
    if (!user?.active) fail('Please sign in.');
    if (!this.permissions(user).includes(permission)) fail('You do not have permission for this action.');
    if (write && ['categories','manufacturers','patients','customers','suppliers','staff','locations','accounts'].includes(permission) && user.role === 'cashier') fail('Read-only access.');
  }
  session() { return this.get("SELECT * FROM cash_sessions WHERE status='open'"); }
  journal(user, description, lines, reference = '') {
    const clean = lines.filter(l => l[1] > 0 || l[2] > 0).map(l => [id(l[0]), round(l[1]), round(l[2] || 0)]);
    if (!clean.length) return null;
    if (clean.length < 2 || Math.abs(sum(clean.map(l => ({v:l[1]})), 'v') - sum(clean.map(l => ({v:l[2]})), 'v')) > 0.005) fail('Accounting entry is not balanced.');
    const sessionId = this.session()?.id || null;
    const result = this.run('INSERT INTO journals(description,reference,user_id,session_id) VALUES(?,?,?,?)', description, reference, user.id, sessionId);
    for (const [account, debit, credit] of clean) this.run('INSERT INTO journal_lines(journal_id,account_id,debit,credit) VALUES(?,?,?,?)', result.lastInsertRowid, account, debit, credit);
    return Number(result.lastInsertRowid);
  }
  paymentAccount(value, paymentMethod) {
    const account = this.get('SELECT * FROM accounts WHERE id=? AND active=1 AND type=?', id(value || (paymentMethod === 'bank' ? 2 : 1),'cash/bank account'), 'asset');
    if (!account || !['1000','1010'].includes(account.code) && !account.code.startsWith('101')) fail('Choose a cash or bank account.');
    if (account.id === 1 || account.code === '1000') {
      if (paymentMethod !== 'cash') fail('Cash account requires cash payment.');
      if (!this.session()) fail('Open the cash register before taking or paying cash.');
    } else if (paymentMethod !== 'bank') fail('Bank account requires bank payment.');
    return account;
  }
  move(batchId, quantity, reason, reference, user) {
    const batch = this.get('SELECT * FROM batches WHERE id=?', id(batchId));
    if (!batch || batch.quantity + quantity < 0) fail('Insufficient stock for this operation.');
    this.run('UPDATE batches SET quantity=quantity+? WHERE id=?', quantity, batch.id);
    this.run('INSERT INTO stock_movements(batch_id,quantity,reason,reference,user_id) VALUES(?,?,?,?,?)', batch.id, quantity, reason, reference, user.id);
    return batch;
  }
  party(type, partyId) {
    const table = type === 'customer' ? 'customers' : 'suppliers';
    const party = this.get(`SELECT * FROM ${table} WHERE id=? AND active=1`, id(partyId));
    if (!party) fail('Active party record not found.');
    const invoice = type === 'customer' ? 'sales' : 'purchases';
    const invoices = this.get(`SELECT COALESCE(SUM(total-paid),0) AS balance FROM ${invoice} WHERE ${type}_id=?`, party.id).balance;
    const returns = this.get(`SELECT COALESCE(SUM(r.credit_amount),0) AS balance FROM ${type === 'customer' ? 'sale_returns r JOIN sales i ON i.id=r.sale_id' : 'purchase_returns r JOIN purchases i ON i.id=r.purchase_id'} WHERE i.${type}_id=?`, party.id).balance;
    const payments = this.get('SELECT COALESCE(SUM(amount),0) AS balance FROM payments WHERE party_type=? AND party_id=?', type, party.id).balance;
    return { ...party, balance: round(party.opening_balance + invoices - returns - payments) };
  }
  bootstrap() { return { initialized: !!this.get('SELECT id FROM users LIMIT 1'), pharmacyName: this.setting('pharmacy_name') }; }
  setup(input) {
    if (this.get('SELECT id FROM users LIMIT 1')) fail('Setup has already been completed.');
    const username = text(input.username, 'username', true, 40).toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) fail('Username must be 3–40 letters, numbers, dots or underscores.');
    const password = String(input.password || '');
    if (password.length < 10 || password.length > 128) fail('Password must contain 10–128 characters.');
    const name = text(input.name, 'name', true, 100);
    const pharmacyName = text(input.pharmacyName, 'pharmacy name', true, 120);
    return transaction(this.db, () => {
      const r = this.run('INSERT INTO users(username,name,password_hash,role) VALUES(?,?,?,?)', username, name, hashPassword(password), 'admin');
      this.run('UPDATE settings SET value=? WHERE key=?', pharmacyName, 'pharmacy_name');
      const user = this.get('SELECT * FROM users WHERE id=?', r.lastInsertRowid);
      audit(this.db, user, 'setup', 'users', user.id);
      return { user: this.publicUser(user), permissions: this.permissions(user) };
    });
  }
  publicUser(user) { return { id: user.id, username: user.username, name: user.name, role: user.role, active: user.active }; }
  login(input) {
    const username = text(input.username, 'username', true, 40).toLowerCase();
    const password = String(input.password || '');
    if (password.length > 128) fail('Invalid username or password.');
    const user = this.get('SELECT * FROM users WHERE username=?', username);
    const dummy = 'scrypt:32768:00000000000000000000000000000000:' + '0'.repeat(128);
    const valid = verifyPassword(password, user?.password_hash || dummy);
    if (!user?.active || !valid) { audit(this.db, null, 'login_failed', 'users', username); fail('Invalid username or password.'); }
    audit(this.db, user, 'login', 'users', user.id);
    return { user: this.publicUser(user), permissions: this.permissions(user) };
  }
  list(user, entity, query = {}) {
    if (entity === 'users') { this.require(user, 'users'); return { rows: this.all('SELECT id,username,name,role,permissions,active,created_at FROM users ORDER BY id'), total: this.get('SELECT COUNT(*) AS n FROM users').n }; }
    const config = entities[entity];
    if (!config) fail('Unknown module.');
    this.require(user, config.permission);
    const search = text(query.search, 'search', false, 100);
    const limit = Math.min(200, integer(query.limit || 100, 'limit'));
    const offset = integer(query.offset || 0, 'offset', 0);
    const searchable = Object.keys(config.fields).filter(f => ['name','sku','barcode','generic_name','phone','code','position'].includes(f));
    const where = search ? ' WHERE ' + searchable.map(f => `${f} LIKE ? ESCAPE '\\'`).join(' OR ') : '';
    const term = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = this.all(`SELECT * FROM ${entity}${where} ORDER BY id DESC LIMIT ? OFFSET ?`, ...(search ? searchable.map(() => term) : []), limit, offset);
    const total = this.get(`SELECT COUNT(*) AS n FROM ${entity}${where}`, ...(search ? searchable.map(() => term) : [])).n;
    if (entity === 'customers' || entity === 'suppliers') return { rows: rows.map(r => ({...r, balance: this.party(entity.slice(0,-1), r.id).balance})), total };
    if (entity === 'medicines') return { rows: rows.map(r => ({...r, stock: this.get('SELECT COALESCE(SUM(quantity),0) AS n FROM batches WHERE medicine_id=?',r.id).n})), total };
    return { rows, total };
  }
  saveEntity(user, entity, input) {
    const config = entities[entity];
    if (!config) fail('Unknown module.');
    this.require(user, config.permission, true);
    const recordId = input.id ? id(input.id) : null;
    const old = recordId ? this.get(`SELECT * FROM ${entity} WHERE id=?`, recordId) : null;
    if (recordId && !old) fail('Record not found.');
    const data = cleanEntity(entity, input, !!old);
    if (old && ['customers','suppliers'].includes(entity) && old.opening_balance !== data.opening_balance) fail('Opening balances cannot be edited after creation. Use a payment or accounting adjustment.');
    if (entity === 'accounts' && old?.system && (old.code !== data.code || old.type !== data.type || !data.active)) fail('System accounts cannot be renamed, disabled or reclassified.');
    return transaction(this.db, () => {
      let recordIdFinal;
      if (old) {
        this.run(`UPDATE ${entity} SET ${Object.keys(data).map(k => `${k}=?`).join(',')} WHERE id=?`, ...Object.values(data), recordId);
        recordIdFinal = recordId;
      } else {
        const r = this.run(`INSERT INTO ${entity}(${Object.keys(data).join(',')}) VALUES(${Object.keys(data).map(() => '?').join(',')})`, ...Object.values(data));
        recordIdFinal = Number(r.lastInsertRowid);
        if (['customers','suppliers'].includes(entity) && data.opening_balance > 0) this.journal(user, 'Opening party balance', entity === 'customers' ? [[3,data.opening_balance],[8,0,data.opening_balance]] : [[8,data.opening_balance],[6,0,data.opening_balance]], `${entity}:${recordIdFinal}`);
      }
      audit(this.db, user, old ? 'update' : 'create', entity, recordIdFinal, { name: data.name || data.sku });
      return { id: recordIdFinal };
    });
  }
  catalog(user, search = '') {
    this.require(user, 'pos');
    const term = `%${text(search,'search',false,100).replace(/[\\%_]/g,'\\$&')}%`;
    return this.all(`SELECT m.*, c.name AS category, COALESCE(SUM(CASE WHEN b.expiry>=date('now') THEN b.quantity ELSE 0 END),0) AS stock FROM medicines m LEFT JOIN categories c ON c.id=m.category_id LEFT JOIN batches b ON b.medicine_id=m.id WHERE m.active=1 AND (m.name LIKE ? ESCAPE '\\' OR m.sku LIKE ? ESCAPE '\\' OR m.barcode LIKE ? ESCAPE '\\' OR m.generic_name LIKE ? ESCAPE '\\') GROUP BY m.id ORDER BY m.name LIMIT 100`,term,term,term,term);
  }
  options(user) {
    this.require(user, 'dashboard');
    const result = {};
    for (const [key, table, permission] of [['categories','categories','categories'],['manufacturers','manufacturers','manufacturers'],['customers','customers','customers'],['suppliers','suppliers','suppliers'],['patients','patients','patients'],['staff','staff','staff'],['locations','locations','inventory'],['medicines','medicines','inventory']]) {
      if (this.permissions(user).includes(permission)) result[key] = this.all(`SELECT id,name FROM ${table} WHERE active=1 ORDER BY name LIMIT 1000`);
    }
    result.accounts = this.all("SELECT id,name,code,type FROM accounts WHERE active=1 AND (code='1000' OR code LIKE '101%') ORDER BY code");
    result.batches = this.all('SELECT b.id,m.name,b.batch_no,b.expiry,b.quantity,b.cost,l.name AS location FROM batches b JOIN medicines m ON m.id=b.medicine_id JOIN locations l ON l.id=b.location_id WHERE b.quantity>0 ORDER BY b.expiry LIMIT 2000');
    return result;
  }
  sale(user, input) {
    this.require(user, 'pos', true);
    if (!Array.isArray(input.items) || !input.items.length || input.items.length > 100) fail('Add between 1 and 100 items.');
    const payment = method(input.paymentMethod);
    const customer = input.customerId ? this.party('customer', input.customerId) : null;
    const prescription = input.prescriptionId ? this.get("SELECT * FROM prescriptions WHERE id=? AND status='pending'",id(input.prescriptionId)) : null;
    if (input.prescriptionId && !prescription) fail('Choose a pending prescription.');
    return transaction(this.db, () => {
      const prepared = input.items.map(item => {
        const medicine = this.get('SELECT * FROM medicines WHERE id=? AND active=1', id(item.medicineId));
        if (!medicine) fail('Medicine is unavailable.');
        const quantity = integer(item.quantity, 'quantity');
        if (medicine.rx_required && (!prescription || prescription.patient_id !== Number(input.patientId))) fail('A matching patient prescription is required for prescription-only medicines.');
        const batches = item.batchId ? this.all("SELECT * FROM batches WHERE id=? AND medicine_id=? AND expiry>=date('now') AND quantity>0",id(item.batchId),medicine.id) : this.all("SELECT * FROM batches WHERE medicine_id=? AND expiry>=date('now') AND quantity>0 ORDER BY expiry,id",medicine.id);
        if (sum(batches,'quantity') < quantity) fail(`Insufficient unexpired stock for ${medicine.name}.`);
        return { medicine, quantity, batches };
      });
      const subtotal = round(prepared.reduce((a,p) => a + p.medicine.price*p.quantity,0));
      let discount = round(number(input.discount || 0,'discount'));
      if (input.offerId) {
        const offer = this.get("SELECT * FROM offers WHERE id=? AND active=1 AND date('now') BETWEEN starts AND ends",id(input.offerId));
        if (!offer || subtotal < offer.min_total) fail('Offer is not available for this sale.');
        discount = round(Math.min(subtotal, Math.max(discount, offer.kind === 'percent' ? subtotal*offer.value/100 : offer.value)));
      }
      if (discount > subtotal) fail('Discount cannot exceed subtotal.');
      const tax = round((subtotal-discount)*number(this.setting('tax_percent'),'tax',0,100)/100);
      const total = round(subtotal-discount+tax);
      const paid = payment === 'credit' ? 0 : round(number(input.paid ?? total,'paid'));
      if (paid > total || (payment !== 'credit' && paid !== total)) fail('Enter the exact non-cash total, or the full cash amount. Split tender is not supported.');
      const due = round(total-paid);
      if (due > 0 && !customer) fail('Credit sales require a customer.');
      if (due > 0 && customer.credit_limit > 0 && customer.balance+due > customer.credit_limit) fail('Customer credit limit would be exceeded.');
      const account = payment === 'credit' ? null : this.paymentAccount(input.accountId,payment);
      const invoice = 'INV-' + Date.now() + '-' + Math.floor(Math.random()*1000);
      const r = this.run('INSERT INTO sales(invoice_no,customer_id,patient_id,prescription_id,subtotal,discount,tax,total,paid,payment_method,user_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)',invoice,customer?.id||null,prescription?.patient_id||null,prescription?.id||null,subtotal,discount,tax,total,paid,payment,user.id);
      const saleId = Number(r.lastInsertRowid);
      let cogs = 0;
      for (const p of prepared) {
        let remaining = p.quantity;
        for (const batch of p.batches) {
          if (!remaining) break;
          const qty = Math.min(remaining,batch.quantity);
          this.move(batch.id,-qty,'sale',invoice,user);
          this.run('INSERT INTO sale_items(sale_id,medicine_id,batch_id,quantity,price,cost) VALUES(?,?,?,?,?,?)',saleId,p.medicine.id,batch.id,qty,p.medicine.price,batch.cost);
          cogs += qty*batch.cost; remaining -= qty;
        }
      }
      this.journal(user,'Medicine sale',[[account?.id,paid],[3,due],[11,discount],[9,0,subtotal],[7,0,tax]],invoice);
      this.journal(user,'Cost of sale',[[12,round(cogs)],[4,0,round(cogs)]],invoice);
      if (prescription) this.run("UPDATE prescriptions SET status='dispensed',sale_id=? WHERE id=?",saleId,prescription.id);
      audit(this.db,user,'checkout','sales',saleId,{invoice,total});
      return { id: saleId, invoice, total, paid, change: 0 };
    });
  }
  documents(user, type, query = {}) {
    const config = { sales:['sales','sales'], purchases:['purchases','purchases'], payments:['payments','finance'], expenses:['expenses','finance'], advances:['advances','staff'], salaries:['salaries','staff'], transfers:['transfers','transfers'], adjustments:['adjustments','adjustments'], prescriptions:['prescriptions','prescriptions'], stockcount:['stock_counts','stockcount'], audit:['audit_logs','audit'] }[type];
    if (!config) fail('Unknown history.');
    this.require(user,config[1]);
    const from = query.from ? date(query.from) : '0000-01-01';
    const to = query.to ? date(query.to) : '9999-12-31';
    if (from > to) fail('Start date must be before end date.');
    const limit = Math.min(500,integer(query.limit||200,'limit'));
    const table = config[0];
    let sql = `SELECT * FROM ${table}`;
    const dateField = type==='audit' ? 'created_at' : 'date';
    sql += ` WHERE date(${dateField}) BETWEEN ? AND ? ORDER BY id DESC LIMIT ?`;
    const rows = this.all(sql,from,to,limit);
    return rows.map(row => {
      if (type==='sales') return {...row,customer:this.get('SELECT name FROM customers WHERE id=?',row.customer_id)?.name||'Walk-in',returns:this.get('SELECT COALESCE(SUM(total),0) AS n FROM sale_returns WHERE sale_id=?',row.id).n};
      if (type==='purchases') return {...row,supplier:this.get('SELECT name FROM suppliers WHERE id=?',row.supplier_id)?.name};
      if (type==='payments') return {...row,party:this.get(`SELECT name FROM ${row.party_type==='customer'?'customers':'suppliers'} WHERE id=?`,row.party_id)?.name};
      if (['advances','salaries'].includes(type)) return {...row,staff:this.get('SELECT name FROM staff WHERE id=?',row.staff_id)?.name};
      if (type==='prescriptions') return {...row,patient:this.get('SELECT name FROM patients WHERE id=?',row.patient_id)?.name,attachment:undefined};
      return row;
    });
  }
  document(user,type,value) {
    this.require(user,type==='purchase'?'purchases':type==='sale'?'sales':'stockcount');
    const table = type==='sale'?'sales':type==='purchase'?'purchases':'stock_counts';
    const row = this.get(`SELECT * FROM ${table} WHERE id=?`,id(value));
    if (!row) fail('Document not found.');
    const items = type==='stockcount' ? this.all('SELECT i.*,m.name,b.batch_no FROM stock_count_items i JOIN batches b ON b.id=i.batch_id JOIN medicines m ON m.id=b.medicine_id WHERE count_id=?',row.id) : this.all(`SELECT i.*,m.name,b.batch_no,b.expiry FROM ${type}_items i JOIN medicines m ON m.id=i.medicine_id JOIN batches b ON b.id=i.batch_id WHERE ${type}_id=?`,row.id);
    const party = type==='sale' ? (row.customer_id?this.party('customer',row.customer_id):null) : type==='purchase'?this.party('supplier',row.supplier_id):null;
    return {...row,items,party,returns:type==='stockcount'?[]:this.all(`SELECT * FROM ${type}_returns WHERE ${type}_id=?`,row.id)};
  }
  receivePurchase(user,input) {
    this.require(user,'purchases',true);
    const supplier = this.party('supplier',id(input.supplierId,'supplier'));
    const invoice = text(input.invoiceNo,'invoice number',true,80);
    const payment = method(input.paymentMethod);
    if (!Array.isArray(input.items)||!input.items.length||input.items.length>100) fail('Add purchase items.');
    return transaction(this.db,()=>{
      const purchaseDiscount=round(number(input.discount||0,'discount'));
      const purchaseSubtotal=round(input.items.reduce((a,i)=>a+integer(i.quantity,'quantity')*round(number(i.cost,'cost',0.01)),0));
      if(purchaseDiscount>purchaseSubtotal)fail('Discount exceeds subtotal.');
      const items = input.items.map(item=>{
        const medicine=this.get('SELECT * FROM medicines WHERE id=? AND active=1',id(item.medicineId,'medicine'));
        if(!medicine) fail('Medicine not found.');
        const expiry=date(item.expiry); if(expiry<=new Date().toISOString().slice(0,10)) fail('Expiry must be in the future.');
        return {medicine,location:id(item.locationId||1,'location'),batch:text(item.batchNo,'batch number',true,80),expiry,quantity:integer(item.quantity,'quantity'),grossCost:round(number(item.cost,'cost',0.01)),cost:round(number(item.cost,'cost',0.01)*(1-purchaseDiscount/purchaseSubtotal))};
      });
      const subtotal=round(items.reduce((a,i)=>a+i.quantity*i.cost,0));
      const discount=round(number(input.discount||0,'discount')); if(discount>subtotal) fail('Discount exceeds subtotal.');
      const total=round(subtotal-discount),paid=payment==='credit'?0:total;
      const account=payment==='credit'?null:this.paymentAccount(input.accountId,payment);
      const r=this.run('INSERT INTO purchases(invoice_no,supplier_id,subtotal,discount,total,paid,payment_method,user_id) VALUES(?,?,?,?,?,?,?,?)',invoice,supplier.id,subtotal,discount,total,paid,payment,user.id);
      const purchaseId=Number(r.lastInsertRowid);
      for(const item of items){
        const existing=this.get('SELECT * FROM batches WHERE medicine_id=? AND location_id=? AND batch_no=? AND expiry=?',item.medicine.id,item.location,item.batch,item.expiry);
        if(existing&&existing.quantity>0&&Math.abs(existing.cost-item.cost)>0.005)fail('An in-stock batch cannot change cost. Use a new batch number for a different delivery cost.');
        this.run('INSERT INTO batches(medicine_id,location_id,batch_no,expiry,cost,quantity) VALUES(?,?,?,?,?,0) ON CONFLICT(medicine_id,location_id,batch_no,expiry) DO UPDATE SET cost=excluded.cost',item.medicine.id,item.location,item.batch,item.expiry,item.cost);
        const batch=this.get('SELECT * FROM batches WHERE medicine_id=? AND location_id=? AND batch_no=? AND expiry=?',item.medicine.id,item.location,item.batch,item.expiry);
        this.move(batch.id,item.quantity,'purchase',invoice,user);
        this.run('INSERT INTO purchase_items(purchase_id,medicine_id,batch_id,quantity,cost) VALUES(?,?,?,?,?)',purchaseId,item.medicine.id,batch.id,item.quantity,item.grossCost);
        this.run('UPDATE medicines SET cost=? WHERE id=?',round(item.cost),item.medicine.id);
      }
      this.journal(user,'Inventory purchase',[[4,total],[account?.id,0,paid],[6,0,total-paid]],`PUR-${purchaseId}`);
      audit(this.db,user,'receive','purchases',purchaseId,{invoice,total}); return {id:purchaseId,total};
    });
  }
  returnDocument(user,type,input) {
    this.require(user,type==='sale'?'sales':'purchases',true);
    if(!['sale','purchase'].includes(type)) fail('Invalid return type.');
    if(!Array.isArray(input.items)||!input.items.length||input.items.length>100) fail('Choose items to return.');
    const reason=text(input.reason,'return reason',true);
    return transaction(this.db,()=>{
      const doc=this.get(`SELECT * FROM ${type==='sale'?'sales':'purchases'} WHERE id=?`,id(input.documentId));
      if(!doc) fail('Original invoice not found.');
      const selected=new Map();
      for(const item of input.items){const itemId=id(item.itemId);if(selected.has(itemId)) fail('Duplicate return item.');selected.set(itemId,{quantity:integer(item.quantity,'return quantity'),restock:type==='sale'?bool(item.restock):1});}
      let total=0; const prepared=[];
      for(const [itemId,choice] of selected){
        const item=this.get(`SELECT * FROM ${type}_items WHERE id=? AND ${type}_id=?`,itemId,doc.id);
        if(!item||item.returned_qty+choice.quantity>item.quantity) fail('Return exceeds the original unreturned quantity.');
        const amount=type==='sale'?round(item.price*choice.quantity*(doc.subtotal?doc.total/doc.subtotal:0)):round(item.cost*choice.quantity*(doc.total/doc.subtotal));
        total+=amount;prepared.push({item,...choice,amount});
      }
      total=round(total);
      const prior=this.get(`SELECT COALESCE(SUM(total),0) AS n FROM ${type}_returns WHERE ${type}_id=?`,doc.id).n;
      if(prior+total>doc.total+0.005) fail('Return exceeds invoice value.');
      const partyType=type==='sale'?'customer':'supplier';
      const partyId=type==='sale'?doc.customer_id:doc.supplier_id;
      const party=partyId?this.party(partyType,partyId):null;
      const credit=party?Math.min(total,Math.max(0,party.balance)):0;
      const refund=round(total-credit);
      const payment=refund>0?method(input.method||doc.payment_method):'credit';
      if(payment==='credit'&&refund>0) fail('A walk-in return must be refunded by cash or bank.');
      const account=refund>0?this.paymentAccount(input.accountId,payment):null;
      const r=this.run(`INSERT INTO ${type}_returns(${type}_id,total,credit_amount,reason,method,user_id) VALUES(?,?,?,?,?,?)`,doc.id,total,credit,reason,payment,user.id);
      const returnId=Number(r.lastInsertRowid);
      let inventoryValue=0,writeoff=0;
      for(const p of prepared){
        this.run(`UPDATE ${type}_items SET returned_qty=returned_qty+? WHERE id=?`,p.quantity,p.item.id);
        this.run(`INSERT INTO ${type}_return_items(return_id,${type}_item_id,quantity${type==='sale'?',restock':''}) VALUES(?,?,?${type==='sale'?',?':''})`,returnId,p.item.id,p.quantity,...(type==='sale'?[p.restock]:[]));
        const batch=this.get('SELECT * FROM batches WHERE id=?',p.item.batch_id);
        const unitCost=type==='sale'?p.item.cost:round(p.item.cost*doc.total/doc.subtotal);
        if(type==='purchase'||p.restock){this.move(batch.id,type==='sale'?p.quantity:-p.quantity,`${type}_return`,String(returnId),user);inventoryValue+=p.quantity*unitCost;}
        else writeoff+=p.quantity*unitCost;
      }
      if(type==='sale'){
        const ratio=doc.subtotal?doc.total/doc.subtotal:0;
        const net=doc.subtotal?round(total*(doc.subtotal-doc.discount)/doc.subtotal):0,tax=round(total-net);
        this.journal(user,'Customer return',[[10,net],[7,tax],[3,0,credit],[account?.id,0,refund]],`RET-${returnId}`);
        this.journal(user,'Return inventory',[[4,round(inventoryValue)],[15,round(writeoff)],[12,0,round(inventoryValue+writeoff)]],`RET-${returnId}`);
        this.run("UPDATE sales SET status=CASE WHEN (SELECT SUM(returned_qty) FROM sale_items WHERE sale_id=?)=(SELECT SUM(quantity) FROM sale_items WHERE sale_id=?) THEN 'returned' ELSE 'partial_return' END WHERE id=?",doc.id,doc.id,doc.id);
      }else{
        this.journal(user,'Supplier return',[[6,credit],[account?.id,refund],[4,0,total]],`PRET-${returnId}`);
        this.run("UPDATE purchases SET status='partial_return' WHERE id=?",doc.id);
      }
      audit(this.db,user,'return',`${type}_returns`,returnId,{total,reason});return {id:returnId,total,refund,credit};
    });
  }
  partyPayment(user,input) {
    if (!['customer','supplier'].includes(input.partyType)) fail('Invalid party type.');
    const type=input.partyType; this.require(user,type==='customer'?'customers':'finance',true);
    const party=this.party(type,input.partyId),amount=round(number(input.amount,'amount',0.01));
    if(amount>party.balance+0.005) fail('Payment exceeds outstanding balance.');
    const payment=method(input.method);if(payment==='credit') fail('Choose cash or bank.');
    const account=this.paymentAccount(input.accountId,payment);
    return transaction(this.db,()=>{
      const r=this.run('INSERT INTO payments(party_type,party_id,direction,amount,account_id,method,reference,user_id) VALUES(?,?,?,?,?,?,?,?)',type,party.id,type==='customer'?'in':'out',amount,account.id,payment,text(input.reference,'reference'),user.id);
      const paymentId=Number(r.lastInsertRowid);
      let remaining=amount;
      const invoices=this.all(`SELECT i.* FROM ${type==='customer'?'sales':'purchases'} i WHERE i.${type}_id=? AND i.total>i.paid ORDER BY i.date,i.id`,party.id);
      for(const invoice of invoices){
        const returns=this.get(`SELECT COALESCE(SUM(credit_amount),0) AS n FROM ${type==='customer'?'sale_returns':'purchase_returns'} WHERE ${type==='customer'?'sale':'purchase'}_id=?`,invoice.id).n;
        const allocated=this.get('SELECT COALESCE(SUM(a.amount),0) AS n FROM payment_allocations a WHERE a.invoice_type=? AND a.invoice_id=?',type==='customer'?'sale':'purchase',invoice.id).n;
        const due=Math.max(0,round(invoice.total-invoice.paid-returns-allocated));
        const value=Math.min(remaining,due);if(value<=0)continue;
        this.run('INSERT INTO payment_allocations(payment_id,invoice_type,invoice_id,amount) VALUES(?,?,?,?)',paymentId,type==='customer'?'sale':'purchase',invoice.id,value);remaining=round(remaining-value);if(!remaining)break;
      }
      this.journal(user,`${type} payment`,type==='customer'?[[account.id,amount],[3,0,amount]]:[[6,amount],[account.id,0,amount]],`PAY-${paymentId}`);
      audit(this.db,user,'payment','payments',paymentId,{type,amount});return {id:paymentId};
    });
  }
  expense(user,input) {
    this.require(user,'finance',true);const amount=round(number(input.amount,'amount',0.01)),payment=method(input.method);if(payment==='credit')fail('Expenses must be paid.');
    const account=this.paymentAccount(input.accountId,payment);
    return transaction(this.db,()=>{const r=this.run('INSERT INTO expenses(category,description,amount,account_id,user_id) VALUES(?,?,?,?,?)',text(input.category,'category',true,100),text(input.description,'description',true),amount,account.id,user.id);this.journal(user,'Operating expense',[[13,amount],[account.id,0,amount]],`EXP-${r.lastInsertRowid}`);audit(this.db,user,'create','expenses',r.lastInsertRowid,{amount});return {id:Number(r.lastInsertRowid)};});
  }
  advance(user,input) {
    this.require(user,'staff',true);const staff=this.get('SELECT * FROM staff WHERE id=? AND active=1',id(input.staffId));if(!staff)fail('Staff not found.');
    const amount=round(number(input.amount,'amount',0.01)),payment=method(input.method);if(payment==='credit')fail('Choose cash or bank.');const account=this.paymentAccount(input.accountId,payment);
    return transaction(this.db,()=>{const r=this.run('INSERT INTO advances(staff_id,amount,note,account_id,user_id) VALUES(?,?,?,?,?)',staff.id,amount,text(input.note,'note'),account.id,user.id);this.journal(user,'Staff advance',[[5,amount],[account.id,0,amount]],`ADV-${r.lastInsertRowid}`);audit(this.db,user,'create','advances',r.lastInsertRowid,{amount});return {id:Number(r.lastInsertRowid)};});
  }
  salary(user,input) {
    this.require(user,'staff',true);const staff=this.get('SELECT * FROM staff WHERE id=? AND active=1',id(input.staffId));if(!staff)fail('Staff not found.');
    const month=text(input.month,'month',true,7);if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))fail('Choose a valid month.');
    const gross=round(number(input.gross ?? staff.salary,'gross')),payment=method(input.method);if(payment==='credit')fail('Choose cash or bank.');const account=this.paymentAccount(input.accountId,payment);
    return transaction(this.db,()=>{
      if(this.get('SELECT id FROM salaries WHERE staff_id=? AND month=?',staff.id,month))fail('This staff member has already been paid for this month.');
      const advances=this.all('SELECT * FROM advances WHERE staff_id=? AND amount>repaid ORDER BY date,id',staff.id);
      const deduction=Math.min(gross,sum(advances.map(a=>({amount:a.amount-a.repaid})),'amount'));
      const net=round(gross-deduction);const r=this.run('INSERT INTO salaries(staff_id,month,gross,deduction,net,account_id,user_id) VALUES(?,?,?,?,?,?,?)',staff.id,month,gross,deduction,net,account.id,user.id);
      let remaining=deduction;for(const advance of advances){const value=Math.min(remaining,round(advance.amount-advance.repaid));if(value<=0)continue;this.run('UPDATE advances SET repaid=repaid+? WHERE id=?',value,advance.id);remaining=round(remaining-value);if(!remaining)break;}
      this.journal(user,'Monthly salary',[[14,gross],[5,0,deduction],[account.id,0,net]],`SAL-${r.lastInsertRowid}`);audit(this.db,user,'pay_salary','salaries',r.lastInsertRowid,{gross,deduction,net});return {id:Number(r.lastInsertRowid),net,deduction};
    });
  }
  register(user,action,input={}) {
    this.require(user,'register',true);
    return transaction(this.db,()=>{
      const current=this.session();
      if(action==='open'){
        if(current)fail('A cash register is already open.');const opening=round(number(input.opening,'opening cash'));
        const r=this.run('INSERT INTO cash_sessions(user_id,opening) VALUES(?,?)',user.id,opening);this.journal(user,'Register opening float',[[1,opening],[8,0,opening]],`REG-${r.lastInsertRowid}`);audit(this.db,user,'open_register','cash_sessions',r.lastInsertRowid);return {id:Number(r.lastInsertRowid)};
      }
      if(!current)fail('Open the cash register first.');
      const expected=round(current.opening+this.get("SELECT COALESCE(SUM(l.debit-l.credit),0) AS n FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE j.session_id=? AND l.account_id=1 AND j.reference<>('REG-'||j.session_id)",current.id).n);
      if(action==='status')return {...current,expected};
      if(action==='move'){
        const amount=round(number(input.amount,'amount',0.01)),direction=input.direction==='in'?'in':input.direction==='out'?'out':fail('Invalid direction');
        if(direction==='out'&&amount>expected)fail('Not enough cash.');const reason=text(input.reason,'reason',true);
        this.run('INSERT INTO cash_movements(session_id,direction,amount,reason) VALUES(?,?,?,?)',current.id,direction,amount,reason);
        this.journal(user,'Manual cash movement',direction==='in'?[[1,amount],[16,0,amount]]:[[13,amount],[1,0,amount]],`CASH-${current.id}`);audit(this.db,user,'cash_movement','cash_sessions',current.id,{direction,amount,reason});return {ok:true};
      }
      if(action==='close'){
        const counted=round(number(input.counted,'counted cash')),variance=round(counted-expected);
        this.journal(user,'Cash over / short',variance>=0?[[1,variance],[16,0,variance]]:[[13,-variance],[1,0,-variance]],`REG-CLOSE-${current.id}`);
        this.run("UPDATE cash_sessions SET status='closed',closed_at=datetime('now'),counted=?,expected=?,note=? WHERE id=?",counted,expected,text(input.note,'note'),current.id);audit(this.db,user,'close_register','cash_sessions',current.id,{expected,counted,variance});return {expected,counted,variance};
      }
      fail('Unknown register action.');
    });
  }
  inventoryOperation(user,kind,input) {
    this.require(user,kind==='transfer'?'transfers':'adjustments',true);
    return transaction(this.db,()=>{
      const batch=this.get('SELECT * FROM batches WHERE id=?',id(input.batchId));if(!batch)fail('Batch not found.');const reason=text(input.reason||input.note,'reason',true);
      if(kind==='transfer'){
        const qty=integer(input.quantity,'quantity'),to=id(input.toLocation);if(to===batch.location_id)fail('Choose a different location.');
        const location=this.get('SELECT id FROM locations WHERE id=? AND active=1',to);if(!location)fail('Destination not found.');
        this.move(batch.id,-qty,'transfer_out',reason,user);
        this.run('INSERT INTO batches(medicine_id,location_id,batch_no,expiry,cost,quantity) VALUES(?,?,?,?,?,0) ON CONFLICT(medicine_id,location_id,batch_no,expiry) DO NOTHING',batch.medicine_id,to,batch.batch_no,batch.expiry,batch.cost);
        const target=this.get('SELECT id FROM batches WHERE medicine_id=? AND location_id=? AND batch_no=? AND expiry=?',batch.medicine_id,to,batch.batch_no,batch.expiry);
        this.move(target.id,qty,'transfer_in',reason,user);
        const r=this.run('INSERT INTO transfers(batch_id,from_location,to_location,quantity,note,user_id) VALUES(?,?,?,?,?,?)',batch.id,batch.location_id,to,qty,reason,user.id);audit(this.db,user,'transfer','transfers',r.lastInsertRowid,{qty});return {id:Number(r.lastInsertRowid)};
      }
      const quantity=integer(input.quantity,'quantity',-1000000);if(!quantity)fail('Quantity cannot be zero.');
      const updated=this.move(batch.id,quantity,'adjustment',reason,user);const value=round(Math.abs(quantity)*batch.cost);
      this.journal(user,'Stock adjustment',quantity<0?[[15,value],[4,0,value]]:[[4,value],[16,0,value]],`ADJ-${batch.id}`);
      const r=this.run('INSERT INTO adjustments(batch_id,quantity,reason,user_id) VALUES(?,?,?,?)',batch.id,quantity,reason,user.id);audit(this.db,user,'adjust','adjustments',r.lastInsertRowid,{quantity,reason,remaining:updated.quantity+quantity});return {id:Number(r.lastInsertRowid)};
    });
  }
  stockCount(user,action,input={}) {
    this.require(user,'stockcount',true);
    return transaction(this.db,()=>{
      if(action==='create'){
        const location=id(input.locationId);if(this.get("SELECT id FROM stock_counts WHERE location_id=? AND status='open'",location))fail('An open count already exists for this location.');
        const r=this.run('INSERT INTO stock_counts(location_id,note,user_id) VALUES(?,?,?)',location,text(input.note,'note'),user.id);const countId=Number(r.lastInsertRowid);
        this.run('INSERT INTO stock_count_items(count_id,batch_id,expected) SELECT ?,id,quantity FROM batches WHERE location_id=?',countId,location);audit(this.db,user,'start_count','stock_counts',countId);return {id:countId};
      }
      const count=this.get("SELECT * FROM stock_counts WHERE id=? AND status='open'",id(input.countId));if(!count)fail('Open count not found.');
      if(action==='save'){
        if(!Array.isArray(input.items)||input.items.length>10000)fail('Invalid count sheet.');
        for(const item of input.items){const value=integer(item.counted,'counted',0);const r=this.run('UPDATE stock_count_items SET counted=? WHERE count_id=? AND batch_id=?',value,count.id,id(item.batchId));if(!r.changes)fail('Batch is not on this count sheet.');}return {ok:true};
      }
      if(action==='complete'){
        const items=this.all('SELECT * FROM stock_count_items WHERE count_id=?',count.id);if(!items.length||items.some(i=>i.counted===null))fail('Save a count for every batch before completing.');
        for(const item of items){const current=this.get('SELECT quantity FROM batches WHERE id=?',item.batch_id).quantity;const delta=item.counted-current;if(delta)this.inventoryOperation(user,'adjustment',{batchId:item.batch_id,quantity:delta,reason:`Physical count #${count.id}`});}
        this.run("UPDATE stock_counts SET status='completed' WHERE id=?",count.id);audit(this.db,user,'complete_count','stock_counts',count.id);return {ok:true};
      }
      fail('Invalid stock count action.');
    });
  }
  savePrescription(user,input) {
    this.require(user,'prescriptions',true);const patient=this.get('SELECT id FROM patients WHERE id=? AND active=1',id(input.patientId));if(!patient)fail('Patient not found.');
    let attachment=null,mime='';
    if(input.attachment){const raw=String(input.attachment);if(raw.length>7000000)fail('Attachment must be smaller than 5 MB.');attachment=Buffer.from(raw,'base64');if(!attachment.length||attachment.length>5242880||attachment.toString('base64')!==raw)fail('Invalid attachment.');mime=input.mime;if(!['image/png','image/jpeg','application/pdf'].includes(mime))fail('Use PNG, JPEG or PDF.');
      const signature=attachment.subarray(0,8).toString('hex');const valid=mime==='application/pdf'?attachment.subarray(0,5).toString()==='%PDF-':mime==='image/png'?signature==='89504e470d0a1a0a':signature.startsWith('ffd8ff');if(!valid)fail('Attachment contents do not match its file type.');}
    return transaction(this.db,()=>{const r=this.run('INSERT INTO prescriptions(patient_id,doctor,date,notes,mime,attachment) VALUES(?,?,?,?,?,?)',patient.id,text(input.doctor,'doctor'),input.date?date(input.date):new Date().toISOString().slice(0,10),text(input.notes,'notes'),mime,attachment);audit(this.db,user,'create','prescriptions',r.lastInsertRowid);return {id:Number(r.lastInsertRowid)};});
  }
  prescriptionFile(user,value) {this.require(user,'prescriptions');const row=this.get('SELECT mime,attachment FROM prescriptions WHERE id=?',id(value));if(!row?.attachment)fail('No attachment.');return {mime:row.mime,data:row.attachment.toString('base64')};}
  cancelPrescription(user,value) {this.require(user,'prescriptions',true);return transaction(this.db,()=>{const r=this.run("UPDATE prescriptions SET status='cancelled' WHERE id=? AND status='pending'",id(value));if(!r.changes)fail('Only pending prescriptions can be cancelled.');audit(this.db,user,'cancel','prescriptions',value);return {ok:true};});}
  saveUser(user,input) {
    this.require(user,'users',true);const userId=input.id?id(input.id):null;const old=userId?this.get('SELECT * FROM users WHERE id=?',userId):null;if(userId&&!old)fail('User not found.');
    const username=text(input.username,'username',true,40).toLowerCase();if(!/^[a-z0-9._-]{3,40}$/.test(username))fail('Invalid username.');
    const role=input.role;if(!Object.hasOwn(rolePermissions,role))fail('Invalid role.');const active=bool(input.active??1);
    if(old?.id===user.id&&(!active||role!=='admin'))fail('You cannot disable or demote your own account.');
    if(old?.role==='admin'&&old.active&&(!active||role!=='admin')&&!this.get("SELECT id FROM users WHERE role='admin' AND active=1 AND id<>?",old.id))fail('Keep at least one active administrator.');
    const password=String(input.password||'');if((!old||password)&&(password.length<10||password.length>128))fail('Password must contain 10–128 characters.');
    const permissions={};for(const m of modules)if(typeof input.permissions?.[m]==='boolean')permissions[m]=input.permissions[m];
    if(role==='admin')permissions.users=true;
    return transaction(this.db,()=>{let userIdFinal;if(old){this.run('UPDATE users SET username=?,name=?,role=?,active=?,permissions=? WHERE id=?',username,text(input.name,'name',true,100),role,active,JSON.stringify(permissions),old.id);if(password)this.run('UPDATE users SET password_hash=? WHERE id=?',hashPassword(password),old.id);userIdFinal=old.id;}else{const r=this.run('INSERT INTO users(username,name,password_hash,role,active,permissions) VALUES(?,?,?,?,?,?)',username,text(input.name,'name',true,100),hashPassword(password),role,active,JSON.stringify(permissions));userIdFinal=Number(r.lastInsertRowid);}audit(this.db,user,old?'update_user':'create_user','users',userIdFinal,{role,active,permissions});return {id:userIdFinal};});
  }
  settings(user,input) {
    this.require(user,'settings',true);const allowed=['pharmacy_name','currency','address','phone','tax_percent','low_stock_days','receipt_footer','language','theme'];
    return transaction(this.db,()=>{for(const key of allowed)if(input[key]!==undefined){let value=text(input[key],key,key==='pharmacy_name',500);if(key==='tax_percent')value=String(number(value,'tax',0,100));if(key==='low_stock_days')value=String(integer(value,'expiry warning days',1,3650));if(key==='currency'&&!/^[A-Z]{3}$/.test(value))fail('Use a three-letter currency code.');if(key==='language'&&!['en','ps','fa-AF'].includes(value))fail('Unsupported language.');if(key==='theme'&&!['light','dark'].includes(value))fail('Unsupported theme.');this.run('UPDATE settings SET value=? WHERE key=?',value,key);}audit(this.db,user,'update','settings');return {ok:true};});
  }
  preference(user,input) { const data={}; if(input.language!==undefined){if(!['en','ps','fa-AF'].includes(input.language))fail('Unsupported language.');data.language=input.language;}if(input.theme!==undefined){if(!['light','dark'].includes(input.theme))fail('Unsupported theme.');data.theme=input.theme;}for(const [key,value] of Object.entries(data))this.run('UPDATE settings SET value=? WHERE key=?',value,key);return data; }
  preferences(user) {this.require(user,'dashboard');return Object.fromEntries(this.all('SELECT key,value FROM settings').map(r=>[r.key,r.value]));}
  dashboard(user) {
    this.require(user,'dashboard');const p=this.permissions(user);const result={pharmacyName:this.setting('pharmacy_name'),currency:this.setting('currency')};
    if(p.includes('reports')||p.includes('finance')){
      result.today=this.get("SELECT COALESCE(SUM(total),0) AS sales,COUNT(*) AS orders,COALESCE(SUM(discount),0) AS discounts FROM sales WHERE date(date)=date('now')");
      result.month=this.get("SELECT COALESCE(SUM(total),0) AS sales FROM sales WHERE strftime('%Y-%m',date)=strftime('%Y-%m','now')").sales;
      result.trend=this.all("SELECT date(date) AS day,SUM(total) AS total,COUNT(*) AS orders FROM sales WHERE date>=date('now','-6 days') GROUP BY date(date) ORDER BY day");
    }
    if(p.includes('inventory')){result.medicines=this.get('SELECT COUNT(*) AS n FROM medicines WHERE active=1').n;result.low=this.all('SELECT m.id,m.name,m.reorder_level,COALESCE(SUM(b.quantity),0) AS stock FROM medicines m LEFT JOIN batches b ON b.medicine_id=m.id WHERE m.active=1 GROUP BY m.id HAVING stock<=m.reorder_level ORDER BY stock LIMIT 8');result.expiring=this.all("SELECT m.name,b.batch_no,b.expiry,b.quantity FROM batches b JOIN medicines m ON m.id=b.medicine_id WHERE b.quantity>0 AND b.expiry<=date('now','+'||?||' days') ORDER BY b.expiry LIMIT 8",this.setting('low_stock_days'));result.stockValue=this.get('SELECT COALESCE(SUM(quantity*cost),0) AS n FROM batches').n;}
    if(p.includes('customers'))result.receivable=this.get('SELECT COALESCE(SUM(l.debit-l.credit),0) AS n FROM journal_lines l WHERE l.account_id=3').n;
    result.register=this.session()?{id:this.session().id}:null;result.recent=p.includes('sales')?this.all('SELECT s.id,s.invoice_no,s.total,s.date,c.name AS customer FROM sales s LEFT JOIN customers c ON c.id=s.customer_id ORDER BY s.id DESC LIMIT 5'):[];
    return result;
  }
  report(user,input) {
    const kind=input.kind||'sales';const permission=['profit','finance'].includes(kind)?'finance':kind==='audit'?'audit':'reports';this.require(user,permission);
    const from=input.from?date(input.from):new Date(Date.now()-29*86400000).toISOString().slice(0,10),to=input.to?date(input.to):new Date().toISOString().slice(0,10);if(from>to)fail('Invalid report range.');
    let rows=[],columns=[];
    if(kind==='sales'){columns=['invoice_no','date','total','paid','payment_method','status'];rows=this.all('SELECT invoice_no,date,total,paid,payment_method,status FROM sales WHERE date(date) BETWEEN ? AND ? ORDER BY date',from,to);}
    else if(kind==='purchases'){columns=['invoice_no','date','total','paid','status'];rows=this.all('SELECT invoice_no,date,total,paid,status FROM purchases WHERE date(date) BETWEEN ? AND ? ORDER BY date',from,to);}
    else if(kind==='inventory'){columns=['sku','name','batch_no','expiry','location','quantity','cost','value'];rows=this.all('SELECT m.sku,m.name,b.batch_no,b.expiry,l.name AS location,b.quantity,b.cost,round(b.quantity*b.cost,2) AS value FROM batches b JOIN medicines m ON m.id=b.medicine_id JOIN locations l ON l.id=b.location_id ORDER BY m.name,b.expiry');}
    else if(kind==='expiry'){columns=['name','batch_no','expiry','quantity'];rows=this.all("SELECT m.name,b.batch_no,b.expiry,b.quantity FROM batches b JOIN medicines m ON m.id=b.medicine_id WHERE b.quantity>0 AND b.expiry<=date('now','+'||?||' days') ORDER BY b.expiry",this.setting('low_stock_days'));}
    else if(kind==='stock'){columns=['date','name','batch_no','quantity','reason','reference'];rows=this.all('SELECT s.created_at AS date,m.name,b.batch_no,s.quantity,s.reason,s.reference FROM stock_movements s JOIN batches b ON b.id=s.batch_id JOIN medicines m ON m.id=b.medicine_id WHERE date(s.created_at) BETWEEN ? AND ? ORDER BY s.id DESC',from,to);}
    else if(kind==='profit'){
      rows=this.all("SELECT a.code,a.name,a.type,round(SUM(CASE WHEN a.type IN ('income','liability','equity') THEN l.credit-l.debit ELSE l.debit-l.credit END),2) AS amount FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id WHERE date(j.date) BETWEEN ? AND ? AND a.type IN ('income','expense') GROUP BY a.id HAVING abs(amount)>0.005 ORDER BY a.code",from,to);
      columns=['code','name','type','amount'];const income=sum(rows.filter(r=>r.type==='income'),'amount'),expenses=sum(rows.filter(r=>r.type==='expense'),'amount');rows.push({code:'',name:'NET PROFIT / (LOSS)',type:'total',amount:round(income-expenses)});
    }else if(kind==='balances'){columns=['code','name','type','balance'];rows=this.all("SELECT a.code,a.name,a.type,round(SUM(CASE WHEN a.type IN ('asset','expense') THEN l.debit-l.credit ELSE l.credit-l.debit END),2) AS balance FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journals j ON j.id=l.journal_id WHERE date(j.date)<=? GROUP BY a.id ORDER BY a.code",to);}
    else if(kind==='receivables'){columns=['name','phone','balance'];rows=this.all('SELECT id,name,phone FROM customers WHERE active=1').map(r=>({name:r.name,phone:r.phone,balance:this.party('customer',r.id).balance})).filter(r=>r.balance>0);}
    else if(kind==='payables'){columns=['name','phone','balance'];rows=this.all('SELECT id,name,phone FROM suppliers WHERE active=1').map(r=>({name:r.name,phone:r.phone,balance:this.party('supplier',r.id).balance})).filter(r=>r.balance>0);}
    else fail('Unknown report.');
    return {kind,from,to,columns,rows,currency:this.setting('currency'),pharmacyName:this.setting('pharmacy_name')};
  }
  generateBarcode(user) {
    this.require(user,'barcodes');
    for(let attempt=0;attempt<20;attempt++){
      const value='MED-'+Date.now().toString(36).toUpperCase()+'-'+crypto.randomBytes(6).toString('hex').toUpperCase();
      if(!this.get('SELECT id FROM medicines WHERE barcode=?',value)){
        return {value,svg:require('./barcode').code128(value)};
      }
    }
    fail('Could not generate a unique barcode. Please try again.');
  }
  barcode(user,input) {
    this.require(user,'barcodes');const value=text(input.value,'barcode',true,64);if(!/^[A-Za-z0-9-]{4,64}$/.test(value))fail('Use letters, digits and hyphens.');
    if(input.medicineId){this.require(user,'inventory',true);transaction(this.db,()=>{const r=this.run('UPDATE medicines SET barcode=? WHERE id=?',value,id(input.medicineId));if(!r.changes)fail('Medicine not found.');audit(this.db,user,'assign_barcode','medicines',input.medicineId,{value});});}
    return {value,svg:require('./barcode').code128(value)};
  }
}
module.exports = { PharmacyService, round, id, number, integer, text, date };
