# Pharmacy Management — delivery

## Windows downloads

Verified release: **v1.0.0-build.16**

- Setup installer in the project folder: `src/pages/Pharmacy-Setup.exe`
- Release page: https://github.com/husoftdeveloper-del/Pharmacy_management-/releases/tag/v1.0.0-build.16
- Setup installer: https://github.com/husoftdeveloper-del/Pharmacy_management-/releases/download/v1.0.0-build.16/Pharmacy-1.0.0-x64.exe
- Portable EXE: https://github.com/husoftdeveloper-del/Pharmacy_management-/releases/download/v1.0.0-build.16/Pharmacy-1.0.0-Portable.exe

These are Windows x64, unsigned builds. Verify the download source and checksums. The installer creates Desktop and Start Menu shortcuts. Application data is stored outside the installation directory.

### GitHub release asset SHA-256

```text
6d774e88df2e5dcd5d701067dea6c756cee405118f86ca1ac8d6233ac4e1fb5c  Pharmacy-1.0.0-x64.exe
dcd96cfa3f5e3a0bda4ed7c7fe7f320b4402583ae9725e802808d46688174027  Pharmacy-1.0.0-Portable.exe
```

`src/pages/Pharmacy-Setup.exe` is the same Setup installer and has the same SHA-256 as `Pharmacy-1.0.0-x64.exe`.

Check in PowerShell:

```powershell
Get-FileHash .\src\pages\Pharmacy-Setup.exe -Algorithm SHA256
```

## Source

Complete source is on branch `arena/0746dde2-pharmacy-management`. Application source commit: `c01e27564e5c4fe55abea7b68947f147234bd4bf`. The branch also contains the refreshed installer commit `ecf7804`.

```powershell
git clone --branch arena/0746dde2-pharmacy-management https://github.com/husoftdeveloper-del/Pharmacy_management-.git Pharmacy_management-
cd .\Pharmacy_management-
npm ci
npm start
```

See `README.md` for architecture, all modules, security boundaries, operating instructions, build commands and known limitations.

## Purchase form fix

Build 16 keeps the purchase-form fix and `Invalid record ID` when receiving a purchase. adds a visible `build.16` label plus field-specific ID errors. The purchase form explicitly maps supplier, medicine, location, invoice, payment method and account fields to the secure IPC contract. The same naming mismatch was corrected in related payment, expense, staff, transfer, stock-count and prescription forms. Cash/bank account choices now follow the selected payment method, and credit purchases hide the irrelevant account field.

## Live-reload development mode

Run `npm run dev` (or double-click `dev.bat` on Windows) after one `npm ci`. Saving `src/` files refreshes the open window; saving `main.js`, `preload.js`, `package.json` or `database/` restarts Electron. Dev mode uses a separate `Pharmacy Management Dev` data folder and is disabled in packaged EXEs.

## Barcode update

Barcode Management now has an icon button inside the barcode input. Clicking it generates a unique `MED-…` barcode through the secure main process, fills the input, and shows the CODE128-B preview immediately. Choose a medicine and press Save to assign it; Print remains available after preview. The action is permission-checked in the main process and covered by database and Electron smoke tests.

## Verification completed

- 17 database/business-rule and form-payload tests passed, including the purchase-form regression, barcode uniqueness and permission checks.
- JavaScript syntax and strict technology checks passed.
- Real Electron smoke test on Windows passed: 26 module screens, renderer Node isolation, one-click barcode generation/preview, visible build label, purchase form submissions for credit/cash/bank, POS cart and sale, PDF generation, persistent login data, Pashto RTL and dark preferences.
- Electron Builder produced both Windows Setup and Portable EXEs.
- Successful Windows workflow: https://github.com/husoftdeveloper-del/Pharmacy_management-/actions/runs/41285944970

The EXEs were built and verified by the Windows CI job. Interactive installation, physical scanner/printer testing, native file-picker workflows and a real-pharmacy acceptance run remain required; they are not claimed as completed here.

This is a working first release with documented boundaries, not certified medical/accounting software. Review README before production use.
