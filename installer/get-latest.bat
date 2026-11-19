@echo off
rem Double-click this file: it downloads the newest Setup, Portable and
rem License Generator EXE files into the folder this file is in.
rem Nothing is installed and nothing outside this folder is changed.
setlocal
title Download the latest installer files
echo.
echo   Downloading the latest installer files into:
echo   %~dp0
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0get-latest.ps1"
echo.
if errorlevel 1 (
  echo Something did not download. Open the Releases page in a browser instead:
  echo https://github.com/husoftdeveloper-del/Pharmacy_management-/releases
)
pause
