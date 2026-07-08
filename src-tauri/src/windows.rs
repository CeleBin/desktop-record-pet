use tauri::{AppHandle, Emitter, Manager};

use crate::errors::{AppError, AppResult};

pub const QUICK_INPUT_LABEL: &str = "quick-input";
pub const MAIN_PANEL_LABEL: &str = "main-panel";
pub const SCREENSHOT_OVERLAY_LABEL: &str = "screenshot-overlay";
pub const PET_LABEL: &str = "pet";
pub const TODO_OVERLAY_LABEL: &str = "todo-overlay";
pub const QUICK_INPUT_RESET_EVENT: &str = "quick-input:reset";

// Stable window-management -- extend with new helpers, never delete existing ones.
pub fn ensure_window_runtime_ready() -> AppResult<()> {
    Ok(())
}

pub fn should_hide_instead_of_close(label: &str) -> bool {
    matches!(label, MAIN_PANEL_LABEL | PET_LABEL | TODO_OVERLAY_LABEL)
}

pub fn show_quick_input(app: &AppHandle) -> AppResult<()> {
    let window = get_window(app, QUICK_INPUT_LABEL)?;
    window
        .emit(QUICK_INPUT_RESET_EVENT, ())
        .map_err(|error| AppError::State(error.to_string()))?;
    window
        .show()
        .map_err(|error| AppError::State(error.to_string()))?;
    window
        .set_focus()
        .map_err(|error| AppError::State(error.to_string()))?;
    Ok(())
}

pub fn show_main_panel(app: &AppHandle) -> AppResult<()> {
    let window = get_window(app, MAIN_PANEL_LABEL)?;
    window
        .show()
        .map_err(|error| AppError::State(error.to_string()))?;
    window
        .unminimize()
        .map_err(|error| AppError::State(error.to_string()))?;
    window
        .set_focus()
        .map_err(|error| AppError::State(error.to_string()))?;
    Ok(())
}

/// Show and focus the pet window.
pub fn show_pet(app: &AppHandle) -> AppResult<()> {
    show_window(app, PET_LABEL)
}

/// Hide the pet window.
pub fn hide_pet(app: &AppHandle) -> AppResult<()> {
    hide_window(app, PET_LABEL)
}

/// Toggle the pet window visibility.
pub fn toggle_pet(app: &AppHandle) -> AppResult<()> {
    let window = get_window(app, PET_LABEL)?;
    let visible = window
        .is_visible()
        .map_err(|error| AppError::State(error.to_string()))?;
    if visible {
        hide_pet(app)?;
    } else {
        show_pet(app)?;
    }
    Ok(())
}

/// Show and focus the todo-overlay window.
pub fn show_todo_overlay(app: &AppHandle) -> AppResult<()> {
    show_window(app, TODO_OVERLAY_LABEL)
}

/// Hide the todo-overlay window.
pub fn hide_todo_overlay(app: &AppHandle) -> AppResult<()> {
    hide_window(app, TODO_OVERLAY_LABEL)
}

/// Toggle the todo-overlay window visibility.
pub fn toggle_todo_overlay(app: &AppHandle) -> AppResult<()> {
    let window = get_window(app, TODO_OVERLAY_LABEL)?;
    let visible = window
        .is_visible()
        .map_err(|error| AppError::State(error.to_string()))?;
    if visible {
        hide_todo_overlay(app)?;
    } else {
        show_todo_overlay(app)?;
    }
    Ok(())
}

/// Generic show + focus for any managed window.
pub fn show_window(app: &AppHandle, label: &str) -> AppResult<()> {
    let window = get_window(app, label)?;
    window
        .show()
        .map_err(|error| AppError::State(error.to_string()))?;
    window
        .unminimize()
        .map_err(|error| AppError::State(error.to_string()))?;
    window
        .set_focus()
        .map_err(|error| AppError::State(error.to_string()))?;
    Ok(())
}

pub fn hide_window(app: &AppHandle, label: &str) -> AppResult<()> {
    let window = get_window(app, label)?;
    window
        .hide()
        .map_err(|error| AppError::State(error.to_string()))?;
    Ok(())
}

fn get_window(app: &AppHandle, label: &str) -> AppResult<tauri::WebviewWindow> {
    app.get_webview_window(label)
        .ok_or_else(|| AppError::NotFound(format!("window {label}")))
}

#[cfg(test)]
mod tests {
    use super::{
        should_hide_instead_of_close, MAIN_PANEL_LABEL, PET_LABEL, QUICK_INPUT_LABEL,
        TODO_OVERLAY_LABEL,
    };

    #[test]
    fn main_panel_close_is_intercepted() {
        assert!(should_hide_instead_of_close(MAIN_PANEL_LABEL));
    }

    #[test]
    fn pet_close_is_intercepted() {
        assert!(should_hide_instead_of_close(PET_LABEL));
    }

    #[test]
    fn quick_input_close_is_not_intercepted() {
        assert!(!should_hide_instead_of_close(QUICK_INPUT_LABEL));
    }

    #[test]
    fn todo_overlay_close_is_intercepted() {
        assert!(should_hide_instead_of_close(TODO_OVERLAY_LABEL));
    }
}
