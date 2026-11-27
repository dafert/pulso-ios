@echo off
chcp 65001 >nul
title Pulso Server
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar_servidor.ps1"
echo.
pause
