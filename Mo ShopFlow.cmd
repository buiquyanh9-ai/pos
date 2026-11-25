@echo off
rem Double-click to start ShopFlow on this computer (POS + Boss on https://quan.t160.men).
rem Close this window to stop it. Nothing is installed or changed in Windows.
chcp 65001 >nul
title ShopFlow - dong cua so nay de TAT ShopFlow
cd /d "%~dp0apps\server"

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue) { exit 1 }"
if errorlevel 1 (
  echo ShopFlow dang chay san roi. Mo POS...
  start "" https://quan.t160.men/pos/
  timeout /t 5 >nul
  exit /b
)

sc query cloudflared | find "RUNNING" >nul || echo [!] Dich vu cloudflared chua chay: link quan.t160.men se khong vao duoc. Mo Services va Start "cloudflared".

echo Sao luu du lieu truoc khi mo...
node --env-file-if-exists=.env src/backup.ts

echo.
echo ================================================================
echo   ShopFlow dang chay. Giu cua so nay mo trong luc ban hang.
echo   POS  (may tinh):  https://quan.t160.men/pos/
echo   Boss (dien thoai): https://quan.t160.men/boss/
echo   Khac wifi van vao duoc. Dong cua so nay = tat ShopFlow.
echo ================================================================
echo.
start "" cmd /c "timeout /t 4 >nul & start https://quan.t160.men/pos/"
node --env-file-if-exists=.env src/index.ts
echo.
echo ShopFlow da dung. Nhan phim bat ky de dong.
pause >nul
