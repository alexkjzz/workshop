[CmdletBinding()]
param(
    [switch]$CoreOnly,
    [switch]$SkipNodeInstall,
    [switch]$SkipPythonInstall
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE" }
}

function New-LocalSecret {
    $bytes = New-Object byte[] 32
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    return [Convert]::ToBase64String($bytes)
}

Push-Location -LiteralPath $projectRoot
try {
    $nodeVersion = (& node --version).TrimStart('v')
    if ($LASTEXITCODE -ne 0 -or [version]$nodeVersion -lt [version]'22.13.0') {
        throw 'Install Node.js 22.13+ (24 LTS recommended).'
    }

    $backendEnv = Join-Path $projectRoot 'iot-backend/.env'
    if (-not (Test-Path -LiteralPath $backendEnv)) {
        $contents = Get-Content -LiteralPath 'iot-backend/.env.example' -Raw
        $contents = $contents.Replace('BETTER_AUTH_SECRET=', ('BETTER_AUTH_SECRET=' + (New-LocalSecret)))
        [System.IO.File]::WriteAllText($backendEnv, $contents, (New-Object System.Text.UTF8Encoding $false))
    }
    $aiEnv = Join-Path $projectRoot 'ai/.env'
    if (-not (Test-Path -LiteralPath $aiEnv)) {
        Copy-Item -LiteralPath 'ai/.env.example' -Destination $aiEnv
    }

    if (-not $SkipNodeInstall) {
        Invoke-Checked 'npm.cmd' @('--prefix', 'iot-backend', 'ci')
        Invoke-Checked 'npm.cmd' @('--prefix', 'iot-frontend', 'ci')
    }

    $aiPython = Join-Path $projectRoot 'ai/.venv/Scripts/python.exe'
    if (-not (Test-Path -LiteralPath $aiPython)) {
        Invoke-Checked 'py' @('-3.12', '-m', 'venv', 'ai/.venv')
    }
    if (-not $SkipPythonInstall) {
        Invoke-Checked $aiPython @('-m', 'pip', 'install', '--upgrade', 'pip')
        $requirements = if ($CoreOnly) { 'ai/requirements-core.txt' } else { 'ai/requirements.txt' }
        Invoke-Checked $aiPython @('-m', 'pip', 'install', '-r', $requirements)
        Invoke-Checked $aiPython @('-m', 'pip', 'install', '-r', 'scripts/requirements-esp.txt')
    }
    Write-Host 'Configuration locale prete. Aucun simulateur ni service lance.'
    Write-Host 'Voir ai/README.md pour demarrer backend, frontend et IA dans trois terminaux.'
} finally {
    Pop-Location
}
