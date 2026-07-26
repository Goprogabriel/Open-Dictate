pub mod tray;

use tauri::{Manager, WebviewWindow};

pub fn show_main(window: &WebviewWindow) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

pub fn should_start_hidden() -> bool {
    std::env::args().any(|argument| argument == "--background")
}

pub fn configure_windows(app: &tauri::App) {
    if let Some(overlay) = app.get_webview_window("recorder-overlay") {
        let _ = overlay.set_ignore_cursor_events(true);
    }
    if should_start_hidden() {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.hide();
        }
    }
}
