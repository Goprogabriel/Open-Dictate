const COMMANDS: &[&str] = &[
    "get_platform_info",
    "list_microphones",
    "get_permission_snapshot",
    "request_microphone_permission",
    "open_permission_settings",
    "start_recording",
    "stop_recording",
    "cancel_recording",
    "transcribe_byok",
    "transcribe_managed",
    "transcribe_local",
    "get_local_model_status",
    "download_local_models",
    "uninstall_local_models",
    "insert_text",
    "copy_text",
    "set_api_key",
    "has_api_key",
    "delete_api_key",
    "test_api_key",
    "load_secure_state",
    "save_secure_state",
    "get_autostart_enabled",
    "set_autostart_enabled",
    "set_run_in_background",
    "update_hud_state",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to build Tauri application manifest");
}
