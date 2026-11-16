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
│  ├─ database.js       SQLite schema and license queries
│  └─ shortcut.js       desktop icon, incl. OneDrive-redirected desktops
├─ src/
│  ├─ index.html        the window
│  ├─ styles/app.css    dark owner console styling
│  └─ scripts/app.js    renderer (talks only through window.generator)
├─ tools/cli.js         issue and check keys from a terminal
├─ build-windows.ps1    install + test + build the Windows EXEs
└─ buildResources/installer.nsh  pins the desktop icon to the current user
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

`dist:win` builds **only the setup wizard** (`electron-builder --win nsis`). The
file is written to:

```
TopInTech-LicenseGenerator\release\Top In Tech License Generator Setup.exe
```

Double-clicking it shows the standard Windows wizard — Welcome → Installation
Location (`C:\Program Files\Top In Tech License Generator` by default) → Install
→ Finish — and leaves a desktop shortcut and a Start menu entry. Uninstalling
keeps the licence database and the keys.

A portable build is still possible, but only when asked for explicitly:

```powershell
npm run dist:portable     # release\Top-In-Tech-License-Generator-<version>-Portable.exe
```

Or run the helper, which installs, tests and builds in one step:

```powershell
powershell -ExecutionPolicy Bypass -File .\build-windows.ps1
```

### Download the ready-built setup (version 2.0.0, built and installed on a Windows runner)

<https://github.com/husoftdeveloper-del/Pharmacy_management-/releases/tag/generator-v2.0.0>

| File | Size | SHA-256 |
| --- | --- | --- |
| `Top-In-Tech-License-Generator-Setup-2.0.0.exe` | 102,687,461 B | `7e423241be376e05a127d7b27a3aa3e5de40c2ff2b59992999235515c3dae8f5` |

The release also carries `Top.In.Tech.License.Generator.Setup.exe`, the same
file: GitHub rewrites spaces in asset names, so the hyphenated copy is the one
with a clean download name. Rename your download to
`Top In Tech License Generator Setup.exe` if you prefer the exact title.

Every change inside `TopInTech-LicenseGenerator/` is built on a Windows runner by
`.github/workflows/license-generator.yml`, which **installs the setup it just
built** and checks Program Files, the desktop shortcut, the Start menu entry and
the uninstaller before publishing. The Pharmacy application has its own separate
release and installer; the two never mix.

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
