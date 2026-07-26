use tauri::{AppHandle, Manager, State};

use crate::{
    error::{AppError, AppResult},
    models::{TranscriptionOptions, TranscriptionResult},
    security::CredentialStore,
    state::DesktopState,
};

#[tauri::command]
pub async fn transcribe_byok(
    app: AppHandle,
    state: State<'_, DesktopState>,
    recording_id: String,
    options: TranscriptionOptions,
) -> AppResult<TranscriptionResult> {
    let recording = state.recording(&recording_id)?;
    let credential_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::System(error.to_string()))?;
    let result = match CredentialStore.get_openai_key(&credential_directory) {
        Ok(key) => {
            state
                .transcription
                .transcribe_byok(&recording.path, &options, &key)
                .await
        }
        Err(error) => Err(error),
    };
    state.delete_recording(&recording_id);
    result
}

#[tauri::command]
pub async fn transcribe_managed(
    state: State<'_, DesktopState>,
    recording_id: String,
    options: TranscriptionOptions,
    endpoint: String,
    id_token: String,
) -> AppResult<TranscriptionResult> {
    let recording = state.recording(&recording_id)?;
    let result = state
        .transcription
        .transcribe_managed(
            &recording.path,
            &options,
            &endpoint,
            &id_token,
            &recording.descriptor,
        )
        .await;
    if !matches!(&result, Err(AppError::Network(_))) {
        state.delete_recording(&recording_id);
    }
    result
}
