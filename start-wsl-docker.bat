@echo off
setlocal
chcp 65001 >nul 2>&1
echo ============================================================
echo   NasDeck Web Desktop - Start Docker Engine inside WSL2
echo ============================================================
echo.
echo   Distro : Debian
echo   Source : D:\WslDockerManager\config.json
echo   Listen : 127.0.0.1:2375
echo.
echo   NOTE: Run start.bat first so the NasDeck backend (port 5080) is up.
echo.

echo [1/4] Waking WSL distro ...
wsl.exe -d Debian -u root -- echo __nasdeck_wsl_up__
if errorlevel 1 goto :fail

echo [2/4] Writing dockerd TCP override ...
wsl.exe -d Debian -u root -- sh -c "mkdir -p /etc/systemd/system/docker.service.d && printf '%%b' '[Service]\nExecStart=\nExecStart=/usr/bin/dockerd -H fd:// -H tcp://127.0.0.1:2375 --containerd=/run/containerd/containerd.sock\nRestart=always\nRestartSec=2\n' > /etc/systemd/system/docker.service.d/nasdeck-override.conf"

echo [3/4] Starting docker service ...
wsl.exe -d Debian -u root -- sh -c "if [ -d /run/systemd/system ]; then systemctl daemon-reload; systemctl enable docker >/dev/null 2>&1; systemctl restart docker; else service docker start; fi"
timeout /t 5 /nobreak >nul

echo [4/4] Fallback: direct dockerd with TCP listener (only if needed) ...
wsl.exe -d Debian -u root -- sh -c "docker info >/dev/null 2>&1 || (pkill -x dockerd 2>/dev/null; sleep 2; nohup dockerd -H fd:// -H tcp://127.0.0.1:2375 --iptables=false >/var/log/nasdeck-dockerd-tcp.log 2>&1 &)"
timeout /t 4 /nobreak >nul

echo.
echo Checking engine from Windows side ...
powershell.exe -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:2375/version' -TimeoutSec 6 -UseBasicParsing; Write-Host ('ENGINE OK: ' + $r.Content) } catch { Write-Host 'ENGINE NOT REACHABLE - check messages above, or run D:\WslDockerManager\restart-backend.bat' }"
echo.
echo Done. Refresh 容器工作台 in NasDeck Web Desktop.
echo If you also want the WslDockerManager supervisor, run:
echo   D:\WslDockerManager\restart-backend.bat
echo.
pause
exit /b 0

:fail
echo.
echo FAILED: wsl.exe could not start the Debian distro.
echo Verify WSL2 is installed and the distro exists (wsl -l -v).
pause
exit /b 1
