@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.13 or newer first: https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies once...
  call npm ci
  if errorlevel 1 (
    echo Dependency installation failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)
call npm run dev
endlocal
