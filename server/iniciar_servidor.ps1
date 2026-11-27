$ErrorActionPreference = 'Stop'
$srvDir = $PSScriptRoot
Set-Location $srvDir

Write-Host "Pulso Server" -ForegroundColor Cyan

# Inicia o servidor Node em segundo plano se a porta 8787 nao estiver ativa
$portBusy = $false
try {
    $h = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/health' -TimeoutSec 2
    if ($h.ok) { $portBusy = $true }
} catch {}

if (-not $portBusy) {
    Write-Host "[1/2] Iniciando servidor na porta 8787..." -ForegroundColor Cyan
    Start-Process -FilePath 'node' -ArgumentList 'server.mjs' -WorkingDirectory $srvDir -WindowStyle Minimized
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 400
        try {
            $h = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/api/health' -TimeoutSec 2
            if ($h.ok) { break }
        } catch {}
    }
}
Write-Host "Servidor local ativo em http://localhost:8787" -ForegroundColor Green

$cf = Join-Path $srvDir 'cloudflared.exe'
if (-not (Test-Path $cf)) {
    Write-Host "cloudflared.exe nao encontrado em $cf. Para acesso local, abra http://localhost:8787." -ForegroundColor Yellow
    exit 0
}

Write-Host "[2/2] Abrindo tunel HTTPS..." -ForegroundColor Cyan
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
    Write-Host "Acesso remoto ativo:" -ForegroundColor Green
    Write-Host "  Direto: $publicUrl" -ForegroundColor Yellow
    Write-Host "  Via site: https://pulso-extrefad.pages.dev/app/?server=$publicUrl" -ForegroundColor Cyan
    Write-Host "Mantenha esta janela aberta enquanto utilizar o tunel." -ForegroundColor Gray
    try { Set-Clipboard -Value $publicUrl } catch {}
} else {
    Write-Host "Tunel demorou para retornar URL. Consulte $logFile" -ForegroundColor Yellow
}

$proc.WaitForExit()
