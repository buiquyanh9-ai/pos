@echo off
rem Double-click: chay TOAN BO ShopFlow de DEMO (may chu + POS + Boss + may in ao + may ao Android neu co).
rem Dung du lieu MAU rieng (apps\server\data\demo.db), KHONG dung so sach that.
rem Dong cua so nay = tat het.
chcp 65001 >nul
title ShopFlow DEMO - dong cua so nay de TAT demo
cd /d "%~dp0"
node scripts\demo.mjs %*
echo.
echo Demo da dung. Nhan phim bat ky de dong.
pause >nul
