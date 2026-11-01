# Pharmacy Management — delivery

## Windows downloads

Verified release: **v1.0.0-build.12**

- Release page: https://github.com/husoftdeveloper-del/Pharmacy_management-/releases/tag/v1.0.0-build.12
- Setup installer: https://github.com/husoftdeveloper-del/Pharmacy_management-/releases/download/v1.0.0-build.12/Pharmacy-1.0.0-x64.exe
- Portable EXE: https://github.com/husoftdeveloper-del/Pharmacy_management-/releases/download/v1.0.0-build.12/Pharmacy-1.0.0-Portable.exe

These are Windows x64, unsigned builds. Verify the download source and checksums. The installer creates Desktop and Start Menu shortcuts. Application data is stored outside the installation directory.

### GitHub release asset SHA-256

```text
1dfa7f6fd5dbdaef5f8f12ed4923b8e7679726ac0a05e5bf5bc271fc19f2432d  Pharmacy-1.0.0-x64.exe
e0dbb4d890806d8ebdfd12a8dbcf5f6cd9d94225ba2e300351b4032a96ddf38e  Pharmacy-1.0.0-Portable.exe
```

Check in PowerShell:

```powershell
Get-FileHash .\Pharmacy-1.0.0-x64.exe -Algorithm SHA256
```

## Source

Complete source is on branch `arena/f53501dc-pharmacy-management`, commit `77ded0269e1038d37d6eb1b01e4c881fce07bec9`.

```powershell
git clone --branch arena/f53501dc-pharmacy-management https://github.com/husoftdeveloper-del/Pharmacy_management-.git Pharmacy_management-
cd .\Pharmacy_management-
npm ci
npm start
```

See `README.md` for architecture, all modules, security boundaries, operating instructions, build commands and known limitations.

## Verification completed

- 14 database/business-rule tests passed.
- JavaScript syntax and strict technology checks passed.
- Real Electron smoke test on Windows passed: 26 module screens, renderer Node isolation, POS cart and sale, PDF generation, persistent login data, Pashto RTL and dark preferences.
- Electron Builder produced both Windows Setup and Portable EXEs.
- Successful Windows workflow: https://github.com/husoftdeveloper-del/Pharmacy_management-/actions/runs/41199829101

The EXEs were built and verified by the Windows CI job. Interactive installation, physical scanner/printer testing, native file-picker workflows and a real-pharmacy acceptance run remain required; they are not claimed as completed here.

This is a working first release with documented boundaries, not certified medical/accounting software. Review README before production use.
