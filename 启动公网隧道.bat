@echo off
echo ============================================
echo  Make sure the local site is running first:
echo      npm start
echo ============================================
echo Starting public tunnel via Cloudflare...
echo Look for a line:  https://xxx.trycloudflare.com
echo Press Ctrl+C to stop the tunnel.
echo.
"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:3000 --no-autoupdate
