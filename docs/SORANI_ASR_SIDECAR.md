# Atlas Sorani ASR Sidecar Contract

Atlas voice-to-text is local-only. The desktop app records a short Sorani Kurdish question as 16 kHz mono PCM WAV, writes it to a temporary file, and calls a local executable.

## Engine Discovery

Atlas looks for the executable in this order:

1. `ATLAS_SORANI_ASR_EXE`
2. `<Atlas app data>/asr/atlas-sorani-asr(.exe)`
3. `<Atlas resources>/asr/atlas-sorani-asr(.exe)`
4. `<Atlas executable directory>/asr/atlas-sorani-asr(.exe)`
5. `<current working directory>/asr/atlas-sorani-asr(.exe)`

Optional model path:

1. `ATLAS_SORANI_ASR_MODEL`
2. `<engine directory>/models/sorani-ckb`

## Required CLI

```bash
atlas-sorani-asr --audio <16khz-mono-wav> --language ckb --output-json [--model <path>]
```

The process must exit with code `0` and write either JSON or plain transcript text to stdout.

Preferred JSON:

```json
{
  "transcript": "ئەم مانگە داهاتم چەند بوو؟",
  "language": "ckb",
  "confidence": 0.91,
  "engine": "atlas-sorani-asr"
}
```

`text` is accepted as an alias for `transcript`.

## Runtime Limits

- Audio payload limit: 16 MB
- Inference timeout: 60 seconds
- No network/API calls from Atlas
- Atlas does not mutate ERP data from voice results; the transcript is reviewed in the assistant input before sending

## Bundled Sidecar

The repo includes a Windows sidecar builder in `asr/`.

```powershell
.\asr\build_windows.ps1
.\asr\setup_runtime.ps1
```

The generated `asr/atlas-sorani-asr.exe`, Python virtual environment, and model cache are local artifacts and are ignored by Git.
