#![deny(unsafe_op_in_unsafe_fn)]

mod app;
mod audio;
mod commands;
mod error;
mod local_ai;
mod models;
mod native;
mod security;
mod state;
mod transcription;

use tauri::Manager;

pub fn run() {
    let builder = tauri::Builder::default()
        // Single-instance handling must be registered before plugins that may
        // perform side effects during a second launch.
        .plugin(tauri_plugin_single_instance::init(
            |app, _arguments, _working_directory| {
                if let Some(window) = app.get_webview_window("main") {
                    app::show_main(&window);
                }
            },
        ))
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--background"])
                .build(),
        )
        .manage(state::DesktopState::default())
        .setup(|app| {
            let recordings = app.path().app_cache_dir()?.join("recordings");
            audio::AudioRecorder::cleanup_abandoned(&recordings);
            app::configure_windows(app);
            app::tray::install(app)?;
            if let Err(error) = native::hotkey::start(app.handle().clone()) {
                tracing::warn!(error = ?error, "global shortcut monitor could not start");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if window.state::<state::DesktopState>().run_in_background() {
                        api.prevent_close();
                        let _ = window.hide();
                    } else {
                        window.app_handle().exit(0);
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_platform_info,
            commands::list_microphones,
            commands::get_permission_snapshot,
            commands::request_microphone_permission,
            commands::open_permission_settings,
            commands::start_recording,
            commands::stop_recording,
            commands::cancel_recording,
            commands::transcribe_byok,
            commands::transcribe_managed,
            commands::transcribe_local,
            commands::get_local_model_status,
            commands::download_local_models,
            commands::uninstall_local_models,
            commands::insert_text,
            commands::copy_text,
            commands::set_api_key,
            commands::has_api_key,
            commands::delete_api_key,
            commands::test_api_key,
            commands::load_secure_state,
            commands::save_secure_state,
            commands::get_autostart_enabled,
            commands::set_autostart_enabled,
            commands::set_run_in_background,
            commands::update_hud_state,
        ]);

    builder
        .run(tauri::generate_context!())
        .expect("failed to run Open Dictate");
}
