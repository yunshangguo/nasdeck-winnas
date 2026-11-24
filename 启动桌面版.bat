@echo off
setlocal
cd /d "%~dp0"
rem WorkBuddy / some terminals export ELECTRON_RUN_AS_NODE=1, which makes
rem electron.exe behave as plain Node and breaks require('electron').
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="
title NasDeck WinNAS Desktop
echo ================================================================
echo   NasDeck WinNAS Desktop  (Electron)
echo   Window 1 : Web Desktop        ^| http://127.0.0.1:5080/
echo   Window 2 : Backend Settings   ^| independent window
echo ================================================================
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH. Please install Node.js 18+ first.
  pause
  exit /b 1
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo [SETUP] First run - installing Electron runtime via npmmirror...
  set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
  call npm install --registry=https://registry.npmmirror.com --no-audit --no-fund
  if errorlevel 1 goto :fail
)
if not exist "node_modules\electron\dist\electron.exe" goto :fail
echo [RUN] Starting desktop shell (backend runs inside the main process)...
call "node_modules\.bin\electron.cmd" .
goto :end
:fail
echo.
echo [FAILED] Electron runtime is not ready. See messages above.
pause
exit /b 1
:end
endlocal
