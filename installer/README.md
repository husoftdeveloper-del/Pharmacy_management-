# Installer files — how to get the latest ones

This folder is where the downloadable setup files land on your own PC. The
installers themselves are **not stored in git** (each one is about 100 MB), so
nothing here is committed except this note and the download script.

Two files matter:

| File | What it is |
| --- | --- |
| `Pharmacy-1.0.1-x64.exe` | The Pharmacy **setup** the customer installs. Asks for the pharmacy name and the 6-character serial key. |
| `Pharmacy-1.0.1-Portable.exe` | The same application without the setup wizard, for testing. |
| `Top-In-Tech-License-Generator-Setup-2.3.9.exe` | The owner's licence generator, which prints the 6-character install key. |

`latest.yml` belongs to the portable build and is not needed for a manual
install.

## 1. Download everything into this folder (one command)

Open PowerShell in this folder and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\get-latest.ps1
```

It downloads the three files next to itself, prints their sizes, and stops with
an error if a file is missing or smaller than 50 MB. Nothing is installed and
nothing outside this folder is touched.

## 2. Download by hand

Open each link in a browser and choose this folder as the save location:

* Setup: https://github.com/husoftdeveloper-del/Pharmacy_management-/releases/download/v1.0.1-build.84/Pharmacy-1.0.1-x64.exe
* Portable: https://github.com/husoftdeveloper-del/Pharmacy_management-/releases/download/v1.0.1-build.84/Pharmacy-1.0.1-Portable.exe
* Generator 2.3.9: https://github.com/husoftdeveloper-del/Pharmacy_management-/releases/download/generator-v2.3.9/Top-In-Tech-License-Generator-Setup-2.3.9.exe

The Releases page lists the same files, newest first:
https://github.com/husoftdeveloper-del/Pharmacy_management-/releases

## 3. Copy the setup that git already carries

Every green Windows build also commits the setup into the repository at
`src\pages\Pharmacy-Setup.exe`, so after `git pull` you can simply copy it:

```powershell
git -C "C:\Users\HK DEVELOPER\Desktop\Pharmacy_Pro" pull origin main
Copy-Item "C:\Users\HK DEVELOPER\Desktop\Pharmacy_Pro\src\pages\Pharmacy-Setup.exe" `
          "C:\Users\HK DEVELOPER\Desktop\Pharmacy_Pro\installer\Pharmacy-1.0.1-x64.exe"
```

That file is byte-for-byte the `Pharmacy-1.0.1-x64.exe` from the release: CI
copies it there right after the build passes, and only the portable build and
the generator are missing from git.

## Which build is which

`src/scripts/version.js` holds the label the application shows in its footer, and
`TopInTech-LicenseGenerator/package.json` holds the generator version. If the
file you downloaded does not match those two, you have an older copy.

## Checksums

After downloading, print the SHA-256 of each file so two PCs can be compared:

```powershell
Get-FileHash .\*.exe -Algorithm SHA256 | Format-Table Hash, Path
```
