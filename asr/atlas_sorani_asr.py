from __future__ import annotations

import argparse
import json
import os
import sys
import time
import wave
from pathlib import Path
from typing import Any

DEFAULT_MODEL_ID = "razhan/whisper-small-ckb"
TARGET_SAMPLE_RATE = 16_000
DEFAULT_SILENCE_RMS_THRESHOLD = 0.0005


def app_home() -> Path:
    env_home = os.environ.get("ATLAS_SORANI_ASR_HOME")
    if env_home:
        return Path(env_home).expanduser().resolve()
    return Path(__file__).resolve().parent


def configure_cache() -> None:
    home = app_home()
    model_cache = home / "models" / "hf-cache"
    model_cache.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("HF_HOME", str(model_cache))
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")


def stderr(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def read_wav_mono(path: Path) -> tuple["np.ndarray[Any, Any]", int]:
    import numpy as np

    with wave.open(str(path), "rb") as wav:
        channels = wav.getnchannels()
        sample_width = wav.getsampwidth()
        sample_rate = wav.getframerate()
        frame_count = wav.getnframes()
        raw = wav.readframes(frame_count)

    if sample_width != 2:
        raise ValueError(f"Expected 16-bit PCM WAV, got {sample_width * 8}-bit audio")

    audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)

    if sample_rate != TARGET_SAMPLE_RATE:
        audio = linear_resample(audio, sample_rate, TARGET_SAMPLE_RATE)
        sample_rate = TARGET_SAMPLE_RATE

    return audio, sample_rate


def linear_resample(audio: "np.ndarray[Any, Any]", source_rate: int, target_rate: int) -> "np.ndarray[Any, Any]":
    import numpy as np

    if source_rate == target_rate:
        return audio
    if audio.size == 0:
        return audio

    duration = audio.size / float(source_rate)
    target_length = max(1, int(round(duration * target_rate)))
    source_positions = np.linspace(0, audio.size - 1, num=audio.size)
    target_positions = np.linspace(0, audio.size - 1, num=target_length)
    return np.interp(target_positions, source_positions, audio).astype(np.float32)


def resolve_model(model_arg: str | None) -> str:
    if model_arg:
        return model_arg
    env_model = os.environ.get("ATLAS_SORANI_ASR_MODEL") or os.environ.get("ATLAS_SORANI_ASR_MODEL_ID")
    return env_model or DEFAULT_MODEL_ID


def silence_threshold() -> float:
    raw = os.environ.get("ATLAS_SORANI_ASR_SILENCE_RMS")
    if not raw:
        return DEFAULT_SILENCE_RMS_THRESHOLD
    try:
        return max(0.0, float(raw))
    except ValueError:
        return DEFAULT_SILENCE_RMS_THRESHOLD


def audio_rms(audio: "np.ndarray[Any, Any]") -> float:
    import numpy as np

    if audio.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(audio, dtype=np.float64))))


def load_model(model_ref: str) -> tuple[Any, Any, Any, str]:
    import torch
    from transformers import WhisperForConditionalGeneration, WhisperProcessor

    use_cuda = torch.cuda.is_available() and os.environ.get("ATLAS_SORANI_ASR_CPU_ONLY") != "1"
    device = "cuda" if use_cuda else "cpu"
    dtype = torch.float16 if use_cuda else torch.float32

    processor = WhisperProcessor.from_pretrained(model_ref)
    model = WhisperForConditionalGeneration.from_pretrained(
        model_ref,
        dtype=dtype,
        low_cpu_mem_usage=True,
        use_safetensors=True,
    )
    model.to(device)
    model.eval()

    return processor, model, torch, device


def decoder_prompt_ids(processor: Any, language: str) -> Any:
    # Whisper may not know "ckb" as a prompt language in every tokenizer build.
    # Sorani fine-tunes usually work best without forcing an unrelated language token.
    if language in {"ku", "kurdish"}:
        try:
            return processor.get_decoder_prompt_ids(language="ku", task="transcribe")
        except Exception:
            return None
    return None


def transcribe(audio_path: Path, model_ref: str, language: str) -> dict[str, Any]:
    configure_cache()
    started = time.perf_counter()
    audio, sample_rate = read_wav_mono(audio_path)
    if audio.size == 0:
        raise ValueError("Audio file has no samples")

    rms = audio_rms(audio)
    if rms < silence_threshold():
        return {
            "transcript": "",
            "language": language,
            "confidence": 0.0,
            "durationMs": round((time.perf_counter() - started) * 1000),
            "engine": "atlas-sorani-asr",
            "model": model_ref,
            "noSpeech": True,
            "rms": rms,
        }

    processor, model, torch, device = load_model(model_ref)
    inputs = processor(
        audio,
        sampling_rate=sample_rate,
        return_tensors="pt",
    )
    input_features = inputs.input_features.to(device)

    with torch.no_grad():
        forced_decoder_ids = decoder_prompt_ids(processor, language)
        generate_kwargs: dict[str, Any] = {
            "max_new_tokens": 128,
            "num_beams": 1,
        }
        if hasattr(inputs, "attention_mask"):
            generate_kwargs["attention_mask"] = inputs.attention_mask.to(device)
        if forced_decoder_ids is not None:
            generate_kwargs["forced_decoder_ids"] = forced_decoder_ids
        predicted_ids = model.generate(input_features, **generate_kwargs)

    transcript = processor.batch_decode(predicted_ids, skip_special_tokens=True)[0].strip()
    return {
        "transcript": transcript,
        "language": language,
        "confidence": None,
        "durationMs": round((time.perf_counter() - started) * 1000),
        "engine": "atlas-sorani-asr",
        "model": model_ref,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="atlas-sorani-asr",
        description="Local Sorani/Central Kurdish ASR sidecar for Atlas.",
    )
    parser.add_argument("--audio", type=Path, help="Path to a 16 kHz mono PCM WAV file.")
    parser.add_argument("--language", default="ckb", choices=["ckb", "ku", "sorani", "kurdish"])
    parser.add_argument("--model", help=f"Local model path or Hugging Face model id. Default: {DEFAULT_MODEL_ID}")
    parser.add_argument("--output-json", action="store_true", help="Emit JSON to stdout.")
    parser.add_argument("--warmup", action="store_true", help="Download/load the model and exit.")
    parser.add_argument("--version", action="version", version="atlas-sorani-asr 0.1.0")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    effective_argv = sys.argv[1:] if argv is None else argv
    if not effective_argv:
        parser.print_help()
        return 0

    args = parser.parse_args(effective_argv)
    model_ref = resolve_model(args.model)
    language = "ckb" if args.language in {"sorani", "kurdish"} else args.language

    try:
        if args.warmup:
            configure_cache()
            load_model(model_ref)
            result = {
                "ok": True,
                "engine": "atlas-sorani-asr",
                "model": model_ref,
                "cache": str(Path(os.environ["HF_HOME"]).resolve()),
            }
        else:
            if not args.audio:
                parser.error("--audio is required unless --warmup is used")
            if not args.audio.exists():
                raise FileNotFoundError(f"Audio file not found: {args.audio}")
            result = transcribe(args.audio, model_ref, language)

        if args.output_json or args.warmup:
            print(json.dumps(result, ensure_ascii=False), flush=True)
        else:
            print(result.get("transcript", ""), flush=True)
        return 0
    except ModuleNotFoundError as error:
        stderr(
            "Missing ASR dependency. Run .\\asr\\setup_runtime.ps1 first. "
            f"Missing module: {error.name}"
        )
        return 2
    except Exception as error:
        stderr(str(error))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
