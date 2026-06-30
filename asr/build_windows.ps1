param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ExePath = Join-Path $ScriptDir "atlas-sorani-asr.exe"
$BuildDir = Join-Path $ScriptDir ".build"
$RuntimeScript = Join-Path $ScriptDir "atlas_sorani_asr.py"

if ((Test-Path $ExePath) -and -not $Force) {
    Write-Host "atlas-sorani-asr.exe already exists. Use -Force to rebuild."
    exit 0
}

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    throw "Python is required to build the Atlas Sorani ASR launcher."
}

python -m pip install --upgrade pyinstaller

if (Test-Path $BuildDir) {
    Remove-Item -LiteralPath $BuildDir -Recurse -Force
}

python -m PyInstaller `
    --onefile `
    --name atlas-sorani-asr `
    --distpath $ScriptDir `
    --workpath (Join-Path $BuildDir "work") `
    --specpath $BuildDir `
    --add-data "${RuntimeScript};." `
    (Join-Path $ScriptDir "atlas_sorani_asr_launcher.py")

if (-not (Test-Path $ExePath)) {
    throw "Build completed but atlas-sorani-asr.exe was not created."
}

Write-Host "Created $ExePath"
