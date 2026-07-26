use std::{
    collections::HashMap,
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
};

use parking_lot::Mutex;

use crate::{
    audio::AudioRecorder,
    error::{AppError, AppResult},
    local_ai::LocalAiManager,
    models::RecordingDescriptor,
    native::focus::FocusTarget,
    transcription::TranscriptionClient,
};

#[derive(Debug, Clone)]
pub struct StoredRecording {
    pub descriptor: RecordingDescriptor,
    pub path: PathBuf,
    pub focus_target: FocusTarget,
}

pub struct DesktopState {
    pub recorder: AudioRecorder,
    pub transcription: TranscriptionClient,
    pub local_ai: LocalAiManager,
    recordings: Mutex<HashMap<String, StoredRecording>>,
    last_focus_target: Mutex<Option<FocusTarget>>,
    microphone_granted: AtomicBool,
    run_in_background: AtomicBool,
}

impl Default for DesktopState {
    fn default() -> Self {
        Self {
            recorder: AudioRecorder::default(),
            transcription: TranscriptionClient::default(),
            local_ai: LocalAiManager::default(),
            recordings: Mutex::new(HashMap::new()),
            last_focus_target: Mutex::new(None),
            microphone_granted: AtomicBool::new(false),
            run_in_background: AtomicBool::new(true),
        }
    }
}

impl DesktopState {
    pub fn insert_recording(&self, recording: StoredRecording) {
        *self.last_focus_target.lock() = Some(recording.focus_target.clone());
        self.recordings
            .lock()
            .insert(recording.descriptor.id.clone(), recording);
    }

    pub fn recording(&self, id: &str) -> AppResult<StoredRecording> {
        self.recordings
            .lock()
            .get(id)
            .cloned()
            .ok_or(AppError::RecordingNotFound)
    }

    pub fn delete_recording(&self, id: &str) {
        if let Some(recording) = self.recordings.lock().remove(id) {
            let _ = std::fs::remove_file(recording.path);
        }
    }

    /// Consumes the insertion target captured for the most recently completed
    /// recording. Keeping this one-shot prevents the webview from replaying an
    /// insertion command after the dictation transaction has finished.
    pub fn take_last_focus_target(&self) -> Option<FocusTarget> {
        self.last_focus_target.lock().take()
    }

    pub fn set_microphone_granted(&self, granted: bool) {
        self.microphone_granted.store(granted, Ordering::Relaxed);
    }

    pub fn microphone_granted(&self) -> bool {
        self.microphone_granted.load(Ordering::Relaxed)
    }

    pub fn set_run_in_background(&self, enabled: bool) {
        self.run_in_background.store(enabled, Ordering::Relaxed);
    }

    pub fn run_in_background(&self) -> bool {
        self.run_in_background.load(Ordering::Relaxed)
    }
}
