use base64::{engine::general_purpose, Engine as _};
use futures_util::{SinkExt, StreamExt};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::time::{sleep, timeout};
use tokio_tungstenite::{connect_async, tungstenite::Message};

const KURDISHTTS_URL: &str = "https://www.kurdishtts.com/";
const MAX_AUDIO_BYTES: usize = 5 * 1024 * 1024;
const BROWSER_START_TIMEOUT: Duration = Duration::from_secs(20);
const PAGE_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(Serialize)]
pub struct KurdishTtsWebsiteStatus {
    available: bool,
    status: String,
    message: String,
    browser_path: Option<String>,
}

#[derive(Serialize)]
pub struct KurdishTtsWebsiteTranscript {
    transcript: String,
    duration_ms: Option<u64>,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub async fn atlas_assistant_kurdishtts_website_status() -> KurdishTtsWebsiteStatus {
    match find_browser_executable() {
        Some(path) => KurdishTtsWebsiteStatus {
            available: true,
            status: "available".to_string(),
            message: "KurdishTTS website transcription is available.".to_string(),
            browser_path: Some(path.to_string_lossy().to_string()),
        },
        None => KurdishTtsWebsiteStatus {
            available: false,
            status: "browser_unavailable".to_string(),
            message:
                "Microsoft Edge or Google Chrome is required for background website transcription."
                    .to_string(),
            browser_path: None,
        },
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
pub async fn atlas_assistant_kurdishtts_website_status() -> KurdishTtsWebsiteStatus {
    KurdishTtsWebsiteStatus {
        available: false,
        status: "desktop_only".to_string(),
        message: "Voice-to-text is available only in the Tauri desktop app.".to_string(),
        browser_path: None,
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub async fn atlas_assistant_transcribe_kurdishtts_website(
    audio_base64: String,
    mime_type: String,
    duration_ms: Option<u64>,
) -> Result<KurdishTtsWebsiteTranscript, String> {
    let browser_path = find_browser_executable().ok_or_else(|| {
        "Microsoft Edge or Google Chrome is required for background website transcription."
            .to_string()
    })?;

    let audio_bytes = decode_audio_base64(&audio_base64)?;
    if audio_bytes.is_empty() {
        return Err("No recorded audio was captured.".to_string());
    }
    if audio_bytes.len() > MAX_AUDIO_BYTES {
        return Err("Recorded audio is larger than the KurdishTTS 5 MB upload limit.".to_string());
    }

    let run_id = current_millis();
    let run_dir = std::env::temp_dir()
        .join("atlas-kurdishtts-stt")
        .join(run_id.to_string());
    let profile_dir = run_dir.join("browser-profile");
    fs::create_dir_all(&profile_dir)
        .map_err(|e| format!("Failed to create transcription temp folder: {e}"))?;

    let audio_path = run_dir.join(format!("atlas-voice.{}", extension_for_mime(&mime_type)));
    fs::write(&audio_path, audio_bytes)
        .map_err(|e| format!("Failed to save recorded audio: {e}"))?;

    let result =
        transcribe_with_browser(browser_path, &profile_dir, &audio_path, duration_ms).await;

    let _ = fs::remove_file(&audio_path);
    let _ = fs::remove_dir_all(&run_dir);

    result
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
pub async fn atlas_assistant_transcribe_kurdishtts_website(
    _audio_base64: String,
    _mime_type: String,
    _duration_ms: Option<u64>,
) -> Result<KurdishTtsWebsiteTranscript, String> {
    Err("Voice-to-text is available only in the Tauri desktop app.".to_string())
}

fn decode_audio_base64(audio_base64: &str) -> Result<Vec<u8>, String> {
    let payload = audio_base64
        .split_once(',')
        .map(|(_, value)| value)
        .unwrap_or(audio_base64)
        .trim();

    general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| format!("Recorded audio could not be decoded: {e}"))
}

fn extension_for_mime(mime_type: &str) -> &'static str {
    let normalized = mime_type.to_ascii_lowercase();
    if normalized.contains("wav") {
        "wav"
    } else if normalized.contains("mpeg") || normalized.contains("mp3") {
        "mp3"
    } else if normalized.contains("mp4") || normalized.contains("m4a") {
        "m4a"
    } else if normalized.contains("ogg") {
        "ogg"
    } else {
        "webm"
    }
}

fn current_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn transcribe_with_browser(
    browser_path: PathBuf,
    profile_dir: &Path,
    audio_path: &Path,
    duration_ms: Option<u64>,
) -> Result<KurdishTtsWebsiteTranscript, String> {
    let port = pick_free_port()?;
    let mut browser = spawn_browser(&browser_path, profile_dir, port)?;

    let run_result = async {
        let page_ws_url = wait_for_page_websocket(port).await?;
        let mut cdp = CdpClient::connect(&page_ws_url).await?;
        cdp.call("Page.enable", json!({})).await?;
        cdp.call("DOM.enable", json!({})).await?;
        cdp.call("Runtime.enable", json!({})).await?;

        wait_for_document_ready(&mut cdp).await?;
        click_speech_to_text(&mut cdp).await?;
        click_sorani(&mut cdp).await?;
        set_audio_file(&mut cdp, audio_path).await?;
        click_convert_to_text(&mut cdp).await?;
        let transcript = wait_for_transcript(&mut cdp).await?;

        Ok(KurdishTtsWebsiteTranscript {
            transcript,
            duration_ms,
        })
    }
    .await;

    terminate_browser(&mut browser);
    run_result
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn pick_free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to reserve a local browser debugging port: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to read local browser debugging port: {e}"))?
        .port();
    drop(listener);
    Ok(port)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn spawn_browser(browser_path: &Path, profile_dir: &Path, port: u16) -> Result<Child, String> {
    let mut command = Command::new(browser_path);
    command
        .arg(format!("--remote-debugging-port={port}"))
        .arg(format!("--user-data-dir={}", profile_dir.to_string_lossy()))
        .arg("--headless=new")
        .arg("--disable-gpu")
        .arg("--disable-extensions")
        .arg("--disable-background-networking")
        .arg("--disable-sync")
        .arg("--mute-audio")
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--window-size=1280,900")
        .arg(KURDISHTTS_URL)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    command
        .spawn()
        .map_err(|e| format!("Failed to start background browser automation: {e}"))
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn terminate_browser(browser: &mut Child) {
    match browser.try_wait() {
        Ok(Some(_)) => {}
        _ => {
            let _ = browser.kill();
            let _ = browser.wait();
        }
    }
}

#[derive(Deserialize)]
struct ChromeTarget {
    #[serde(rename = "type")]
    target_type: Option<String>,
    url: Option<String>,
    #[serde(rename = "webSocketDebuggerUrl")]
    web_socket_debugger_url: Option<String>,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
async fn wait_for_page_websocket(port: u16) -> Result<String, String> {
    let client = Client::new();
    let endpoint = format!("http://127.0.0.1:{port}/json");

    let targets = timeout(BROWSER_START_TIMEOUT, async {
        loop {
            if let Ok(response) = client.get(&endpoint).send().await {
                if response.status().is_success() {
                    if let Ok(targets) = response.json::<Vec<ChromeTarget>>().await {
                        if let Some(ws_url) = targets
                            .iter()
                            .find(|target| {
                                target.target_type.as_deref() == Some("page")
                                    && target
                                        .url
                                        .as_deref()
                                        .unwrap_or_default()
                                        .contains("kurdishtts.com")
                            })
                            .and_then(|target| target.web_socket_debugger_url.clone())
                        {
                            return Ok(ws_url);
                        }
                    }
                }
            }
            sleep(Duration::from_millis(250)).await;
        }
    })
    .await;

    targets.map_err(|_| "Timed out while starting the background browser.".to_string())?
}

struct CdpClient {
    socket: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    next_id: u64,
}

impl CdpClient {
    async fn connect(ws_url: &str) -> Result<Self, String> {
        let (socket, _) = connect_async(ws_url)
            .await
            .map_err(|e| format!("Failed to connect to browser automation: {e}"))?;
        Ok(Self { socket, next_id: 0 })
    }

    async fn call(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.next_id += 1;
        let id = self.next_id;
        let message = json!({
            "id": id,
            "method": method,
            "params": params,
        });

        self.socket
            .send(Message::Text(message.to_string()))
            .await
            .map_err(|e| format!("Failed to send browser automation command: {e}"))?;

        while let Some(message) = self.socket.next().await {
            let message =
                message.map_err(|e| format!("Browser automation connection failed: {e}"))?;
            let Message::Text(text) = message else {
                continue;
            };

            let value: Value = serde_json::from_str(&text)
                .map_err(|e| format!("Browser automation returned invalid data: {e}"))?;
            if value.get("id").and_then(Value::as_u64) != Some(id) {
                continue;
            }

            if let Some(error) = value.get("error") {
                return Err(format!("Browser automation error in {method}: {error}"));
            }

            return Ok(value.get("result").cloned().unwrap_or(Value::Null));
        }

        Err("Browser automation connection closed unexpectedly.".to_string())
    }

    async fn evaluate(&mut self, expression: &str, await_promise: bool) -> Result<Value, String> {
        let result = self
            .call(
                "Runtime.evaluate",
                json!({
                    "expression": expression,
                    "awaitPromise": await_promise,
                    "returnByValue": true,
                    "userGesture": true,
                }),
            )
            .await?;

        if let Some(exception) = result.get("exceptionDetails") {
            return Err(format!("Website automation script failed: {exception}"));
        }

        Ok(result
            .get("result")
            .and_then(|value| value.get("value"))
            .cloned()
            .unwrap_or(Value::Null))
    }
}

async fn wait_for_document_ready(cdp: &mut CdpClient) -> Result<(), String> {
    timeout(Duration::from_secs(30), async {
        loop {
            let is_ready = cdp
                .evaluate(
                    r#"
(() => {
  return Boolean(document.body) && ["interactive", "complete"].includes(document.readyState);
})()
"#,
                    false,
                )
                .await?
                .as_bool()
                .unwrap_or(false);
            if is_ready {
                return Ok(());
            }
            sleep(Duration::from_millis(250)).await;
        }
    })
    .await
    .map_err(|_| "Timed out while loading KurdishTTS.".to_string())?
}

async fn click_speech_to_text(cdp: &mut CdpClient) -> Result<(), String> {
    let result = timeout(Duration::from_secs(25), async {
        loop {
            let value = cdp
                .evaluate(
                    r#"
(() => {
  const normalize = (value) => (value || "").replace(/\s+/g, " ").trim();
  const bodyText = document.body?.innerText || "";
  if (document.querySelector("input[type='file']") || bodyText.includes("Click to upload or drag")) {
    return { ready: true };
  }

  const candidates = Array.from(document.querySelectorAll("span, button, [role='tab'], [role='button']"))
    .filter((element) => normalize(element.textContent) === "Speech to Text")
    .map((element) => element.closest("button, [role='tab'], [role='button']") || element)
    .filter((element, index, all) => element && all.indexOf(element) === index);

  const target = candidates.find((element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    const text = normalize(element.textContent);
    return text === "Speech to Text"
      && rect.width > 0
      && rect.height > 0
      && rect.top >= 0
      && rect.top < Math.max(520, window.innerHeight * 0.65)
      && style.display !== "none"
      && style.visibility !== "hidden";
  });

  if (!target) {
    return { ready: false, found: false };
  }

  target.scrollIntoView({ block: "center", inline: "center" });
  const rect = target.getBoundingClientRect();
  return {
    ready: false,
    found: true,
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    text: normalize(target.textContent)
  };
})()
"#,
                    false,
                )
                .await?;

            if value.get("ready").and_then(Value::as_bool) == Some(true) {
                return Ok::<(), String>(());
            }

            let x = value.get("x").and_then(Value::as_f64);
            let y = value.get("y").and_then(Value::as_f64);
            if let (Some(x), Some(y)) = (x, y) {
                dispatch_mouse_click(cdp, x, y).await?;
            }

            sleep(Duration::from_millis(700)).await;
        }
    })
    .await;

    match result {
        Ok(Ok(())) => Ok(()),
        Ok(Err(error)) => Err(step_error(cdp, "select Speech to Text", &error).await),
        Err(_) => Err(step_error(cdp, "select Speech to Text", "timed out").await),
    }
}

async fn dispatch_mouse_click(cdp: &mut CdpClient, x: f64, y: f64) -> Result<(), String> {
    cdp.call(
        "Input.dispatchMouseEvent",
        json!({
            "type": "mouseMoved",
            "x": x,
            "y": y,
        }),
    )
    .await?;

    cdp.call(
        "Input.dispatchMouseEvent",
        json!({
            "type": "mousePressed",
            "x": x,
            "y": y,
            "button": "left",
            "clickCount": 1,
        }),
    )
    .await?;

    cdp.call(
        "Input.dispatchMouseEvent",
        json!({
            "type": "mouseReleased",
            "x": x,
            "y": y,
            "button": "left",
            "clickCount": 1,
        }),
    )
    .await?;

    Ok(())
}

async fn click_sorani(cdp: &mut CdpClient) -> Result<(), String> {
    let clicked = wait_for_truthy(
        cdp,
        r#"
(() => {
  const normalize = (value) => (value || "").replace(/\s+/g, " ").trim();
  const button = Array.from(document.querySelectorAll("button"))
    .find((element) => normalize(element.textContent).includes("Sorani"));
  const bodyText = document.body?.innerText || "";
  if (!button && (document.querySelector("input[type='file']") || bodyText.includes("Click to upload or drag"))) {
    return true;
  }
  if (!button) return false;
  button.click();
  return true;
})()
"#,
        Duration::from_secs(20),
        "select Sorani dialect",
    )
    .await?;

    if clicked {
        Ok(())
    } else {
        Err("Could not select the KurdishTTS Sorani dialect.".to_string())
    }
}

async fn set_audio_file(cdp: &mut CdpClient, audio_path: &Path) -> Result<(), String> {
    let marked = wait_for_truthy(
        cdp,
        r#"
(() => {
  const input = document.querySelector("input[type='file']");
  if (input) {
    input.setAttribute("data-atlas-stt-file-input", "true");
    return true;
  }

  const uploadText = Array.from(document.querySelectorAll("p, div, button"))
    .find((element) => (element.textContent || "").includes("Click to upload or drag"));
  const target = uploadText?.closest("label, button, [role='button'], div.relative") || uploadText;
  target?.click();
  return false;
})()
"#,
        Duration::from_secs(20),
        "find audio upload input",
    )
    .await?;

    if !marked {
        return Err("Could not find the KurdishTTS upload input.".to_string());
    }

    let document = cdp.call("DOM.getDocument", json!({})).await?;
    let root_node_id = document
        .get("root")
        .and_then(|root| root.get("nodeId"))
        .and_then(Value::as_u64)
        .ok_or_else(|| "Could not inspect the KurdishTTS upload form.".to_string())?;

    let input = cdp
        .call(
            "DOM.querySelector",
            json!({
                "nodeId": root_node_id,
                "selector": "[data-atlas-stt-file-input='true']",
            }),
        )
        .await?;
    let node_id = input
        .get("nodeId")
        .and_then(Value::as_u64)
        .filter(|value| *value > 0)
        .ok_or_else(|| "Could not attach the recorded audio to KurdishTTS.".to_string())?;

    cdp.call(
        "DOM.setFileInputFiles",
        json!({
            "nodeId": node_id,
            "files": [audio_path.to_string_lossy().to_string()],
        }),
    )
    .await?;

    sleep(Duration::from_millis(500)).await;
    Ok(())
}

async fn click_convert_to_text(cdp: &mut CdpClient) -> Result<(), String> {
    let clicked = wait_for_truthy(
        cdp,
        r#"
(() => {
  const normalize = (value) => (value || "").replace(/\s+/g, " ").trim();
  const buttons = Array.from(document.querySelectorAll("button"))
    .filter((element) => normalize(element.textContent).includes("Convert to Text"));
  const button = buttons.reverse().find((element) => {
    const style = window.getComputedStyle(element);
    return !element.disabled && style.display !== "none" && style.visibility !== "hidden";
  });
  if (!button) return false;
  button.click();
  return true;
})()
"#,
        Duration::from_secs(20),
        "click Convert to Text",
    )
    .await?;

    if clicked {
        Ok(())
    } else {
        Err("Could not start KurdishTTS transcription.".to_string())
    }
}

async fn wait_for_transcript(cdp: &mut CdpClient) -> Result<String, String> {
    let transcript = timeout(PAGE_TIMEOUT, async {
        loop {
            let value = cdp
                .evaluate(
                    r#"
(() => {
  const clean = (value) => (value || "").replace(/\s+/g, " ").trim();
  const ignore = /^(Transcription Result|Convert to Text|Click to upload|MP3, WAV|Demo limit|Upload Audio|Record Audio)$/i;
  const isTranscript = (text) => text && text.length > 1 && !ignore.test(text);
  const hasResultLabelNearby = (element) => {
    let current = element.parentElement;
    for (let depth = 0; current && depth < 8; depth += 1) {
      const text = clean(current.textContent);
      if (text.includes("Transcription Result")) return true;
      current = current.parentElement;
    }
    return false;
  };

  const exact = Array.from(document.querySelectorAll("p.text-text-primary.leading-relaxed.whitespace-pre-wrap.text-xl.break-words.flex-1[dir='auto']"))
    .find((element) => isTranscript(clean(element.textContent)) && hasResultLabelNearby(element));
  if (exact) return clean(exact.textContent);

  const labels = Array.from(document.querySelectorAll("h1,h2,h3,h4,p,div,span"))
    .filter((element) => clean(element.textContent) === "Transcription Result");

  for (const label of labels) {
    let container = label.parentElement;
    for (let depth = 0; container && depth < 8; depth += 1) {
      const containerText = clean(container.textContent);
      const looksScoped = containerText.includes("Transcription Result") && containerText.length < 3000;
      const hasResultMedia = Boolean(container.querySelector("audio, video"));
      if (looksScoped || hasResultMedia) {
        const candidates = Array.from(container.querySelectorAll("p[dir='auto'], p.whitespace-pre-wrap, p.text-xl, textarea, [contenteditable='true']"))
          .map((element) => clean("value" in element ? element.value : element.textContent))
          .filter(isTranscript)
          .filter((text) => text !== "Transcription Result")
          .sort((a, b) => b.length - a.length);
        if (candidates.length > 0) return candidates[0];
      }
      container = container.parentElement;
    }
  }

  return "";
})()
"#,
                    false,
                )
                .await?;

            let transcript = value.as_str().unwrap_or_default().trim().to_string();
            if !transcript.is_empty() {
                return Ok::<String, String>(transcript);
            }

            sleep(Duration::from_millis(750)).await;
        }
    })
    .await
    .map_err(|_| "Timed out while waiting for the KurdishTTS transcript.".to_string())??;

    Ok(transcript)
}

async fn wait_for_truthy(
    cdp: &mut CdpClient,
    expression: &str,
    duration: Duration,
    step: &str,
) -> Result<bool, String> {
    let result = timeout(duration, async {
        loop {
            let value = cdp.evaluate(expression, false).await?;
            if value.as_bool() == Some(true) {
                return Ok::<bool, String>(true);
            }
            sleep(Duration::from_millis(300)).await;
        }
    })
    .await;

    match result {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) => Err(step_error(cdp, step, &error).await),
        Err(_) => Err(step_error(cdp, step, "timed out").await),
    }
}

async fn step_error(cdp: &mut CdpClient, step: &str, reason: &str) -> String {
    let debug_dir = std::env::temp_dir()
        .join("atlas-kurdishtts-stt-debug")
        .join(current_millis().to_string());
    let mut message = format!(
        "KurdishTTS website automation failed while trying to {step}: {reason}."
    );

    if fs::create_dir_all(&debug_dir).is_ok() {
        if let Ok(Value::String(snapshot)) = cdp
            .evaluate(
                r#"
(() => {
  const text = (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n").slice(0, 6000);
  const buttons = Array.from(document.querySelectorAll("button, a, [role='tab'], [role='button'], input[type='file']"))
    .map((element, index) => {
      const anyElement = element;
      return `${index + 1}. <${element.tagName.toLowerCase()}> text="${(element.textContent || "").replace(/\s+/g, " ").trim()}" type="${anyElement.type || ""}" disabled="${Boolean(anyElement.disabled)}"`;
    })
    .join("\n");
  return [
    `url=${location.href}`,
    `title=${document.title}`,
    "",
    "INTERACTIVE ELEMENTS:",
    buttons,
    "",
    "BODY TEXT:",
    text
  ].join("\n");
})()
"#,
                false,
            )
            .await
        {
            let snapshot_path = debug_dir.join("page-snapshot.txt");
            let _ = fs::write(&snapshot_path, snapshot);
        }

        if let Ok(result) = cdp
            .call(
                "Page.captureScreenshot",
                json!({
                    "format": "png",
                    "captureBeyondViewport": true,
                }),
            )
            .await
        {
            if let Some(data) = result.get("data").and_then(Value::as_str) {
                if let Ok(bytes) = general_purpose::STANDARD.decode(data) {
                    let screenshot_path = debug_dir.join("page.png");
                    let _ = fs::write(&screenshot_path, bytes);
                }
            }
        }

        message.push_str(&format!(
            " Debug snapshot saved to {}",
            debug_dir.to_string_lossy()
        ));
    }

    message
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn find_browser_executable() -> Option<PathBuf> {
    let mut candidates = Vec::new();

    #[cfg(target_os = "windows")]
    {
        for base in [
            std::env::var_os("PROGRAMFILES"),
            std::env::var_os("PROGRAMFILES(X86)"),
            std::env::var_os("LOCALAPPDATA"),
        ]
        .into_iter()
        .flatten()
        {
            let base = PathBuf::from(base);
            candidates.push(
                base.join("Microsoft")
                    .join("Edge")
                    .join("Application")
                    .join("msedge.exe"),
            );
            candidates.push(
                base.join("Google")
                    .join("Chrome")
                    .join("Application")
                    .join("chrome.exe"),
            );
        }
    }

    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from(
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ));
        candidates.push(PathBuf::from(
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        ));
    }

    #[cfg(target_os = "linux")]
    {
        candidates.push(PathBuf::from("/usr/bin/microsoft-edge"));
        candidates.push(PathBuf::from("/usr/bin/google-chrome"));
        candidates.push(PathBuf::from("/usr/bin/chromium"));
        candidates.push(PathBuf::from("/usr/bin/chromium-browser"));
    }

    candidates
        .into_iter()
        .find(|path| path.is_file())
        .or_else(find_browser_in_path)
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn find_browser_in_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let names = ["msedge.exe", "chrome.exe", "msedge", "chrome"];
    #[cfg(target_os = "macos")]
    let names = ["Microsoft Edge", "Google Chrome"];
    #[cfg(target_os = "linux")]
    let names = [
        "microsoft-edge",
        "google-chrome",
        "chromium",
        "chromium-browser",
    ];

    for name in names {
        let output = if cfg!(target_os = "windows") {
            Command::new("where").arg(name).output()
        } else {
            Command::new("which").arg(name).output()
        };

        if let Ok(output) = output {
            if output.status.success() {
                if let Some(line) = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .map(str::trim)
                    .find(|line| !line.is_empty())
                {
                    let path = PathBuf::from(line);
                    if path.is_file() {
                        return Some(path);
                    }
                }
            }
        }
    }

    None
}
