use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State};
use tauri_plugin_autostart::ManagerExt;

use crate::{
    error::{AppError, AppResult},
    models::{HudStateEvent, PlatformInfo},
    native::insertion,
    state::DesktopState,
};

#[tauri::command]
pub fn get_platform_info() -> PlatformInfo {
    #[cfg(target_os = "macos")]
    return PlatformInfo {
        os: "macos",
        shortcut_label: "⌥ + ⌘",
    };

    #[cfg(target_os = "windows")]
    return PlatformInfo {
        os: "windows",
        shortcut_label: "Alt + Win",
    };
}

#[tauri::command]
pub fn insert_text(state: State<'_, DesktopState>, text: String) -> AppResult<()> {
    let target = state
        .take_last_focus_target()
        .ok_or(AppError::FocusChanged)?;
    insertion::insert_text(&target, &text)
}

#[tauri::command]
pub fn copy_text(text: String) -> AppResult<()> {
    insertion::copy_text(&text)
}

#[tauri::command]
pub fn get_autostart_enabled(app: AppHandle) -> AppResult<bool> {
    app.autolaunch()
        .is_enabled()
        .map_err(|error| AppError::System(error.to_string()))
}

#[tauri::command]
pub fn set_autostart_enabled(app: AppHandle, enabled: bool) -> AppResult<()> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable()
    } else {
        manager.disable()
    }
    .map_err(|error| AppError::System(error.to_string()))
}

#[tauri::command]
pub fn set_run_in_background(state: State<'_, DesktopState>, enabled: bool) {
    state.set_run_in_background(enabled);
}

#[tauri::command]
pub fn update_hud_state(app: AppHandle, state: HudStateEvent) -> AppResult<()> {
    let window = app
        .get_webview_window("recorder-overlay")
        .ok_or_else(|| AppError::System("recording indicator window is unavailable".into()))?;
    if state.phase == "idle" {
        window
            .hide()
            .map_err(|error| AppError::System(error.to_string()))?;
        return Ok(());
    }

    if let Ok(Some(monitor)) = window.primary_monitor() {
        if let Ok(size) = window.outer_size() {
            let monitor_size = monitor.size();
            let monitor_position = monitor.position();
            let x =
                monitor_position.x + ((monitor_size.width.saturating_sub(size.width)) / 2) as i32;
            #[cfg(target_os = "macos")]
            let y = monitor_position.y + 6;
            #[cfg(not(target_os = "macos"))]
            let y =
                monitor_position.y + monitor_size.height.saturating_sub(size.height + 36) as i32;
            let _ = window.set_position(PhysicalPosition::new(x, y));
        }
    }
    let _ = window.set_ignore_cursor_events(true);
    let _ = window.set_always_on_top(true);
    window
        .show()
        .map_err(|error| AppError::System(error.to_string()))?;
    window
        .emit("dictation://hud-state", &state)
        .map_err(|error| AppError::System(error.to_string()))
}
