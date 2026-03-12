use std::fs;
use tauri::Manager;

#[tauri::command]
fn read_fcm_token(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join("fcm-token.txt");

    match fs::read_to_string(path) {
        Ok(contents) => {
            let token = contents.trim().to_string();
            if token.is_empty() {
                Ok(None)
            } else {
                Ok(Some(token))
            }
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_thermal_printer::init());

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        builder = builder.plugin(tauri_plugin_biometric::init());
    }

    builder.setup(|app| {
        use tauri::Manager;
        let window = app.get_webview_window("main").unwrap();

            #[cfg(desktop)]
            {
                // Force disable decorations (Fix for persistent title bar)
                let _ = window.set_decorations(false);
                // let _ = window.set_shadow(true);

                // Show window after configuration
                let _ = window.maximize();
                let _ = window.show();
            }

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![read_fcm_token])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
