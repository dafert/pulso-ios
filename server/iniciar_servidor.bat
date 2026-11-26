@echo off
chcp 65001 >nul
title Pulso Server - Figurinhas com Som (Web)
cd /d "C:\Users\E-COMMERCE\.gemini\antigravity\scratch\pulso-ios\server"
echo ==========================================================
echo   Iniciando Servidor Pulso Web (Figurinhas com Som)
echo ==========================================================
echo.
echo   No PC, abra:        http://localhost:8787
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
  for /f "tokens=1" %%b in ("%%a") do (
    echo   No Wi-Fi (iPhone):  http://%%b:8787
  )
)
echo.
echo   Deixe esta janela aberta enquanto usa o site.
echo ==========================================================
echo.
node server.mjs
echo.
pause
