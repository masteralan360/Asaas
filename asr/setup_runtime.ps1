param(
    [string]$Model = "razhan/whisper-small-ckb",
    [switch]$SkipModelWarmup,
    [switch]$UseCudaTorch
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvDir = Join-Path $ScriptDir ".venv"
$PythonExe = Join-Path $VenvDir "Scripts\python.exe"

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    throw "Python is required to install the Atlas Sorani ASR runtime."
}

if (-not (Test-Path $PythonExe)) {
    python -m venv $VenvDir
}

& $PythonExe -m pip install --upgrade pip

if ($UseCudaTorch) {
    & $PythonExe -m pip install torch
} else {
    & $PythonExe -m pip install torch --index-url https://download.pytorch.org/whl/cpu
}

& $PythonExe -m pip install -r (Join-Path $ScriptDir "requirements.txt")

if (-not $SkipModelWarmup) {
    $env:ATLAS_SORANI_ASR_HOME = $ScriptDir
    & $PythonExe (Join-Path $ScriptDir "atlas_sorani_asr.py") --warmup --model $Model --output-json
}

Write-Host "Atlas Sorani ASR runtime is ready."
