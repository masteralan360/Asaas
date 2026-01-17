#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .setup(|app| {
      use tauri::Manager;
      use window_vibrancy::{apply_acrylic, apply_vibrancy, NSVisualEffectMaterial};

      let window = app.get_webview_window("main").unwrap();

      #[cfg(target_os = "macos")]
      apply_vibrancy(&window, NSVisualEffectMaterial::HudWindow, None, None)
        .expect("Unsupported platform! 'apply_vibrancy' is only supported on macOS");

      #[cfg(target_os = "windows")]
      apply_acrylic(&window, Some((18, 18, 18, 20)))
        .expect("Unsupported platform! 'apply_acrylic' is only supported on Windows");

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
