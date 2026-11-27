$ErrorActionPreference = 'Stop'
$srvDir = 'C:\Users\E-COMMERCE\.gemini\antigravity\scratch\pulso-ios\server'
Set-Location $srvDir

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  PULSO WEB SERVER (100% GRATIS - FIGURINHAS COM SOM)" -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Iniciar servidor Node em segundo plano se porta 8787 nao estiver aberta
$portBusy = $false
try {
    $h = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/health' -TimeoutSec 2
    if ($h.ok) { $portBusy = $true }
} catch {}

if (-not $portBusy) {
    Write-Host "[1/2] Iniciando servidor Pulso na porta 8787..." -ForegroundColor Cyan
    Start-Process -FilePath 'node' -ArgumentList 'server.mjs' -WorkingDirectory $srvDir -WindowStyle Minimized
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 400
        try {
            $h = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/health' -TimeoutSec 2
            if ($h.ok) { break }
        } catch {}
    }
}
Write-Host "  OK Servidor local rodando em http://localhost:8787" -ForegroundColor Green

$cf = Join-Path $srvDir 'cloudflared.exe'
if (-not (Test-Path $cf)) {
    Write-Host "[ERRO] cloudflared.exe nao encontrado em $cf" -ForegroundColor Red
    pause
    exit 1
}

Write-Host "[2/2] Abrindo tunel HTTPS gratuito na Cloudflare..." -ForegroundColor Cyan
$logFile = Join-Path $srvDir 'tunnel.log'
if (Test-Path $logFile) { Remove-Item $logFile -Force }

$proc = Start-Process -FilePath $cf -ArgumentList 'tunnel --url http://127.0.0.1:8787 --no-autoupdate' -RedirectStandardError $logFile -WorkingDirectory $srvDir -NoNewWindow -PassThru

$publicUrl = $null
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Path $logFile) {
        $txt = Get-Content $logFile -Raw -ErrorAction SilentlyContinue
        if ($txt -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
            $publicUrl = $Matches[0]
            break
        }
    }
}

Write-Host ""
if ($publicUrl) {
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host "  SITE NO AR 100% GRATIS! ABRA NO SAFARI DO SEU IPHONE:" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Link Direto (mais rapido):" -ForegroundColor White
    Write-Host "  $publicUrl" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Link via GitHub Pages ja conectado:" -ForegroundColor White
    Write-Host "  https://dafert.github.io/pulso-ios/app/?server=$publicUrl" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Deixe esta janela aberta enquanto estiver usando." -ForegroundColor Gray
    Write-Host "==========================================================" -ForegroundColor Green
    try { Set-Clipboard -Value $publicUrl; Write-Host "  (Link copiado para a area de transferencia!)" -ForegroundColor Gray } catch {}
} else {
    Write-Host "[AVISO] Tunel demorou para retornar URL. Veja $logFile" -ForegroundColor Yellow
}

$proc.WaitForExit()
