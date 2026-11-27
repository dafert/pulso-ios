@echo off
chcp 65001 >nul
title Pulso Web Server + Tunel HTTPS Gratis
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\E-COMMERCE\.gemini\antigravity\scratch\pulso-ios\server\iniciar_servidor.ps1"
echo.
pause
