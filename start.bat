@echo off
chcp 65001 >nul
title BRAC Live Workshop
rem ===== Change the presenter PIN here =====
set PIN=2026
set PORT=3000
node server.js
pause
