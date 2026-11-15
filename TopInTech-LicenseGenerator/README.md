# Top In Tech License Generator

Offline serial-key generator for Top In Tech desktop applications. It is an
owner-only tool: it signs license keys with an Ed25519 private key that never
leaves this computer, keeps every issued key in its own SQLite database, and
never needs an internet connection.

Built with **Electron + Node.js + SQLite + plain HTML/CSS/JavaScript** — same
stack as the customer app, no frameworks.

```
TopInTech-LicenseGenerator/
├─ main.js              Electron main process, IPC allow-list, exports
├─ preload.js           the only bridge exposed to the window
├─ lib/
│  ├─ serial.js         serial format, Ed25519 signing and verifying
│  ├─ keys.js           key pair creation, storage and description
│  └─ database.js       SQLite schema and license queries
├─ src/
│  ├─ index.html        the window
│  ├─ styles/app.css    dark owner console styling
│  └─ scripts/app.js    renderer (talks only through window.generator)
├─ tools/cli.js         issue and check keys from a terminal
├─ build-windows.ps1    install + test + build the Windows EXEs
├─ tests/               node --test suites (no Electron needed)
└─ docs/                how the customer app verifies a serial
```

## Run it

```powershell
cd "C:\Users\HK DEVELOPER\Desktop\PharmacyProjects\Pharmacy_management-\TopInTech-LicenseGenerator"
npm install
npm start
```

`npm install` must run **inside this folder**. It has its own `package.json` and
its own `node_modules`; nothing is shared with the Pharmacy application.

## Build the Windows installer

```powershell
npm run dist:win
```

Or run the helper, which installs, tests and builds in one step:

```powershell
powershell -ExecutionPolicy Bypass -File .\build-windows.ps1
```

Output in `release\`:

| File | Purpose |
| --- | --- |
| `TopInTech-LicenseGenerator-1.0.0-x64.exe` | Setup installer (choose folder, desktop + Start menu shortcut) |
| `TopInTech-LicenseGenerator-1.0.0-Portable.exe` | Single-file portable build |

The installer never deletes your data on uninstall
(`deleteAppDataOnUninstall: false`), so keys and licenses survive upgrades.

### Download the ready-built installer (built on Windows)

<https://github.com/husoftdeveloper-del/Pharmacy_management-/releases/tag/generator-v1.0.0>

Two files, both double-clickable:

| Download | What happens when you double-click |
| --- | --- |
| **`Top-In-Tech-License-Generator-Setup.exe`** | Installs in a few seconds — no wizard, no questions — creates a **desktop icon** and a Start menu entry, then **opens the app by itself**. |
| **`Top-In-Tech-License-Generator-Portable.exe`** | Opens the app immediately without installing anything. It does not add a desktop icon. |

(Hyphens instead of spaces, because GitHub rewrites spaces in file names.)

Installing on the owner's laptop:

1. Open the link above and download `Top-In-Tech-License-Generator-Setup.exe`.
2. Double-click it. Windows SmartScreen shows *Windows protected your PC* because
   the build is unsigned → **More info → Run anyway**. (If the file came from a
   browser and still refuses to start: right-click → **Properties → Unblock**.)
3. A short progress window appears, then the app opens and the desktop icon
   *Top In Tech License Generator* is already there.
4. The key pair is created on that computer the first time the app starts.
5. Press **Back up keys** and keep the copy somewhere offline and safe.

The install is per-user (`perMachine: false`), so Windows does not ask for an
administrator password. Uninstalling (Settings → Apps) never deletes the license
database or the keys, and upgrading to a newer build keeps them too.

The installers are built by `.github/workflows/license-generator.yml` on a
Windows runner every time something inside `TopInTech-LicenseGenerator/` changes
outside the documentation, and the previous files are removed from the release
page so only the current two downloads are ever offered. That workflow is
separate from the Pharmacy one: the Pharmacy application has its own release and
installer, and the two never mix.

## Where the files live

| What | Path |
| --- | --- |
| License database | `%APPDATA%\Top In Tech License Generator\licenses.sqlite` |
| Private key | `%APPDATA%\Top In Tech License Generator\keys\private.pem` (owner only) |
| Public key | `%APPDATA%\Top In Tech License Generator\keys\public.pem` |

The **Data folder** button opens that folder, and **Back up keys** copies both
key files plus a README into a folder you choose. Do that once and keep the
backup offline: without `private.pem` no new keys can be made for that key id.

> The private key must never be shipped with a customer application, put in a
> git repository, or e-mailed. Only `public.pem` may travel.
> `.gitignore` blocks `*.pem` as a second line of defence.

## Serial keys

* Format: `TIT1<payload>.<signature>`, shown in groups of five.
* Alphabet: Crockford base32 — no `I`, `L`, `O`, `U`, so `O` reads as `0` and
  `I`/`L` read as `1` when someone types a key by hand.
* Payload: `{v, k, id, pr, d, i, x}` — version, key id, license id, product,
  duration (`L` lifetime / `Y` 1 year / `H` 6 months), issue date, expiry date.
* Signature: Ed25519 over the exact payload bytes. Editing one character breaks
  the signature; a key signed by another pair fails the key-id check.
* A serial issued as *Lifetime* has an empty expiry and never expires.

Every generated key is verified against the public key before it is saved, so a
damaged key pair can never hand a customer a serial that their app rejects.

## Records

Each license row has a status:

| Status | Meaning |
| --- | --- |
| Unused | generated, not given to anyone yet |
| Assigned | handed to a customer (naming a customer sets this automatically) |
| Used | activated in the customer installation — cannot be deleted |

Filters, search, notes and per-row copy are in the records panel. Export writes
CSV (UTF-8 with BOM, formula-injection safe), JSON (includes the public key) or
a plain text list.

Status changes, notes and generation are written to `license_events`, so every
key has a small audit trail.

## Command line

```powershell
npm run keys                                 # show / create the key pair
npm run new-license -- "Pharmacy Management" 1y "Kabul Pharmacy"
npm run verify -- "TIT1…"
node tools/cli.js list
```

The CLI uses the same data folder, database and key files as the window.

## Tests

```powershell
npm test
```

Covers signing and verifying, tampered keys, the wrong key pair, expiry edges,
month arithmetic, malformed input, key file permissions, database CRUD, status
rules, search escaping, and the wiring between the window, the preload bridge
and the main process. No Electron binary is required.

## Giving the customer app the public key

See [`docs/customer-verification.md`](docs/customer-verification.md) for a
~40-line verifier that a customer application can embed together with
`public.pem` to check its own license offline.
