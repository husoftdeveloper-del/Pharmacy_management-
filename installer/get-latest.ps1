# Downloads the newest Pharmacy Setup and License Generator into the folder this
# script sits in, and names them the way this folder already does:
#
#   Pharmacy-Setup-build84.exe
#   Generator-Setup-2.3.9.exe
#   Pharmacy-Setup-Portable-build84.exe   (only with -WithPortable)
#
#   powershell -ExecutionPolicy Bypass -File .\get-latest.ps1
#   powershell -ExecutionPolicy Bypass -File .\get-latest.ps1 -WithPortable
#
# Older builds of the same two files are moved into .\old\ instead of being
# deleted, so a file is never lost. Nothing is installed and nothing outside this
# folder is touched. The version numbers are read from the repository when it is
# available, so this script does not go stale.
param(
  [switch]$WithPortable
)
$ErrorActionPreference = 'Stop'

$folder = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $folder
$repo = 'husoftdeveloper-del/Pharmacy_management-'
$base = "https://github.com/$repo/releases/download"

# --- Which version is the newest? ------------------------------------------
# Ask the working copy first; fall back to the numbers of the release these
# files came from.
$pharmacyVersion = '1.0.1'
$buildLabel = 'build.84'
$generatorVersion = '2.3.9'

$versionFile = Join-Path $repoRoot 'src/scripts/version.js'
if (Test-Path $versionFile) {
  $text = Get-Content $versionFile -Raw
  if ($text -match "APP_VERSION='([^']+)'") { $pharmacyVersion = $Matches[1] }
  if ($text -match "APP_BUILD='(build\.\d+)'") { $buildLabel = $Matches[1] }
}
$generatorPackage = Join-Path $repoRoot 'TopInTech-LicenseGenerator/package.json'
if (Test-Path $generatorPackage) {
  $generatorVersion = (Get-Content $generatorPackage -Raw | ConvertFrom-Json).version
}
# build.84 -> 84, so the file is named like the ones already in this folder.
$buildNumber = ($buildLabel -replace '^build\.', '')

$files = @(
  @{
    Name = "Pharmacy-Setup-build$buildNumber.exe"
    Url  = "$base/v$pharmacyVersion-$buildLabel/Pharmacy-$pharmacyVersion-x64.exe"
    Kind = 'setup'
  },
  @{
    Name = "Generator-Setup-$generatorVersion.exe"
    Url  = "$base/generator-v$generatorVersion/Top-In-Tech-License-Generator-Setup-$generatorVersion.exe"
    Kind = 'generator'
  }
)
if ($WithPortable) {
  $files += @{
    Name = "Pharmacy-Setup-Portable-build$buildNumber.exe"
    Url  = "$base/v$pharmacyVersion-$buildLabel/Pharmacy-$pharmacyVersion-Portable.exe"
    Kind = 'portable'
  }
}

Write-Host "Newest build : $buildLabel (Pharmacy $pharmacyVersion) · Generator $generatorVersion"
Write-Host "Folder       : $folder"
Write-Host ''

$failed = 0
$downloaded = @()

foreach ($file in $files) {
  $target = Join-Path $folder $file.Name
  if (Test-Path $target) {
    Write-Host "ok      $($file.Name) is already here"
    $downloaded += $target
    continue
  }
  Write-Host "downloading $($file.Name) ..."
  try {
    # A release asset answers with a redirect to storage; Invoke-WebRequest
    # follows it and writes the real file.
    Invoke-WebRequest -Uri $file.Url -OutFile $target -UseBasicParsing
  } catch {
    Write-Host "FAILED  $($file.Name): $($_.Exception.Message)"
    $failed += 1
    continue
  }
  $size = (Get-Item $target).Length
  if ($size -lt 50MB) {
    Write-Host "FAILED  $($file.Name): only $size bytes, the download is incomplete"
    Remove-Item $target -Force -ErrorAction SilentlyContinue
    $failed += 1
  } else {
    Write-Host ("ok      {0}  {1:N0} KB" -f $file.Name, [math]::Round($size / 1KB))
    $downloaded += $target
  }
}

if ($failed -gt 0) {
  Write-Error "$failed file(s) did not download. Check the connection, or open https://github.com/$repo/releases in a browser."
  exit 1
}

# --- Put the older copies aside, so the folder shows exactly the new ones ---
# Only the two kinds this script manages are touched, and nothing is deleted.
$old = Join-Path $folder 'old'
$patterns = @('Pharmacy-Setup-build*.exe', 'Generator-Setup-*.exe', 'Pharmacy-Setup-Portable-build*.exe')
$moved = 0
foreach ($pattern in $patterns) {
  Get-ChildItem $folder -Filter $pattern -File | Where-Object { $downloaded -notcontains $_.FullName } | ForEach-Object {
    if (-not (Test-Path $old)) { New-Item -ItemType Directory -Path $old | Out-Null }
    $destination = Join-Path $old $_.Name
    if (Test-Path $destination) { Remove-Item $destination -Force }
    Move-Item $_.FullName $destination
    Write-Host "moved   $($_.Name)  ->  old\"
    $moved += 1
  }
}
if ($moved -gt 0) {
  Write-Host ''
  Write-Host "$moved older file(s) moved into .\old (nothing was deleted)."
}

$list = Get-ChildItem $folder -Filter '*.exe' -File | Sort-Object Name
Write-Host ''
Write-Host 'This folder now holds:'
foreach ($item in $list) {
  Write-Host ("  {0,-40} {1,10:N0} KB" -f $item.Name, [math]::Round($item.Length / 1KB))
}
Write-Host ''
Write-Host 'Order: install the Generator first and create the licence, then run the Pharmacy setup.'
Write-Host 'The setup asks for: Enter your Pharmacy Name, then the six-character serial key.'
