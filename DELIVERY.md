# Pharmacy Management — delivery

## Windows downloads

Verified release: **v1.0.0-build.19**

- Setup installer in the project folder: `src/pages/Pharmacy-Setup.exe`
- Release page: https://github.com/husoftdeveloper-del/Pharmacy_management-/releases/tag/v1.0.0-build.19
- Setup installer: https://github.com/husoftdeveloper-del/Pharmacy_management-/releases/download/v1.0.0-build.19/Pharmacy-1.0.0-x64.exe
- Portable EXE: https://github.com/husoftdeveloper-del/Pharmacy_management-/releases/download/v1.0.0-build.19/Pharmacy-1.0.0-Portable.exe

These are Windows x64, unsigned builds. Verify the download source and checksums. The installer creates Desktop and Start Menu shortcuts. Application data is stored outside the installation directory.

### GitHub release asset SHA-256

```text
e02d9223e0026bbb8476211e7252c33e8a6d3b57852fe2b976650193ecd39cbc  Pharmacy-1.0.0-x64.exe
ab1a078c20a67d3ad667802a3f5abdcd083f77c16c5cfd2a7056a3732166643d  Pharmacy-1.0.0-Portable.exe
```

`src/pages/Pharmacy-Setup.exe` is the same Setup installer and has the same SHA-256 as `Pharmacy-1.0.0-x64.exe`.

Check in PowerShell:

```powershell
Get-FileHash .\src\pages\Pharmacy-Setup.exe -Algorithm SHA256
```

## Source

Complete source is on branch `arena/0746dde2-pharmacy-management`. Application source commit: `178fbaa`. The branch also contains the refreshed installer commit `ab03451`.

```powershell
git clone --branch arena/0746dde2-pharmacy-management https://github.com/husoftdeveloper-del/Pharmacy_management-.git Pharmacy_management-
cd .\Pharmacy_management-
npm ci
npm start
```

See `README.md` for architecture, all modules, security boundaries, operating instructions, build commands and known limitations.

## Dashboard boxes (build 18, single row in build 19)

The dashboard now shows four equal data-driven boxes in one responsive grid, each clickable to its full page:

| Box | Main figure | Details |
| --- | --- | --- |
| Expenses | This month's total | Today's spend, latest three expenses, expense count |
| Low stock | Number of medicines at or below the reorder level | Latest three medicines with their stock and reorder level |
| Expiring soon | Number of batches inside the expiry-warning window | Batch number, remaining quantity and days left (or Expired) |
| Recent sales | Today's sales total (or the number of recent invoices for roles without finance access) | Latest three invoices with customer and total |

Build 19 places the four boxes side by side in one row of four equal columns (two columns below 1180 px, one below 650 px). Each box is one large click target: the card shows a pointer cursor, lifts on hover, moves its arrow, is focusable with Tab and opens with Enter or Space. The four boxes follow the same card, spacing, hover and focus styling, work in light/dark themes and in LTR/RTL, and degrade gracefully by role: pharmacists see three boxes (no finance), cashiers see the recent-sales box only. The sales-trend chart remains below the boxes.

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
- Successful Windows workflow: https://github.com/husoftdeveloper-del/Pharmacy_management-/actions/runs/42771000762

The EXEs were built and verified by the Windows CI job. Interactive installation, physical scanner/printer testing, native file-picker workflows and a real-pharmacy acceptance run remain required; they are not claimed as completed here.

This is a working first release with documented boundaries, not certified medical/accounting software. Review README before production use.
