# Pharmacy Management — delivery

## Windows downloads

Verified release: **v1.0.0-build.31**

- Setup installer in the project folder: `src/pages/Pharmacy-Setup.exe`
- Release page: https://github.com/husoftdeveloper-del/Pharmacy_management-/releases/tag/v1.0.0-build.31
- Setup installer: https://github.com/husoftdeveloper-del/Pharmacy_management-/releases/download/v1.0.0-build.31/Pharmacy-1.0.0-x64.exe
- Portable EXE: https://github.com/husoftdeveloper-del/Pharmacy_management-/releases/download/v1.0.0-build.31/Pharmacy-1.0.0-Portable.exe

These are Windows x64, unsigned builds. Verify the download source and checksums. The installer creates Desktop and Start Menu shortcuts. Application data is stored outside the installation directory.

### GitHub release asset SHA-256

```text
cd3683391766d4dbcd0cf63a21ca64d449b32649c45ceedaa0346afcc9fc5844  Pharmacy-1.0.0-x64.exe
2179f1a7a383e0900e20fdfb9091e0d43f4d042592b49d44cc094ba0536adb1e  Pharmacy-1.0.0-Portable.exe
```

`src/pages/Pharmacy-Setup.exe` is the same Setup installer and has the same SHA-256 as `Pharmacy-1.0.0-x64.exe`.

Check in PowerShell:

```powershell
Get-FileHash .\src\pages\Pharmacy-Setup.exe -Algorithm SHA256
```

## Source

Complete source is on branch `arena/0746dde2-pharmacy-management`. Application source commit: `3e3e6e0`. The branch also contains the refreshed installer commit `460c4a1`.

```powershell
git clone --branch arena/0746dde2-pharmacy-management https://github.com/husoftdeveloper-del/Pharmacy_management-.git Pharmacy_management-
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

The footer of each box still opens the module itself. Release tags now follow the in-app build label (`v1.0.0-build.31` = `build.22` shown in the app).

The four boxes follow the same card, spacing, hover and focus styling, work in light/dark themes and in LTR/RTL, and degrade gracefully by role: pharmacists see three boxes (no finance), cashiers see the recent-sales box only. The sales-trend chart remains below the boxes.

## Purchase form fix

Build 14 fixed the purchase form so receiving a purchase no longer fails with `Invalid record ID`; build 15 added the visible build label and field-specific ID errors. The purchase form explicitly maps supplier, medicine, location, invoice, payment method and account fields to the secure IPC contract. The same naming mismatch was corrected in related payment, expense, staff, transfer, stock-count and prescription forms. Cash/bank account choices now follow the selected payment method, and credit purchases hide the irrelevant account field.

## Live-reload development mode

Run `npm run dev` (or double-click `dev.bat` on Windows) after one `npm ci`. Saving `src/` files refreshes the open window; saving `main.js`, `preload.js`, `package.json` or `database/` restarts Electron. Build 17 ignores read-only Windows file-watch events and resumes the dev session after a renderer refresh, so navigating between pages no longer forces logout. Dev mode uses a separate `Pharmacy Management Dev` data folder and is disabled in packaged EXEs.

## Barcode update

Barcode Management now has an icon button inside the barcode input. Clicking it generates a unique `MED-…` barcode through the secure main process, fills the input, and shows the CODE128-B preview immediately. Choose a medicine and press Save to assign it; Print remains available after preview. The action is permission-checked in the main process and covered by database and Electron smoke tests.

## Verification completed

- 17 database/business-rule and form-payload tests passed, including the purchase-form regression, barcode uniqueness and permission checks.
- JavaScript syntax and strict technology checks passed.
- Real Electron smoke test on Windows passed: 26 module screens, renderer Node isolation, one-click barcode generation/preview, visible build label, purchase form submissions for credit/cash/bank, POS cart and sale, PDF generation, persistent login data, Pashto RTL and dark preferences.
- Electron Builder produced both Windows Setup and Portable EXEs.
- Successful Windows workflow: https://github.com/husoftdeveloper-del/Pharmacy_management-/actions/runs/42786147454

The EXEs were built and verified by the Windows CI job. Interactive installation, physical scanner/printer testing, native file-picker workflows and a real-pharmacy acceptance run remain required; they are not claimed as completed here.

This is a working first release with documented boundaries, not certified medical/accounting software. Review README before production use.
