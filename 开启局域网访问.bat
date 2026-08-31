@echo off
echo ============================================
echo  Adding firewall rule for port 3000 (LAN access)
echo ============================================
netsh advfirewall firewall delete rule name="RecruitSite3000" >nul 2>&1
netsh advfirewall firewall add rule name="RecruitSite3000" dir=in action=allow protocol=TCP localport=3000
echo.
echo Done. Make sure the server is running (npm start).
echo Share one of these URLs with friends on the SAME network:
ipconfig | findstr /i "IPv4"
echo.
pause
