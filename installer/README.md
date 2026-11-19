# Installer files — how to get the latest ones

This folder is where the downloadable setup files land on your own PC. The
installers themselves are **not stored in git** (each one is about 100 MB), so
nothing here is committed except this note and the two download scripts.

The folder holds exactly two files, named the way it always has:

| File | What it is |
| --- | --- |
| `Pharmacy-Setup-build84.exe` | The Pharmacy **setup** the customer installs. Asks for **Enter your Pharmacy Name** and the **six-character serial key**. |
| `Generator-Setup-2.3.9.exe` | The owner's licence generator. It prints the six-character install key and has the ⚙ Settings window. |

Install the generator first, create the licence, then run the Pharmacy setup. The
Portable build is optional and only for testing:

```powershell
powershell -ExecutionPolicy Bypass -File .\get-latest.ps1 -WithPortable
```

## 1. Replace the two old files with the newest ones (double-click)

Open this `installer` folder in File Explorer and **double-click
`get-latest.bat`**. It:

* reads the newest build from the repository (`build.84`, generator `2.3.9`),
* downloads `Pharmacy-Setup-build84.exe` and `Generator-Setup-2.3.9.exe` here,
* moves any **older** `Pharmacy-Setup-build*.exe` / `Generator-Setup-*.exe` into
  `.\old\` (nothing is deleted),
* prints the folder listing and the size of each file.

The same from a terminal:

```powershell
powershell -ExecutionPolicy Bypass -File .\get-latest.ps1
```

A download that is interrupted (smaller than 50 MB) is deleted and reported, so a
half file can never be mistaken for an installer.

## 2. Download by hand, then rename

Open the two links, save into this folder, and rename the saved files to the two
names in the table above:

* Setup: https://github.com/husoftdeveloper-del/Pharmacy_management-/releases/download/v1.0.1-build.84/Pharmacy-1.0.1-x64.exe
* Generator 2.3.9: https://github.com/husoftdeveloper-del/Pharmacy_management-/releases/download/generator-v2.3.9/Top-In-Tech-License-Generator-Setup-2.3.9.exe

```powershell
Rename-Item .\Pharmacy-1.0.1-x64.exe                     .\Pharmacy-Setup-build84.exe
Rename-Item .\Top-In-Tech-License-Generator-Setup-2.3.9.exe .\Generator-Setup-2.3.9.exe
```

The Releases page lists the same files, newest first:
https://github.com/husoftdeveloper-del/Pharmacy_management-/releases

## 3. Copy the setup that git already carries

Every green Windows build also commits the setup into the repository at
`src\pages\Pharmacy-Setup.exe`, so after `git pull` you can simply copy it:

```powershell
git -C "C:\Users\HK DEVELOPER\Desktop\Pharmacy_Pro" pull origin main
Copy-Item "C:\Users\HK DEVELOPER\Desktop\Pharmacy_Pro\src\pages\Pharmacy-Setup.exe" `
          "C:\Users\HK DEVELOPER\Desktop\Pharmacy_Pro\installer\Pharmacy-Setup-build84.exe"
```

That file is byte-for-byte the `Pharmacy-1.0.1-x64.exe` from the release: CI
copies it there right after the build passes. Only the portable build and the
generator are missing from git.

## Which build is which

`src/scripts/version.js` holds the label the application shows in its footer, and
`TopInTech-LicenseGenerator/package.json` holds the generator version. The
download script reads both, so the file names always match the repository. If a
file you hold does not match those two numbers, it is an older copy — that is
exactly what the screenshot of `2.3.5` and `build79` shows.

## Checksums

After downloading, print the SHA-256 of each file so two PCs can be compared:

```powershell
Get-FileHash .\*.exe -Algorithm SHA256 | Format-Table Hash, Path
```
