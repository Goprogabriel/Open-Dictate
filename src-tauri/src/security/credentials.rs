use std::path::Path;

use secrecy::SecretString;
use serde_json::json;

use crate::{
    error::{AppError, AppResult},
    security::LocalVault,
};

const CREDENTIALS_NAMESPACE: &str = "credentials";

#[derive(Debug, Default, Clone, Copy)]
pub struct CredentialStore;

impl CredentialStore {
    pub fn set_openai_key(self, directory: &Path, api_key: &str) -> AppResult<()> {
        let api_key = api_key.trim();
        if !api_key.starts_with("sk-") || !(20..=500).contains(&api_key.len()) {
            return Err(AppError::InvalidRequest(
                "the OpenAI API key format is invalid".into(),
            ));
        }
        LocalVault.save(
            directory,
            CREDENTIALS_NAMESPACE,
            &json!({ "openaiApiKey": api_key }),
        )
    }

    pub fn get_openai_key(self, directory: &Path) -> AppResult<SecretString> {
        let value = LocalVault
            .load(directory, CREDENTIALS_NAMESPACE)?
            .and_then(|value| {
                value
                    .get("openaiApiKey")
                    .and_then(|value| value.as_str())
                    .map(str::to_owned)
            })
            .ok_or_else(|| AppError::Credential("no OpenAI API key is configured".into()))?;
        Ok(SecretString::new(value.into_boxed_str()))
    }

    pub fn has_openai_key(self, directory: &Path) -> AppResult<bool> {
        Ok(LocalVault
            .load(directory, CREDENTIALS_NAMESPACE)?
            .and_then(|value| value.get("openaiApiKey").cloned())
            .and_then(|value| value.as_str().map(str::to_owned))
            .is_some_and(|value| !value.trim().is_empty()))
    }

    pub fn delete_openai_key(self, directory: &Path) -> AppResult<()> {
        LocalVault.delete(directory, CREDENTIALS_NAMESPACE)
    }
}
