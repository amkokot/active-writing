@echo off
cd /d "%~dp0"
node scripts\desktopLauncher.mjs
if errorlevel 1 pause
