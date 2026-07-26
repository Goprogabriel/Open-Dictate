use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::{
    error::{AppError, AppResult},
    security::LocalVault,
};

fn secure_state_directory(app: &AppHandle) -> AppResult<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|error| AppError::System(error.to_string()))
}

fn validate_public_namespace(namespace: &str) -> AppResult<()> {
    match namespace {
        "history" | "prompt" | "dictionary" => Ok(()),
        _ => Err(AppError::InvalidRequest(
            "unknown secure state namespace".into(),
        )),
    }
}

#[tauri::command]
pub fn load_secure_state(app: AppHandle, namespace: String) -> AppResult<Option<Value>> {
    validate_public_namespace(&namespace)?;
    LocalVault.load(&secure_state_directory(&app)?, &namespace)
}

#[tauri::command]
pub fn save_secure_state(app: AppHandle, namespace: String, value: Value) -> AppResult<()> {
    validate_public_namespace(&namespace)?;
    LocalVault.save(&secure_state_directory(&app)?, &namespace, &value)
}
