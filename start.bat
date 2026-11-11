@echo off
chcp 65001 >nul
title Kubik Launcher
cd /d "%~dp0"
if exist "node_modules\electron\dist\electron.exe" (
  start "" "node_modules\electron\dist\electron.exe" "%~dp0."
  exit /b 0
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js не найден. Установите Node.js с https://nodejs.org и запустите start.bat снова.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo Первый запуск: устанавливаю зависимости...
  call npm.cmd install --no-audit --no-fund
)
call npm.cmd start
