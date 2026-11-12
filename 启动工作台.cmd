@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

if not exist "dist\index.html" (
  echo.
  echo   [1/2] no build output found, running "npm run build" once...
  call npm run build
  if errorlevel 1 (
    echo.
    echo   x build failed. Send me the log above.
    pause
    exit /b 1
  )
)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   x node not found. Install Node 20+ first.
  pause
  exit /b 1
)

echo.
echo   [2/2] starting local server (close this window to stop)...
node scripts\serve-local.mjs 5180 %1

if errorlevel 1 pause
endlocal