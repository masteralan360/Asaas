use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tokio::process::Command;
use tokio::time::timeout;

const MAX_AUDIO_BYTES: usize = 16 * 1024 * 1024;
const EXPECTED_INTERFACE: &str =
    "atlas-sorani-asr --audio <16khz-mono-wav> --language ckb --output-json [--model <path>]";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoraniAsrStatus {
    available: bool,
    status: &'static str,
    message: String,
    engine_path: Option<String>,
    model_path: Option<String>,
    expected_interface: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoraniAsrTranscript {
    transcript: String,
    language: String,
    confidence: Option<f32>,
    duration_ms: Option<u64>,
    engine: Option<String>,
}

#[derive(Deserialize)]
struct EngineJsonOutput {
    transcript: Option<String>,
    text: Option<String>,
    language: Option<String>,
    confidence: Option<f32>,
    engine: Option<String>,
}

fn engine_file_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "atlas-sorani-asr.exe"
    } else {
        "atlas-sorani-asr"
    }
}

fn non_empty_env_path(name: &str) -> Option<PathBuf> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn candidate_engine_paths(app: &AppHandle) -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Some(path) = non_empty_env_path("ATLAS_SORANI_ASR_EXE") {
        paths.push(path);
    }

    if let Ok(app_data_dir) = app.path().app_data_dir() {
        paths.push(app_data_dir.join("asr").join(engine_file_name()));
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        paths.push(resource_dir.join("asr").join(engine_file_name()));
    }

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            paths.push(parent.join("asr").join(engine_file_name()));
        }
    }

    if let Ok(current_dir) = std::env::current_dir() {
        paths.push(current_dir.join("asr").join(engine_file_name()));
    }

    paths
}

fn resolve_engine_path(app: &AppHandle) -> Option<PathBuf> {
    candidate_engine_paths(app)
        .into_iter()
        .find(|path| path.is_file())
}

fn resolve_model_path(engine_path: &Path) -> Option<PathBuf> {
    if let Some(path) = non_empty_env_path("ATLAS_SORANI_ASR_MODEL") {
        if path.exists() {
            return Some(path);
        }
    }

    engine_path
        .parent()
        .map(|parent| parent.join("models").join("sorani-ckb"))
        .filter(|path| path.exists())
}

fn status_from_paths(engine_path: Option<PathBuf>) -> SoraniAsrStatus {
    match engine_path {
        Some(engine_path) => {
            let model_path = resolve_model_path(&engine_path);
            SoraniAsrStatus {
                available: true,
                status: "available",
                message: "Local Sorani voice-to-text engine is installed.".to_string(),
                engine_path: Some(engine_path.to_string_lossy().to_string()),
                model_path: model_path.map(|path| path.to_string_lossy().to_string()),
                expected_interface: Some(EXPECTED_INTERFACE.to_string()),
            }
        }
        None => SoraniAsrStatus {
            available: false,
            status: "engine_not_installed",
            message: format!(
                "Sorani voice-to-text engine is not installed. Add {} under the Atlas app data asr folder, bundle it as an app resource, or set ATLAS_SORANI_ASR_EXE.",
                engine_file_name()
            ),
            engine_path: None,
            model_path: None,
            expected_interface: Some(EXPECTED_INTERFACE.to_string()),
        },
    }
}

fn resolve_status(app: &AppHandle) -> SoraniAsrStatus {
    status_from_paths(resolve_engine_path(app))
}

fn decode_audio(audio_base64: &str) -> Result<Vec<u8>, String> {
    let bytes = general_purpose::STANDARD
        .decode(audio_base64.as_bytes())
        .map_err(|error| format!("Invalid audio payload: {}", error))?;

    if bytes.is_empty() {
        return Err("Audio payload is empty.".to_string());
    }

    if bytes.len() > MAX_AUDIO_BYTES {
        return Err("Audio payload is too large for local Sorani transcription.".to_string());
    }

    Ok(bytes)
}

fn temp_audio_path(app: &AppHandle) -> Result<PathBuf, String> {
    let base_dir = app
        .path()
        .app_cache_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|error| format!("Failed to locate Atlas cache directory: {}", error))?
        .join("assistant-asr");
    fs::create_dir_all(&base_dir)
        .map_err(|error| format!("Failed to prepare ASR cache directory: {}", error))?;

    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();

    Ok(base_dir.join(format!("sorani-question-{}.wav", now_ms)))
}

fn parse_engine_output(
    stdout: &str,
    engine_path: &Path,
    elapsed: Duration,
) -> Result<SoraniAsrTranscript, String> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Err("Local Sorani ASR engine returned an empty response.".to_string());
    }

    if let Ok(parsed) = serde_json::from_str::<EngineJsonOutput>(trimmed) {
        let transcript = parsed
            .transcript
            .or(parsed.text)
            .unwrap_or_default()
            .trim()
            .to_string();

        if transcript.is_empty() {
            return Err(
                "Local Sorani ASR engine returned JSON without transcript text.".to_string(),
            );
        }

        return Ok(SoraniAsrTranscript {
            transcript,
            language: parsed.language.unwrap_or_else(|| "ckb".to_string()),
            confidence: parsed.confidence,
            duration_ms: Some(elapsed.as_millis() as u64),
            engine: parsed.engine.or_else(|| {
                engine_path
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
            }),
        });
    }

    Ok(SoraniAsrTranscript {
        transcript: trimmed.to_string(),
        language: "ckb".to_string(),
        confidence: None,
        duration_ms: Some(elapsed.as_millis() as u64),
        engine: engine_path
            .file_name()
            .map(|name| name.to_string_lossy().to_string()),
    })
}

#[tauri::command]
pub fn atlas_assistant_sorani_asr_status(app: AppHandle) -> SoraniAsrStatus {
    resolve_status(&app)
}

#[tauri::command]
pub async fn atlas_assistant_transcribe_sorani(
    app: AppHandle,
    audio_base64: String,
    mime_type: Option<String>,
) -> Result<SoraniAsrTranscript, String> {
    if let Some(mime_type) = mime_type.as_deref() {
        if mime_type != "audio/wav" && mime_type != "audio/x-wav" {
            return Err(format!(
                "Unsupported Sorani ASR audio format: {}",
                mime_type
            ));
        }
    }

    let status = resolve_status(&app);
    if !status.available {
        return Err(status.message);
    }

    let engine_path = resolve_engine_path(&app)
        .ok_or_else(|| "Sorani voice-to-text engine is not installed.".to_string())?;
    let model_path = resolve_model_path(&engine_path);
    let audio_bytes = decode_audio(&audio_base64)?;
    let audio_path = temp_audio_path(&app)?;
    fs::write(&audio_path, audio_bytes)
        .map_err(|error| format!("Failed to write temporary Sorani audio: {}", error))?;

    let started = Instant::now();
    let mut command = Command::new(&engine_path);
    command
        .arg("--audio")
        .arg(&audio_path)
        .arg("--language")
        .arg("ckb")
        .arg("--output-json")
        .kill_on_drop(true);

    if let Some(model_path) = model_path {
        command.arg("--model").arg(model_path);
    }

    let output = timeout(Duration::from_secs(60), command.output())
        .await
        .map_err(|_| "Local Sorani ASR engine timed out after 60 seconds.".to_string())?
        .map_err(|error| format!("Failed to run local Sorani ASR engine: {}", error));

    let _ = fs::remove_file(&audio_path);

    let output = output?;
    let elapsed = started.elapsed();

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("Local Sorani ASR engine failed: {}", stdout)
        } else {
            format!("Local Sorani ASR engine failed: {}", stderr)
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_engine_output(&stdout, &engine_path, elapsed)
}
