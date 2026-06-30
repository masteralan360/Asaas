from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def executable_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def bundled_dir() -> Path:
    return Path(getattr(sys, "_MEIPASS", executable_dir())).resolve()


def runtime_script() -> Path:
    candidates = [
        executable_dir() / "atlas_sorani_asr.py",
        bundled_dir() / "atlas_sorani_asr.py",
    ]
    for path in candidates:
        if path.is_file():
            return path
    raise FileNotFoundError("atlas_sorani_asr.py was not found beside the sidecar executable")


def python_executable() -> Path:
    env_python = os.environ.get("ATLAS_SORANI_ASR_PYTHON")
    candidates = []
    if env_python:
        candidates.append(Path(env_python))

    root = executable_dir()
    if os.name == "nt":
        candidates.extend([
            root / ".venv" / "Scripts" / "python.exe",
            root / ".venv" / "Scripts" / "python3.exe",
            root / ".venv" / ".venv" / "Scripts" / "python.exe",
        ])
    else:
        candidates.extend([
            root / ".venv" / "bin" / "python3",
            root / ".venv" / "bin" / "python",
            root / ".venv" / ".venv" / "bin" / "python3",
        ])

    if not getattr(sys, "frozen", False):
        candidates.append(Path(sys.executable))

    for path in candidates:
        if path.is_file():
            return path

    raise FileNotFoundError(
        "Atlas Sorani ASR runtime is not installed. Run .\\asr\\setup_runtime.ps1 first."
    )


def main() -> int:
    root = executable_dir()
    env = os.environ.copy()
    env.setdefault("ATLAS_SORANI_ASR_HOME", str(root))
    env.setdefault("HF_HOME", str(root / "models" / "hf-cache"))
    env.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

    try:
        command = [str(python_executable()), str(runtime_script()), *sys.argv[1:]]
        completed = subprocess.run(command, env=env)
        return completed.returncode
    except Exception as error:
        print(str(error), file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
