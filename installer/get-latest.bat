@echo off
rem Double-click this file: it downloads the newest Pharmacy Setup and the
rem License Generator into the folder this file is in, named like the files
rem already here (Pharmacy-Setup-build84.exe, Generator-Setup-2.3.9.exe).
rem Older copies are moved into .\old\ and nothing is deleted.
rem   get-latest.bat               two files
rem   get-latest.bat -WithPortable two files plus the portable build
setlocal
title Download the latest installer files
echo.
echo   Folder: %~dp0
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0get-latest.ps1" %*
echo.
if errorlevel 1 (
  echo Something did not download. Open the Releases page in a browser instead:
  echo https://github.com/husoftdeveloper-del/Pharmacy_management-/releases
)
pause
