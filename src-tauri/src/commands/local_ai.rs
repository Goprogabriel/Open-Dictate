use tauri::{AppHandle, Manager, State};

use crate::{
    error::{AppError, AppResult},
    models::{LocalAiQuality, LocalModelStatus, TranscriptionOptions, TranscriptionResult},
    state::DesktopState,
};

fn model_directory(app: &AppHandle) -> AppResult<std::path::PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::System(error.to_string()))?
        .join("local-models"))
}

#[tauri::command]
pub fn get_local_model_status(
    app: AppHandle,
    quality: LocalAiQuality,
) -> AppResult<LocalModelStatus> {
    crate::local_ai::status(&model_directory(&app)?, quality)
}

#[tauri::command]
pub async fn download_local_models(
    app: AppHandle,
    state: State<'_, DesktopState>,
    quality: LocalAiQuality,
) -> AppResult<LocalModelStatus> {
    state
        .local_ai
        .download(&app, &model_directory(&app)?, quality)
        .await
}

#[tauri::command]
pub async fn uninstall_local_models(
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> AppResult<()> {
    state.local_ai.uninstall(&model_directory(&app)?).await
}

#[tauri::command]
pub async fn transcribe_local(
    app: AppHandle,
    state: State<'_, DesktopState>,
    recording_id: String,
    options: TranscriptionOptions,
    quality: LocalAiQuality,
) -> AppResult<TranscriptionResult> {
    let recording = state.recording(&recording_id)?;
    let models = model_directory(&app)?;
    let audio_path = recording.path.clone();
    let manager = state.local_ai.clone();
    let result = tokio::task::spawn_blocking(move || {
        manager.transcribe(&models, quality, &audio_path, &options)
    })
    .await
    .map_err(|error| AppError::LocalInference(error.to_string()))?;
    state.delete_recording(&recording_id);
    result
}
