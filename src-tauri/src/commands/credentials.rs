use secrecy::SecretString;
use tauri::{AppHandle, Manager, State};

use crate::{
    error::{AppError, AppResult},
    security::CredentialStore,
    state::DesktopState,
};

fn credential_directory(app: &AppHandle) -> AppResult<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|error| AppError::System(error.to_string()))
}

#[tauri::command]
pub fn set_api_key(app: AppHandle, api_key: String) -> AppResult<()> {
    CredentialStore.set_openai_key(&credential_directory(&app)?, &api_key)
}

#[tauri::command]
pub fn has_api_key(app: AppHandle) -> AppResult<bool> {
    CredentialStore.has_openai_key(&credential_directory(&app)?)
}

#[tauri::command]
pub fn delete_api_key(app: AppHandle) -> AppResult<()> {
    CredentialStore.delete_openai_key(&credential_directory(&app)?)
}

#[tauri::command]
pub async fn test_api_key(
    app: AppHandle,
    state: State<'_, DesktopState>,
    api_key: Option<String>,
) -> AppResult<bool> {
    let key = match api_key {
        Some(value) => {
            let value = value.trim();
            if !value.starts_with("sk-") || !(20..=500).contains(&value.len()) {
                return Ok(false);
            }
            SecretString::new(value.to_owned().into_boxed_str())
        }
        None => CredentialStore.get_openai_key(&credential_directory(&app)?)?,
    };
    state
        .transcription
        .test_api_key(&key)
        .await
        .map_err(|error| match error {
            AppError::Provider(_) => AppError::Provider("API key validation failed".into()),
            other => other,
        })
}
