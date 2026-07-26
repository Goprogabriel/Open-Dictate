use arboard::Clipboard;
use enigo::{Enigo, Keyboard, Settings};

use crate::{
    error::{AppError, AppResult},
    native::focus::{self, FocusTarget},
};

/// Inserts into the application captured at the start of the dictation.
///
/// We deliberately fail closed if focus moved while the network request was in
/// flight. The caller then places the text on the clipboard and surfaces a
/// recoverable UI instead of typing potentially sensitive text into a different
/// application.
pub fn insert_text(target: &FocusTarget, text: &str) -> AppResult<()> {
    let text = text.trim();
    if text.is_empty() {
        return Err(AppError::InvalidRequest("text cannot be empty".into()));
    }
    if text.len() > 100_000 {
        return Err(AppError::InvalidRequest(
            "text is too large to insert".into(),
        ));
    }
    if !focus::is_current(target) {
        return Err(AppError::FocusChanged);
    }

    let mut enigo =
        Enigo::new(&Settings::default()).map_err(|error| AppError::Insertion(error.to_string()))?;
    enigo
        .text(text)
        .map_err(|error| AppError::Insertion(error.to_string()))
}

pub fn copy_text(text: &str) -> AppResult<()> {
    if text.len() > 100_000 {
        return Err(AppError::InvalidRequest("text is too large to copy".into()));
    }
    Clipboard::new()
        .and_then(|mut clipboard| clipboard.set_text(text.to_owned()))
        .map_err(|error| AppError::Insertion(error.to_string()))
}
