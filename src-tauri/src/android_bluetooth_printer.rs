use serde::{Deserialize, Serialize};
use tauri::{plugin::{Builder, TauriPlugin}, AppHandle, Runtime};

#[cfg(target_os = "android")]
use tauri::{plugin::PluginHandle, Manager};

const PLUGIN_NAME: &str = "android-bluetooth-printer";

#[derive(Debug, Deserialize, Serialize)]
pub struct BluetoothPrinterInfo {
    pub name: String,
    pub interface_type: String,
    pub identifier: String,
    pub status: String,
}

#[cfg(target_os = "android")]
#[derive(Serialize)]
struct BluetoothPrintRequest {
    address: String,
    payload: Vec<u8>,
}

#[cfg(target_os = "android")]
#[derive(Serialize)]
struct BluetoothTestRequest {
    address: String,
}

#[cfg(target_os = "android")]
struct AndroidBluetoothPrinter<R: Runtime>(PluginHandle<R>);

/// Registers the native Android implementation. The desktop and PWA transports
/// remain separate so they keep their existing printer selection behavior.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(PLUGIN_NAME)
        .setup(|app, api| {
            #[cfg(not(target_os = "android"))]
            let _ = (&app, &api);

            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin("com.atlas.app", "BluetoothThermalPrinterPlugin")?;
                app.manage(AndroidBluetoothPrinter(handle));
            }

            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
fn plugin_handle<R: Runtime>(app: &AppHandle<R>) -> Result<PluginHandle<R>, String> {
    app.try_state::<AndroidBluetoothPrinter<R>>()
        .map(|state| state.0.clone())
        .ok_or_else(|| "The Android Bluetooth printer service is unavailable. Restart Atlas and try again.".to_string())
}

pub async fn list_printers<R: Runtime>(app: AppHandle<R>) -> Result<Vec<BluetoothPrinterInfo>, String> {
    #[cfg(target_os = "android")]
    {
        return plugin_handle(&app)?
            .run_mobile_plugin_async("list_paired_printers", ())
            .await
            .map_err(|error| error.to_string());
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("Bluetooth Classic receipt printing is available in the Android app only.".to_string())
    }
}

pub async fn print<R: Runtime>(
    app: AppHandle<R>,
    address: String,
    payload: Vec<u8>,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        plugin_handle(&app)?
            .run_mobile_plugin_async::<()>(
                "print_receipt",
                BluetoothPrintRequest { address, payload },
            )
            .await
            .map_err(|error| error.to_string())
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, address, payload);
        Err("Bluetooth Classic receipt printing is available in the Android app only.".to_string())
    }
}

pub async fn test<R: Runtime>(app: AppHandle<R>, address: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        plugin_handle(&app)?
            .run_mobile_plugin_async::<()>("test_printer", BluetoothTestRequest { address })
            .await
            .map_err(|error| error.to_string())
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, address);
        Err("Bluetooth Classic receipt printing is available in the Android app only.".to_string())
    }
}
