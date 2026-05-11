use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Serialize, Deserialize, Clone)]
struct MonitorInfo {
    name: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[tauri::command]
fn get_monitors(app: tauri::AppHandle) -> Vec<MonitorInfo> {
    let mut monitors: Vec<MonitorInfo> = Vec::new();
    if let Some(primary) = app.primary_monitor().ok().flatten() {
        let pos = primary.position();
        let size = primary.size();
        monitors.push(MonitorInfo {
            name: primary
                .name()
                .cloned()
                .unwrap_or_else(|| "Primary".to_string()),
            x: pos.x,
            y: pos.y,
            width: size.width,
            height: size.height,
        });
    }
    for monitor in app.available_monitors().unwrap_or_default() {
        let pos = monitor.position();
        let size = monitor.size();
        let info = MonitorInfo {
            name: monitor
                .name()
                .cloned()
                .unwrap_or_else(|| "Unknown".to_string()),
            x: pos.x,
            y: pos.y,
            width: size.width,
            height: size.height,
        };
        // Avoid duplicating primary monitor
        if !monitors.iter().any(|m| m.x == info.x && m.y == info.y) {
            monitors.push(info);
        }
    }
    monitors
}

#[tauri::command]
fn open_secondary_window(app: tauri::AppHandle, x: i32, y: i32, width: u32, height: u32) -> Result<(), String> {
    // Check if secondary already exists
    if app.get_webview_window("secondary").is_some() {
        return Ok(());
    }

    let _window = WebviewWindowBuilder::new(
        &app,
        "secondary",
        WebviewUrl::App("/secondary.html".into()),
    )
    .title("Player Display")
    .position(x as f64, y as f64)
    .inner_size(width as f64, height as f64)
    .decorations(false)
    .resizable(false)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn close_secondary_window(app: tauri::AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("secondary") {
        window.destroy().map_err(|e| e.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
fn is_secondary_open(app: tauri::AppHandle) -> bool {
    app.get_webview_window("secondary").is_some()
}

#[tauri::command]
fn save_session(path: String, data: String) -> Result<(), String> {
    let path = PathBuf::from(&path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, &data).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_session(path: String) -> Result<String, String> {
    let path = PathBuf::from(&path);
    if !path.exists() {
        return Err("File not found".to_string());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_fog_png(path: String, data: Vec<u8>) -> Result<(), String> {
    let path = PathBuf::from(&path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, &data).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_fog_png(path: String) -> Result<Vec<u8>, String> {
    let path = PathBuf::from(&path);
    if !path.exists() {
        return Err("Fog file not found".to_string());
    }
    fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn broadcast_to_secondary(app: tauri::AppHandle, event: String, payload: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("secondary") {
        window.emit(&event, payload).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            get_monitors,
            open_secondary_window,
            close_secondary_window,
            is_secondary_open,
            save_session,
            load_session,
            save_fog_png,
            load_fog_png,
            broadcast_to_secondary,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
