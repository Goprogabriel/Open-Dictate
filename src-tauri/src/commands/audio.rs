use tauri::{AppHandle, Manager, State};

use crate::{
    error::AppResult,
    models::{
        MicrophoneDevice, PermissionSnapshot, PermissionState, RecordingDescriptor,
        RecordingStarted,
    },
    native::{focus, permissions},
    state::DesktopState,
};

#[tauri::command]
pub fn list_microphones(state: State<'_, DesktopState>) -> AppResult<Vec<MicrophoneDevice>> {
    state.recorder.list_devices()
}

#[tauri::command]
pub fn get_permission_snapshot(state: State<'_, DesktopState>) -> PermissionSnapshot {
    permission_snapshot(&state)
}

#[tauri::command]
pub fn request_microphone_permission(state: State<'_, DesktopState>) -> PermissionSnapshot {
    let granted = state.recorder.probe_default_device().is_ok();
    state.set_microphone_granted(granted);
    permission_snapshot(&state)
}

#[tauri::command]
pub fn open_permission_settings(kind: String) -> AppResult<()> {
    permissions::open_settings(&kind)
}

#[tauri::command]
pub fn start_recording(
    app: AppHandle,
    state: State<'_, DesktopState>,
    microphone_id: Option<String>,
) -> AppResult<RecordingStarted> {
    let focus_target = focus::capture()?;
    let cache_directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| crate::error::AppError::System(error.to_string()))?
        .join("recordings");
    state.recorder.start(
        &app,
        &cache_directory,
        microphone_id.as_deref(),
        focus_target,
    )
}

#[tauri::command]
pub fn stop_recording(
    state: State<'_, DesktopState>,
    recording_id: String,
) -> AppResult<RecordingDescriptor> {
    let recording = state.recorder.stop(&recording_id)?;
    let descriptor = recording.descriptor.clone();
    state.insert_recording(recording);
    Ok(descriptor)
}

#[tauri::command]
pub fn cancel_recording(state: State<'_, DesktopState>, recording_id: String) -> AppResult<()> {
    state.recorder.cancel(&recording_id)?;
    state.delete_recording(&recording_id);
    Ok(())
}

fn permission_snapshot(state: &DesktopState) -> PermissionSnapshot {
    PermissionSnapshot {
        microphone: permissions::microphone_state(state.microphone_granted()),
        accessibility: permissions::accessibility_state(),
        // Open Dictate does not need screen recording. This field remains for
        // a future explicitly opt-in context feature and is never requested.
        screen_recording: PermissionState::Unknown,
    }
}
