use keyring::{Entry, Error as KeyringError};

use crate::errors::{AppError, AppResult};

const AI_KEY_SERVICE: &str = "desktop-record-pet";
const AI_KEY_ACCOUNT: &str = "ai-api-key";

fn ai_api_key_entry() -> AppResult<Entry> {
    Entry::new(AI_KEY_SERVICE, AI_KEY_ACCOUNT)
        .map_err(|error| AppError::State(format!("credential store unavailable: {error}")))
}

pub fn get_ai_api_key() -> AppResult<Option<String>> {
    match ai_api_key_entry()?.get_password() {
        Ok(value) if value.trim().is_empty() => Ok(None),
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(AppError::State(format!(
            "could not read AI API key from the credential store: {error}"
        ))),
    }
}

pub fn set_ai_api_key(value: &str) -> AppResult<()> {
    if value.trim().is_empty() {
        return Err(AppError::Validation("AI API key is required".into()));
    }

    ai_api_key_entry()?
        .set_password(value)
        .map_err(|error| AppError::State(format!("could not save AI API key: {error}")))
}

pub fn clear_ai_api_key() -> AppResult<()> {
    match ai_api_key_entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(AppError::State(format!(
            "could not clear AI API key: {error}"
        ))),
    }
}
