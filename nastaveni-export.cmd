@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\nastaveni.ps1" export %*
if errorlevel 1 pause
