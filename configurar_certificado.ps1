<#
.SYNOPSIS
    Configura seu Certificado Oficial (.p12 + .mobileprovision + senha) nos Secrets do GitHub
    e dispara a compilacao e assinatura automatica no GitHub Actions.
#>

param(
    [string]$P12Path,
    [string]$ProvisionPath,
    [string]$Password,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$Repo = 'dafert/pulso-ios'

function Find-GhCli {
    $candidates = @(
        'C:\Program Files\GitHub CLI\gh.exe',
        'C:\Program Files (x86)\GitHub CLI\gh.exe'
    )
    foreach ($c in $candidates) {
        if (Test-Path -LiteralPath $c) { return $c }
    }
    $cmd = Get-Command gh -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

function Select-FileWithDialog {
    param(
        [string]$Title,
        [string]$Filter,
        [string]$InitialDirectory
    )
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $owner = New-Object System.Windows.Forms.Form
        $owner.TopMost = $true
        $owner.StartPosition = 'CenterScreen'
        $owner.WindowState = 'Minimized'
        $owner.ShowInTaskbar = $false

        $dialog = New-Object System.Windows.Forms.OpenFileDialog
        $dialog.Title = $Title
        $dialog.Filter = $Filter
        if ($InitialDirectory -and (Test-Path -LiteralPath $InitialDirectory)) {
            $dialog.InitialDirectory = $InitialDirectory
        }
        $dialog.CheckFileExists = $true

        $result = $dialog.ShowDialog($owner)
        $selected = $null
        if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
            $selected = $dialog.FileName
        }
        $dialog.Dispose()
        $owner.Dispose()
        return $selected
    } catch {
        return $null
    }
}

function Read-FilePath {
    param(
        [string]$CurrentValue,
        [string]$Label,
        [string]$Filter
    )
    $path = $CurrentValue
    if (-not $path) {
        Write-Host "Abrindo seletor para: $Label ..." -ForegroundColor Cyan
        $path = Select-FileWithDialog -Title "Selecione o arquivo $Label" -Filter $Filter -InitialDirectory $PSScriptRoot
    }
    if (-not $path) {
        Write-Host "Se preferir, arraste o arquivo $Label aqui na janela e aperte Enter:" -ForegroundColor Yellow
        $path = Read-Host "Caminho do arquivo $Label"
    }
    if ($path) {
        $path = $path.Trim().Trim('"').Trim("'")
    }
    if (-not $path -or -not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Arquivo $Label nao encontrado: $path"
    }
    return (Resolve-Path -LiteralPath $path).Path
}

function Set-GitHubSecret {
    param(
        [string]$GhPath,
        [string]$TargetRepo,
        [string]$SecretName,
        [string]$SecretValue,
        [switch]$NoStore
    )
    $argsList = "secret set $SecretName --repo $TargetRepo"
    if ($NoStore) {
        $argsList += " --no-store"
    }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $GhPath
    $psi.Arguments = $argsList
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    [void]$proc.Start()

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $bytes = $utf8NoBom.GetBytes($SecretValue)
    $proc.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
    $proc.StandardInput.BaseStream.Flush()
    $proc.StandardInput.Close()

    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    if ($proc.ExitCode -ne 0) {
        throw "Erro ao enviar secret $SecretName (codigo $($proc.ExitCode)): $stderr $stdout"
    }
}

try {
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "   Configurador de Certificado Oficial - Pulso iOS" -ForegroundColor Yellow
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host ""

    $ghCli = Find-GhCli
    if (-not $ghCli) {
        throw "GitHub CLI (gh.exe) nao encontrado. Instale em https://cli.github.com"
    }

    & $ghCli auth status *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "Voce nao esta logado no GitHub CLI. Rode 'gh auth login' primeiro."
    }

    $P12Path = Read-FilePath -CurrentValue $P12Path -Label ".p12" -Filter "Certificado P12 (*.p12)|*.p12|Todos os arquivos (*.*)|*.*"
    Write-Host "  OK .p12: $P12Path" -ForegroundColor Green

    $ProvisionPath = Read-FilePath -CurrentValue $ProvisionPath -Label ".mobileprovision" -Filter "Provisioning Profile (*.mobileprovision)|*.mobileprovision|Todos os arquivos (*.*)|*.*"
    Write-Host "  OK .mobileprovision: $ProvisionPath" -ForegroundColor Green

    if (-not $PSBoundParameters.ContainsKey('Password')) {
        $Password = Read-Host "Digite a senha do certificado .p12 (deixe vazio se nao tiver)"
    }

    Write-Host ""
    Write-Host "[1/4] Codificando arquivos em Base64..." -ForegroundColor Cyan
    $p12Bytes = [System.IO.File]::ReadAllBytes($P12Path)
    if ($p12Bytes.Length -eq 0) { throw "O arquivo .p12 esta vazio." }
    $p12Base64 = [Convert]::ToBase64String($p12Bytes)

    $provBytes = [System.IO.File]::ReadAllBytes($ProvisionPath)
    if ($provBytes.Length -eq 0) { throw "O arquivo .mobileprovision esta vazio." }
    $provBase64 = [Convert]::ToBase64String($provBytes)

    Write-Host "[2/4] Enviando Secrets criptografados para $Repo ..." -ForegroundColor Cyan
    Set-GitHubSecret -GhPath $ghCli -TargetRepo $Repo -SecretName 'IOS_P12_BASE64' -SecretValue $p12Base64 -NoStore:$DryRun
    Set-GitHubSecret -GhPath $ghCli -TargetRepo $Repo -SecretName 'IOS_PROVISION_BASE64' -SecretValue $provBase64 -NoStore:$DryRun
    Set-GitHubSecret -GhPath $ghCli -TargetRepo $Repo -SecretName 'IOS_P12_PASSWORD' -SecretValue $Password -NoStore:$DryRun

    Write-Host "[3/4] Secrets configurados com sucesso!" -ForegroundColor Green

    if ($DryRun) {
        Write-Host "[4/4] Modo DryRun concluido (nenhum secret salvo, build nao disparado)." -ForegroundColor Yellow
        exit 0
    }

    Write-Host "[4/4] Disparando compilacao e assinatura no GitHub Actions..." -ForegroundColor Cyan
    & $ghCli workflow run build-ipa.yml --repo $Repo
    if ($LASTEXITCODE -ne 0) {
        throw "Os Secrets foram salvos, mas falhou ao iniciar o workflow build-ipa.yml."
    }

    Write-Host ""
    Write-Host "==========================================================" -ForegroundColor Green
    Write-Host " TUDO PRONTO!" -ForegroundColor Green
    Write-Host " O GitHub Actions esta compilando e assinando seu app." -ForegroundColor White
    Write-Host " Acompanhe em: https://github.com/dafert/pulso-ios/actions" -ForegroundColor Cyan
    Write-Host " Em ~1 minuto, instale no Safari do iPhone em:" -ForegroundColor White
    Write-Host " https://dafert.github.io/pulso-ios/" -ForegroundColor Yellow
    Write-Host "==========================================================" -ForegroundColor Green
    exit 0
} catch {
    Write-Host ""
    Write-Host "[ERRO] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
