use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use aes_gcm::{
    aead::{rand_core::RngCore, Aead, OsRng, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine};
use serde_json::Value;
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};

const MAGIC: &[u8; 8] = b"ODVLT01\0";
const NONCE_BYTES: usize = 12;
const KEY_BYTES: usize = 32;
const MAX_PLAINTEXT_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Default, Clone, Copy)]
pub struct LocalVault;

impl LocalVault {
    pub fn load(self, directory: &Path, namespace: &str) -> AppResult<Option<Value>> {
        let path = state_path(directory, namespace)?;
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(AppError::Credential(error.to_string())),
        };
        let key = vault_key(directory)?;
        match decrypt(namespace, &key, &bytes) {
            Ok(plaintext) => {
                let value = serde_json::from_slice(&plaintext).map_err(|_| {
                    AppError::Credential("encrypted local state is malformed".into())
                })?;
                Ok(Some(value))
            }
            Err(error) => {
                tracing::warn!(error = ?error, namespace, "ignoring unreadable encrypted local state");
                Ok(None)
            }
        }
    }

    pub fn save(self, directory: &Path, namespace: &str, value: &Value) -> AppResult<()> {
        let path = state_path(directory, namespace)?;
        let plaintext = serde_json::to_vec(value)
            .map_err(|error| AppError::InvalidRequest(error.to_string()))?;
        if plaintext.len() > MAX_PLAINTEXT_BYTES {
            return Err(AppError::InvalidRequest(
                "secure local state exceeds the size limit".into(),
            ));
        }
        let key = vault_key(directory)?;
        let encrypted = encrypt(namespace, &key, &plaintext)?;
        write_private_file(&path, &encrypted)
    }

    pub fn delete(self, directory: &Path, namespace: &str) -> AppResult<()> {
        let path = state_path(directory, namespace)?;
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(AppError::Credential(error.to_string())),
        }
    }
}

fn state_path(directory: &Path, namespace: &str) -> AppResult<PathBuf> {
    let filename = match namespace {
        "history" => "history.vault",
        "prompt" => "prompt.vault",
        "dictionary" => "dictionary.vault",
        "credentials" => "credentials.vault",
        _ => {
            return Err(AppError::InvalidRequest(
                "unknown secure state namespace".into(),
            ))
        }
    };
    Ok(directory.join("secure-state").join(filename))
}

fn vault_key(directory: &Path) -> AppResult<Zeroizing<[u8; KEY_BYTES]>> {
    let path = directory
        .join("secure-state")
        .join("local-state-key-v1.key");
    match fs::read_to_string(&path) {
        Ok(encoded) => {
            let decoded = STANDARD_NO_PAD
                .decode(encoded.trim())
                .map_err(|_| AppError::Credential("local state key is invalid".into()))?;
            let key: [u8; KEY_BYTES] = decoded.try_into().map_err(|_| {
                AppError::Credential("local state key has an invalid length".into())
            })?;
            Ok(Zeroizing::new(key))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut key = Zeroizing::new([0_u8; KEY_BYTES]);
            OsRng.fill_bytes(key.as_mut());
            write_private_file(&path, STANDARD_NO_PAD.encode(key.as_ref()).as_bytes())?;
            Ok(key)
        }
        Err(error) => Err(AppError::Credential(error.to_string())),
    }
}

fn encrypt(namespace: &str, key: &[u8; KEY_BYTES], plaintext: &[u8]) -> AppResult<Vec<u8>> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| AppError::Credential("local state encryption key is invalid".into()))?;
    let mut nonce_bytes = [0_u8; NONCE_BYTES];
    OsRng.fill_bytes(&mut nonce_bytes);
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce_bytes),
            Payload {
                msg: plaintext,
                aad: namespace.as_bytes(),
            },
        )
        .map_err(|_| AppError::Credential("could not encrypt local state".into()))?;

    let mut encoded = Vec::with_capacity(MAGIC.len() + NONCE_BYTES + ciphertext.len());
    encoded.extend_from_slice(MAGIC);
    encoded.extend_from_slice(&nonce_bytes);
    encoded.extend_from_slice(&ciphertext);
    Ok(encoded)
}

fn decrypt(
    namespace: &str,
    key: &[u8; KEY_BYTES],
    encoded: &[u8],
) -> AppResult<Zeroizing<Vec<u8>>> {
    if encoded.len() <= MAGIC.len() + NONCE_BYTES || &encoded[..MAGIC.len()] != MAGIC {
        return Err(AppError::Credential(
            "encrypted local state has an invalid format".into(),
        ));
    }
    let nonce_start = MAGIC.len();
    let ciphertext_start = nonce_start + NONCE_BYTES;
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| AppError::Credential("local state encryption key is invalid".into()))?;
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(&encoded[nonce_start..ciphertext_start]),
            Payload {
                msg: &encoded[ciphertext_start..],
                aad: namespace.as_bytes(),
            },
        )
        .map_err(|_| AppError::Credential("encrypted local state failed authentication".into()))?;
    if plaintext.len() > MAX_PLAINTEXT_BYTES {
        return Err(AppError::Credential(
            "decrypted local state exceeds the size limit".into(),
        ));
    }
    Ok(Zeroizing::new(plaintext))
}

fn write_private_file(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Credential("local state path is invalid".into()))?;
    fs::create_dir_all(parent).map_err(|error| AppError::Credential(error.to_string()))?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));

    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|error| AppError::Credential(error.to_string()))?;
    let write_result = (|| -> std::io::Result<()> {
        file.write_all(bytes)?;
        file.sync_all()
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary);
        return Err(AppError::Credential(error.to_string()));
    }

    #[cfg(windows)]
    if path.exists() {
        // Windows rename does not replace an existing destination. The file is
        // an authenticated cache, so a crash in this narrow replacement window
        // is recoverable from Firestore or an empty local state.
        fs::remove_file(path).map_err(|error| AppError::Credential(error.to_string()))?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(AppError::Credential(error.to_string()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{decrypt, encrypt};

    #[test]
    fn encrypted_state_round_trips_and_detects_tampering() {
        let key = [7_u8; 32];
        let plaintext = br#"{"dictations":[{"text":"Private text"}]}"#;
        let encoded = encrypt("history", &key, plaintext).expect("encrypt state");
        assert!(!encoded
            .windows(plaintext.len())
            .any(|window| window == plaintext));
        assert_eq!(
            decrypt("history", &key, &encoded)
                .expect("decrypt state")
                .as_slice(),
            plaintext
        );
        assert!(decrypt("dictionary", &key, &encoded).is_err());

        let mut tampered = encoded;
        let last = tampered.len() - 1;
        tampered[last] ^= 1;
        assert!(decrypt("history", &key, &tampered).is_err());
    }
}
