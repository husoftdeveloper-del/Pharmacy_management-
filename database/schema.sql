PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','pharmacist','cashier','accountant')),
 permissions TEXT NOT NULL DEFAULT '{}', active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS manufacturers (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, country TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', opening_balance REAL NOT NULL DEFAULT 0 CHECK(opening_balance >= 0), credit_limit REAL NOT NULL DEFAULT 0 CHECK(credit_limit >= 0), active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS suppliers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', opening_balance REAL NOT NULL DEFAULT 0 CHECK(opening_balance >= 0), active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS patients (id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', age INTEGER CHECK(age BETWEEN 0 AND 130), gender TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS staff (id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', position TEXT NOT NULL DEFAULT '', salary REAL NOT NULL DEFAULT 0 CHECK(salary >= 0), hired_on TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS locations (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS medicines (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL, generic_name TEXT NOT NULL DEFAULT '', sku TEXT NOT NULL UNIQUE,
 barcode TEXT UNIQUE, category_id INTEGER REFERENCES categories(id), manufacturer_id INTEGER REFERENCES manufacturers(id),
 unit TEXT NOT NULL DEFAULT 'piece', cost REAL NOT NULL DEFAULT 0 CHECK(cost >= 0), price REAL NOT NULL CHECK(price >= 0),
 reorder_level INTEGER NOT NULL DEFAULT 10 CHECK(reorder_level >= 0), rx_required INTEGER NOT NULL DEFAULT 0 CHECK(rx_required IN (0,1)),
 storage TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS batches (
 id INTEGER PRIMARY KEY, medicine_id INTEGER NOT NULL REFERENCES medicines(id), location_id INTEGER NOT NULL REFERENCES locations(id),
 batch_no TEXT NOT NULL, expiry TEXT NOT NULL, cost REAL NOT NULL CHECK(cost >= 0), quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
 UNIQUE(medicine_id, location_id, batch_no, expiry)
);
CREATE TABLE IF NOT EXISTS stock_movements (
 id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES batches(id), quantity INTEGER NOT NULL,
 reason TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '', user_id INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS accounts (id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('asset','liability','equity','income','expense')), system INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS journals (id INTEGER PRIMARY KEY, date TEXT NOT NULL DEFAULT (date('now')), description TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '', user_id INTEGER REFERENCES users(id), session_id INTEGER REFERENCES cash_sessions(id), created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS journal_lines (id INTEGER PRIMARY KEY, journal_id INTEGER NOT NULL REFERENCES journals(id), account_id INTEGER NOT NULL REFERENCES accounts(id), debit REAL NOT NULL DEFAULT 0 CHECK(debit >= 0), credit REAL NOT NULL DEFAULT 0 CHECK(credit >= 0), CHECK((debit = 0) <> (credit = 0)));
CREATE TABLE IF NOT EXISTS sales (
 id INTEGER PRIMARY KEY, invoice_no TEXT NOT NULL UNIQUE, customer_id INTEGER REFERENCES customers(id), patient_id INTEGER REFERENCES patients(id), prescription_id INTEGER,
 date TEXT NOT NULL DEFAULT (datetime('now')), subtotal REAL NOT NULL, discount REAL NOT NULL DEFAULT 0, tax REAL NOT NULL DEFAULT 0,
 total REAL NOT NULL CHECK(total >= 0), paid REAL NOT NULL CHECK(paid >= 0), payment_method TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'completed', user_id INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS sale_items (id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id), medicine_id INTEGER NOT NULL REFERENCES medicines(id), batch_id INTEGER NOT NULL REFERENCES batches(id), quantity INTEGER NOT NULL CHECK(quantity > 0), price REAL NOT NULL CHECK(price >= 0), cost REAL NOT NULL CHECK(cost >= 0), returned_qty INTEGER NOT NULL DEFAULT 0 CHECK(returned_qty >= 0 AND returned_qty <= quantity));
CREATE TABLE IF NOT EXISTS sale_returns (id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id), date TEXT NOT NULL DEFAULT (datetime('now')), total REAL NOT NULL CHECK(total >= 0), credit_amount REAL NOT NULL DEFAULT 0 CHECK(credit_amount >= 0), reason TEXT NOT NULL, method TEXT NOT NULL, user_id INTEGER REFERENCES users(id));
CREATE TABLE IF NOT EXISTS sale_return_items (id INTEGER PRIMARY KEY, return_id INTEGER NOT NULL REFERENCES sale_returns(id), sale_item_id INTEGER NOT NULL REFERENCES sale_items(id), quantity INTEGER NOT NULL CHECK(quantity > 0), restock INTEGER NOT NULL CHECK(restock IN (0,1)));
CREATE TABLE IF NOT EXISTS purchases (id INTEGER PRIMARY KEY, invoice_no TEXT NOT NULL, supplier_id INTEGER NOT NULL REFERENCES suppliers(id), date TEXT NOT NULL DEFAULT (datetime('now')), subtotal REAL NOT NULL, discount REAL NOT NULL DEFAULT 0, total REAL NOT NULL, paid REAL NOT NULL DEFAULT 0, payment_method TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'received', user_id INTEGER REFERENCES users(id), UNIQUE(supplier_id, invoice_no));
CREATE TABLE IF NOT EXISTS purchase_items (id INTEGER PRIMARY KEY, purchase_id INTEGER NOT NULL REFERENCES purchases(id), medicine_id INTEGER NOT NULL REFERENCES medicines(id), batch_id INTEGER NOT NULL REFERENCES batches(id), quantity INTEGER NOT NULL CHECK(quantity > 0), cost REAL NOT NULL CHECK(cost >= 0), returned_qty INTEGER NOT NULL DEFAULT 0 CHECK(returned_qty >= 0 AND returned_qty <= quantity));
CREATE TABLE IF NOT EXISTS purchase_returns (id INTEGER PRIMARY KEY, purchase_id INTEGER NOT NULL REFERENCES purchases(id), date TEXT NOT NULL DEFAULT (datetime('now')), total REAL NOT NULL, credit_amount REAL NOT NULL DEFAULT 0 CHECK(credit_amount >= 0), reason TEXT NOT NULL, method TEXT NOT NULL, user_id INTEGER REFERENCES users(id));
CREATE TABLE IF NOT EXISTS purchase_return_items (id INTEGER PRIMARY KEY, return_id INTEGER NOT NULL REFERENCES purchase_returns(id), purchase_item_id INTEGER NOT NULL REFERENCES purchase_items(id), quantity INTEGER NOT NULL CHECK(quantity > 0));
CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY, party_type TEXT NOT NULL CHECK(party_type IN ('customer','supplier')), party_id INTEGER NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('in','out')), amount REAL NOT NULL CHECK(amount > 0), account_id INTEGER NOT NULL REFERENCES accounts(id), method TEXT NOT NULL, reference TEXT NOT NULL DEFAULT '', date TEXT NOT NULL DEFAULT (datetime('now')), user_id INTEGER REFERENCES users(id));
CREATE TABLE IF NOT EXISTS payment_allocations (id INTEGER PRIMARY KEY, payment_id INTEGER NOT NULL REFERENCES payments(id), invoice_type TEXT NOT NULL CHECK(invoice_type IN ('sale','purchase')), invoice_id INTEGER NOT NULL, amount REAL NOT NULL CHECK(amount > 0));
CREATE TABLE IF NOT EXISTS expenses (id INTEGER PRIMARY KEY, date TEXT NOT NULL DEFAULT (date('now')), category TEXT NOT NULL, description TEXT NOT NULL, amount REAL NOT NULL CHECK(amount > 0), account_id INTEGER NOT NULL REFERENCES accounts(id), user_id INTEGER REFERENCES users(id));
CREATE TABLE IF NOT EXISTS advances (id INTEGER PRIMARY KEY, staff_id INTEGER NOT NULL REFERENCES staff(id), date TEXT NOT NULL DEFAULT (date('now')), amount REAL NOT NULL CHECK(amount > 0), repaid REAL NOT NULL DEFAULT 0 CHECK(repaid >= 0 AND repaid <= amount), note TEXT NOT NULL DEFAULT '', account_id INTEGER NOT NULL REFERENCES accounts(id), user_id INTEGER REFERENCES users(id));
CREATE TABLE IF NOT EXISTS salaries (id INTEGER PRIMARY KEY, staff_id INTEGER NOT NULL REFERENCES staff(id), month TEXT NOT NULL, gross REAL NOT NULL CHECK(gross >= 0), deduction REAL NOT NULL DEFAULT 0 CHECK(deduction >= 0 AND deduction <= gross), net REAL NOT NULL CHECK(net >= 0), account_id INTEGER NOT NULL REFERENCES accounts(id), date TEXT NOT NULL DEFAULT (date('now')), user_id INTEGER REFERENCES users(id), UNIQUE(staff_id, month));
CREATE TABLE IF NOT EXISTS cash_sessions (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), opened_at TEXT NOT NULL DEFAULT (datetime('now')), closed_at TEXT, opening REAL NOT NULL CHECK(opening >= 0), counted REAL, expected REAL, note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')));
CREATE UNIQUE INDEX IF NOT EXISTS one_open_register ON cash_sessions(status) WHERE status='open';
CREATE TABLE IF NOT EXISTS cash_movements (id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES cash_sessions(id), direction TEXT NOT NULL CHECK(direction IN ('in','out')), amount REAL NOT NULL CHECK(amount > 0), reason TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS prescriptions (id INTEGER PRIMARY KEY, patient_id INTEGER NOT NULL REFERENCES patients(id), doctor TEXT NOT NULL DEFAULT '', date TEXT NOT NULL DEFAULT (date('now')), notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','dispensed','cancelled')), sale_id INTEGER REFERENCES sales(id), mime TEXT NOT NULL DEFAULT '', attachment BLOB, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS offers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('percent','fixed')), value REAL NOT NULL CHECK(value >= 0), min_total REAL NOT NULL DEFAULT 0 CHECK(min_total >= 0), starts TEXT NOT NULL, ends TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), CHECK(ends >= starts), CHECK(kind <> 'percent' OR value <= 100));
CREATE TABLE IF NOT EXISTS transfers (id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES batches(id), from_location INTEGER NOT NULL REFERENCES locations(id), to_location INTEGER NOT NULL REFERENCES locations(id), quantity INTEGER NOT NULL CHECK(quantity > 0), note TEXT NOT NULL DEFAULT '', date TEXT NOT NULL DEFAULT (datetime('now')), user_id INTEGER REFERENCES users(id), CHECK(from_location <> to_location));
CREATE TABLE IF NOT EXISTS adjustments (id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES batches(id), quantity INTEGER NOT NULL CHECK(quantity <> 0), reason TEXT NOT NULL, date TEXT NOT NULL DEFAULT (datetime('now')), user_id INTEGER REFERENCES users(id));
CREATE TABLE IF NOT EXISTS stock_counts (id INTEGER PRIMARY KEY, location_id INTEGER NOT NULL REFERENCES locations(id), date TEXT NOT NULL DEFAULT (datetime('now')), status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','completed')), note TEXT NOT NULL DEFAULT '', user_id INTEGER REFERENCES users(id));
CREATE TABLE IF NOT EXISTS stock_count_items (id INTEGER PRIMARY KEY, count_id INTEGER NOT NULL REFERENCES stock_counts(id), batch_id INTEGER NOT NULL REFERENCES batches(id), expected INTEGER NOT NULL, counted INTEGER CHECK(counted >= 0), UNIQUE(count_id,batch_id));
CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), username TEXT NOT NULL, action TEXT NOT NULL, entity TEXT NOT NULL DEFAULT '', entity_id TEXT NOT NULL DEFAULT '', details TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_batches_medicine ON batches(medicine_id);
CREATE INDEX IF NOT EXISTS idx_movements_batch ON stock_movements(batch_id);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_journals_date ON journals(date);
CREATE INDEX IF NOT EXISTS idx_journal_lines_journal ON journal_lines(journal_id);
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_logs(created_at);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT,'Audit records are immutable'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT,'Audit records are immutable'); END;
INSERT OR IGNORE INTO locations(id,name,description) VALUES(1,'Main pharmacy','Default stock location');
INSERT OR IGNORE INTO accounts(id,code,name,type,system) VALUES
(1,'1000','Cash','asset',1),(2,'1010','Bank','asset',1),(3,'1100','Customer receivables','asset',1),
(4,'1200','Inventory','asset',1),(5,'1300','Staff advances','asset',1),(6,'2000','Supplier payables','liability',1),
(7,'2100','Tax payable','liability',1),(8,'3000','Opening equity','equity',1),(9,'4000','Medicine sales','income',1),
(10,'4100','Sales returns','income',1),(11,'4200','Sales discounts','income',1),(12,'5000','Cost of goods sold','expense',1),
(13,'6000','Operating expenses','expense',1),(14,'6100','Salaries','expense',1),(15,'6200','Stock write-offs','expense',1),(16,'4300','Other income','income',1);
INSERT OR IGNORE INTO settings(key,value) VALUES ('pharmacy_name','Pharmacy Management'),('currency','AFN'),('language','en'),('theme','light'),('tax_percent','0'),('address',''),('phone',''),('low_stock_days','90'),('receipt_footer','Thank you. Get well soon.'),('schema_version','1');
