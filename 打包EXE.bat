@echo off
setlocal
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="
title NasDeck WinNAS - Build Windows EXE
echo ================================================================
echo   NasDeck WinNAS  -  Windows EXE builder
echo   Output folder: dist\
echo ================================================================
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH.
  pause
  exit /b 1
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo [SETUP] Installing build dependencies via npmmirror...
  set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
  call npm install --registry=https://registry.npmmirror.com --no-audit --no-fund
  if errorlevel 1 goto :fail
)
set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
set "ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/"
echo.
echo [1/2] Building unpacked EXE - no extra downloads required...
call "node_modules\.bin\electron-builder.cmd" --win --x64 --dir
if errorlevel 1 goto :fail
echo.
echo [2/2] Building single-file portable EXE...
call "node_modules\.bin\electron-builder.cmd" --win portable --x64
if errorlevel 1 (
  echo [WARN] Portable build failed - usually a network issue downloading NSIS.
  echo        The unpacked EXE is already usable: dist\win-unpacked\NasDeck WinNAS.exe
)
echo.
echo [DONE] Artifacts are in dist\
echo        dist\win-unpacked\NasDeck WinNAS.exe        (folder-based, always works)
echo        dist\NasDeck-WinNAS-*-win-x64-portable.exe  (single file, if built)
echo.
echo NOTE: The WinNAS engine (C:\AI使用\项目\NasManager) stays on this machine.
echo       To move the EXE elsewhere, copy that folder too and set its
echo       path in the Backend Settings window (WinNAS engine field).
pause
goto :end
:fail
echo.
echo [FAILED] Build failed. See messages above.
pause
exit /b 1
:end
endlocal
