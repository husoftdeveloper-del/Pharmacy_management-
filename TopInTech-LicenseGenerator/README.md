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
└─ buildResources/installer.nsh  activation page + current-user shortcuts
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

Double-clicking it shows the standard Windows wizard:

**Welcome → Software Activation → Installation Location → Install → Finish**

The **Software Activation** page asks for **Enter Your Key** and has `Continue`
and `Cancel` buttons. Only the serial key supplied with the purchase is
accepted, and it is compared case-sensitively. A wrong or empty key keeps the
user on the page with an error and the install never starts. The key itself is
never displayed anywhere in the installer.

Once a machine is activated the answer is remembered in several places at once,
and the page asks again only when **none** of them is found:

- `HKEY_LOCAL_MACHINE` and `HKEY_CURRENT_USER`, each read through **both** the
  32-bit and the 64-bit registry view (a 32-bit setup writes into
  `WOW6432Node`, a 64-bit one writes at the top of `Software`);
- `activated.txt` in `%ProgramData%\Top In Tech\License Generator`,
  `%LOCALAPPDATA%\Top In Tech\License Generator` and
  `%APPDATA%\Top In Tech\License Generator` (the ProgramData folder is read
  from the `ProgramData` environment variable, because the NSIS that
  electron-builder ships has no constant for it);
- the installed application folder itself (`C:\Program Files\Top In Tech
  License Generator`) — it cannot be there without the key.

So a repair, a reinstall, an update, a reinstall after an uninstall and even a
silent `/S` update on an activated laptop all go straight past the activation
page. Uninstalling never removes these flags.

The install directory defaults to `C:\Program Files\Top In Tech License
Generator`, and the wizard leaves a desktop shortcut and a Start menu entry.
Uninstalling keeps the licence database and the keys.

A portable build is still possible, but only when asked for explicitly:

```powershell
npm run dist:portable     # release\Top-In-Tech-License-Generator-<version>-Portable.exe
```

Or run the helper, which installs, tests and builds in one step:

```powershell
powershell -ExecutionPolicy Bypass -File .\build-windows.ps1
```

### Download the ready-built setup (version 2.1.0, built and installed on a Windows runner)

<https://github.com/husoftdeveloper-del/Pharmacy_management-/releases/tag/generator-v2.1.0>

| File | Size | SHA-256 |
| --- | --- | --- |
| `Top-In-Tech-License-Generator-Setup-2.1.0.exe` | 102,692,026 B | `5c97bd5a0405b13aa4f68dd6531a7a2797fb1adb215b97f28b3859963d5312cd` |

The release also carries `Top.In.Tech.License.Generator.Setup.exe`, the same
file: GitHub rewrites spaces in asset names, so the hyphenated copy is the one
with a clean download name. Rename your download to
`Top In Tech License Generator Setup.exe` if you prefer the exact title.

Every change inside `TopInTech-LicenseGenerator/` is built on a Windows runner by
`.github/workflows/license-generator.yml`, which **compiles the activation page
with the real NSIS compiler**, **installs the setup it just built** and checks
Program Files, the desktop shortcut, the Start menu entry, the uninstaller and
the remembered activation before publishing. It also proves that a silent
install is refused without the key and that an upper-case copy of the key is
rejected. The Pharmacy application has its own separate
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

## Settings

The gear icon in the top bar (or **Ctrl ,**) opens **Settings**. Everything in
it is local to this computer:

| Section | What you can do |
| --- | --- |
| Owner account | See which account is open and when it was created; **change the password** — current password, new password, confirmation; the new password needs 6–128 characters, must differ from the old one and from the username |
| Username | Rename the account. Your password is required, because the username is half of the credentials the sign-in screen asks for |
| Data and keys | See exactly where the licenses and the signing key live, how many licenses of each status exist, open the data folder, back up the keys, re-create the desktop icon |
| About | Version, Electron and Node of this build, and **Sign out** |

Both changes require the **current password**, so an already-unlocked window on
an unattended desk is not enough to take the tool over. The password is stored
only as a fresh scrypt hash; changing it also clears any lockout left by wrong
attempts, and every change is written to the license_events audit trail (without
the password). **Sign out** locks the window again immediately.

Losing the owner password means editing the generator's SQLite database by hand
(delete `owner_password_hash` and restart to create the account again) — the
tool never stores a second copy of it anywhere.

## Serial keys

* Format: `TIT1<payload>.<signature>`, shown in groups of five.
* Alphabet: Crockford base32 — no `I`, `L`, `O`, `U`, so `O` reads as `0` and
  `I`/`L` read as `1` when someone types a key by hand.
* Payload: `{v, k, id, pr, d, i, x}` — version, key id, license id, product,
  duration (`L` lifetime / `Y` 1 year / `H` 6 months / `M` 1 month / `F` 15
  days / `T` 10 days / `Q` 10 minutes), issue date, expiry.
* `x` is a date (`2026-11-28`) for every plan measured in days or months — the
  licence is valid through that whole day — and a full moment
  (`2026-11-19T07:40:00Z`) for **10 Minutes**, so the short plan really ends
  ten minutes after it was issued instead of at midnight.
* Signature: Ed25519 over the exact payload bytes. Editing one character breaks
  the signature; a key signed by another pair fails the key-id check.
* A serial issued as *Lifetime* has an empty expiry and never expires.

Every generated key is verified against the public key before it is saved, so a
damaged key pair can never hand a customer a serial that their app rejects.

## Install key for the Pharmacy setup

The long serial is the licence; it is also 170 characters, so nobody types it
into a setup wizard. Each license therefore also has a short **install key**:

```
ABC-123-456        9 characters: 5 data + 3 expiry day + 1 check
ABC-123-456-789   12 characters: 5 data + 3 day + 3 minute + 1 check
```

The fourth group appears only for a licence that ends at a time — the **10
Minutes** plan — and holds the minute of that day (UTC), so the customer gets
exactly ten minutes rather than the rest of the day.

* The 5 data characters are a stable base32 slice of `sha256("install:" + serial)`,
  so one serial always produces the same key and a second license produces a
  different one.
* The 3 middle characters are the last valid day, counted from 2025-01-01 (UTC)
  in base32. `000` means a lifetime licence. The line under the key spells the
  date out: *The application stops at sign-in after 28 November 2026.*
* The last character comes from a small arithmetic fold
  (`lib/setupkey.js`), because NSIS has no crypto library. The Pharmacy setup
  runs exactly the same arithmetic in `build/installer.nsh`, and the customer
  application re-reads the same number in `license.js` — the three agree.
* A key issued before 2.3.6 has 6 characters (`ABC-123`) and a 2.3.2 key has 16
  (`WXYZ-1234-5678-9ABC`). Neither carries a date, so both are read as lifetime
  and still install.
* The result card shows the key under **Install key for the setup** with
  **Copy Install Key**; the licences table has a ⌨ button that copies it again
  for a key sold earlier.
* The customer types it on the setup's **Pharmacy Management Activation** page.
  A typo or an empty field shows *"Invalid Serial Key! / Application Not
  Installed."* and the install does not start. Dashes, spaces and lower case are
  all accepted.
* The setup asks on **every** run: a repair, a reinstall, an upgrade or an
  install after an uninstall on the same computer all need the key again. The
  installer stores no activation record, so an old installation cannot open it.
* The setup writes the accepted key to `license.json` next to the program and in
  `%APPDATA%\Pharmacy Management`. The customer application reads it at sign-in
  and, after the last valid day, refuses to sign anyone in until you issue a new
  key. Selling a 10-Day licence therefore really ends after ten days.

This check stops casual copying; it is not the security boundary. The signed
serial is: verify it in the customer app with `public.pem`, as described in
[`docs/customer-verification.md`](docs/customer-verification.md).

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
