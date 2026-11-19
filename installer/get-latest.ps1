# Downloads the three installer files into the folder this script sits in.
#
#   powershell -ExecutionPolicy Bypass -File .\get-latest.ps1
#
# No installation, no registry, no files outside this folder. The versions are
# read from the repository it is run from, so a later release only needs the two
# numbers at the top changed.
$ErrorActionPreference = 'Stop'

# Keep in step with src/scripts/version.js and TopInTech-LicenseGenerator/package.json.
$pharmacyBuild = 'build.84'
$pharmacyVersion = '1.0.1'
$generatorVersion = '2.3.9'
$repo = 'husoftdeveloper-del/Pharmacy_management-'
$base = "https://github.com/$repo/releases/download"

$files = @(
  @{
    Name = "Pharmacy-$pharmacyVersion-x64.exe"
    Url  = "$base/v$pharmacyVersion-$pharmacyBuild/Pharmacy-$pharmacyVersion-x64.exe"
  },
  @{
    Name = "Pharmacy-$pharmacyVersion-Portable.exe"
    Url  = "$base/v$pharmacyVersion-$pharmacyBuild/Pharmacy-$pharmacyVersion-Portable.exe"
  },
  @{
    Name = "Top-In-Tech-License-Generator-Setup-$generatorVersion.exe"
    Url  = "$base/generator-v$generatorVersion/Top-In-Tech-License-Generator-Setup-$generatorVersion.exe"
  }
)

$folder = Split-Path -Parent $MyInvocation.MyCommand.Path
$failed = 0

foreach ($file in $files) {
  $target = Join-Path $folder $file.Name
  Write-Host "downloading $($file.Name) ..."
  try {
    # A GitHub release asset answers with a redirect to storage; Invoke-WebRequest
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
    $failed += 1
  } else {
    Write-Host ("ok      {0}  {1:N0} bytes" -f $file.Name, $size)
  }
}

if ($failed -gt 0) {
  Write-Error "$failed file(s) did not download. Check the connection, or open the Releases page in a browser: https://github.com/$repo/releases"
  exit 1
}

Write-Host ''
Write-Host 'All installer files are in this folder:'
Get-ChildItem $folder -Filter '*.exe' | ForEach-Object { Write-Host ("  {0}  {1:N0} bytes" -f $_.Name, $_.Length) }
Write-Host ''
Write-Host 'Install the generator first, create the licence, then run the Pharmacy setup.'
