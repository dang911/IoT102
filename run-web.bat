@echo off
setlocal

cd /d "%~dp0"
title IoT102 Web Launcher

where node.exe >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or is not available in PATH.
    echo Install Node.js 18 or newer, then run this file again.
    pause
    exit /b 1
)

if not exist "package.json" (
    echo [ERROR] package.json was not found in:
    echo %CD%
    pause
    exit /b 1
)

set "ESP32_IP=%~1"
if not defined ESP32_IP (
    echo Enter the ESP32 IP address shown in Serial Monitor.
    echo Example: 192.168.1.100
    set /p "ESP32_IP=ESP32 IP ^(leave blank for demo mode^): "
)

if defined ESP32_IP (
    set "ESP32_BASE_URL=http://%ESP32_IP%"
    set "SYNC_FROM_ESP32=true"
    echo Connecting to ESP32 at %ESP32_BASE_URL%
) else (
    set "ESP32_BASE_URL="
    set "SYNC_FROM_ESP32=false"
    echo Starting without ESP32 in demo mode.
)

echo Starting IoT102 backend and frontend...
start "IoT102 Backend" cmd /k npm.cmd start

timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"

echo Web dashboard: http://localhost:3000
echo Close the "IoT102 Backend" window to stop the web server.
endlocal
