# Pharmacy Management — delivery

## Windows downloads

Verified release: **v1.0.0-build.55**

- Setup installer in the project folder: `src/pages/Pharmacy-Setup.exe`
- Release page: https://github.com/husoftdeveloper-del/Pharmacy_management-/releases/tag/v1.0.0-build.55
- Setup installer: https://github.com/husoftdeveloper-del/Pharmacy_management-/releases/download/v1.0.0-build.55/Pharmacy-1.0.0-x64.exe
- Portable EXE: https://github.com/husoftdeveloper-del/Pharmacy_management-/releases/download/v1.0.0-build.55/Pharmacy-1.0.0-Portable.exe

These are Windows x64, unsigned builds. Verify the download source and checksums. The installer creates Desktop and Start Menu shortcuts. Application data is stored outside the installation directory.

### GitHub release asset SHA-256

```text
717afe384a7c0a2d6babc2cfe61cbad75da36a2b65200978f93b16dd227bc12d  Pharmacy-1.0.0-x64.exe
59797183b556ba314d61dab6c951104de40b75bf77e60902916fd8708a8055f6  Pharmacy-1.0.0-Portable.exe
```

`src/pages/Pharmacy-Setup.exe` is the same Setup installer and has the same SHA-256 as `Pharmacy-1.0.0-x64.exe`.

Check in PowerShell:

```powershell
Get-FileHash .\src\pages\Pharmacy-Setup.exe -Algorithm SHA256
```

## Source

Complete source is on branch `arena/17a27247-pharmacy-management`. Application source commit: `e3d2b17`. The branch also contains the refreshed installer commit `8f95b5f`.

```powershell
git clone --branch arena/17a27247-pharmacy-management https://github.com/husoftdeveloper-del/Pharmacy_management-.git Pharmacy_management-
cd .\Pharmacy_management-
npm ci
npm start
```

See `README.md` for architecture, all modules, security boundaries, operating instructions, build commands and known limitations.

## Sales history and Returns (separate modules since build 27)

The **Sales & returns** module now has two tabs:

- **Sales history** (`sales`) — its own sidebar entry: invoices with customer, total, paid, date, status and the amount already returned per invoice, plus View / Return / PDF per row and a footer total.
- **Returns** (`returns`) — a separate sidebar entry under Overview with two buttons: **Sales return** and **Purchase return**. Each list shows the date, original invoice, the customer or supplier, returned quantity, negative amount, refund method and reason, with View (opens the original invoice) and Return (starts another return for that document) per row, a footer total and the same date filter. Purchase returns are served by a `purchasereturns` history on the existing `purchases` permission.

Returns are still created from the sales history (Return) or from an invoice's detail dialog. The `returns` module is a real permission: it is granted to administrator, pharmacist, cashier and accountant by default and can be toggled per user on the Users page. Returns are still created from a sale row (**Return**) or from an invoice's detail dialog. The returns list is served by a permission-checked `salereturns` history on the existing `sales` permission, and is covered by database tests and the Windows Electron smoke test.

## Sidebar order in build 29 (extended in build 30)

The **Overview** group is now `Dashboard · Point of sale · Sales history · Returns · Customers · Customer payments · Cash register`, so customers sit directly below the returns module and their payments directly below them. Customers was removed from the Management group (it still uses the `customers` permission and its page is unchanged). The sidebar order is asserted by the Windows Electron smoke test.

## Customer payments page (build 30)

The new **Customer payments** module (`customerpayments`, sidebar right below Customers) lists money received from customers: date, customer, amount, method, reference, how much was allocated to open invoices and who recorded it. The footer totals the received amount and the allocated amount for the selected date range.

**Record payment** opens the same validated form as the Finance page (customer, amount, cash/bank account, reference) and refreshes the customer list first, so a customer added on another page can be paid immediately. Payments are stored in the existing `payments` table and allocated to the oldest open invoices by the main process; the server requires the `customers` permission for customer payments, so pharmacists, cashiers and accountants can use the page without gaining finance access.

## Customer payments layout (build 31)

The page now opens with four totals — **Total Credit Sales, Total Paid, Total Returned, Total Owed** (owed in red) — then two views:

- **Balances** — one row per active customer with name/phone, credit sales, paid, returned, balance and last payment, plus a customer search box and an **Only with dues** toggle. When nothing is owed it shows “No customer balances — Balances will appear once you record credit sales.”
- **History** — every recorded payment with amount, method, reference, allocated amount and the user who recorded it, filtered by the same search box.

All figures come from the new permission-checked `customerAccounts` IPC call (aggregates over `sales`, `sale_returns` and `payments`, with each balance computed from the customer ledger), so the totals always match the Finance report. **Record Payment** keeps the validated cash/bank form and refreshes the customer list first.

## Customers page layout (build 32)

The Customers page now has **Total Customers** and **Outstanding Credit** cards, a full-width search box (name, phone or email) and one table: **Name, Phone, Email, Credit Balance, Status, Actions** with Edit and Payment per row. An empty pharmacy shows “No customers yet. Add one to keep track of buyers.”

- **Email** is a real customer field: added to the record form, validated by the server and stored in a new `customers.email` column. Existing databases are migrated automatically on start (`PRAGMA table_info` + `ALTER TABLE … ADD COLUMN`), so no data is lost.
- Balances come from a new permission-checked `customerBook` call that returns every customer (active and inactive) with the ledger balance (opening balance + unpaid invoices − returns − payments) plus the totals used by the cards.

## Receipt tab matches the design pixel-for-pixel (build 55)

Build 54 rebuilt the tab; build 55 closes the remaining visual gaps against the approved screenshot:

- **Amounts carry no currency prefix.** Item totals, subtotal, discount and TOTAL print as plain numbers (`6.00`, `12.00`, `18.00`, `- 1.00`, `17.00`) in both the live preview and the printed PDF, exactly as drawn. `TOTAL` is capitalised.
- **Paper and panel.** The live preview sits on a pale panel with a white receipt sheet inside it, hairline border and a soft shadow; the sheet keeps the dashed rules of the Classic template.
- **Tab strip.** Pale track, white active pill with a hairline border and a 1 px shadow — the design's active state rather than an inverted one.
- **Card copy.** The Live Preview card drops its icon, the page hint now reads “Manage your profile, pharmacy details, users and preferences.”, and the role line reads `Role: Admin`.

Everything from build 54 stays: three templates, paper size, copies, the editable footer and the cashier name on the receipt.

## Receipt tab rebuilt (build 54)

**Settings → Receipt** now works like a small receipt designer, and the printed PDF follows the same design:

```
Receipt Template   Classic · Compact · Boxed      (picked card: teal border + tick)
Receipt Layout     Paper Size 80mm / 58mm / A4 · Copies to Print 1-5 · Receipt footer
Live Preview       the actual layout, item lines, totals and footer
```

- **Classic** keeps dashed dividers and one line per item (the default). **Compact** drops the dividers and tightens rows so more items fit. **Boxed** frames the header, meta, items and totals for a formal invoice look.
- **Paper Size** is a real print setting: 58mm and 80mm receipts use narrow pages with zero margins, A4 uses a normal page. **Copies to Print** repeats the receipt, one per page, up to five.
- **Live Preview** is rebuilt from the same preferences the printer reads, so what you see is what comes out. Every change saves immediately.
- The **receipt footer** stays editable on the same tab and appears in the preview.
- Printed receipts now show the **cashier** name from the sale alongside invoice number and date; medicine names are XML-escaped.
- `database/pdf.js` exports `receiptHTML()` so the template logic is unit-tested without Electron.

### Password rule is now 6 characters

At the request of the user, the minimum password length dropped from 10 to **6** characters (maximum stays 128) in `changePassword`, `saveUser`, the three language hints and the database tests. The Change Password card explains it: “Use a strong password of at least 6 characters.”

### Settings look

The tab strip, cards, inputs and buttons were tightened to match the approved screenshot: slim white strip with small tab icons, 38px inputs with a teal focus ring, teal action buttons and 12px cards.

## Settings page rebuilt (build 53)

**Settings** now opens on a page shaped like the approved design: a **Settings** heading with one line of explanation under a rule, then a horizontal strip of eight pill tabs, each with an icon:

```
Profile · Pharmacy · Receipt · Notifications · Appearance · Users · Data · License
```

The active pill is a white card on the light grey track (it inverts in the dark theme), and the page keeps the chosen tab in the URL state, so `settings` always reopens where you were.

**Profile** is two cards side by side:

- **Your Profile** — Full Name, Username and a `Role: Administrator` line, with **Save**. Saving goes through a new permission-free `profile` IPC call: it only ever edits the signed-in account, rejects names that are too short and usernames that already exist, writes an audit row and refreshes the name in the top bar.
- **Change Password** — Current, New and Confirm Password with **Update Password**. The new `changePassword` call proves the current password, enforces 10–128 characters, refuses to reuse the same password, re-hashes with the existing scrypt helper and records `change_password` in the audit log. Mismatched confirmation is caught before anything is sent.

The other tabs keep real data:

| Tab | What it saves |
| --- | --- |
| Pharmacy | Name, phone, currency, tax percent and address — printed on receipts and reports. |
| Receipt | Receipt footer text, beside a live receipt preview. |
| Notifications | Expiry warning days plus three workplace switches (low stock, expiry, register), stored as `'1'`/`'0'`. |
| Appearance | Light/dark theme cards and the language picker; the whole shell re-translates immediately. |
| Users | The same team-account table as the Users page (add/edit, role defaults, administrator boxes locked) — shared from `src/components/user-admin.js`. |
| Data | Back up the database and restore it, with the existing confirmation. |
| License | Application, version, build, registered pharmacy, license status and the signed-in account. |

Preference rows are now written with `INSERT … ON CONFLICT DO UPDATE`, so notification keys added by this build appear in databases created by earlier builds without losing any stored setting.

## Administration trimmed (build 52)

**Categories**, **Patients**, **Manufacturers** and **Users & permissions** no longer appear in the sidebar, so **ADMINISTRATION** now holds only **Audit**, **Settings** and **Backup**:

```
MANAGEMENT      Medicines · Inventory · Price list · Print Labels
PURCHASING      Purchases · Suppliers · Supplier Payments
FINANCE         Expenses · Ledger & P&L · Reports
STAFF           Employees · Monthly Salaries · Salary Advances
ADMINISTRATION  Audit · Settings · Backup
```

The categories, patients, manufacturers and users modules, their permissions, pages and every record stay in place, because other screens read them:

- **Categories** and **Manufacturers** are the pickers on the New Medicine form, and categories drive the medicine filter.
- **Patients** is used by the point of sale and by prescriptions.
- **Users** still holds every account, role and permission — an administrator keeps all modules (build 50) and can still reach the page through the router, for example `window.dispatchEvent(new CustomEvent('navigate',{detail:'users'}))`.

Restoring any of them is one line in `src/scripts/navigation.js`.

## OPERATIONS group removed (build 51)

The **OPERATIONS** group is gone too: **Finance** (payments and journals) and **Banking** no longer appear in the sidebar. The sidebar is now five groups:

```
MANAGEMENT      Medicines · Inventory · Price list · Print Labels
PURCHASING      Purchases · Suppliers · Supplier Payments
FINANCE         Expenses · Ledger & P&L · Reports
STAFF           Employees · Monthly Salaries · Salary Advances
ADMINISTRATION  Audit · Settings · Backup
```

As with the stock pages, nothing was deleted:

- The `finance` and `banking` modules, their permissions, pages and every journal/account record stay, because the rest of the app depends on the double-entry ledger — sales, purchases, expenses, salaries and advances all post to it, and **Ledger & P&L** and **Reports** read the same accounts.
- Bank and cash accounts are still chosen on every payment form (customer payments, supplier payments, expenses, salaries, advances).
- The pages remain reachable through the router (`window.dispatchEvent(new CustomEvent('navigate',{detail:'banking'}))`), so a custom role that still has the permission is not blocked, only the sidebar entry is hidden.

## Login no longer blocked by a saved permission set (build 50)

Signing in could fail with **“You do not have permission for this action.”** and never open the app. The login screen itself was fine — the shell then asked for preferences and reference data, and that call required the `dashboard` module. An account whose saved permission set had Dashboard switched off (for example a set stored by an older build, or a user edited on the Users page) could therefore never get past the login screen, with no way back in.

Three changes fix that:

1. **Preferences and reference data are shell-level.** `preferences` and `options` now only require a signed-in, active account, so the window always opens. Each list inside `options` is still filtered by permission.
2. **An administrator always keeps every module.** A stored permission set can no longer strip modules from an administrator — the account that can repair permissions can never lock itself out. The Users page shows the administrator's boxes ticked and disabled, and `saveUser` stores all modules for that role.
3. **The shell picks a landing page.** After sign-in the app opens the Dashboard if it is allowed, otherwise the first permitted module, and only shows a “no access” toast when the account genuinely has no module at all.

Also hardened while there: a corrupt `permissions` JSON payload now falls back to the role defaults instead of throwing during sign-in.

## STOCK group removed (build 49)

The **STOCK** sidebar group is gone. Prescriptions, Stock count, Locations, Transfers, Adjustments, Barcodes and Offers no longer appear in the sidebar, so the app reads:

```
MANAGEMENT      Medicines · Inventory · Price list · Print Labels
PURCHASING      Purchases · Suppliers · Supplier Payments
FINANCE         Expenses · Ledger & P&L · Reports
STAFF           Employees · Monthly Salaries · Salary Advances
ADMINISTRATION  Audit · Settings · Backup
```

Nothing was deleted from the database or from the business logic:

- The tables (`prescriptions`, `stock_counts`, `transfers`, `adjustments`, `locations`, `offers`) and every stored record are untouched, so no history is lost.
- The modules, permissions and page files still exist because other screens depend on them: the point of sale lists prescriptions and active offers, and receiving a purchase picks a stock location. Removing their permissions would have broken those flows, so they stay available to existing roles.
- Barcode generation is still one click from the **New Medicine** form, and **Print Labels** still prints barcode labels.

Restoring the section later is a one-line change in `src/scripts/navigation.js` — the page files and permissions were kept for exactly that reason. The Windows smoke test now asserts that no stock page keeps a sidebar item and that the barcode page still renders when reached through the router.

## Staff group moved under Finance (build 48)

The **STAFF** group (Employees · Monthly Salaries · Salary Advances) now sits directly below **FINANCE**, so the money sections read top to bottom: Purchases → Finance → Staff. The stock pages (Prescriptions, Stock count, Locations, Transfers, Adjustments, Barcodes, Offers) moved down one step into their own **STOCK** group above **OPERATIONS**; builds 49 and 51 removed those groups again.

```
MANAGEMENT   Medicines · Inventory · Price list · Print Labels
PURCHASING   Purchases · Suppliers · Supplier Payments
FINANCE      Expenses · Ledger & P&L · Reports
STAFF        Employees · Monthly Salaries · Salary Advances
ADMINISTRATION  Audit · Settings · Backup
```

Only the sidebar order changed — no page, permission or database change. The Windows Electron smoke test asserts the heading order (`MANAGEMENT|PURCHASING|FINANCE|STAFF`) and that Employees, Monthly Salaries and Salary Advances are the three pages directly after the finance pages.

## Staff section (build 47)

A new **STAFF** group sits directly below **FINANCE** with three pages:

1. **Employees** (`employees`) — the Employees title with **New Employee**, two totals (**Active Employees**, **Monthly Payroll**), a search box with an **Active only / All employees** picker, and the table **Name · Position · Phone · Monthly Salary · Join Date · Status · Actions** (Advance, Edit). Empty state: “No employees yet” / “Add your team members to track salaries and advances.”
2. **Monthly Salaries** (`salaries`) — the Monthly Salaries title with **Export PDF** and **Issue Salary**, two totals (**Monthly Payroll**, **Pending Salaries**), a filter row (**All Years**, month, All / Paid / Pending) and the payroll table **Month · Employee · Base · Additions · Deductions · Advance Deduction · Net Pay · Status · Paid Date · Actions**. Staff without a salary record for the selected month are listed as **Pending** with a **Pay** action, so the pending card and the list always agree. Empty state: “No salary records for this filter” / “Use “Issue Salary” to create a payroll entry.”
3. **Salary Advances** (`advances`) — the Salary Advances title with **New Advance**, two totals (**Outstanding Advances**, **Active Employees**), an **Active / Settled / All** filter and the table **Date · Employee · Amount · Remaining · Reason · Status · Actions**. Empty state: “No advances yet” / “Advances are deducted from the next monthly salary.”

Supporting changes:

- New permission-checked calls `employeeBook`, `salaryBook` and `advanceBook`; the new `employees`, `salaries` and `advances` permissions are granted to administrators, pharmacists and accountants by default and can be toggled per user. Writes (`save` staff, `salary`, `advance`) still use the `staff` permission.
- `salaries` gained **additions** and **deductions** columns (existing databases get them through the automatic migration). Net pay is now `base + additions − deductions − advance recovery`, and the monthly journal stays balanced. Issuing a salary still recovers every outstanding advance first and refuses to pay the same person twice in one month.
- The first save on a new employee is reachable from the three new pages; the old tabbed Staff page is no longer in the sidebar.

## Report tabs (build 46)

Every Reports tab now behaves like its own page: the tab owns its filter row, its KPI boxes and its table, all served by one permission-checked `reportBook` call, and a tab with no matching rows says **“No data for the selected filters.”**

| Tab | Filter row | KPI boxes | Table |
| --- | --- | --- | --- |
| **Sales** | Search invoice #, All cashiers, All customers, All statuses | Revenue, Discount, Sale Returns, Orders | Invoice #, Date, Customer, Cashier, Total, Discount, Returned, Status |
| **Profit** | Search medicine | Revenue, Cost of Goods, Gross Profit, Margin, Returned (Value) | Medicine, Quantity, Revenue, Cost of Goods, Profit, Margin, Returned (Value) |
| **Inventory** | Search medicine or batch | Batches, Units, Stock Value, Low Stock | Medicine, Batch, Expiry, Location, Quantity, Cost, Value |
| **Expiry** | Search medicine or batch, Any expiry (expired / ≤ 30 / ≤ 90) | Expired, Expiring ≤ 30 days, Expiring ≤ 90 days, Value at Risk | Medicine, Batch, Expiry, Days Left, Quantity, Value |
| **Purchases** | Search invoice #, All suppliers, All statuses | Invoices, Total Purchases, Paid, Balance Due | Invoice #, Date, Supplier, Recorded by, Total, Paid, Balance Due, Status |
| **Expenses** | Search expense, All categories | Total, Entries, Largest Expense, Categories | Date, Category, Description, Amount, Account, Recorded by |
| **Customers** | Search customer | Customers, Credit Sales, Paid, Outstanding | Customer, Phone, Orders, Credit, Paid, Returned, Balance |
| **Suppliers** | Search supplier | Suppliers, Total Purchases, Paid, Balance Due | Supplier, Phone, Orders, Purchased, Paid, Returned, Balance |

Filtering happens in the main process, so the KPI boxes, the table and the CSV always describe the same rows. The **Export** button on the period card writes the current tab as CSV (translated column titles) or PDF. Profit figures come from the same `profitFigures` helper the Ledger page uses, so the Profit tab and the P&L statement can never disagree.

## Finance section (build 45)

A new **FINANCE** group sits directly after **PURCHASING**, with three pages:

1. **Expenses** (`expenses`) — the Expenses title with **New Expense**, three totals (**This Month**, **Total**, **Entries**), one filter card (search, **All categories**, From, To) and the table **Date · Category · Description · Amount · Recorded by · Actions** with a view dialog per row. Empty state: “No expenses recorded yet.” / “Log rent, salaries, and other costs to track profit.”; a search with no hits says “No expenses match these filters.”
2. **Ledger & P&L** (`ledger`) — the Ledger & P&L title with its subtitle and an **Export** menu (CSV, PDF), a From/To card, **P&L Statement / Transactions** tabs, the statement panel (Sales revenue, Less: Sale returns, Net Revenue, Cost of goods sold, Add: COGS returned, Net COGS, Operating expenses, Net Profit) beside four cards (**Cash In**, **Cash Out**, **Net Cash Flow**, **Total Purchases**).
3. **Reports** (`reports`) — nine tabs (Overview, Sales, Profit, Inventory, Expiry, Purchases, Expenses, Customers, Suppliers), a period picker (Last 7 / 30 / 90 days, This month) with From/To dates, eight KPI cards (Revenue, Gross Profit, Expenses, Net Profit, Orders, Items Sold, Cost of Goods, Avg Order Value) and the **Revenue & Profit Trend** chart. Every tab exports CSV or PDF.

Both new pages are permission-checked in the main process (`expenseBook`, `ledgerBook`, `reportOverview`) and the new `expenses` / `ledger` permissions can be toggled per user; administrators, pharmacists and accountants get them by default. Creating an expense now needs the `expenses` permission instead of `finance`. The Reports page still reads the existing `report` call for its detail tabs, so no report data was duplicated.

## Sidebar groups (builds 43–45)

Purchases, Suppliers and Supplier Payments no longer sit inside **MANAGEMENT**. They are grouped under a new uppercase heading, **PURCHASING**, placed directly after Management in the sidebar, so the three pages read as one section:

```
MANAGEMENT   Medicines · Inventory · Price list · Print Labels
PURCHASING   Purchases · Suppliers · Supplier Payments
FINANCE      Expenses · Ledger & P&L · Reports
STAFF        Employees · Monthly Salaries · Salary Advances
ADMINISTRATION  Audit · Settings · Backup
```

Build 44 trimmed the medicines group so **PURCHASING starts straight after Print Labels**, and moved the remaining stock pages (Prescriptions, Stock count, Locations, Transfers, Adjustments, Barcodes, Offers) into their own **STOCK** group below it. It also fixed two sidebar items that were printing their raw keys — `printlabels` → **Print Labels** and `supplierpayments` → **Supplier Payments** — in English, Pashto and Dari.

The heading is translated (English *PURCHASING*, Pashto *اخیستنې*, Dari *خریدها*) and follows the same permission rules as the pages it holds — a user without those permissions simply never sees the group.

Build 45 added the **FINANCE** group with Expenses, Ledger & P&L and Reports, and build 48 placed the **STAFF** group directly underneath it (see the build 48 note above). Reports moved out of OPERATIONS, and build 51 removed that group as well. Every heading is translated and only rendered when the signed-in user has at least one page in that group.

## Purchasing section rebuilt (build 42)

Three pages now follow one another in the Management group, each rebuilt to the agreed reference:

1. **Purchases** — title with **New Purchase**, a full-width search card, and a table of **Invoice #** (with its status badge), **Supplier**, **Date**, **Total**, **Balance Due**, **Recorded by** and **Actions** (view / return). The empty state reads “No purchases recorded yet.” / “Record your first purchase to add stock.” The receiving form is unchanged: supplier, invoice number, batch lines and cash / bank / credit.
2. **Suppliers** — title with **New Supplier**, a search card, and a table of **Supplier Name**, **Contact Person**, **Phone**, **Purchases**, **Total Spent**, **Last Purchase**, **Status** and **Actions** (Payment / Edit). Empty state: “No suppliers yet. Add one to start recording purchases.”
3. **Supplier Payments** — the title with its subtitle and **Record Payment**, four totals (**Total Purchased**, **Total Paid**, **Total Credited (returns)**, **Total Owed**), **Balances / History** tabs, a supplier search with an **Only with dues** switch, and a table of **Supplier Name**, **Purchased**, **Paid**, **Credited**, **Balance** (red pill when owed), **Last Payment** and a **Pay** button.

Supporting changes:

- New `purchaseBook`, `supplierBook` and `supplierAccounts` calls; balance due subtracts returns **and** payment allocations, so a purchase settled later shows the real amount left.
- A supplier payment now needs the `suppliers` permission for writes (previously `finance`), matching customer payments; the new `supplierpayments` permission covers the payments page and is granted to administrators, pharmacists and accountants.
- `suppliers.contact_person` is a new column, added to existing databases by the automatic migration.
- `documents('supplierpayments')` lists supplier payments with supplier, method, allocation and the user who recorded them.

## Print Labels page (build 41)

A **Print Labels** page sits directly after **Price list** in the Management group:

1. The **Print Labels** title with the subtitle “Filter your medicines and quickly print barcode labels in bulk.”
2. A filter card: search by name, barcode, generic or brand, plus **All categories**, **Any expiry** (any / expiring soon / expired / no expiry) and **Any stock** (any / in stock / low stock / out of stock), then **Select all visible**, **Copies = current stock** and an “N of M” counter.
3. A table with a tick box per row, **Medicine** (name with generic name under it and a pill icon), **Barcode**, **Stock** (badge with the unit), **Selling Price**, **Expiry** and a **Copies** box, plus the centred *Showing all N* footer.
4. A pinned bar at the bottom with the label count and the **Print** button, disabled until at least one label is chosen.

Printing goes through a new `printLabels` channel: it validates every medicine and copy count (1–200 copies each, 500 labels per run), builds CODE128 barcodes locally, and lays them out on an A4 sheet (three 60 × 32 mm labels per row, dashed cut guides). Medicines without a barcode print their SKU instead. Like the other exports, the PDF is written wherever you choose in the save dialog and an `export_pdf` audit entry is recorded.

The page has its own **printlabels** permission, granted to administrators and pharmacists by default and available as a checkbox on the Users page.

## Editing prices from the price list (build 40)

The **Selling Price** column of the price list now has a pencil button that stays invisible until you point at that price — hover (or focus it with the keyboard) and it fades in; move away and it fades out. On touch screens, where there is no hover, the pencil is always visible.

Clicking it turns the price into a small editor in place: type the new amount and press **Enter** or the tick to save, or **Esc** / the cross to leave it unchanged. A value of zero or an empty box is refused with “Enter a price greater than zero.” After saving, the row, the profit and the *Showing all* footer refresh immediately.

Behind it sits a new `updatePrice` channel that requires the **pricelist** permission with write access, changes only `medicines.price`, refuses prices below 0.01, and writes a `price_change` audit entry with the old and new amount. The point of sale, the medicines table and the price list all read that same column, so the next sale uses the new price.

## Inventory page rebuilt (build 39)

The Inventory page now follows the agreed reference:

- The **Inventory** title with a **Scan or search barcode…** box on the right (barcode icon). Typing filters by name, barcode, SKU or generic name; scanning a barcode and pressing Enter jumps straight to that medicine.
- Four filter chips in one rounded strip — **All stock**, **Low Stock**, **Out of Stock**, **Expiring Soon** — each showing its count, with the selected chip highlighted. Low stock means more than zero but at or below the reorder level; out of stock means zero on the shelf; expiring soon uses the pharmacy's expiry-warning setting (90 days by default).
- One table — **Name** (generic name underneath), **Barcode**, **Stock** (badge with the unit, e.g. `20 Tablet`; amber when low, grey when empty) and **Expiry** (nearest in-stock batch) — with a centred *Showing all N* footer.

The data comes from one permission-checked call (`inventoryBook`), which now returns medicine-level rows with the summed quantity, nearest expiry and low/out/expiring flags instead of raw batches. Batch-level detail (batch numbers, locations, stock value) is still available in Reports → Inventory value and on the Stock adjustments, Transfers and Physical stock count pages.

## Medicine Price List page (build 38)

A new **Price list** page sits directly after **Inventory** in the Management group, laid out like the agreed reference:

1. The **Medicine Price List** title, with an **Export PDF** button on the right.
2. A card holding one wide **Search medicine…** box.
3. A card holding the table — **Name** (generic name underneath), **Stock** (amber badge such as `20 Tablet`), **Purchase Price**, **Selling Price** and **Profit** in green — and a centred *Showing all N* footer.

Details:

- Only active medicines are listed, one row each, with the quantity summed from every batch.
- Profit is the selling price minus the purchase price for one unit; prices show with the currency code in front (`AFN 15`).
- **Export PDF** builds a local A4 PDF through the existing main-process print pipeline (`pdf` channel with `kind: 'pricelist'`), which now accepts the `pricelist` permission instead of `reports`. Nothing leaves the computer; the file is written wherever you choose in the save dialog.
- The page has its own permission, `pricelist`, granted to administrators, pharmacists and accountants by default and available as a separate checkbox on the Users page.

## New Medicine form rebuilt (build 35–36)

The **New Medicine** dialog now follows the reference layout:

| Row | Fields |
| --- | --- |
| 1 | **Name** (full width) |
| 2 | **Barcode** with the side-icon generator · **Barcode Type** (Internal / Manufacturer) |
| 3 | **Generic Name** · **Brand** |
| 4 | **Company** (manufacturer) · **Category** |
| 5 | **Dosage Form** (tablet, capsule, syrup, suspension, injection, cream, ointment, drops, inhaler, sachet, powder, spray, other) · **Unit** (piece, tablet, capsule, bottle, box, strip, sachet, ml, g, tube, vial, ampoule) |
| 6 | **Reorder Level** (with the hint “Alert when total stock falls to or below this quantity.”) · **Reorder Qty** |
| 7 | **Storage instructions** |
| 8 | **Opening Stock** collapsible: **Quantity**, **Expiry**, **Purchase Price**, **Selling Price** |

Footer: **Cancel · Save & New · Save**. *Save & New* stores the medicine, refreshes the table and clears the form for the next entry.

Build 37 trimmed the Opening Stock block to the four fields asked for — Quantity, Expiry, Purchase Price and Selling Price — and moved both prices there for a new medicine. Opening stock no longer asks for a batch number (it is stored as `OPEN-1`) or a location (it goes to the default Main pharmacy). The purchase price becomes the batch cost and the medicine's cost; the selling price becomes the medicine's price, so the catalogue and the point of sale show the same numbers. When editing an existing medicine both prices stay editable in the main grid, because there is no opening stock at that point.

Supporting changes:

- New medicine columns `brand`, `dosage_form`, `barcode_type` and `reorder_qty`, added to existing databases by the automatic migration.
- The SKU is generated automatically (`MED-00001`, `MED-00002`, …) because the reference form does not ask for one; the number stays unique.
- A new `saveMedicine` channel writes the catalogue entry **and** its opening batch in one transaction: `batches` row, an `opening` stock movement and a balanced journal entry (Inventory debit / Opening balance equity credit). Opening stock is only offered for a new medicine — later stock comes from purchases, adjustments or transfers.
- Editing an existing medicine reuses the same dialog, prefilled, without the Opening Stock section.
- The sidebar entry for Customer payments had no translation key and printed `customerpayments`; it is now labelled in English, Pashto and Dari.

## Medicines page rebuilt (build 34)

The Medicines page now follows the agreed reference layout:

- A plain **Medicines** title with a rule underneath and a **New Medicine** button on the right.
- One card holding the search box (“Search by name, barcode, generic, or brand…”) and an **All categories** picker.
- One card holding the table: **Name** (with generic name below), **Barcode**, **Category**, **Stock**, **Purchase Price**, **Selling Price**, **Expiry**, **Recorded by** and **Actions**, with the pill empty state (“No medicines match your search.”).

Two supporting changes made the reference possible:

1. `medicines.created_by` records who entered each medicine (existing databases get the column through the automatic migration), and the page reads it as *Recorded by*; the nearest in-stock batch expiry is shown as *Expiry* (amber when it is inside the expiry-warning window).
2. Every page stylesheet in `src/styles` is now actually loaded when its page opens (`loadPageStyles` in `app.js`). Until this build only `base.css` was linked, so page-specific rules in `customers.css`, `customerpayments.css`, `barcodes.css`, `returns.css` and the new `medicines.css` / `inventory.css` were never applied. The shared only-with-dues / only-expiring switch moved into `base.css` so both pages can use it.

The medicine form also has the barcode side-icon: one click creates a unique code and fills the field.

## Medicines and Inventory split (build 33)

The former “Medicines & inventory” module is now two pages at the top of the **Management** group, in this order:

| Page | Permission | Shows |
| --- | --- | --- |
| **Medicines** | `medicines` | Catalogue only: Total medicines, Low stock and Stock value cards, search, and a table of name/generic name, SKU, category, price and unit, stock, reorder level and status with Edit |
| **Inventory** | `inventory` | The stock itself: Batches, Stock value, Low stock and Expiring cards, search plus an “expiring” toggle, and a batch table of medicine, batch, expiry, location, quantity, cost and value, with a shortcut to Stock adjustments |

Both read the same SQLite data through two permission-checked calls (`medicineBook`, `inventoryBook`), so editing a medicine on one page is visible on the other. The medicine entity accepts **either** permission (`['medicines','inventory']`), so existing custom roles keep working; administrators and pharmacists get both by default, and both are separate checkboxes on the Users page. Stock adjustments, transfers, physical counts and barcodes are unchanged.

## Renderer caching fixed in build 24

The app loads its screens through a custom `pharmacy://` protocol. Chromium was allowed to cache those responses, so after an update the window could keep rendering the previous build (for example the old dashboard with record lists inside the boxes).

From build 24 every renderer file is read from disk on each request, sent with an explicit content type and `cache-control: no-store`, and the session cache is cleared before the window loads. An update therefore always shows the new screens. The build label in the sidebar footer and on the login screen tells you which version is really running.

## Dashboard boxes (single row since build 19, deep links since build 20)

The dashboard now shows four equal data-driven boxes in one responsive grid, each clickable to its full page:

| Box | Main figure | Details |
| --- | --- | --- |
| Expenses | This month's total | Today's spend, latest three expenses, expense count |
| Low stock | Number of medicines at or below the reorder level | Latest three medicines with their stock and reorder level |
| Expiring soon | Number of batches inside the expiry-warning window | Batch number, remaining quantity and days left (or Expired) |
| Recent sales | Today's sales total (or the number of recent invoices for roles without finance access) | Latest three invoices with customer and total |

Build 19 places the four boxes side by side in one row of four equal columns (two columns below 1180 px, one below 650 px). Each box is one large click target: the card shows a pointer cursor, lifts on hover, moves its arrow, is focusable with Tab and opens with Enter or Space. Each detail line inside a box is its own button, so a click opens that exact record instead of just the module:

| Clicked row | Where it goes | What you see |
| --- | --- | --- |
| An invoice in Recent sales | Sales & returns | The invoice detail dialog opens immediately and the row is highlighted |
| An expense in Expenses | Finance & expenses | Expenses tab with that expense highlighted and scrolled into view |
| A medicine in Low stock | Medicines & inventory | The inventory table opens filtered to that medicine |
| A batch in Expiring soon | Reports | The near-expiry report opens with the batch row highlighted |

The footer of each box still opens the module itself. Release tags now follow the in-app build label (`v1.0.0-build.55` = `build.53` shown in the app).

The four boxes follow the same card, spacing, hover and focus styling, work in light/dark themes and in LTR/RTL, and degrade gracefully by role: pharmacists see three boxes (no finance), cashiers see the recent-sales box only. The sales-trend chart remains below the boxes.

## Purchase form fix

Build 14 fixed the purchase form so receiving a purchase no longer fails with `Invalid record ID`; build 15 added the visible build label and field-specific ID errors. The purchase form explicitly maps supplier, medicine, location, invoice, payment method and account fields to the secure IPC contract. The same naming mismatch was corrected in related payment, expense, staff, transfer, stock-count and prescription forms. Cash/bank account choices now follow the selected payment method, and credit purchases hide the irrelevant account field.

## Live-reload development mode

Run `npm run dev` (or double-click `dev.bat` on Windows) after one `npm ci`. Saving `src/` files refreshes the open window; saving `main.js`, `preload.js`, `package.json` or `database/` restarts Electron. Build 17 ignores read-only Windows file-watch events and resumes the dev session after a renderer refresh, so navigating between pages no longer forces logout. Dev mode uses a separate `Pharmacy Management Dev` data folder and is disabled in packaged EXEs.

## Barcode update

Barcode Management now has an icon button inside the barcode input. Clicking it generates a unique `MED-…` barcode through the secure main process, fills the input, and shows the CODE128-B preview immediately. Choose a medicine and press Save to assign it; Print remains available after preview. The action is permission-checked in the main process and covered by database and Electron smoke tests.

## Verification completed

- 28 database/business-rule and form-payload tests passed, including the purchase-form regression, barcode uniqueness, permission checks, the finance queries, every report tab and the three staff pages.
- JavaScript syntax and strict technology checks passed.
- Real Electron smoke test on Windows passed: 37 module screens, renderer Node isolation, one-click barcode generation/preview, visible build label, purchase form submissions for credit/cash/bank, POS cart and sale, PDF generation, persistent login data, Pashto RTL and dark preferences.
- Electron Builder produced both Windows Setup and Portable EXEs.
- Successful Windows workflow: https://github.com/husoftdeveloper-del/Pharmacy_management-/actions/runs/42989314985

The EXEs were built and verified by the Windows CI job. Interactive installation, physical scanner/printer testing, native file-picker workflows and a real-pharmacy acceptance run remain required; they are not claimed as completed here.

This is a working first release with documented boundaries, not certified medical/accounting software. Review README before production use.
