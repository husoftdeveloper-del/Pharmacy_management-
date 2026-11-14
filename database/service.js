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
    // The administrator keeps every module even if an old saved permission set
    // (from a build with a shorter module list) says otherwise, so the only
    // administrator can never lock themselves out of the app.
    if (user.role === 'admin') return [...modules];
    let overrides = {};
    try { overrides = JSON.parse(user.permissions || '{}') || {}; } catch { overrides = {}; }
    const defaults = rolePermissions[user.role] || [];
    return modules.filter(m => overrides[m] === undefined ? defaults.includes(m) : overrides[m] === true);
  }
  // Shell-level calls every signed-in user needs before the first page renders;
  // they do not depend on any single module permission.
  requireSession(user) {
    if (!user?.active) fail('Please sign in.');
  }
  require(user, permission, write = false) {
    if (!user?.active) fail('Please sign in.');
    const allowed = this.permissions(user);
    const granted = Array.isArray(permission) ? permission.some(name => allowed.includes(name)) : allowed.includes(permission);
    if (!granted) fail('You do not have permission for this action.');
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
        if (entity === 'medicines') data.created_by = user?.id ?? null;
        const r = this.run(`INSERT INTO ${entity}(${Object.keys(data).join(',')}) VALUES(${Object.keys(data).map(() => '?').join(',')})`, ...Object.values(data));
        recordIdFinal = Number(r.lastInsertRowid);
        if (['customers','suppliers'].includes(entity) && data.opening_balance > 0) this.journal(user, 'Opening party balance', entity === 'customers' ? [[3,data.opening_balance],[8,0,data.opening_balance]] : [[8,data.opening_balance],[6,0,data.opening_balance]], `${entity}:${recordIdFinal}`);
      }
      audit(this.db, user, old ? 'update' : 'create', entity, recordIdFinal, { name: data.name || data.sku });
      return { id: recordIdFinal };
    });
  }
  // Price list: one row per medicine with its shelf quantity, both prices and
  // the profit made on a single unit.
  priceList(user) {
    this.require(user, 'pricelist');
    const rows = this.all(`SELECT m.id,m.name,m.generic_name,m.unit,m.cost,m.price,
        COALESCE(SUM(b.quantity),0) AS stock
      FROM medicines m LEFT JOIN batches b ON b.medicine_id=m.id
      WHERE m.active=1 GROUP BY m.id ORDER BY m.name`).map(row => ({
        ...row,
        cost: round(row.cost),
        price: round(row.price),
        profit: round(Number(row.price) - Number(row.cost))
      }));
    return {
      rows,
      totals: {
        medicines: rows.length,
        stockValue: round(rows.reduce((sum, row) => sum + Number(row.stock) * Number(row.cost), 0)),
        profit: round(rows.reduce((sum, row) => sum + Number(row.profit), 0))
      },
      currency: this.setting('currency')
    };
  }
  // Expenses page: every cost entry with who logged it, plus the totals shown
  // above the table.
  expenseBook(user) {
    this.require(user,'expenses');
    const rows = this.all(`SELECT e.id,e.date,e.category,e.description,e.amount,e.account_id,a.name AS account,u.name AS recorded_by
      FROM expenses e LEFT JOIN accounts a ON a.id=e.account_id LEFT JOIN users u ON u.id=e.user_id
      ORDER BY e.date DESC,e.id DESC`);
    const month = new Date().toISOString().slice(0,7);
    return {
      rows,
      totals: {
        thisMonth: round(rows.filter(row=>String(row.date).slice(0,7)===month).reduce((sum,row)=>sum+Number(row.amount),0)),
        total: round(rows.reduce((sum,row)=>sum+Number(row.amount),0)),
        entries: rows.length
      },
      categories: [...new Set(rows.map(row=>row.category))].sort(),
      currency: this.setting('currency')
    };
  }
  // Ledger & P&L: the profit and loss statement, the cash movement and the
  // journal transactions for one date range.
  // Profit and loss figures for one date range, shared by the Ledger page and
  // the profit tab of Reports so both always show the same numbers.
  profitFigures(from, to) {
    const accountTotal = code => {
      const account = this.get('SELECT id,type FROM accounts WHERE code=?',code);
      if (!account) return 0;
      const row = this.get('SELECT COALESCE(SUM(l.debit),0) AS debit,COALESCE(SUM(l.credit),0) AS credit FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE l.account_id=? AND date(j.date) BETWEEN ? AND ?',account.id,from,to);
      return round(account.type==='income'?row.credit-row.debit:row.debit-row.credit);
    };
    const salesRevenue = accountTotal('4000');
    const saleReturns = accountTotal('4100');
    const discounts = accountTotal('4200');
    const cogs = accountTotal('5000');
    const cogsReturned = round(this.get(`SELECT COALESCE(SUM(si.cost*sri.quantity),0) AS n FROM sale_return_items sri JOIN sale_items si ON si.id=sri.sale_item_id
      JOIN sale_returns r ON r.id=sri.return_id WHERE date(r.date) BETWEEN ? AND ?`,from,to).n);
    const expenses = accountTotal('6000');
    const netRevenue = round(salesRevenue - saleReturns);
    const netCogs = round(cogs - cogsReturned);
    const grossProfit = round(netRevenue - netCogs);
    const netProfit = round(grossProfit - expenses);
    return { salesRevenue, saleReturns, discounts, netRevenue, cogs, cogsReturned, netCogs, grossProfit, expenses, netProfit };
  }
  // Ledger & P&L: the profit and loss statement, the cash movement and the
  // journal transactions for one date range.
  ledgerBook(user, query = {}) {
    this.require(user,'ledger');
    const from = query.from ? date(query.from) : new Date(Date.now()-29*86400000).toISOString().slice(0,10);
    const to = query.to ? date(query.to) : new Date().toISOString().slice(0,10);
    if (from > to) fail('Start date must be before end date.');
    const statement = this.profitFigures(from,to);
    const cash = this.all("SELECT id FROM accounts WHERE code IN ('1000','1010')").map(row=>row.id);
    const cashMoved = [];
    for (const accountId of cash) {
      const row = this.get('SELECT COALESCE(SUM(l.debit),0) AS debit,COALESCE(SUM(l.credit),0) AS credit FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE l.account_id=? AND date(j.date) BETWEEN ? AND ?',accountId,from,to);
      cashMoved.push({debit:Number(row.debit),credit:Number(row.credit)});
    }
    const cashIn = round(cashMoved.reduce((sum,row)=>sum+row.debit,0));
    const cashOut = round(cashMoved.reduce((sum,row)=>sum+row.credit,0));
    const purchases = this.get('SELECT COALESCE(SUM(total),0) AS n,COUNT(*) AS c FROM purchases WHERE date(date) BETWEEN ? AND ?',from,to);
    return {
      from,to,
      currency: this.setting('currency'),
      statement,
      cash: { cashIn, cashOut, netCashFlow: round(cashIn-cashOut), totalPurchases: round(purchases.n), purchaseCount: Number(purchases.c) },
      transactions: this.all(`SELECT j.id,j.date,j.description,j.reference,u.name AS user,
          COALESCE(SUM(l.debit),0) AS amount
        FROM journals j LEFT JOIN journal_lines l ON l.journal_id=j.id LEFT JOIN users u ON u.id=j.user_id
        WHERE date(j.date) BETWEEN ? AND ? GROUP BY j.id ORDER BY j.date DESC,j.id DESC LIMIT 500`,from,to)
    };
  }
  // Reports overview: the headline numbers and the daily revenue/profit trend.
  reportOverview(user, query = {}) {
    this.require(user,'reports');
    const from = query.from ? date(query.from) : new Date(Date.now()-29*86400000).toISOString().slice(0,10);
    const to = query.to ? date(query.to) : new Date().toISOString().slice(0,10);
    if (from > to) fail('Start date must be before end date.');
    const sales = this.get(`SELECT COALESCE(SUM(s.subtotal),0) AS revenue,COALESCE(SUM(s.discount),0) AS discount,COALESCE(SUM(s.total),0) AS total,COUNT(s.id) AS orders
      FROM sales s WHERE date(s.date) BETWEEN ? AND ?`,from,to);
    const items = this.get(`SELECT COALESCE(SUM(i.quantity),0) AS quantity,COALESCE(SUM(i.cost*i.quantity),0) AS cogs
      FROM sale_items i JOIN sales s ON s.id=i.sale_id WHERE date(s.date) BETWEEN ? AND ?`,from,to);
    const returns = this.get('SELECT COALESCE(SUM(total),0) AS total FROM sale_returns WHERE date(date) BETWEEN ? AND ?',from,to);
    const expenses = this.get('SELECT COALESCE(SUM(amount),0) AS total,COUNT(*) AS entries FROM expenses WHERE date(date) BETWEEN ? AND ?',from,to);
    const revenue = round(Number(sales.revenue) - Number(returns.total));
    const cogs = round(items.cogs);
    const grossProfit = round(revenue - cogs);
    const netProfit = round(grossProfit - Number(expenses.total));
    const trend = this.all(`SELECT d.day,
        (SELECT COALESCE(SUM(s.subtotal),0) FROM sales s WHERE date(s.date)=d.day) -
        (SELECT COALESCE(SUM(r.total),0) FROM sale_returns r WHERE date(r.date)=d.day) AS revenue,
        (SELECT COALESCE(SUM(i.cost*i.quantity),0) FROM sale_items i JOIN sales s ON s.id=i.sale_id WHERE date(s.date)=d.day) AS cogs
      FROM (WITH RECURSIVE days(day) AS (SELECT ? UNION ALL SELECT date(day,'+1 day') FROM days WHERE day < ?) SELECT day FROM days) d
      ORDER BY d.day`,from,to).map(row=>{
        const dayRevenue = round(row.revenue);
        const dayProfit = round(dayRevenue - Number(row.cogs));
        return { day: row.day, revenue: dayRevenue, profit: dayProfit };
      });
    return {
      from,to,
      currency: this.setting('currency'),
      totals: {
        revenue,
        grossProfit,
        expenses: round(Number(expenses.total)),
        netProfit,
        orders: Number(sales.orders),
        itemsSold: Number(items.quantity),
        cogs,
        averageOrder: sales.orders ? round(Number(sales.total)/Number(sales.orders)) : 0,
        margin: revenue > 0 ? round(grossProfit / revenue * 100) : 0,
        expenseEntries: Number(expenses.entries)
      },
      trend
    };
  }
  // Reports tabs: each tab has its own filter row, KPI cards and table, all
  // computed here so the numbers always match the ledger and the lists.
  reportBook(user, query = {}) {
    this.require(user,'reports');
    const kinds = ['sales','profit','inventory','expiry','purchases','expenses','customers','suppliers'];
    const kind = kinds.includes(query.kind) ? query.kind : 'sales';
    const from = query.from ? date(query.from) : new Date(Date.now()-29*86400000).toISOString().slice(0,10);
    const to = query.to ? date(query.to) : new Date().toISOString().slice(0,10);
    if (from > to) fail('Start date must be before end date.');
    const search = String(query.search || '').trim().toLowerCase();
    const choice = value => { try { return value ? id(value) : 0; } catch { return 0; } };
    const cashier = choice(query.cashier);
    const customer = choice(query.customer);
    const supplier = choice(query.supplier);
    const category = String(query.category || '').trim();
    const status = String(query.status || '').trim();
    const window = ['expired','30','90'].includes(String(query.expiry || '')) ? String(query.expiry) : '';
    const matches = (...values) => !search || values.some(value => String(value ?? '').toLowerCase().includes(search));
    const today = new Date().toISOString().slice(0,10);
    const daysLeft = expiry => Math.ceil((Date.parse(`${String(expiry).slice(0,10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    const kpi = (key, value, format = 'money') => ({ key, value: format === 'number' ? Number(value) : round(value), format });
    const people = table => this.all(`SELECT id,name FROM ${table} WHERE active=1 ORDER BY name`).map(row => ({ value: row.id, label: row.name }));
    const head = (searchLabel, filters, kpis, columns, rows) => ({
      kind, from, to, currency: this.setting('currency'), searchLabel, filters, kpis, columns, rows
    });

    if (kind === 'sales') {
      const rows = this.all(`SELECT s.id,s.invoice_no,s.date,s.subtotal,s.discount,s.total,s.paid,s.status,s.customer_id,s.user_id,
          COALESCE(c.name,'') AS customer, COALESCE(u.name,'') AS cashier,
          (SELECT COALESCE(SUM(r.total),0) FROM sale_returns r WHERE r.sale_id=s.id) AS returned
        FROM sales s LEFT JOIN customers c ON c.id=s.customer_id LEFT JOIN users u ON u.id=s.user_id
        WHERE date(s.date) BETWEEN ? AND ? ORDER BY s.date DESC,s.id DESC`,from,to)
        .filter(row => (!cashier || Number(row.user_id) === cashier) && (!customer || Number(row.customer_id) === customer)
          && (!status || row.status === status) && matches(row.invoice_no,row.customer,row.cashier))
        .map(row => ({ ...row, discount: round(row.discount), total: round(row.total), returned: round(row.returned) }));
      return head('searchInvoice', [
        { key: 'cashier', all: 'allCashiers', options: people('users') },
        { key: 'customer', all: 'allCustomers', options: people('customers') },
        { key: 'status', all: 'allStatuses', options: this.all('SELECT DISTINCT status FROM sales WHERE date(date) BETWEEN ? AND ? ORDER BY status',from,to).map(row => ({ value: row.status, label: row.status })) }
      ], [
        kpi('revenue', rows.reduce((sum,row)=>sum+row.total,0)),
        kpi('discount', rows.reduce((sum,row)=>sum+row.discount,0)),
        kpi('saleReturns', rows.reduce((sum,row)=>sum+row.returned,0)),
        kpi('orders', rows.length, 'number')
      ], ['invoice_no','date','customer','cashier','total','discount','returned','status'], rows);
    }

    if (kind === 'profit') {
      const rows = this.all(`SELECT m.id,m.name,m.sku,
          SUM(i.price*(i.quantity-i.returned_qty)) AS revenue,
          SUM(i.cost*(i.quantity-i.returned_qty)) AS cogs,
          SUM(i.quantity-i.returned_qty) AS quantity,
          SUM(i.price*i.returned_qty) AS returned_value
        FROM sale_items i JOIN sales s ON s.id=i.sale_id JOIN medicines m ON m.id=i.medicine_id
        WHERE date(s.date) BETWEEN ? AND ? AND s.status<>'cancelled'
        GROUP BY m.id HAVING quantity<>0 OR returned_value<>0 ORDER BY revenue DESC`,from,to)
        .filter(row => matches(row.name,row.sku))
        .map(row => {
          const revenue = round(row.revenue);
          const cogs = round(row.cogs);
          const profit = round(revenue - cogs);
          return { ...row, revenue, cogs, profit, margin: revenue > 0 ? round(profit / revenue * 100) : 0, returned_value: round(row.returned_value) };
        });
      const revenue = round(rows.reduce((sum,row)=>sum+row.revenue,0));
      const cogs = round(rows.reduce((sum,row)=>sum+row.cogs,0));
      const profit = round(revenue - cogs);
      return head('searchMedicine', [], [
        kpi('revenue', revenue),
        kpi('costOfGoods', cogs),
        kpi('grossProfit', profit),
        kpi('margin', revenue > 0 ? round(profit / revenue * 100) : 0, 'percent'),
        kpi('returnedValue', rows.reduce((sum,row)=>sum+row.returned_value,0))
      ], ['name','quantity','revenue','cogs','profit','margin','returned_value'], rows);
    }

    if (kind === 'inventory') {
      const rows = this.all(`SELECT b.id,m.name,m.sku,m.barcode,b.batch_no,b.expiry,b.quantity,b.cost,l.name AS location
        FROM batches b JOIN medicines m ON m.id=b.medicine_id JOIN locations l ON l.id=b.location_id
        WHERE b.quantity>0 ORDER BY m.name,b.expiry`)
        .filter(row => matches(row.name,row.sku,row.barcode,row.batch_no,row.location))
        .map(row => ({ ...row, cost: round(row.cost), value: round(Number(row.quantity)*Number(row.cost)) }));
      const low = this.get(`SELECT COUNT(*) AS n FROM (SELECT m.id,COALESCE(SUM(b.quantity),0) AS quantity,m.reorder_level
        FROM medicines m LEFT JOIN batches b ON b.medicine_id=m.id WHERE m.active=1 GROUP BY m.id HAVING quantity<=m.reorder_level)`).n;
      return head('searchBatch', [], [
        kpi('batches', rows.length, 'number'),
        kpi('units', rows.reduce((sum,row)=>sum+Number(row.quantity),0), 'number'),
        kpi('stockValueLabel', rows.reduce((sum,row)=>sum+row.value,0)),
        kpi('lowStockItems', low, 'number')
      ], ['name','batch_no','expiry','location','quantity','cost','value'], rows);
    }

    if (kind === 'expiry') {
      const warning = Number(this.setting('low_stock_days')) || 90;
      const all = this.all('SELECT b.expiry,b.quantity,b.cost FROM batches b WHERE b.quantity>0')
        .map(row => ({ ...row, days: daysLeft(row.expiry) }));
      let rows = this.all(`SELECT b.id,m.name,m.barcode,b.batch_no,b.expiry,b.quantity,b.cost
        FROM batches b JOIN medicines m ON m.id=b.medicine_id WHERE b.quantity>0 ORDER BY b.expiry`)
        .filter(row => matches(row.name,row.barcode,row.batch_no))
        .map(row => ({ ...row, days: daysLeft(row.expiry), value: round(Number(row.quantity)*Number(row.cost)) }))
        .filter(row => row.days <= warning)
        .map(({ days, ...row }) => ({ ...row, days_left: days }));
      if (window === 'expired') rows = rows.filter(row => row.days_left < 0);
      else if (window === '30') rows = rows.filter(row => row.days_left >= 0 && row.days_left <= 30);
      else if (window === '90') rows = rows.filter(row => row.days_left >= 0 && row.days_left <= 90);
      return head('searchBatch', [
        { key: 'expiry', all: 'anyExpiry', options: [{ value: 'expired', label: 'expired' }, { value: '30', label: '≤ 30' }, { value: '90', label: '≤ 90' }] }
      ], [
        kpi('expired', all.filter(row => row.days < 0).length, 'number'),
        kpi('expiring30', all.filter(row => row.days >= 0 && row.days <= 30).length, 'number'),
        kpi('expiring90', all.filter(row => row.days >= 0 && row.days <= 90).length, 'number'),
        kpi('valueAtRisk', all.filter(row => row.days <= warning).reduce((sum,row)=>sum+Number(row.quantity)*Number(row.cost),0))
      ], ['name','batch_no','expiry','days_left','quantity','value'], rows);
    }

    if (kind === 'purchases') {
      const rows = this.all(`SELECT p.id,p.invoice_no,p.date,p.total,p.paid,p.status,p.supplier_id,p.user_id,
          s.name AS supplier, COALESCE(u.name,'') AS recorded_by,
          (SELECT COALESCE(SUM(r.total),0) FROM purchase_returns r WHERE r.purchase_id=p.id) AS returned,
          (SELECT COALESCE(SUM(a.amount),0) FROM payment_allocations a WHERE a.invoice_type='purchase' AND a.invoice_id=p.id) AS allocated
        FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id LEFT JOIN users u ON u.id=p.user_id
        WHERE date(p.date) BETWEEN ? AND ? ORDER BY p.date DESC,p.id DESC`,from,to)
        .filter(row => (!supplier || Number(row.supplier_id) === supplier) && (!status || row.status === status)
          && matches(row.invoice_no,row.supplier,row.recorded_by))
        .map(row => ({
          ...row,
          total: round(row.total),
          paid: round(row.paid),
          due: round(Math.max(0,Number(row.total)-Number(row.paid)-Number(row.returned)-Number(row.allocated)))
        }));
      return head('searchInvoice', [
        { key: 'supplier', all: 'allSuppliers', options: people('suppliers') },
        { key: 'status', all: 'allStatuses', options: this.all('SELECT DISTINCT status FROM purchases WHERE date(date) BETWEEN ? AND ? ORDER BY status',from,to).map(row => ({ value: row.status, label: row.status })) }
      ], [
        kpi('invoices', rows.length, 'number'),
        kpi('totalPurchases', rows.reduce((sum,row)=>sum+row.total,0)),
        kpi('paid', rows.reduce((sum,row)=>sum+row.paid,0)),
        kpi('balanceDue', rows.reduce((sum,row)=>sum+row.due,0))
      ], ['invoice_no','date','supplier','recorded_by','total','paid','due','status'], rows);
    }

    if (kind === 'expenses') {
      const rows = this.all(`SELECT e.id,e.date,e.category,e.description,e.amount,e.user_id,
          a.name AS account, COALESCE(u.name,'') AS recorded_by
        FROM expenses e LEFT JOIN accounts a ON a.id=e.account_id LEFT JOIN users u ON u.id=e.user_id
        WHERE date(e.date) BETWEEN ? AND ? ORDER BY e.date DESC,e.id DESC`,from,to)
        .filter(row => (!category || row.category === category) && matches(row.category,row.description,row.recorded_by,row.account))
        .map(row => ({ ...row, amount: round(row.amount) }));
      const categories = [...new Set(this.all('SELECT DISTINCT category FROM expenses ORDER BY category').map(row=>row.category))];
      return head('searchExpense', [
        { key: 'category', all: 'allCategories', options: categories.map(name => ({ value: name, label: name })) }
      ], [
        kpi('total', rows.reduce((sum,row)=>sum+row.amount,0)),
        kpi('entries', rows.length, 'number'),
        kpi('largestExpense', rows.reduce((max,row)=>Math.max(max,row.amount),0)),
        kpi('categoriesCount', new Set(rows.map(row=>row.category)).size, 'number')
      ], ['date','category','description','amount','account','recorded_by'], rows);
    }

    if (kind === 'customers') {
      const rows = this.all('SELECT id,name,phone FROM customers WHERE active=1 ORDER BY name')
        .filter(row => matches(row.name,row.phone))
        .map(entry => {
          const totals = this.get(`SELECT COALESCE(SUM(total),0) AS credit,COUNT(*) AS orders FROM sales
            WHERE customer_id=? AND date(date) BETWEEN ? AND ?`,entry.id,from,to);
          const paid = this.get(`SELECT COALESCE(SUM(amount),0) AS n FROM payments WHERE party_type='customer' AND party_id=? AND date(date) BETWEEN ? AND ?`,entry.id,from,to).n;
          const returned = this.get(`SELECT COALESCE(SUM(r.total),0) AS n FROM sale_returns r JOIN sales s ON s.id=r.sale_id
            WHERE s.customer_id=? AND date(r.date) BETWEEN ? AND ?`,entry.id,from,to).n;
          return {
            id: entry.id, name: entry.name, phone: entry.phone,
            orders: Number(totals.orders), credit: round(totals.credit), paid: round(paid), returned: round(returned),
            balance: this.party('customer',entry.id).balance
          };
        });
      return head('searchCustomer', [], [
        kpi('customers', rows.length, 'number'),
        kpi('creditSales', rows.reduce((sum,row)=>sum+row.credit,0)),
        kpi('paid', rows.reduce((sum,row)=>sum+row.paid,0)),
        kpi('outstanding', rows.reduce((sum,row)=>sum+Math.max(0,row.balance),0))
      ], ['name','phone','orders','credit','paid','returned','balance'], rows);
    }

    const rows = this.all('SELECT id,name,phone,contact_person FROM suppliers WHERE active=1 ORDER BY name')
      .filter(row => matches(row.name,row.phone,row.contact_person))
      .map(entry => {
        const totals = this.get(`SELECT COALESCE(SUM(total),0) AS purchased,COUNT(*) AS orders FROM purchases
          WHERE supplier_id=? AND date(date) BETWEEN ? AND ?`,entry.id,from,to);
        const paid = this.get(`SELECT COALESCE(SUM(amount),0) AS n FROM payments WHERE party_type='supplier' AND party_id=? AND date(date) BETWEEN ? AND ?`,entry.id,from,to).n;
        const returned = this.get(`SELECT COALESCE(SUM(r.total),0) AS n FROM purchase_returns r JOIN purchases p ON p.id=r.purchase_id
          WHERE p.supplier_id=? AND date(r.date) BETWEEN ? AND ?`,entry.id,from,to).n;
        return {
          id: entry.id, name: entry.name, phone: entry.phone, contact: entry.contact_person,
          orders: Number(totals.orders), purchased: round(totals.purchased), paid: round(paid), returned: round(returned),
          balance: this.party('supplier',entry.id).balance
        };
      });
    return head('searchSupplier', [], [
      kpi('suppliers', rows.length, 'number'),
      kpi('totalPurchases', rows.reduce((sum,row)=>sum+row.purchased,0)),
      kpi('paid', rows.reduce((sum,row)=>sum+row.paid,0)),
      kpi('balanceDue', rows.reduce((sum,row)=>sum+Math.max(0,row.balance),0))
    ], ['name','phone','orders','purchased','paid','returned','balance'], rows);
  }
  // Purchases page: every received purchase with what is still owed on it.
  purchaseBook(user) {
    this.require(user,'purchases');
    const rows = this.all(`SELECT p.id,p.invoice_no,p.date,p.total,p.paid,p.status,s.name AS supplier,u.name AS recorded_by,
        (SELECT COALESCE(SUM(r.total),0) FROM purchase_returns r WHERE r.purchase_id=p.id) AS returned,
        (SELECT COALESCE(SUM(a.amount),0) FROM payment_allocations a WHERE a.invoice_type='purchase' AND a.invoice_id=p.id) AS allocated
      FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id LEFT JOIN users u ON u.id=p.user_id
      ORDER BY p.date DESC,p.id DESC`).map(row => ({
        ...row,
        total: round(row.total),
        paid: round(row.paid),
        returned: round(row.returned),
        allocated: round(row.allocated),
        due: round(Math.max(0, Number(row.total) - Number(row.paid) - Number(row.returned) - Number(row.allocated)))
      }));
    return {
      rows,
      totals: {
        purchases: rows.length,
        total: round(rows.reduce((sum,row)=>sum+row.total,0)),
        due: round(rows.reduce((sum,row)=>sum+row.due,0))
      },
      currency: this.setting('currency')
    };
  }
  // Suppliers page: contact details plus how much has been bought from each one.
  supplierBook(user) {
    this.require(user,'suppliers');
    const rows = this.all(`SELECT s.id,s.name,s.contact_person,s.phone,s.address,s.active,
        COUNT(p.id) AS purchases, COALESCE(SUM(p.total),0) AS spent, MAX(p.date) AS last_purchase
      FROM suppliers s LEFT JOIN purchases p ON p.supplier_id=s.id
      GROUP BY s.id ORDER BY s.name`).map(row => ({
        ...row,
        purchases: Number(row.purchases),
        spent: round(row.spent),
        last_purchase: row.last_purchase || null,
        balance: this.party('supplier',row.id).balance
      }));
    return {
      rows,
      totals: {
        suppliers: rows.length,
        active: rows.filter(row=>Number(row.active)===1).length,
        spent: round(rows.reduce((sum,row)=>sum+row.spent,0)),
        owed: round(rows.reduce((sum,row)=>sum+Math.max(0,row.balance),0))
      },
      currency: this.setting('currency')
    };
  }
  // Supplier payments page: what was bought, paid and credited, and what is owed.
  supplierAccounts(user, query = {}) {
    this.require(user,'supplierpayments');
    const from = query.from ? date(query.from) : '0000-01-01';
    const to = query.to ? date(query.to) : '9999-12-31';
    if (from > to) fail('Start date must be before end date.');
    const byId = rows => new Map(rows.map(row => [row.id, row]));
    const purchases = byId(this.all('SELECT supplier_id AS id,SUM(total) AS total,COUNT(*) AS n FROM purchases WHERE date(date) BETWEEN ? AND ? GROUP BY supplier_id',from,to));
    const payments = byId(this.all("SELECT party_id AS id,SUM(amount) AS total,MAX(date) AS last FROM payments WHERE party_type='supplier' AND date(date) BETWEEN ? AND ? GROUP BY party_id",from,to));
    const returns = byId(this.all("SELECT p.supplier_id AS id,SUM(r.total) AS total FROM purchase_returns r JOIN purchases p ON p.id=r.purchase_id WHERE date(r.date) BETWEEN ? AND ? GROUP BY p.supplier_id",from,to));
    const rows = this.all('SELECT id,name,contact_person,phone,opening_balance FROM suppliers WHERE active=1 ORDER BY name').map(supplier => ({
      id: supplier.id,
      name: supplier.name,
      contact: supplier.contact_person,
      phone: supplier.phone,
      purchases: Number(purchases.get(supplier.id)?.n||0),
      purchased: round(purchases.get(supplier.id)?.total||0),
      paid: round(payments.get(supplier.id)?.total||0),
      credited: round(returns.get(supplier.id)?.total||0),
      balance: this.party('supplier',supplier.id).balance,
      lastPayment: payments.get(supplier.id)?.last||null
    }));
    return {
      rows,
      totals: {
        purchased: round(rows.reduce((sum,row)=>sum+row.purchased,0)),
        paid: round(rows.reduce((sum,row)=>sum+row.paid,0)),
        credited: round(rows.reduce((sum,row)=>sum+row.credited,0)),
        owed: round(rows.reduce((sum,row)=>sum+Math.max(0,row.balance),0))
      },
      currency: this.setting('currency')
    };
  }
  // Label printing: the shelf facts needed to choose medicines, then a batch of
  // labels (medicine, price, barcode) rendered locally as CODE128.
  labelBook(user) {
    this.require(user,'printlabels');
    const days = Number(this.setting('low_stock_days')) || 90;
    const rows = this.all(`SELECT m.id,m.name,m.generic_name,m.sku,m.barcode,m.unit,m.price,m.reorder_level,m.category_id,c.name AS category,
        COALESCE(SUM(b.quantity),0) AS stock,
        (SELECT MIN(b2.expiry) FROM batches b2 WHERE b2.medicine_id=m.id AND b2.quantity>0) AS expiry
      FROM medicines m LEFT JOIN categories c ON c.id=m.category_id LEFT JOIN batches b ON b.medicine_id=m.id
      WHERE m.active=1 GROUP BY m.id ORDER BY m.name`).map(row => {
      const stock = Number(row.stock);
      const expiring = Boolean(row.expiry) && row.expiry <= new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
      return { ...row, stock, low: stock > 0 && stock <= Number(row.reorder_level), out: stock === 0, expiring };
    });
    return { rows, categories: this.all('SELECT id,name FROM categories WHERE active=1 ORDER BY name'), currency: this.setting('currency'), warningDays: days };
  }
  printLabels(user, input) {
    this.require(user,'printlabels');
    const list = Array.isArray(input?.items) ? input.items : [];
    if (!list.length) fail('Choose at least one medicine to print.');
    if (list.length > 200) fail('Choose 200 medicines or fewer.');
    let total = 0;
    const items = list.map(item => {
      const copies = integer(item.copies, 'copies', 1);
      if (copies > 200) fail('Each medicine can print 200 labels or fewer.');
      total += copies;
      const medicine = this.get('SELECT id,name,generic_name,sku,barcode,price FROM medicines WHERE id=? AND active=1', id(item.id, 'medicine'));
      if (!medicine) fail('Medicine not found.');
      const code = medicine.barcode || medicine.sku;
      return {
        name: medicine.name,
        generic: medicine.generic_name,
        price: round(medicine.price),
        copies,
        barcode: code,
        svg: require('./barcode').code128(code)
      };
    });
    if (total > 500) fail('A single print run can hold 500 labels or fewer.');
    return { items, total, currency: this.setting('currency'), pharmacyName: this.setting('pharmacy_name') };
  }
  // Changing a selling price from the price list only touches medicines.price,
  // so it is audited and permission-checked on its own.
  updateMedicinePrice(user, input) {
    this.require(user, 'pricelist', true);
    const medicineId = id(input.id, 'medicine');
    const price = round(number(input.price, 'selling price', 0));
    if (price < 0.01) fail('Selling price must be greater than zero.');
    return transaction(this.db, () => {
      const medicine = this.get('SELECT id,name,price FROM medicines WHERE id=?', medicineId);
      if (!medicine) fail('Medicine not found.');
      this.run('UPDATE medicines SET price=? WHERE id=?', price, medicineId);
      audit(this.db, user, 'price_change', 'medicines', medicineId, { name: medicine.name, from: medicine.price, to: price });
      return { id: medicineId, price };
    });
  }
  priceListDocument(user) {
    const book = this.priceList(user);
    const currency = book.currency || '';
    return {
      kind: 'pricelist',
      from: '',
      to: '',
      columns: ['name', 'stock', 'purchasePrice', 'sellingPrice', 'profit'],
      rows: book.rows.map(row => ({
        name: row.name,
        stock: `${row.stock} ${row.unit}`,
        purchasePrice: `${currency} ${row.cost.toFixed(2)}`,
        sellingPrice: `${currency} ${row.price.toFixed(2)}`,
        profit: `${currency} ${row.profit.toFixed(2)}`
      })),
      currency,
      pharmacyName: this.setting('pharmacy_name')
    };
  }
  // The Medicines form saves the catalogue entry and, for a new medicine, its
  // opening batch in one transaction so the shelf and the books always agree.
  saveMedicine(user, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Invalid medicine.');
    const record = { ...input };
    if (!record.id && !String(record.sku || '').trim()) record.sku = this.nextSku();
    if (record.id) {
      const existing = this.get('SELECT * FROM medicines WHERE id=?', id(record.id, 'medicine'));
      if (!existing) fail('Record not found.');
      if (!String(record.sku || '').trim()) record.sku = existing.sku;
      if (!String(record.unit || '').trim()) record.unit = existing.unit;
      if (record.price === undefined || record.price === '') record.price = existing.price;
    }
    const opening = record.opening_stock;
    const quantity = opening ? Number(opening.quantity) : 0;
    if (quantity > 0 && record.id) fail('Opening stock is only entered when the medicine is created. Use purchases or stock adjustments to add stock.');
    return transaction(this.db, () => {
      const saved = this.saveEntity(user, 'medicines', record);
      if (quantity > 0) this.openingStock(user, saved.id, opening);
      return saved;
    });
  }
  nextSku() {
    for (let attempt = 1; attempt < 100000; attempt++) {
      const value = `MED-${String(attempt).padStart(5, '0')}`;
      if (!this.get('SELECT id FROM medicines WHERE sku=?', value)) return value;
    }
    fail('Could not create a medicine code.');
  }
  openingStock(user, medicineId, input) {
    this.require(user, 'inventory', true);
    const medicine = this.get('SELECT * FROM medicines WHERE id=?', id(medicineId, 'medicine'));
    if (!medicine) fail('Medicine not found.');
    const quantity = integer(input.quantity, 'quantity');
    const expiry = date(input.expiry);
    if (expiry <= new Date().toISOString().slice(0, 10)) fail('Opening stock expiry must be in the future.');
    const location = id(input.location_id || 1, 'location');
    if (!this.get('SELECT id FROM locations WHERE id=?', location)) fail('Stock location not found.');
    const batchNo = text(input.batch_no, 'batch number', false, 80) || 'OPEN-1';
    const cost = round(number(input.cost ?? medicine.cost, 'cost', 0));
    const price = round(number(input.price ?? medicine.price, 'price', 0));
    const value = round(quantity * cost);
    return transaction(this.db, () => {
      if (price > 0 && Number(medicine.price) !== price) this.run('UPDATE medicines SET price=? WHERE id=?', price, medicine.id);
      const r = this.run('INSERT INTO batches(medicine_id,location_id,batch_no,expiry,cost,quantity) VALUES(?,?,?,?,?,?)', medicine.id, location, batchNo, expiry, cost, quantity);
      this.run("INSERT INTO stock_movements(batch_id,quantity,reason,reference,user_id) VALUES(?,?, 'opening', ?, ?)", r.lastInsertRowid, quantity, `MED-${medicine.id}`, user.id);
      if (value > 0) this.journal(user, 'Opening stock', [[4, value], [8, 0, value]], `MED-${medicine.id}`);
      audit(this.db, user, 'opening_stock', 'batches', r.lastInsertRowid, { quantity, value });
      return { id: Number(r.lastInsertRowid), quantity, value };
    });
  }
  catalog(user, search = '') {
    this.require(user, 'pos');
    const term = `%${text(search,'search',false,100).replace(/[\\%_]/g,'\\$&')}%`;
    return this.all(`SELECT m.*, c.name AS category, COALESCE(SUM(CASE WHEN b.expiry>=date('now') THEN b.quantity ELSE 0 END),0) AS stock FROM medicines m LEFT JOIN categories c ON c.id=m.category_id LEFT JOIN batches b ON b.medicine_id=m.id WHERE m.active=1 AND (m.name LIKE ? ESCAPE '\\' OR m.sku LIKE ? ESCAPE '\\' OR m.barcode LIKE ? ESCAPE '\\' OR m.generic_name LIKE ? ESCAPE '\\') GROUP BY m.id ORDER BY m.name LIMIT 100`,term,term,term,term);
  }
  options(user) {
    this.requireSession(user);
    const result = {};
    for (const [key, table, permission] of [['categories','categories','categories'],['manufacturers','manufacturers','manufacturers'],['customers','customers','customers'],['suppliers','suppliers','suppliers'],['patients','patients','patients'],['staff','staff',['staff','employees','salaries','advances']],['locations','locations','inventory'],['medicines','medicines',['medicines','inventory']]]) {
      const can = Array.isArray(permission) ? permission.some(name => this.permissions(user).includes(name)) : this.permissions(user).includes(permission);
      if (can) result[key] = this.all(`SELECT id,name FROM ${table} WHERE active=1 ORDER BY name LIMIT 1000`);
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
    const config = { sales:['sales','sales'], salereturns:['sale_returns','sales'], customerpayments:['payments','customerpayments'], purchases:['purchases','purchases'],supplierpayments:['payments','supplierpayments'], purchasereturns:['purchase_returns','purchases'], payments:['payments','finance'], expenses:['expenses','finance'], advances:['advances','staff'], salaries:['salaries','staff'], transfers:['transfers','transfers'], adjustments:['adjustments','adjustments'], prescriptions:['prescriptions','prescriptions'], stockcount:['stock_counts','stockcount'], audit:['audit_logs','audit'] }[type];
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
    const rows = ['customerpayments','supplierpayments'].includes(type) ? this.all(`SELECT * FROM payments WHERE party_type=? AND date(${dateField}) BETWEEN ? AND ? ORDER BY id DESC LIMIT ?`,type==='customerpayments'?'customer':'supplier',from,to,limit) : this.all(sql,from,to,limit);
    return rows.map(row => {
      if (type==='sales') return {...row,customer:this.get('SELECT name FROM customers WHERE id=?',row.customer_id)?.name||'Walk-in',returns:this.get('SELECT COALESCE(SUM(total),0) AS n FROM sale_returns WHERE sale_id=?',row.id).n};
      if (type==='salereturns') {
        const sale=this.get('SELECT invoice_no,customer_id FROM sales WHERE id=?',row.sale_id);
        return {...row,invoice_no:sale?.invoice_no||'',customer:(sale?.customer_id&&this.get('SELECT name FROM customers WHERE id=?',sale.customer_id)?.name)||'Walk-in',items:this.get('SELECT COALESCE(SUM(quantity),0) AS n FROM sale_return_items WHERE return_id=?',row.id).n,user:this.get('SELECT name FROM users WHERE id=?',row.user_id)?.name||''};
      }
      if (type==='purchasereturns') {
        const purchase=this.get('SELECT invoice_no,supplier_id FROM purchases WHERE id=?',row.purchase_id);
        return {...row,invoice_no:purchase?.invoice_no||'',supplier:purchase?.supplier_id?this.get('SELECT name FROM suppliers WHERE id=?',purchase.supplier_id)?.name||'':'',items:this.get('SELECT COALESCE(SUM(quantity),0) AS n FROM purchase_return_items WHERE return_id=?',row.id).n,user:this.get('SELECT name FROM users WHERE id=?',row.user_id)?.name||''};
      }
      if (type==='purchases') return {...row,supplier:this.get('SELECT name FROM suppliers WHERE id=?',row.supplier_id)?.name};
      if (type==='customerpayments') return {...row,customer:this.get('SELECT name FROM customers WHERE id=?',row.party_id)?.name||'',account:this.get('SELECT name FROM accounts WHERE id=?',row.account_id)?.name||'',user:this.get('SELECT name FROM users WHERE id=?',row.user_id)?.name||'',allocated:this.get('SELECT COALESCE(SUM(amount),0) AS n FROM payment_allocations WHERE payment_id=?',row.id).n};
      if (type==='supplierpayments') return {...row,supplier:this.get('SELECT name FROM suppliers WHERE id=?',row.party_id)?.name||'',account:this.get('SELECT name FROM accounts WHERE id=?',row.account_id)?.name||'',user:this.get('SELECT name FROM users WHERE id=?',row.user_id)?.name||'',allocated:this.get('SELECT COALESCE(SUM(amount),0) AS n FROM payment_allocations WHERE payment_id=?',row.id).n};
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
    const cashier=row.user_id?this.get('SELECT name FROM users WHERE id=?',row.user_id)?.name||'':'';
    // The printed bill carries the patient and the prescribing doctor.
    const patientName=type==='sale'&&row.patient_id?this.get('SELECT name FROM patients WHERE id=?',row.patient_id)?.name||'':' ';
    const doctor=type==='sale'&&row.prescription_id?this.get('SELECT doctor FROM prescriptions WHERE id=?',row.prescription_id)?.doctor||'':' ';
    return {...row,cashier,patientName:patientName.trim(),doctor:doctor.trim(),items,party,returns:type==='stockcount'?[]:this.all(`SELECT * FROM ${type}_returns WHERE ${type}_id=?`,row.id)};
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
    const type=input.partyType; this.require(user,type==='customer'?'customers':'suppliers',true);
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
    this.require(user,'expenses');const amount=round(number(input.amount,'amount',0.01)),payment=method(input.method);if(payment==='credit')fail('Expenses must be paid.');
    const account=this.paymentAccount(input.accountId,payment);
    return transaction(this.db,()=>{const r=this.run('INSERT INTO expenses(category,description,amount,account_id,user_id) VALUES(?,?,?,?,?)',text(input.category,'category',true,100),text(input.description,'description',true),amount,account.id,user.id);this.journal(user,'Operating expense',[[13,amount],[account.id,0,amount]],`EXP-${r.lastInsertRowid}`);audit(this.db,user,'create','expenses',r.lastInsertRowid,{amount});return {id:Number(r.lastInsertRowid)};});
  }
  advance(user,input) {
    this.require(user,'staff',true);const staff=this.get('SELECT * FROM staff WHERE id=? AND active=1',id(input.staffId));if(!staff)fail('Staff not found.');
    const amount=round(number(input.amount,'amount',0.01)),payment=method(input.method);if(payment==='credit')fail('Choose cash or bank.');const account=this.paymentAccount(input.accountId,payment);
    return transaction(this.db,()=>{const r=this.run('INSERT INTO advances(staff_id,amount,note,account_id,user_id) VALUES(?,?,?,?,?)',staff.id,amount,text(input.note,'note'),account.id,user.id);this.journal(user,'Staff advance',[[5,amount],[account.id,0,amount]],`ADV-${r.lastInsertRowid}`);audit(this.db,user,'create','advances',r.lastInsertRowid,{amount});return {id:Number(r.lastInsertRowid)};});
  }
  // Employees page: the team list with what each one costs per month and any
  // advance still to be recovered.
  employeeBook(user) {
    this.require(user,['employees','staff']);
    const rows = this.all(`SELECT s.id,s.name,s.position,s.phone,s.salary,s.hired_on,s.active,
        (SELECT COALESCE(SUM(a.amount-a.repaid),0) FROM advances a WHERE a.staff_id=s.id) AS advance_due,
        (SELECT MAX(x.date) FROM salaries x WHERE x.staff_id=s.id) AS last_paid
      FROM staff s ORDER BY s.active DESC,s.name`).map(row => ({
        ...row,
        salary: round(row.salary),
        advance_due: round(row.advance_due),
        last_paid: row.last_paid || null
      }));
    return {
      rows,
      totals: {
        active: rows.filter(row => Number(row.active) === 1).length,
        payroll: round(rows.filter(row => Number(row.active) === 1).reduce((sum,row) => sum + Number(row.salary), 0))
      },
      currency: this.setting('currency')
    };
  }
  // Monthly salaries page: issued payroll plus the people still unpaid for the
  // selected month, so the pending card and the list always agree.
  salaryBook(user, query = {}) {
    this.require(user,['salaries','staff']);
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(query.month || '')) ? String(query.month) : new Date().toISOString().slice(0,7);
    const year = /^\d{4}$/.test(String(query.year || '')) ? String(query.year) : '';
    const status = ['paid','pending'].includes(String(query.status || '')) ? String(query.status) : '';
    const issued = this.all(`SELECT s.id,s.month,s.gross,s.additions,s.deductions,s.deduction,s.net,s.date,s.staff_id,
        t.name AS staff, t.position, a.name AS account, COALESCE(u.name,'') AS recorded_by
      FROM salaries s JOIN staff t ON t.id=s.staff_id LEFT JOIN accounts a ON a.id=s.account_id LEFT JOIN users u ON u.id=s.user_id
      ORDER BY s.month DESC,s.id DESC`).map(row => ({
        id: row.id,
        month: row.month,
        staff_id: row.staff_id,
        staff: row.staff,
        position: row.position,
        base: round(row.gross),
        additions: round(row.additions),
        deductions: round(row.deductions),
        advance_deduction: round(row.deduction),
        net: round(row.net),
        status: 'paid',
        paid_date: row.date,
        account: row.account || '',
        recorded_by: row.recorded_by
      })).filter(row => (!year || row.month.startsWith(year)) && (!status || status === 'paid'));
    const paidThisMonth = new Set(this.all('SELECT staff_id FROM salaries WHERE month=?',month).map(row => row.staff_id));
    const pending = status === 'paid' ? [] : this.all('SELECT id,name,position,salary FROM staff WHERE active=1 ORDER BY name')
      .filter(row => !paidThisMonth.has(row.id))
      .map(row => ({
        id: null,
        month,
        staff_id: row.id,
        staff: row.name,
        position: row.position,
        base: round(row.salary),
        additions: 0,
        deductions: 0,
        advance_deduction: round(this.get('SELECT COALESCE(SUM(amount-repaid),0) AS n FROM advances WHERE staff_id=?',row.id).n),
        net: 0,
        status: 'pending',
        paid_date: null,
        account: '',
        recorded_by: ''
      }));
    const rows = [...issued, ...pending].sort((a,b) => b.month.localeCompare(a.month) || String(a.staff).localeCompare(String(b.staff)));
    const payroll = round(this.all('SELECT salary FROM staff WHERE active=1').reduce((total,row) => total + Number(row.salary), 0));
    return {
      month,
      year,
      status,
      years: [...new Set(this.all('SELECT DISTINCT substr(month,1,4) AS year FROM salaries ORDER BY year DESC').map(row => row.year))],
      months: [...new Set(this.all('SELECT DISTINCT month FROM salaries ORDER BY month DESC').map(row => row.month))],
      currency: this.setting('currency'),
      totals: {
        payroll,
        pending: pending.length,
        paid: issued.filter(row => row.month === month).length,
        netPaid: round(issued.filter(row => row.month === month).reduce((total,row) => total + Number(row.net), 0))
      },
      rows
    };
  }
  // Salary advances page: what is still owed back and what has been settled.
  advanceBook(user, query = {}) {
    this.require(user,['advances','staff']);
    const status = ['active','settled'].includes(String(query.status || '')) ? String(query.status) : '';
    const rows = this.all(`SELECT a.id,a.date,a.amount,a.repaid,a.note,a.staff_id,t.name AS staff,t.position,a.account_id,ac.name AS account,
        COALESCE(u.name,'') AS recorded_by
      FROM advances a JOIN staff t ON t.id=a.staff_id LEFT JOIN accounts ac ON ac.id=a.account_id LEFT JOIN users u ON u.id=a.user_id
      ORDER BY a.date DESC,a.id DESC`).map(row => ({
        ...row,
        amount: round(row.amount),
        repaid: round(row.repaid),
        remaining: round(Number(row.amount) - Number(row.repaid)),
        status: Number(row.amount) - Number(row.repaid) > 0 ? 'active' : 'settled'
      })).filter(row => !status || row.status === status);
    const all = this.all('SELECT amount,repaid FROM advances');
    return {
      status,
      currency: this.setting('currency'),
      totals: {
        outstanding: round(all.reduce((total,row) => total + Math.max(0, Number(row.amount) - Number(row.repaid)), 0)),
        recovered: round(all.reduce((total,row) => total + Number(row.repaid), 0)),
        activeEmployees: this.get('SELECT COUNT(*) AS n FROM staff WHERE active=1').n
      },
      rows
    };
  }
  salary(user,input) {
    this.require(user,'staff',true);const staff=this.get('SELECT * FROM staff WHERE id=? AND active=1',id(input.staffId));if(!staff)fail('Staff not found.');
    const month=text(input.month,'month',true,7);if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))fail('Choose a valid month.');
    const gross=round(number(input.gross ?? staff.salary,'gross')),payment=method(input.method);if(payment==='credit')fail('Choose cash or bank.');const account=this.paymentAccount(input.accountId,payment);
    return transaction(this.db,()=>{
      if(this.get('SELECT id FROM salaries WHERE staff_id=? AND month=?',staff.id,month))fail('This staff member has already been paid for this month.');
      const additions=input.additions===undefined||input.additions===''?0:round(number(input.additions,'additions'));
      const deductions=input.deductions===undefined||input.deductions===''?0:round(number(input.deductions,'deductions'));
      if(deductions>round(gross+additions))fail('Deductions cannot be more than the base salary plus additions.');
      const advances=this.all('SELECT * FROM advances WHERE staff_id=? AND amount>repaid ORDER BY date,id',staff.id);
      const deduction=Math.min(round(gross+additions-deductions),sum(advances.map(a=>({amount:a.amount-a.repaid})),'amount'));
      const net=round(gross+additions-deductions-deduction);const r=this.run('INSERT INTO salaries(staff_id,month,gross,additions,deductions,deduction,net,account_id,user_id) VALUES(?,?,?,?,?,?,?,?,?)',staff.id,month,gross,additions,deductions,deduction,net,account.id,user.id);
      let remaining=deduction;for(const advance of advances){const value=Math.min(remaining,round(advance.amount-advance.repaid));if(value<=0)continue;this.run('UPDATE advances SET repaid=repaid+? WHERE id=?',value,advance.id);remaining=round(remaining-value);if(!remaining)break;}
      this.journal(user,'Monthly salary',[[14,round(gross+additions-deductions)],[5,0,deduction],[account.id,0,net]],`SAL-${r.lastInsertRowid}`);audit(this.db,user,'pay_salary','salaries',r.lastInsertRowid,{gross,additions,deductions,deduction,net});return {id:Number(r.lastInsertRowid),net,deduction,additions,deductions};
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
  // Settings → Profile: the signed-in user renames their own account.
  profile(user, input = {}) {
    this.requireSession(user);
    const name = text(input.name, 'name', true, 100);
    const username = text(input.username ?? user.username, 'username', true, 40).toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) fail('Username must be 3–40 letters, numbers, dots or underscores.');
    if (this.get('SELECT id FROM users WHERE username=? AND id<>?', username, user.id)) fail('That username is already taken.');
    return transaction(this.db, () => {
      this.run('UPDATE users SET name=?,username=? WHERE id=?', name, username, user.id);
      audit(this.db, user, 'update', 'profile', user.id, { name, username });
      return this.publicUser(this.get('SELECT * FROM users WHERE id=?', user.id));
    });
  }
  // Settings → Profile: change your own password by proving the current one.
  changePassword(user, input = {}) {
    this.requireSession(user);
    const row = this.get('SELECT * FROM users WHERE id=?', user.id);
    if (!row || !verifyPassword(String(input.currentPassword || ''), row.password_hash)) fail('The current password is incorrect.');
    const next = String(input.newPassword || '');
    if (next.length < 6 || next.length > 128) fail('New password must contain 6–128 characters.');
    if (next === String(input.currentPassword || '')) fail('Choose a different password from the current one.');
    return transaction(this.db, () => {
      this.run('UPDATE users SET password_hash=? WHERE id=?', hashPassword(next), user.id);
      audit(this.db, user, 'change_password', 'users', user.id);
      return { ok: true };
    });
  }
  saveUser(user,input) {
    this.require(user,'users',true);const userId=input.id?id(input.id):null;const old=userId?this.get('SELECT * FROM users WHERE id=?',userId):null;if(userId&&!old)fail('User not found.');
    const username=text(input.username,'username',true,40).toLowerCase();if(!/^[a-z0-9._-]{3,40}$/.test(username))fail('Invalid username.');
    const role=input.role;if(!Object.hasOwn(rolePermissions,role))fail('Invalid role.');const active=bool(input.active??1);
    if(old?.id===user.id&&(!active||role!=='admin'))fail('You cannot disable or demote your own account.');
    if(old?.role==='admin'&&old.active&&(!active||role!=='admin')&&!this.get("SELECT id FROM users WHERE role='admin' AND active=1 AND id<>?",old.id))fail('Keep at least one active administrator.');
    const password=String(input.password||'');if((!old||password)&&(password.length<6||password.length>128))fail('Password must contain 6–128 characters.');
    const permissions={};for(const m of modules)if(typeof input.permissions?.[m]==='boolean')permissions[m]=input.permissions[m];
    // An administrator always keeps every module, so the account that can fix
    // permissions can never be locked out by its own saved set.
    if(role==='admin')for(const m of modules)permissions[m]=true;
    return transaction(this.db,()=>{let userIdFinal;if(old){this.run('UPDATE users SET username=?,name=?,role=?,active=?,permissions=? WHERE id=?',username,text(input.name,'name',true,100),role,active,JSON.stringify(permissions),old.id);if(password)this.run('UPDATE users SET password_hash=? WHERE id=?',hashPassword(password),old.id);userIdFinal=old.id;}else{const r=this.run('INSERT INTO users(username,name,password_hash,role,active,permissions) VALUES(?,?,?,?,?,?)',username,text(input.name,'name',true,100),hashPassword(password),role,active,JSON.stringify(permissions));userIdFinal=Number(r.lastInsertRowid);}audit(this.db,user,old?'update_user':'create_user','users',userIdFinal,{role,active,permissions});return {id:userIdFinal};});
  }
  settings(user,input) {
    this.require(user,'settings',true);const allowed=['pharmacy_name','currency','address','phone','tax_percent','low_stock_days','receipt_footer','receipt_template','receipt_paper','receipt_copies','language','theme','notify_low_stock','notify_out_of_stock','notify_expiry','notify_daily_summary','notify_sound','notify_desktop','notify_register'];
    return transaction(this.db,()=>{for(const key of allowed)if(input[key]!==undefined){let value=text(input[key],key,key==='pharmacy_name',500);if(key==='tax_percent')value=String(number(value,'tax',0,100));if(key==='low_stock_days')value=String(integer(value,'expiry warning days',1,3650));if(key==='currency'&&!/^[A-Z]{3}$/.test(value))fail('Use a three-letter currency code.');if(key==='language'&&!['en','ps','fa-AF'].includes(value))fail('Unsupported language.');if(key==='receipt_template'&&!['classic','compact','boxed'].includes(value))fail('Unsupported receipt template.');if(key==='receipt_paper'&&!['80mm','58mm','A4'].includes(value))fail('Unsupported paper size.');if(key==='receipt_copies'){const copies=integer(value,'receipt copies',1);if(copies>5)fail('Receipt copies must be between 1 and 5.');value=String(copies);}if(key==='theme'&&!['light','dark'].includes(value))fail('Unsupported theme.');if(key.startsWith('notify_'))value=input[key]===true||input[key]===1||input[key]==='1'||input[key]==='true'?'1':'0';this.run('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,value);}audit(this.db,user,'update','settings');return {ok:true};});
  }
  preference(user,input) { const data={}; if(input.language!==undefined){if(!['en','ps','fa-AF'].includes(input.language))fail('Unsupported language.');data.language=input.language;}if(input.theme!==undefined){if(!['light','dark'].includes(input.theme))fail('Unsupported theme.');data.theme=input.theme;}for(const [key,value] of Object.entries(data))this.run('UPDATE settings SET value=? WHERE key=?',value,key);return data; }
  preferences(user) {this.requireSession(user);return Object.fromEntries(this.all('SELECT key,value FROM settings').map(r=>[r.key,r.value]));}
  dashboard(user) {
    this.require(user,'dashboard');const p=this.permissions(user);const result={pharmacyName:this.setting('pharmacy_name'),currency:this.setting('currency')};
    if(p.includes('reports')||p.includes('finance')){
      result.today=this.get("SELECT COALESCE(SUM(total),0) AS sales,COUNT(*) AS orders,COALESCE(SUM(discount),0) AS discounts FROM sales WHERE date(date)=date('now')");
      result.month=this.get("SELECT COALESCE(SUM(total),0) AS sales FROM sales WHERE strftime('%Y-%m',date)=strftime('%Y-%m','now')").sales;
      result.trend=this.all("SELECT date(date) AS day,SUM(total) AS total,COUNT(*) AS orders FROM sales WHERE date>=date('now','-6 days') GROUP BY date(date) ORDER BY day");
    }
    if(p.includes('inventory')){result.medicines=this.get('SELECT COUNT(*) AS n FROM medicines WHERE active=1').n;result.low=this.all('SELECT m.id,m.name,m.reorder_level,COALESCE(SUM(b.quantity),0) AS stock FROM medicines m LEFT JOIN batches b ON b.medicine_id=m.id WHERE m.active=1 GROUP BY m.id HAVING stock<=m.reorder_level ORDER BY stock LIMIT 8');result.expiring=this.all("SELECT m.name,b.batch_no,b.expiry,b.quantity FROM batches b JOIN medicines m ON m.id=b.medicine_id WHERE b.quantity>0 AND b.expiry<=date('now','+'||?||' days') ORDER BY b.expiry LIMIT 8",this.setting('low_stock_days'));result.stockValue=this.get('SELECT COALESCE(SUM(quantity*cost),0) AS n FROM batches').n;}
    if(p.includes('inventory')){result.lowCount=this.all('SELECT m.id FROM medicines m LEFT JOIN batches b ON b.medicine_id=m.id WHERE m.active=1 GROUP BY m.id HAVING COALESCE(SUM(b.quantity),0)<=m.reorder_level').length;result.expiringCount=this.all("SELECT b.id FROM batches b WHERE b.quantity>0 AND b.expiry<=date('now','+'||?||' days')",this.setting('low_stock_days')).length;}
    if(p.includes('finance'))result.expenses={today:this.get("SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE date=date('now')").total,month:this.get("SELECT COALESCE(SUM(amount),0) AS total,COUNT(*) AS count FROM expenses WHERE strftime('%Y-%m',date)=strftime('%Y-%m','now')"),recent:this.all('SELECT id,date,category,description,amount FROM expenses ORDER BY id DESC LIMIT 4')};
    if(p.includes('customers'))result.receivable=this.get('SELECT COALESCE(SUM(l.debit-l.credit),0) AS n FROM journal_lines l WHERE l.account_id=3').n;
    result.register=this.session()?{id:this.session().id}:null;result.recent=p.includes('sales')?this.all('SELECT s.id,s.invoice_no,s.total,s.date,c.name AS customer FROM sales s LEFT JOIN customers c ON c.id=s.customer_id ORDER BY s.id DESC LIMIT 5'):[];
    return result;
  }
  medicineBook(user) {
    this.require(user,['medicines','inventory']);
    const rows = this.all(`SELECT m.id,m.name,m.generic_name,m.sku,m.barcode,m.unit,m.cost,m.price,m.reorder_level,m.active,m.category_id,c.name AS category,
        u.name AS recorded_by, COALESCE(SUM(b.quantity),0) AS stock,
        (SELECT MIN(b2.expiry) FROM batches b2 WHERE b2.medicine_id=m.id AND b2.quantity>0) AS expiry
      FROM medicines m LEFT JOIN categories c ON c.id=m.category_id LEFT JOIN users u ON u.id=m.created_by LEFT JOIN batches b ON b.medicine_id=m.id
      GROUP BY m.id ORDER BY m.name`);
    return {
      rows,
      totals: {
        medicines: rows.length,
        active: rows.filter(row => Number(row.active) === 1).length,
        lowStock: rows.filter(row => Number(row.active) === 1 && Number(row.stock) <= Number(row.reorder_level)).length,
        value: round(rows.reduce((sum,row) => sum + Number(row.stock)*Number(row.cost),0))
      },
      currency: this.setting('currency')
    };
  }
  // Inventory view: one row per active medicine with the shelf quantity summed
  // from every batch and the nearest in-stock expiry, so the page can filter by
  // all stock, low stock, out of stock and expiring soon.
  inventoryBook(user) {
    this.require(user,'inventory');
    const days = Number(this.setting('low_stock_days')) || 90;
    const rows = this.all(`SELECT m.id,m.name,m.generic_name,m.sku,m.barcode,m.unit,m.reorder_level,
        COALESCE(SUM(b.quantity),0) AS stock,
        (SELECT MIN(b2.expiry) FROM batches b2 WHERE b2.medicine_id=m.id AND b2.quantity>0) AS expiry
      FROM medicines m LEFT JOIN batches b ON b.medicine_id=m.id
      WHERE m.active=1 GROUP BY m.id ORDER BY m.name`).map(row => {
      const stock = Number(row.stock);
      const reorder = Number(row.reorder_level);
      const expiring = Boolean(row.expiry) && row.expiry <= new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
      return {
        ...row,
        stock,
        reorder_level: reorder,
        out: stock === 0,
        low: stock > 0 && stock <= reorder,
        expiring
      };
    });
    return {
      rows,
      totals: {
        medicines: rows.length,
        low: rows.filter(row => row.low).length,
        out: rows.filter(row => row.out).length,
        expiring: rows.filter(row => row.expiring).length,
        warningDays: days
      },
      currency: this.setting('currency')
    };
  }

  customerBook(user) {
    this.require(user,'customers');
    const balance = customer => {
      const invoices = this.get('SELECT COALESCE(SUM(total-paid),0) AS n FROM sales WHERE customer_id=?',customer.id).n;
      const returns = this.get('SELECT COALESCE(SUM(r.credit_amount),0) AS n FROM sale_returns r JOIN sales s ON s.id=r.sale_id WHERE s.customer_id=?',customer.id).n;
      const payments = this.get('SELECT COALESCE(SUM(amount),0) AS n FROM payments WHERE party_type=? AND party_id=?','customer',customer.id).n;
      return round(customer.opening_balance+invoices-returns-payments);
    };
    const rows = this.all('SELECT id,name,phone,email,address,opening_balance,credit_limit,active FROM customers ORDER BY name').map(customer => ({
      ...customer,
      active: Number(customer.active) === 1 ? 1 : 0,
      balance: balance(customer)
    }));
    return {
      rows,
      totals: {
        customers: rows.length,
        active: rows.filter(row => row.active === 1).length,
        outstanding: round(rows.reduce((sum,row) => sum + Math.max(0,row.balance),0))
      },
      currency: this.setting('currency')
    };
  }
  customerAccounts(user, query = {}) {
    this.require(user,'customerpayments');
    const from = query.from ? date(query.from) : '0000-01-01';
    const to = query.to ? date(query.to) : '9999-12-31';
    if (from > to) fail('Start date must be before end date.');
    const byId = rows => new Map(rows.map(row => [row.id, row]));
    const credit = byId(this.all("SELECT customer_id AS id,SUM(total) AS total FROM sales WHERE payment_method='credit' AND customer_id IS NOT NULL AND date(date) BETWEEN ? AND ? GROUP BY customer_id",from,to));
    const payments = byId(this.all("SELECT party_id AS id,SUM(amount) AS total,MAX(date) AS last FROM payments WHERE party_type='customer' AND date(date) BETWEEN ? AND ? GROUP BY party_id",from,to));
    const returns = byId(this.all("SELECT s.customer_id AS id,SUM(r.total) AS total FROM sale_returns r JOIN sales s ON s.id=r.sale_id WHERE s.customer_id IS NOT NULL AND date(r.date) BETWEEN ? AND ? GROUP BY s.customer_id",from,to));
    const rows = this.all('SELECT id,name,phone,opening_balance FROM customers WHERE active=1 ORDER BY name').map(customer => ({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      creditSales: round(credit.get(customer.id)?.total||0),
      paid: round(payments.get(customer.id)?.total||0),
      returned: round(returns.get(customer.id)?.total||0),
      balance: this.party('customer',customer.id).balance,
      lastPayment: payments.get(customer.id)?.last||null
    }));
    return {
      rows,
      totals: {
        creditSales: round(rows.reduce((sum,row)=>sum+row.creditSales,0)),
        paid: round(rows.reduce((sum,row)=>sum+row.paid,0)),
        returned: round(rows.reduce((sum,row)=>sum+row.returned,0)),
        owed: round(rows.reduce((sum,row)=>sum+Math.max(0,row.balance),0))
      },
      currency: this.setting('currency')
    };
  }
  report(user,input) {
    const kind=input.kind||'sales';const permission=['profit','finance'].includes(kind)?'finance':kind==='audit'?'audit':'reports';this.require(user,permission);
    const from=input.from?date(input.from):new Date(Date.now()-29*86400000).toISOString().slice(0,10),to=input.to?date(input.to):new Date().toISOString().slice(0,10);if(from>to)fail('Invalid report range.');
    let rows=[],columns=[];
    if(kind==='sales'){columns=['invoice_no','date','total','paid','payment_method','status'];rows=this.all('SELECT invoice_no,date,total,paid,payment_method,status FROM sales WHERE date(date) BETWEEN ? AND ? ORDER BY date',from,to);}
    else if(kind==='purchases'){columns=['invoice_no','date','total','paid','status'];rows=this.all('SELECT invoice_no,date,total,paid,status FROM purchases WHERE date(date) BETWEEN ? AND ? ORDER BY date',from,to);}
    else if(kind==='expenses'){columns=['date','category','description','amount','account','user'];rows=this.all("SELECT e.date,e.category,e.description,e.amount,a.name AS account,COALESCE(u.name,'') AS user FROM expenses e LEFT JOIN accounts a ON a.id=e.account_id LEFT JOIN users u ON u.id=e.user_id WHERE date(e.date) BETWEEN ? AND ? ORDER BY e.date DESC",from,to);}
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
    this.require(user,['barcodes','medicines','inventory']);
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
