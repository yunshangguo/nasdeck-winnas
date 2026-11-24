@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal
set "NasDeck_BAT=%~f0"

rem ---- Auto-elevate to Administrator (needed for services / firewall / VSS / shares) ----
if /i "%~1"=="elevated" goto :run
if /i "%~1"=="noelevate" goto :run
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Requesting administrator privileges ^(UAC prompt^)...
  echo Cancel the UAC dialog and run "start.bat noelevate" for read-only mode.
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath $env:NasDeck_BAT -ArgumentList 'elevated' -Verb RunAs"
  exit /b 0
)

:run
echo.
echo   ============================================================
echo    NasDeck 2.5 Web Desktop  -  Windows Native Backend
echo   ============================================================
echo    URL       http://127.0.0.1:5080/
echo    Account   admin / admin
echo    Runtime   zero-dependency Node.js (no npm install needed)
echo.
echo    Real Windows: services, firewall, event log, VSS, SMB shares,
echo    processes, perf counters, winget, robocopy backup, WSL containers.
echo.
echo    A minimized window runs the server. Close it to stop the backend.
echo   ============================================================
echo.

set "NODE_EXE=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
  if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe" set "NODE_EXE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
)
"%NODE_EXE%" --version >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js 18+ or put node.exe in PATH.
  pause
  exit /b 1
)

start "NasDeck Windows Backend" /min cmd /c ""%NODE_EXE%" server.js"
timeout /t 3 >nul
start "" "http://127.0.0.1:5080/"
echo Backend started. Browser should open automatically.
