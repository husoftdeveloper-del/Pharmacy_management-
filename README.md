# Pharmaca — Pharmacy Management System

An offline Windows desktop application built with **pure HTML5, CSS3, Vanilla JavaScript (ES modules), Electron.js and SQLite**. No React, Next, Vue, Angular, TypeScript, JSX, Tailwind, frontend framework, CDN, or hosted database is used.

> This is a working first release of the modules listed below, not a claim of certified medical, tax, or accounting software. The earlier repository contained only a README, so the module list in the current request is the available specification. Review the operational boundaries before using it with real patients or money.

## Install on Windows

1. Open the repository's **Releases** page and download the installer from the latest successful Windows build:
   - `Pharmacy-1.0.0-x64.exe`: Setup installer, with Desktop and Start Menu shortcuts.
   - `Pharmacy-1.0.0-Portable.exe`: portable application.
2. Run the installer and choose an installation directory. These builds are **unsigned**; verify that you downloaded them from this repository. Windows SmartScreen may warn about an unknown publisher. A production deployment should use the organization's code-signing certificate.
3. Launch **Pharmacy Management**.
4. Complete first-run setup: pharmacy name, your name, administrator username, and a password of at least 10 characters. **There is no default password.**
5. Open Settings to set currency, address, phone, tax rate, language, theme, and receipt footer.
6. Add categories, manufacturers, suppliers, customers, staff, and medicines.
7. Open the cash register with its actual opening float.
8. Receive a purchase to create batch stock. Then use Point of Sale.

The application does not need internet access after installation. Do not delete the application-data directory when upgrading.

## Run the source

Requires **Node.js 22.13 or newer** and npm. Electron 39.8.10 is pinned in the lockfile. SQLite is provided by Electron/Node's built-in `node:sqlite`; there is no native third-party database addon to rebuild.

```powershell
git clone --branch arena/0746dde2-pharmacy-management https://github.com/husoftdeveloper-del/Pharmacy_management-.git Pharmacy_management-
cd .\Pharmacy_management-
npm ci
npm start
```

`npm ci` downloads Electron from GitHub, so installation requires internet access. On a managed network, allow the official Electron download host or configure your organization's approved Electron mirror. Do not disable TLS verification.

### Live-reload development mode

Install dependencies once, then start the app in development mode:

```powershell
npm ci
npm run dev
```

On Windows you can also double-click `dev.bat`; it installs dependencies if needed and starts live-reload mode.

While `npm run dev` is running:

- Save changes in `src/` (HTML, CSS, JavaScript, images) and the open window refreshes automatically after a short debounce. Read-only file access events are ignored, and the dev session is resumed after a renderer refresh, so normal page navigation does not log you out.
- Save changes to `main.js`, `preload.js`, `package.json`, or `database/` and the Electron app restarts automatically.
- Press `F5` or `Ctrl+R` to force a renderer refresh; press `F12` to toggle DevTools.
- Development mode uses a separate database folder, `Pharmacy Management Dev`, so experiments do not modify the installed production database. Complete first-run setup again in that dev profile if it is empty.
- Live reload is disabled in packaged Setup/Portable EXEs. To deliver a change to an installed app, build a new EXE with `npm run dist:win` and install it over the old one; application data is preserved.

### Build Windows EXEs

On Windows x64:

```powershell
npm ci
npm run check
npm test
npx electron tests/electron-smoke.js
npm run dist:win
```

Outputs are written to `release/`:

- Setup: `Pharmacy-1.0.0-x64.exe`
- Portable: `Pharmacy-1.0.0-Portable.exe`
- Checksum blockmaps and `latest.yml`

Electron Builder creates both targets. The installer permits per-user installation and an installation-directory choice. Uninstall does **not** delete application data. The portable EXE uses the same persistent application-data location; it is not a database-on-USB mode.

The GitHub workflow `.github/workflows/windows.yml` runs the checks, database tests, real Electron smoke test and Windows packaging on `windows-latest`. Successful builds on the session branch publish a prerelease with downloadable EXEs. Workflow artifacts also retain test results for 14 days. The build is unsigned.

## Included modules

| Area | Working functionality |
|---|---|
| Authentication | First-run administrator creation, salted scrypt password hashes, login throttling, 15-minute inactivity expiry, logout, active-user checks |
| Dashboard | Sales totals, seven-day chart, stock value, low-stock and expiry alerts, recent invoices; respects module permissions |
| POS | Medicine/barcode/SKU search, stock-aware cart, FEFO batch allocation, prescription checks, server-calculated discounts/tax, cash/bank/credit sales, receipt PDF |
| Sales history | Date filters, invoice details, quantity-limited returns, restock/damaged choice, cash/bank refund or customer credit, PDF receipts |
| Customers | Contact records, opening balances, credit limits, outstanding balances, payments and invoice allocation |
| Medicines | SKU/barcode, generic name, category/manufacturer, unit, cost/price, reorder level, Rx flag, storage instructions, active/inactive status |
| Barcode | One-click unique barcode generation from the icon beside the input, instant preview, unique assignment, local CODE128-B SVG with checksum, printable PDF; keyboard-wedge scanner input in POS |
| Purchases | Supplier invoices, multi-item receiving, batch/expiry/cost/location, discounts, cash/bank/credit payment, purchase returns |
| Suppliers | Contacts, opening balances, payables, payments and purchase history |
| Finance | Expenses, party payments, double-entry journals, profit and loss, trial balance |
| Staff/payroll | Staff records, monthly salary uniqueness, advances, automatic advance deduction, net salary payment |
| Cash register | One shared open register, opening float, cash in/out, expected cash from ledger, counted close and over/short entry |
| Prescriptions | Patient/doctor/date/notes, PNG/JPEG/PDF attachment up to 5 MB, pending/dispensed/cancelled states, sale linkage |
| Reference data | Medicine categories, patients, manufacturers |
| Stock operations | Location transfers, signed stock adjustments, physical count sheets, count completion with stock/audit updates |
| Banking | System cash/bank accounts, additional bank accounts, accounting balances |
| Offers | Percentage/fixed discounts, minimum sale, date range, active flag; validated again at checkout |
| Reports | Sales, purchases, inventory valuation, expiry, stock movements, P&L, trial balance, receivables, payables; PDF and CSV |
| Users/permissions | Administrator, pharmacist, cashier, accountant defaults; per-module overrides; password changes; last-admin/self-demotion protection |
| Audit | Append-only application audit records, including logins, changes, transactions, exports and backups |
| Settings | Pharmacy details, currency, tax, expiry warning, receipt footer, English/Pashto/Dari, light/dark themes |
| Backup/restore | Consistent online SQLite backup, integrity/relationship/journal validation before restore, administrator-only restore, safety copy and restart |

## Daily workflow

1. **Open register:** enter the counted opening cash. Cash sales/payments require an open register.
2. **Receive stock:** add a supplier, medicine and purchase invoice. Every line needs a batch number, future expiry, quantity and unit cost. A batch already in stock cannot silently change cost; use a distinct batch for a different delivery cost.
3. **Sell:** scan a barcode or select a medicine. The server chooses the earliest-expiring unexpired batch. Expired stock is never sold. Rx medicines require a matching pending patient prescription.
4. **Take payments:** record customer/supplier payments from their screens or Finance. Payments allocate to the oldest outstanding invoices; any remainder reduces the opening balance.
5. **Returns:** open the original invoice, enter unreturned quantities and a reason. Sales can be restocked or written off. Purchase returns remove available batch stock. Refunds/credits and inventory accounting are recorded transactionally.
6. **Count stock:** start a location count, enter every batch count, save, then complete. Completion adjusts current stock and records the reason. Pause stock activity while counting.
7. **Close register:** count the drawer, compare with expected cash, and record the difference.
8. **Back up:** save a `.sqlite` backup to separate protected storage. Test restore on a spare installation.

## Architecture

```text
.
├── package.json                 Electron Builder targets and scripts
├── package-lock.json            Pinned development dependencies
├── main.js                      Window lifecycle, trusted IPC, native dialogs, restore
├── preload.js                   Narrow contextBridge API; session token stays here
├── database/
│   ├── schema.sql               SQLite tables, constraints, indexes, audit triggers
│   ├── database.js              Connection, scrypt, transactions, backup validation
│   ├── catalog.js               Server-owned entity fields and role defaults
│   ├── service.js               Business rules and transactional module services
│   ├── barcode.js               Local CODE128-B generator
│   └── pdf.js                   Electron printToPDF (no PDF framework)
├── src/
│   ├── pages/                   26 module HTML files + matching JavaScript modules
│   ├── components/              Reusable Vanilla JS forms, tables, dialogs, documents
│   ├── styles/                  Shared design system and per-page stylesheet files
│   ├── scripts/                 Shell, API adapter, navigation, translations
│   └── assets/                  Local-only asset location
├── build/                       Application PNG/ICO/SVG icon
├── tests/                       Database invariants and Electron smoke test
├── scripts/check.js             Syntax and technology-rule checks
└── .github/workflows/windows.yml
```

The shared shell loads each page's HTML and JavaScript module. Reusable record screens share a form/table component; complex workflows have dedicated modules. Shared visual rules live in `base.css` and `pages.css`; page stylesheet slots are provided for future page-specific extensions.

### Security boundaries

- Renderer: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Preload exposes one allowlisted request method, not `ipcRenderer`, Node, filesystem, or SQL.
- Main accepts requests only from the application window's exact trusted page URL.
- Session tokens are random 256-bit values held in the preload closure and main-process session map, not localStorage.
- Every business operation checks the current active user and permissions in the main process.
- Table/field identifiers come from server-owned catalogs; values use prepared statements.
- Renderer totals are never authoritative. Checkout recalculates prices, discounts, tax, credit and stock.
- Stock/financial operations use immediate SQLite transactions and rollback on failure.
- Passwords use random salts and scrypt (`N=32768, r=8, p=1`); plaintext passwords are not stored or audited.
- CSP blocks remote scripts, frames, objects and connections. New windows/navigation and browser permissions are denied.
- Audit records have database triggers preventing update/delete through the application connection.

**Not a compliance certification:** SQLite files, backups and safety copies are not encrypted. Use Windows access controls, BitLocker/another encrypted volume, restricted backup access, and appropriate patient-data policies. A local administrator with filesystem access can bypass application-level audit protections. There is no central password-recovery service; keep a second trusted administrator and protected backups.

### Persistent data

Electron's `app.getPath('userData')` stores `pharmacy.sqlite`. On a normal Windows installation the directory is:

```text
C:\Users\<you>\AppData\Roaming\Pharmacy Management\
```

SQLite WAL files may exist while running. Use the in-app Backup command rather than copying only the live `.sqlite` file. Restore validates the candidate, keeps a `.before-restore-<timestamp>` safety copy, replaces the database, and restarts. Backups include sensitive attachments and password hashes.

## Verification

```powershell
npm run check
npm test
npx electron tests/electron-smoke.js
```

Database tests cover setup/passwords/permissions, purchases, FEFO sales, stock conservation, credit limits, payment allocation, sales/purchase returns, expenses, advances/salaries, transfers, adjustments, stock counts, offers, Rx attachments, register reconciliation, audit immutability, search escaping, barcode generation, backup integrity and balanced journals.

The Electron smoke test launches the real desktop application against a temporary database, checks renderer Node isolation, visits every module, exercises POS, generates a PDF, checks persistence after logout/login and verifies Pashto RTL/dark preferences. It writes screenshots and a result file to ignored `artifacts/`. Native file-picker interactions and installer execution still require the Windows acceptance checklist below.

## Operational boundaries / next phases

This release implements the listed modules as an integrated local application. The following are deliberate boundaries, not hidden claims:

- Single-pharmacy, one shared cash session; multiple stock locations are supported, but there is no multi-tenant/cloud synchronization.
- Whole-unit inventory quantities; no decimal pack conversion, serial numbers, controlled-drug registers, drug-interaction checking, or clinical decision support.
- One payment method per invoice; no split tender, cash change/tender workflow, payment cards/gateway integration, or automatic bank reconciliation.
- Cash-register expected cash tracks the system Cash account. Bank accounts have journals and balances but no statement import.
- Batch cost is preserved for in-stock batches. This is batch-cost accounting, not a weighted-average or FIFO perpetual cost revaluation system.
- P&L uses posted income/expense accounts. There is no period lock, tax filing, certified payroll, statutory accounting localization, or accountant-approved chart migration.
- Reports show up to 500 recent history rows; use date filters for older records. Reference selectors load up to 1,000 records and batch selectors up to 2,000; larger deployments need paged selectors.
- PDF export uses native Save dialogs. Receipt PDFs use A4, not thermal-printer-specific layouts. CSV is also available for reports.
- Core navigation, forms and common actions are translated into English, Pashto and Dari with RTL layout. Some advanced explanations and database-entered business values remain English/original text; professional translation review is recommended.
- Barcode output is CODE128-B, not EAN/UPC or GS1 DataMatrix. Validate print size and scanner compatibility.
- No sample patients, medicines, sales or credentials are inserted. The database starts empty except for reference accounts, settings and Main pharmacy.
- Schema creation is idempotent for this first release. Future schema changes require explicit versioned migrations before upgrading a production database.

Before production: have a pharmacist/accountant review workflows and reports, test the actual scanner/printer, perform a restore drill, configure encrypted storage and backups, and complete a supervised parallel-run period.

## Windows acceptance checklist

- [ ] Install Setup EXE; verify Desktop and Start Menu shortcuts.
- [ ] Create administrator; close/reopen and verify login/data persistence.
- [ ] Receive stock; complete cash and credit sales; print receipt PDF.
- [ ] Test return, customer payment, supplier payment, expense and salary advance.
- [ ] Close/reconcile register; test a restricted cashier account.
- [ ] Switch English/Pashto/Dari and light/dark themes.
- [ ] Back up, restore into a test installation, verify counts and balances.
- [ ] Upgrade without deleting application data; verify the portable EXE separately.

## Source and downloads

Repository: <https://github.com/husoftdeveloper-del/Pharmacy_management->

Session branch: `arena/f53501dc-pharmacy-management`

Windows binaries are published under **Releases** by the verified build workflow. Source ZIP/TAR links on each release are generated by GitHub. `node_modules`, local databases, test artifacts and `release` output are intentionally excluded from Git.
