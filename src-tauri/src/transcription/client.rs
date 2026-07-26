use std::{fs, path::Path, time::Duration};

use reqwest::{
    header::{HeaderMap, HeaderValue},
    multipart::{Form, Part},
    Client, Response, StatusCode, Url,
};
use secrecy::{ExposeSecret, SecretString};
use serde_json::{json, Value};
use tokio::time::Instant;

use crate::{
    error::{AppError, AppResult},
    models::{RecordingDescriptor, TranscriptionOptions, TranscriptionResult},
};

use super::prompt;

const OPENAI_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_TRANSCRIPTION_MODEL: &str = "gpt-4o-mini-transcribe";
const FALLBACK_TRANSCRIPTION_MODEL: &str = "whisper-1";
const DEFAULT_POLISH_MODEL: &str = "gpt-5-mini";
const MAX_AUDIO_BYTES: u64 = 24 * 1024 * 1024;
const MANAGED_RECOVERY_BUDGET: Duration = Duration::from_secs(300);
const MANAGED_RECOVERY_POLL_INTERVAL: Duration = Duration::from_secs(2);
const MANAGED_RECOVERY_REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Clone)]
pub struct TranscriptionClient {
    http: Client,
}

impl Default for TranscriptionClient {
    fn default() -> Self {
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(330))
            .user_agent(concat!("OpenDictate/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("the native HTTP client configuration is valid");
        Self { http }
    }
}

impl TranscriptionClient {
    pub async fn transcribe_byok(
        &self,
        audio_path: &Path,
        options: &TranscriptionOptions,
        api_key: &SecretString,
    ) -> AppResult<TranscriptionResult> {
        prompt::validate(options)?;
        validate_audio(audio_path)?;
        let (raw_text, transcription_tokens, provider_request_id) =
            match self.transcribe_audio(audio_path, options, api_key).await {
                Ok(result) => result,
                Err(error) => {
                    tracing::warn!(error = ?error, "audio transcription failed");
                    return Err(error);
                }
            };
        if raw_text.trim().is_empty() {
            return Err(AppError::InvalidResponse(
                "the provider returned no speech".into(),
            ));
        }
        let (text, transform_tokens, transform_request_id) =
            match self.polish_text(&raw_text, options, api_key).await {
                Ok(result) => result,
                Err(error) => {
                    tracing::warn!(
                        error = ?error,
                        "text polishing failed; using the original transcription"
                    );
                    (raw_text, 0, None)
                }
            };

        Ok(TranscriptionResult {
            text,
            // The raw transcript is deliberately not returned to the webview.
            raw_text: None,
            transcription_tokens,
            transform_tokens,
            request_id: None,
            provider_request_id: transform_request_id.or(provider_request_id),
            dictation_id: None,
            remaining_tokens: None,
            subscription_tokens: None,
            purchased_tokens: None,
            subscription_tokens_expire_at: None,
        })
    }

    pub async fn transcribe_managed(
        &self,
        audio_path: &Path,
        options: &TranscriptionOptions,
        endpoint: &str,
        id_token: &str,
        recording: &RecordingDescriptor,
    ) -> AppResult<TranscriptionResult> {
        prompt::validate(options)?;
        validate_audio(audio_path)?;
        validate_managed_endpoint(endpoint)?;
        if !(100..=8_192).contains(&id_token.len()) {
            return Err(AppError::InvalidRequest(
                "the authentication token is invalid".into(),
            ));
        }
        let bytes =
            fs::read(audio_path).map_err(|error| AppError::AudioRecording(error.to_string()))?;
        let response = self
            .send_managed_request(&bytes, options, endpoint, id_token, recording)
            .await;

        match response {
            Ok(response) if response.status().is_success() => {
                parse_managed_result(response, &recording.id).await
            }
            Ok(response)
                if response.status() == StatusCode::CONFLICT
                    || response.status().is_server_error() =>
            {
                match self
                    .recover_managed(endpoint, id_token, &recording.id)
                    .await?
                {
                    Some(result) => Ok(result),
                    None => Err(managed_response_error(response).await),
                }
            }
            Ok(response) => Err(managed_response_error(response).await),
            Err(initial_error) => {
                if let Some(result) = self
                    .recover_managed(endpoint, id_token, &recording.id)
                    .await?
                {
                    return Ok(result);
                }

                let retry = self
                    .send_managed_request(&bytes, options, endpoint, id_token, recording)
                    .await;
                match retry {
                    Ok(response) if response.status().is_success() => {
                        parse_managed_result(response, &recording.id).await
                    }
                    Ok(response)
                        if response.status() == StatusCode::CONFLICT
                            || response.status().is_server_error() =>
                    {
                        match self
                            .recover_managed(endpoint, id_token, &recording.id)
                            .await?
                        {
                            Some(result) => Ok(result),
                            None => Err(managed_response_error(response).await),
                        }
                    }
                    Ok(response) => Err(managed_response_error(response).await),
                    Err(_) => Err(initial_error),
                }
            }
        }
    }

    async fn send_managed_request(
        &self,
        bytes: &[u8],
        options: &TranscriptionOptions,
        endpoint: &str,
        id_token: &str,
        recording: &RecordingDescriptor,
    ) -> AppResult<Response> {
        let audio = Part::bytes(bytes.to_vec())
            .file_name("dictation.wav")
            .mime_str("audio/wav")
            .map_err(|error| AppError::InvalidRequest(error.to_string()))?;
        let form = Form::new()
            .part("audio", audio)
            .text("language", options.language.clone())
            .text("durationMs", recording.duration_ms.to_string())
            .text("speakingMs", recording.speaking_ms.to_string())
            .text("application", recording.application.clone())
            .text("saveHistory", options.save_history.to_string())
            .text("retentionDays", options.retention_days.to_string())
            .text("outputLanguage", options.output_language.clone())
            .text("customPrompt", options.custom_prompt.clone())
            .text("removeFillers", options.remove_fillers.to_string())
            .text(
                "correctPunctuation",
                options.correct_punctuation.to_string(),
            )
            .text("formatLists", options.format_lists.to_string())
            .text(
                "dictionary",
                serde_json::to_string(&options.dictionary)
                    .map_err(|error| AppError::InvalidRequest(error.to_string()))?,
            );

        self.http
            .post(endpoint)
            .bearer_auth(id_token)
            .header("Idempotency-Key", &recording.id)
            .multipart(form)
            .send()
            .await
            .map_err(network_error)
    }

    async fn recover_managed(
        &self,
        endpoint: &str,
        id_token: &str,
        request_id: &str,
    ) -> AppResult<Option<TranscriptionResult>> {
        let base = endpoint
            .strip_suffix("/v1/dictations/transcribe")
            .ok_or_else(|| {
                AppError::InvalidRequest("managed API endpoint path is invalid".into())
            })?;
        let status_endpoint = format!("{base}/v1/dictation-requests/{request_id}");
        let deadline = Instant::now() + MANAGED_RECOVERY_BUDGET;
        let mut saw_job = false;
        let mut consecutive_network_errors = 0_u8;
        let mut attempt = 0_u32;

        loop {
            if attempt > 0 {
                wait_for_managed_recovery_poll(deadline).await?;
            }

            let now = Instant::now();
            let request_deadline = managed_recovery_request_deadline(now, deadline)?;
            let request_timeout = request_deadline.duration_since(now);
            let request = async {
                let response = self
                    .http
                    .get(&status_endpoint)
                    .bearer_auth(id_token)
                    .timeout(request_timeout)
                    .send()
                    .await
                    .map_err(network_error)?;
                let status = response.status();
                let payload = if status.is_success() {
                    Some(response.json::<Value>().await.map_err(|_| {
                        AppError::InvalidResponse("managed recovery response was malformed".into())
                    })?)
                } else {
                    None
                };
                Ok::<_, AppError>((status, payload))
            };
            let response = match tokio::time::timeout_at(request_deadline, request).await {
                Ok(Ok(response)) => {
                    consecutive_network_errors = 0;
                    response
                }
                Ok(Err(error @ AppError::Network(_))) => {
                    consecutive_network_errors += 1;
                    if !saw_job && consecutive_network_errors >= 3 {
                        return Err(error);
                    }
                    attempt = attempt.saturating_add(1);
                    continue;
                }
                Ok(Err(error)) => return Err(error),
                Err(_) if request_deadline >= deadline => return Err(managed_recovery_timeout()),
                Err(_) => {
                    consecutive_network_errors += 1;
                    if !saw_job && consecutive_network_errors >= 3 {
                        return Err(AppError::Network("request timed out".into()));
                    }
                    attempt = attempt.saturating_add(1);
                    continue;
                }
            };
            let (status, payload) = response;

            if status == StatusCode::NOT_FOUND {
                if attempt >= 2 && !saw_job {
                    return Ok(None);
                }
                attempt = attempt.saturating_add(1);
                continue;
            }
            if !status.is_success() {
                return Err(provider_status(status));
            }

            let payload = payload.expect("successful managed recovery responses include a body");
            match payload.get("status").and_then(Value::as_str) {
                Some("succeeded") => {
                    let mut result: TranscriptionResult =
                        serde_json::from_value(payload).map_err(|_| {
                            AppError::InvalidResponse(
                                "managed recovery result was malformed".into(),
                            )
                        })?;
                    result
                        .request_id
                        .get_or_insert_with(|| request_id.to_owned());
                    return Ok(Some(result));
                }
                Some("failed") => {
                    return Err(AppError::Provider("managed transcription failed".into()))
                }
                Some("reserved" | "processing") => saw_job = true,
                _ => {
                    return Err(AppError::InvalidResponse(
                        "managed recovery status was invalid".into(),
                    ))
                }
            }
            attempt = attempt.saturating_add(1);
        }
    }

    pub async fn test_api_key(&self, api_key: &SecretString) -> AppResult<bool> {
        let primary_model = transcription_model();
        let mut models = vec![primary_model.as_str()];
        if primary_model != FALLBACK_TRANSCRIPTION_MODEL {
            models.push(FALLBACK_TRANSCRIPTION_MODEL);
        }

        for model in models {
            let response = self
                .http
                .get(format!("{OPENAI_BASE_URL}/models/{model}"))
                .bearer_auth(api_key.expose_secret())
                .send()
                .await
                .map_err(network_error)?;
            if response.status().is_success() {
                return Ok(true);
            }
            if response.status() == StatusCode::UNAUTHORIZED {
                return Ok(false);
            }
        }
        Ok(false)
    }

    async fn transcribe_audio(
        &self,
        audio_path: &Path,
        options: &TranscriptionOptions,
        api_key: &SecretString,
    ) -> AppResult<(String, u64, Option<String>)> {
        let bytes =
            fs::read(audio_path).map_err(|error| AppError::AudioRecording(error.to_string()))?;
        let primary_model = transcription_model();
        let mut response = self
            .send_transcription_request(&bytes, options, api_key, &primary_model)
            .await?;
        let primary_status = response.status();
        if !primary_status.is_success()
            && primary_model != FALLBACK_TRANSCRIPTION_MODEL
            && should_try_transcription_fallback(primary_status)
        {
            let primary_error = provider_response_error(response, "transcription").await;
            log::warn!("{primary_error}; retrying with the compatible transcription fallback");
            response = self
                .send_transcription_request(&bytes, options, api_key, FALLBACK_TRANSCRIPTION_MODEL)
                .await?;
        }

        let status = response.status();
        if !status.is_success() {
            return Err(provider_response_error(response, "transcription").await);
        }
        let request_id = request_id(response.headers());
        let payload = response.json::<Value>().await.map_err(|_| {
            AppError::InvalidResponse("transcription response was malformed".into())
        })?;
        let text = payload
            .get("text")
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::InvalidResponse("transcription text was missing".into()))?
            .trim()
            .to_owned();
        let tokens = payload
            .pointer("/usage/total_tokens")
            .and_then(Value::as_u64)
            .or_else(|| {
                payload
                    .pointer("/usage/output_tokens")
                    .and_then(Value::as_u64)
            })
            .unwrap_or(0);
        Ok((text, tokens, request_id))
    }

    async fn send_transcription_request(
        &self,
        bytes: &[u8],
        options: &TranscriptionOptions,
        api_key: &SecretString,
        model: &str,
    ) -> AppResult<Response> {
        let audio = Part::bytes(bytes.to_vec())
            .file_name("dictation.wav")
            .mime_str("audio/wav")
            .map_err(|error| AppError::InvalidRequest(error.to_string()))?;
        let form = Form::new()
            .part("file", audio)
            .text("model", model.to_owned())
            .text("language", options.language.clone())
            .text("response_format", "json")
            .text("prompt", prompt::transcription_context(options));

        self.http
            .post(format!("{OPENAI_BASE_URL}/audio/transcriptions"))
            .bearer_auth(api_key.expose_secret())
            .multipart(form)
            .send()
            .await
            .map_err(network_error)
    }

    async fn polish_text(
        &self,
        raw_text: &str,
        options: &TranscriptionOptions,
        api_key: &SecretString,
    ) -> AppResult<(String, u64, Option<String>)> {
        let model = std::env::var("OPENAI_POLISH_MODEL")
            .ok()
            .map(|model| model.trim().to_owned())
            .filter(|model| !model.is_empty())
            .unwrap_or_else(|| DEFAULT_POLISH_MODEL.into());
        let body = json!({
            "model": model,
            "instructions": prompt::transformation_instructions(options),
            "input": raw_text,
            "max_output_tokens": 4096,
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "open_dictate_result",
                    "strict": true,
                    "schema": {
                        "type": "object",
                        "properties": { "text": { "type": "string", "maxLength": 100000 } },
                        "required": ["text"],
                        "additionalProperties": false
                    }
                }
            }
        });
        let response = self
            .http
            .post(format!("{OPENAI_BASE_URL}/responses"))
            .bearer_auth(api_key.expose_secret())
            .json(&body)
            .send()
            .await
            .map_err(network_error)?;
        let status = response.status();
        let request_id = request_id(response.headers());
        if !status.is_success() {
            return Err(provider_response_error(response, "polish").await);
        }
        let payload = response
            .json::<Value>()
            .await
            .map_err(|_| AppError::InvalidResponse("polish response was malformed".into()))?;
        let output = extract_output_text(&payload)
            .ok_or_else(|| AppError::InvalidResponse("polished text was missing".into()))?;
        let decoded: Value = serde_json::from_str(output)
            .map_err(|_| AppError::InvalidResponse("polished text was not valid JSON".into()))?;
        let text = decoded
            .get("text")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .ok_or_else(|| AppError::InvalidResponse("polished text was empty".into()))?
            .to_owned();
        let tokens = payload
            .pointer("/usage/total_tokens")
            .and_then(Value::as_u64)
            .unwrap_or_else(|| {
                payload
                    .pointer("/usage/input_tokens")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
                    + payload
                        .pointer("/usage/output_tokens")
                        .and_then(Value::as_u64)
                        .unwrap_or(0)
            });
        Ok((text, tokens, request_id))
    }
}

fn managed_recovery_request_deadline(
    now: Instant,
    recovery_deadline: Instant,
) -> AppResult<Instant> {
    if now >= recovery_deadline {
        return Err(managed_recovery_timeout());
    }

    Ok((now + MANAGED_RECOVERY_REQUEST_TIMEOUT).min(recovery_deadline))
}

async fn wait_for_managed_recovery_poll(recovery_deadline: Instant) -> AppResult<()> {
    let now = Instant::now();
    if now >= recovery_deadline {
        return Err(managed_recovery_timeout());
    }

    let wake_at = (now + MANAGED_RECOVERY_POLL_INTERVAL).min(recovery_deadline);
    tokio::time::sleep_until(wake_at).await;
    if Instant::now() >= recovery_deadline {
        Err(managed_recovery_timeout())
    } else {
        Ok(())
    }
}

fn managed_recovery_timeout() -> AppError {
    AppError::Network("managed transcription is still processing".into())
}

async fn parse_managed_result(
    response: Response,
    request_id: &str,
) -> AppResult<TranscriptionResult> {
    let mut result = response
        .json::<TranscriptionResult>()
        .await
        .map_err(|_| AppError::InvalidResponse("managed response was malformed".into()))?;
    result
        .request_id
        .get_or_insert_with(|| request_id.to_owned());
    Ok(result)
}

fn validate_audio(path: &Path) -> AppResult<()> {
    let metadata =
        fs::metadata(path).map_err(|error| AppError::AudioRecording(error.to_string()))?;
    if metadata.len() < 1_000 {
        return Err(AppError::InvalidRequest(
            "the recording is too short".into(),
        ));
    }
    if metadata.len() > MAX_AUDIO_BYTES {
        return Err(AppError::InvalidRequest(
            "the recording is too large".into(),
        ));
    }
    Ok(())
}

fn validate_managed_endpoint(endpoint: &str) -> AppResult<()> {
    validate_managed_endpoint_for_origin(
        endpoint,
        option_env!("OPEN_DICTATE_MANAGED_API_ORIGIN"),
        cfg!(debug_assertions),
    )
}

fn validate_managed_endpoint_for_origin(
    endpoint: &str,
    allowed_origin: Option<&str>,
    allow_local_debug: bool,
) -> AppResult<()> {
    let url = Url::parse(endpoint)
        .map_err(|_| AppError::InvalidRequest("managed API endpoint is invalid".into()))?;
    if url.username() != ""
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(AppError::InvalidRequest(
            "managed API endpoint contains unsupported URL components".into(),
        ));
    }
    if !url.path().ends_with("/v1/dictations/transcribe") {
        return Err(AppError::InvalidRequest(
            "managed API endpoint path is invalid".into(),
        ));
    }

    let local_debug =
        allow_local_debug && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if url.scheme() != "https" && !(local_debug && url.scheme() == "http") {
        return Err(AppError::InvalidRequest(
            "managed API endpoint must use HTTPS".into(),
        ));
    }
    if local_debug {
        return Ok(());
    }

    let allowed_origin = allowed_origin.ok_or_else(|| {
        AppError::InvalidRequest("managed API origin is not configured in this build".into())
    })?;
    let allowed = Url::parse(allowed_origin)
        .map_err(|_| AppError::InvalidRequest("configured managed API origin is invalid".into()))?;
    let same_origin = url.scheme() == allowed.scheme()
        && url.host_str() == allowed.host_str()
        && url.port_or_known_default() == allowed.port_or_known_default();
    if !same_origin || allowed.scheme() != "https" {
        return Err(AppError::InvalidRequest(
            "managed API endpoint is not an approved origin".into(),
        ));
    }
    Ok(())
}

fn extract_output_text(payload: &Value) -> Option<&str> {
    payload.get("output")?.as_array()?.iter().find_map(|item| {
        item.get("content")?.as_array()?.iter().find_map(|content| {
            (content.get("type")?.as_str()? == "output_text")
                .then(|| content.get("text")?.as_str())
                .flatten()
        })
    })
}

fn transcription_model() -> String {
    std::env::var("OPENAI_TRANSCRIBE_MODEL")
        .ok()
        .map(|model| model.trim().to_owned())
        .filter(|model| !model.is_empty())
        .unwrap_or_else(|| DEFAULT_TRANSCRIPTION_MODEL.into())
}

fn should_try_transcription_fallback(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::BAD_REQUEST
            | StatusCode::FORBIDDEN
            | StatusCode::NOT_FOUND
            | StatusCode::UNPROCESSABLE_ENTITY
    )
}

async fn provider_response_error(response: Response, operation: &'static str) -> AppError {
    let status = response.status();
    let provider_request_id = request_id(response.headers());
    let payload = response.json::<Value>().await.ok();
    let provider_code = error_code_from_payload(payload.as_ref());

    log::warn!(
        "OpenAI {operation} request rejected: status={status}, code={}, request_id={}",
        provider_code.as_deref().unwrap_or("unknown"),
        provider_request_id.as_deref().unwrap_or("unknown")
    );
    provider_status_with_code(status, provider_code.as_deref())
}

async fn managed_response_error(response: Response) -> AppError {
    let status = response.status();
    let managed_request_id = request_id(response.headers());
    let payload = response.json::<Value>().await.ok();
    let code = error_code_from_payload(payload.as_ref());

    log::warn!(
        "managed transcription request rejected: status={status}, code={}, request_id={}",
        code.as_deref().unwrap_or("unknown"),
        managed_request_id.as_deref().unwrap_or("unknown")
    );
    match code {
        Some(code) => AppError::Provider(format!(
            "managed transcription was rejected ({status}; code={code})"
        )),
        None => provider_status(status),
    }
}

fn error_code_from_payload(payload: Option<&Value>) -> Option<String> {
    payload
        .and_then(|value| {
            value
                .pointer("/error/code")
                .and_then(Value::as_str)
                .or_else(|| value.pointer("/error/type").and_then(Value::as_str))
        })
        .filter(|value| {
            value.len() <= 80
                && value
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || "_-.".contains(character))
        })
        .map(str::to_owned)
}

fn request_id(headers: &HeaderMap<HeaderValue>) -> Option<String> {
    headers
        .get("x-request-id")
        .or_else(|| headers.get("openai-request-id"))
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
}

fn network_error(error: reqwest::Error) -> AppError {
    if error.is_timeout() {
        AppError::Network("request timed out".into())
    } else if error.is_connect() {
        AppError::Network("could not connect to the service".into())
    } else {
        AppError::Network("request could not be completed".into())
    }
}

fn provider_status(status: StatusCode) -> AppError {
    provider_status_with_code(status, None)
}

fn provider_status_with_code(status: StatusCode, provider_code: Option<&str>) -> AppError {
    let message = match status.as_u16() {
        400 => "the service rejected the request",
        401 | 403 => "authentication was rejected",
        402 => "the account has no remaining allowance",
        413 => "the recording is too large",
        429 => "the service is temporarily rate limited",
        500..=599 => "the service is temporarily unavailable",
        _ => "the service rejected the request",
    };
    match provider_code {
        Some(code) => AppError::Provider(format!("{message} ({status}; code={code})")),
        None => AppError::Provider(format!("{message} ({status})")),
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{
        extract_output_text, managed_recovery_request_deadline,
        validate_managed_endpoint_for_origin, MANAGED_RECOVERY_REQUEST_TIMEOUT,
    };
    use serde_json::json;
    use tokio::time::Instant;

    #[test]
    fn extracts_structured_response_text() {
        let payload = json!({
            "output": [{ "content": [{ "type": "output_text", "text": "{\"text\":\"Hello.\"}" }] }]
        });
        assert_eq!(extract_output_text(&payload), Some("{\"text\":\"Hello.\"}"));
    }

    #[test]
    fn managed_endpoint_requires_https_outside_local_debug() {
        let allowed = Some("https://api.example.com");
        assert!(validate_managed_endpoint_for_origin(
            "https://api.example.com/v1/dictations/transcribe",
            allowed,
            false,
        )
        .is_ok());
        assert!(validate_managed_endpoint_for_origin(
            "https://attacker.example/v1/dictations/transcribe",
            allowed,
            false,
        )
        .is_err());
        assert!(validate_managed_endpoint_for_origin("file:///tmp/audio", allowed, false).is_err());
        assert!(validate_managed_endpoint_for_origin(
            "http://api.example.com/v1/dictations/transcribe",
            allowed,
            false,
        )
        .is_err());
        assert!(validate_managed_endpoint_for_origin(
            "http://127.0.0.1:5001/project/region/api/v1/dictations/transcribe",
            None,
            true,
        )
        .is_ok());
    }

    #[test]
    fn managed_recovery_request_timeout_is_capped_by_remaining_budget() {
        let now = Instant::now();
        let short_deadline = now + Duration::from_secs(7);
        let long_deadline = now + Duration::from_secs(60);

        assert_eq!(
            managed_recovery_request_deadline(now, short_deadline).unwrap(),
            short_deadline
        );
        assert_eq!(
            managed_recovery_request_deadline(now, long_deadline).unwrap(),
            now + MANAGED_RECOVERY_REQUEST_TIMEOUT
        );
    }

    #[test]
    fn managed_recovery_rejects_an_exhausted_budget() {
        let deadline = Instant::now();

        assert!(managed_recovery_request_deadline(deadline, deadline).is_err());
    }
}
