@echo off
title Intern Recruitment Site
cd /d "%~dp0"

netstat -ano | findstr /C:":3000 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo Server is already running. Opening the web page...
    start "" http://localhost:3000
    timeout /t 2 /nobreak >nul
    exit /b 0
)

echo Starting server... your browser will open automatically in a few seconds.
echo To stop: close this window, or press Ctrl+C.
start "" /min cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:3000"
node --disable-warning=ExperimentalWarning src\server.js
pause
