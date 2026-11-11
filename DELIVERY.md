# Pharmacy Management — delivery

## Windows downloads

Verified release: **v1.0.0-build.42**

- Setup installer in the project folder: `src/pages/Pharmacy-Setup.exe`
- Release page: https://github.com/husoftdeveloper-del/Pharmacy_management-/releases/tag/v1.0.0-build.42
- Setup installer: https://github.com/husoftdeveloper-del/Pharmacy_management-/releases/download/v1.0.0-build.42/Pharmacy-1.0.0-x64.exe
- Portable EXE: https://github.com/husoftdeveloper-del/Pharmacy_management-/releases/download/v1.0.0-build.42/Pharmacy-1.0.0-Portable.exe

These are Windows x64, unsigned builds. Verify the download source and checksums. The installer creates Desktop and Start Menu shortcuts. Application data is stored outside the installation directory.

### GitHub release asset SHA-256

```text
cab8df770066d2fe9956a12e9cc35cd6a07f98d9e19c94e2c7b0dfddd7bc3550  Pharmacy-1.0.0-x64.exe
53a85ddebc96aef91556403962d3736ad45dd7c0e008f163d042ff5d13a89c43  Pharmacy-1.0.0-Portable.exe
```

`src/pages/Pharmacy-Setup.exe` is the same Setup installer and has the same SHA-256 as `Pharmacy-1.0.0-x64.exe`.

Check in PowerShell:

```powershell
Get-FileHash .\src\pages\Pharmacy-Setup.exe -Algorithm SHA256
```

## Source

Complete source is on branch `arena/0746dde2-pharmacy-management`. Application source commit: `24e2e70`. The branch also contains the refreshed installer commit `62fde70`.

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

## Customers page layout (build 32)

The Customers page now has **Total Customers** and **Outstanding Credit** cards, a full-width search box (name, phone or email) and one table: **Name, Phone, Email, Credit Balance, Status, Actions** with Edit and Payment per row. An empty pharmacy shows “No customers yet. Add one to keep track of buyers.”

- **Email** is a real customer field: added to the record form, validated by the server and stored in a new `customers.email` column. Existing databases are migrated automatically on start (`PRAGMA table_info` + `ALTER TABLE … ADD COLUMN`), so no data is lost.
- Balances come from a new permission-checked `customerBook` call that returns every customer (active and inactive) with the ledger balance (opening balance + unpaid invoices − returns − payments) plus the totals used by the cards.

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

The footer of each box still opens the module itself. Release tags now follow the in-app build label (`v1.0.0-build.42` = `build.22` shown in the app).

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
- Successful Windows workflow: https://github.com/husoftdeveloper-del/Pharmacy_management-/actions/runs/42970006084

The EXEs were built and verified by the Windows CI job. Interactive installation, physical scanner/printer testing, native file-picker workflows and a real-pharmacy acceptance run remain required; they are not claimed as completed here.

This is a working first release with documented boundaries, not certified medical/accounting software. Review README before production use.
