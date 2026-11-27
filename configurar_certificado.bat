@echo off
chcp 65001 >nul
title Configurador de Certificado - Pulso iOS
powershell -STA -NoProfile -ExecutionPolicy Bypass -File "%~dp0configurar_certificado.ps1" %*
echo.
pause
