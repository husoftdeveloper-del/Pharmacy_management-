# Builds the Windows installer for the License Generator.
# Right-click → Run with PowerShell, or from this folder:
#   powershell -ExecutionPolicy Bypass -File .\build-windows.ps1
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

Write-Host 'Top In Tech License Generator — Windows build' -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath 'node_modules')) {
  Write-Host '1/3 Installing dependencies (own node_modules, nothing shared)' -ForegroundColor Yellow
  npm install
} else {
  Write-Host '1/3 Dependencies already installed' -ForegroundColor DarkGray
}

Write-Host '2/3 Running the test suite' -ForegroundColor Yellow
npm test
if ($LASTEXITCODE -ne 0) { throw 'Tests failed — the installer was not built.' }

Write-Host '3/3 Building the installer and portable EXE' -ForegroundColor Yellow
npm run dist:win
if ($LASTEXITCODE -ne 0) { throw 'electron-builder failed. See the messages above.' }

Write-Host ''
Write-Host 'Done. Files in the release folder:' -ForegroundColor Green
Get-ChildItem -LiteralPath 'release' -Filter '*.exe' | ForEach-Object {
  '{0}  ({1:N1} MB)' -f $_.Name, ($_.Length / 1MB)
}
Write-Host ''
Write-Host 'Keep %APPDATA%\Top In Tech License Generator\keys\private.pem offline and secret.'
