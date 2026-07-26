use serde::{Serialize, Serializer};
use thiserror::Error;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("audio device error: {0}")]
    AudioDevice(String),
    #[error("audio recording error: {0}")]
    AudioRecording(String),
    #[error("recording not found")]
    RecordingNotFound,
    #[error("a recording is already active")]
    RecordingAlreadyActive,
    #[error("secure credential error: {0}")]
    Credential(String),
    #[error("network request failed: {0}")]
    Network(String),
    #[error("provider rejected the request: {0}")]
    Provider(String),
    #[error("invalid provider response: {0}")]
    InvalidResponse(String),
    #[error("text insertion failed: {0}")]
    Insertion(String),
    #[error("focused application changed")]
    FocusChanged,
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[error("system integration error: {0}")]
    System(String),
    #[error("local model error: {0}")]
    LocalModel(String),
    #[error("local inference error: {0}")]
    LocalInference(String),
}

impl AppError {
    fn code(&self) -> &'static str {
        match self {
            Self::AudioDevice(_) => "audio_device",
            Self::AudioRecording(_) => "audio_recording",
            Self::RecordingNotFound => "recording_not_found",
            Self::RecordingAlreadyActive => "recording_already_active",
            Self::Credential(_) => "credential_error",
            Self::Network(_) => "network_error",
            Self::Provider(_) => "provider_error",
            Self::InvalidResponse(_) => "invalid_provider_response",
            Self::Insertion(_) => "insertion_error",
            Self::FocusChanged => "focus_changed",
            Self::InvalidRequest(_) => "invalid_request",
            Self::System(_) => "system_error",
            Self::LocalModel(_) => "local_model_error",
            Self::LocalInference(_) => "local_inference_error",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct ErrorPayload<'a> {
            code: &'a str,
            message: String,
        }

        ErrorPayload {
            code: self.code(),
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}
