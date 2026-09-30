@echo off
title macOS Web & Supabase Database Server
echo ============================================================
echo   Khoi dong Web Dashboard ^& Server Supabase PostgreSQL
echo ============================================================

set NODE_EXEC=node

where node >nul 2>nul
if %errorlevel% equ 0 goto CHECK_PORT

if exist "C:\Program Files\Adobe\Adobe Creative Cloud Experience\libs\node.exe" (
    set "NODE_EXEC=C:\Program Files\Adobe\Adobe Creative Cloud Experience\libs\node.exe"
    goto CHECK_PORT
)

if exist "C:\Program Files\Adobe\Adobe Photoshop 2024\node.exe" (
    set "NODE_EXEC=C:\Program Files\Adobe\Adobe Photoshop 2024\node.exe"
    goto CHECK_PORT
)

echo [LOI] Khong tim thay Node.js tren he thong!
echo Vui long cai dat Node.js tu https://nodejs.org
pause
exit /b 1

:CHECK_PORT
cd /d "%~dp0"
echo Dang su dung Node.js tai: "%NODE_EXEC%"
echo.

:: Kiem tra va giai phong port 3000 neu co tien trinh cu dang chiem
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo Dang giai phong cong 3000 tu tien trinh PID %%a...
    taskkill /f /pid %%a >nul 2>&1
)

:RUN_SERVER
"%NODE_EXEC%" server.js
pause
