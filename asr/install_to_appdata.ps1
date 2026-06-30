param(
    [string]$Destination = (Join-Path $env:APPDATA "com.atlas.app\asr")
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ExePath = Join-Path $ScriptDir "atlas-sorani-asr.exe"
$RuntimePath = Join-Path $ScriptDir "atlas_sorani_asr.py"
$VenvPath = Join-Path $ScriptDir ".venv"
$ModelsPath = Join-Path $ScriptDir "models"
$DestinationVenv = Join-Path $Destination ".venv"
$DestinationModels = Join-Path $Destination "models"

if (-not (Test-Path $ExePath)) {
    throw "atlas-sorani-asr.exe is missing. Run .\asr\build_windows.ps1 first."
}

if (-not (Test-Path $VenvPath)) {
    throw "ASR runtime is missing. Run .\asr\setup_runtime.ps1 first."
}

New-Item -ItemType Directory -Force -Path $Destination | Out-Null
Copy-Item -LiteralPath $ExePath -Destination (Join-Path $Destination "atlas-sorani-asr.exe") -Force
Copy-Item -LiteralPath $RuntimePath -Destination (Join-Path $Destination "atlas_sorani_asr.py") -Force

if (Test-Path $DestinationVenv) {
    Remove-Item -LiteralPath $DestinationVenv -Recurse -Force
}
Copy-Item -LiteralPath $VenvPath -Destination $Destination -Recurse -Force

if (Test-Path $ModelsPath) {
    if (Test-Path $DestinationModels) {
        Remove-Item -LiteralPath $DestinationModels -Recurse -Force
    }
    Copy-Item -LiteralPath $ModelsPath -Destination $Destination -Recurse -Force
}

Write-Host "Installed Atlas Sorani ASR sidecar to $Destination"
