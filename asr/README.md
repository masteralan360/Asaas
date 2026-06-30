# Atlas Sorani ASR Sidecar

This folder builds the local executable expected by Atlas:

```powershell
.\asr\atlas-sorani-asr.exe --audio audio.wav --language ckb --output-json
```

The executable is a small launcher. The actual ASR runtime lives in a local Python virtual environment under `asr/.venv` and uses a Sorani/Central Kurdish Whisper model.

## Default Model

Default model: `razhan/whisper-small-ckb`

Reason: it is a Sorani/Central Kurdish Whisper-small model and its Hugging Face model card lists Apache-2.0. The model can be changed with `--model` or `ATLAS_SORANI_ASR_MODEL_ID`.

## Build on Windows

```powershell
.\asr\build_windows.ps1
.\asr\setup_runtime.ps1
```

`build_windows.ps1` creates `asr/atlas-sorani-asr.exe`.

`setup_runtime.ps1` creates `asr/.venv`, installs CPU PyTorch plus Transformers dependencies, and warms up/downloads the default model into `asr/models`.

For an installed Atlas desktop build, copy the sidecar into the app-data location Atlas checks:

```powershell
.\asr\install_to_appdata.ps1
```

## Runtime Layout

Generated local files are intentionally ignored by Git:

```text
asr/atlas-sorani-asr.exe
asr/.venv/
asr/models/
asr/.build/
```

Atlas can also use an external sidecar by setting:

```powershell
$env:ATLAS_SORANI_ASR_EXE = "C:\path\to\atlas-sorani-asr.exe"
$env:ATLAS_SORANI_ASR_MODEL = "C:\path\to\local\model"
```

## Output Contract

```json
{
  "transcript": "ئەم مانگە داهاتم چەند بوو؟",
  "language": "ckb",
  "confidence": null,
  "durationMs": 1234,
  "engine": "atlas-sorani-asr"
}
```

Quiet audio is filtered before model inference. If the RMS level is below `ATLAS_SORANI_ASR_SILENCE_RMS` or the default threshold, the sidecar returns an empty transcript with `"noSpeech": true`.
