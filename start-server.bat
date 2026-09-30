@echo off
title macOS Web & Supabase Database Server
echo ============================================================
echo   Khoi dong Web Dashboard ^& Server Supabase PostgreSQL
echo ============================================================

set NODE_EXEC=node

where node >nul 2>nul
if %errorlevel% equ 0 goto RUN_SERVER

if exist "C:\Program Files\Adobe\Adobe Creative Cloud Experience\libs\node.exe" (
    set "NODE_EXEC=C:\Program Files\Adobe\Adobe Creative Cloud Experience\libs\node.exe"
    goto RUN_SERVER
)

if exist "C:\Program Files\Adobe\Adobe Photoshop 2024\node.exe" (
    set "NODE_EXEC=C:\Program Files\Adobe\Adobe Photoshop 2024\node.exe"
    goto RUN_SERVER
)

echo [LOI] Khong tim thay Node.js tren he thong!
echo Vui long cai dat Node.js tu https://nodejs.org
pause
exit /b 1

:RUN_SERVER
cd /d "%~dp0"
echo Dang su dung Node.js tai: "%NODE_EXEC%"
echo.
"%NODE_EXEC%" server.js
pause
