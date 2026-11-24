@echo off
setlocal
chcp 65001 >nul 2>&1
title NasDeck WinNAS Launcher

rem ============================================================
rem  NasDeck 2.5 Web Desktop - Windows native NAS tool
rem  Double-click this file to start the backend, or use:
rem     start-nasdeck.bat --check     diagnose only, do not start
rem     start-nasdeck.bat --noelev    start without UAC prompt
rem     start-nasdeck.bat --nodocker   do NOT auto-start WSL/dockerd
rem     start-nasdeck.bat --docker      (compat; autostart is ON by default)
rem  All messages are ASCII on purpose (avoids GBK/UTF-8 mojibake).
rem ============================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

rem ---- change these two lines if you want another port / local-only ----
set "PORT=5080"
set "HOST=0.0.0.0"
rem Docker autostart is ON by default: wake WSL, start dockerd and keep the
rem WSL session alive (otherwise WSL2 sleeps and 2375 drops offline again).
rem Use --nodocker to disable. Never inherit a polluted parent-shell value.
set "NasDeck_WSL_AUTOSTART=1"

rem ---- locate node.exe ----
set "NODE_EXE="
for /f "delims=" %%i in ('where node 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%i"
if not defined NODE_EXE if exist "%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe" set "NODE_EXE=%USERPROFILE%\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
if not defined NODE_EXE if exist "C:\Program Files\nodejs\node.exe" set "NODE_EXE=C:\Program Files\nodejs\node.exe"

set "NOELEV=0"
set "NOBROWSER=0"
for %%a in (%*) do (
  if /i "%%a"=="--check" goto CHECK
  if /i "%%a"=="--noelev" set "NOELEV=1"
  if /i "%%a"=="--nobrowser" set "NOBROWSER=1"
  if /i "%%a"=="--docker" set "NasDeck_WSL_AUTOSTART=1"
  if /i "%%a"=="--nodocker" set "NasDeck_WSL_AUTOSTART=0"
  if /i "%%a"=="--elevated" set "NOELEV=1"
)

rem ---- auto elevate (full Windows features need admin rights) ----
if "%NOELEV%"=="0" (
  fltmc >nul 2>&1
  if errorlevel 1 (
    echo Requesting administrator privileges...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '--elevated %*' -Verb RunAs"
    exit /b
  )
)

:RUN
echo.
echo ============================================================
echo  NasDeck WinNAS  /  backend startup
echo ============================================================
echo  Project : %ROOT%
echo  Node    : %NODE_EXE%
echo  Listen  : %HOST%:%PORT%
echo  WSL     : autostart=%NasDeck_WSL_AUTOSTART% (--nodocker to disable)
echo  Login   : admin / admin
echo  WARN    : default password - set NasDeck_PASSWORD before exposing to LAN
echo.

if not defined NODE_EXE (
  echo [ERROR] node.exe not found. Install Node.js or fix NODE_EXE in this bat.
  pause
  exit /b 1
)
if not exist "%ROOT%\server.js" (
  echo [ERROR] server.js not found next to this bat.
  pause
  exit /b 1
)

findstr /c:"__NasDeck_WINNAS_START__" "%ROOT%\index.html" >nul 2>&1
if errorlevel 1 (
  echo [WARN] index.html has no WinNAS layer marker. Run: python build.py
) else (
  echo [OK]   index.html contains the WinNAS layer.
)

rem ---- stop old instances of THIS project only (never touch C:\AI使用\项目\NasManager) ----
rem Two paths: by listening port (works even when CommandLine is unreadable on an
rem elevated process) and by health-check identification on other ports.
echo.
echo Stopping old NasDeck backend instances...
powershell -NoProfile -Command "$ids=@(); foreach($p in (@(%PORT%,5000) | Sort-Object -Unique)){ $cs=Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue; foreach($x in $cs){ $pr=Get-Process -Id $x.OwningProcess -ErrorAction SilentlyContinue; if($pr -and $pr.ProcessName -eq 'node'){ if($p -eq %PORT%){ $ids += $x.OwningProcess } else { try { $h=Invoke-RestMethod -Uri ('http://127.0.0.1:'+$p+'/api/health') -TimeoutSec 2; if($h.name -like '*NasDeck*'){ $ids += $x.OwningProcess } } catch {} } } } }; $ids=@($ids|Sort-Object -Unique); if($ids.Count -gt 0){ foreach($id in $ids){ Write-Host ('  stop PID ' + $id); Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } } else { Write-Host '  none' }"
powershell -NoProfile -Command "Start-Sleep -Milliseconds 700"
powershell -NoProfile -Command "try { $h=Invoke-RestMethod -Uri 'http://127.0.0.1:5000/api/health' -TimeoutSec 2; if($h.name -like '*NasDeck*'){ Write-Host '  NOTE: another NasDeck instance is still on port 5000; close it manually if unused' } } catch {}"

rem ---- LAN addresses (HOST=0.0.0.0 means remote access is enabled) ----
powershell -NoProfile -Command "$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { $_.IPAddress }; if ($ips) { foreach ($ip in $ips) { Write-Host ('  LAN: http://' + $ip + ':%PORT%/') } }"

rem ---- open browser 3s later with a cache-buster ----
set "URL=http://127.0.0.1:%PORT%/?_=%RANDOM%%RANDOM%"
if "%NOBROWSER%"=="0" (
  echo Opening  : %URL%
  start "" /min powershell -NoProfile -Command "Start-Sleep -Seconds 3; Start-Process '%URL%'"
) else (
  echo Browser skipped. Open manually: %URL%
)

echo.
echo ------------------------------------------------------------
echo  Startup   : staged boot - progress is visible in the browser
echo  Boot API  : http://127.0.0.1:%PORT%/api/boot/status
echo  Tab title must read: NasDeck - WinNAS v2.3.0 (build 2026-11-12)
echo  A version pill sits at the bottom-right of the desktop.
echo  If the page still looks old, press Ctrl+F5 in the browser.
echo  Keep THIS window open. Press Ctrl+C to stop the backend.
echo ------------------------------------------------------------
echo.
echo Starting backend now (live logs below)...
echo.
pushd "%ROOT%"
"%NODE_EXE%" server.js
set "RC=%ERRORLEVEL%"
popd
echo.
echo [backend exited with code %RC%]
pause
exit /b 0

:CHECK
echo.
echo ==== NasDeck diagnosis (no server started) ====
echo ROOT=%ROOT%
echo NODE_EXE=%NODE_EXE%
findstr /c:"__NasDeck_WINNAS_START__" "%ROOT%\index.html" >nul 2>&1
if errorlevel 1 ( echo FRONTEND=OLD_OR_MISSING ) else ( echo FRONTEND=NEW_WITH_WINNAS_LAYER )
powershell -NoProfile -Command "foreach($p in 5080,5000,2375,5050){ $c=Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue; if($c){ foreach($x in $c){ $tag=''; try { $h=Invoke-RestMethod -Uri ('http://127.0.0.1:'+$p+'/api/health') -TimeoutSec 2; if($h.name -like '*NasDeck*'){ $tag=' [NasDeck]' } } catch {}; Write-Host ('  PORT ' + $p + ' pid=' + $x.OwningProcess + ' bind=' + $x.LocalAddress + $tag) } } else { Write-Host ('  PORT ' + $p + ' : free') } }"
echo.
pause
exit /b 0
