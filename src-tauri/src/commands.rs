use std::fs;
use std::path::{Path, PathBuf};

use image::RgbaImage;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::db::{self, Database};
use crate::errors::{AppError, AppResult};
use crate::models::{
    AiResult, AiTriggerMode, AttachmentRole, AttachmentType, ClipboardImageRequest,
    CreateAiResultRequest, CreateAttachmentRequest, CreateRecordRequest, CreateTaskRequest,
    ImportFilesRequest, Record, RecordFilter, RecordSource, RecordType, RecordWithRelations,
    SettingsEntry, Task, TaskFilter, TaskStatus, UnfinishedTaskItem, UpdateRecordRequest,
};
use crate::screenshot;
use crate::windows;

// Stable command surface -- extend with new commands, never delete existing ones.

pub const DATA_CHANGED_EVENT: &str = "data-changed";

fn emit_data_changed(app: &AppHandle) -> AppResult<()> {
    app.emit(DATA_CHANGED_EVENT, ())
        .map_err(|error| AppError::State(error.to_string()))
}

fn import_files_impl(
    conn: &rusqlite::Connection,
    attachments_dir: &Path,
    request: &ImportFilesRequest,
) -> AppResult<Record> {
    let attachment_ids = request
        .paths
        .iter()
        .map(|path| persist_attachment_from_path(conn, attachments_dir, Path::new(path)))
        .collect::<AppResult<Vec<_>>>()?;

    let record = db::insert_record(
        conn,
        CreateRecordRequest {
            record_type: Some(if request.create_as_task {
                RecordType::Task
            } else if attachment_ids.len() == 1 {
                RecordType::FileNote
            } else {
                RecordType::Note
            }),
            title: Some(default_title_from_paths(&request.paths)),
            content: None,
            source: request.source,
            create_as_task: request.create_as_task,
            attachment_ids: vec![],
        },
    )?;

    for (index, attachment_id) in attachment_ids.iter().enumerate() {
        db::link_attachment(conn, &record.id, attachment_id, AttachmentRole::Main, index as i64)?;
    }

    if request.create_as_task {
        insert_default_task(conn, &record.id)?;
    }

    Ok(record)
}

#[tauri::command]
pub fn create_record(
    app: AppHandle,
    database: State<'_, Database>,
    mut request: CreateRecordRequest,
) -> AppResult<Record> {
    let record = {
        let conn = database.conn.lock()?;
        if request.create_as_task {
            request.record_type = Some(RecordType::Task);
        }

        let record = db::insert_record(&conn, request.clone())?;

        for (index, attachment_id) in request.attachment_ids.iter().enumerate() {
            db::link_attachment(
                &conn,
                &record.id,
                attachment_id,
                AttachmentRole::Main,
                index as i64,
            )?;
        }

        if request.create_as_task {
            insert_default_task(&conn, &record.id)?;
        }

        record
    };
    emit_data_changed(&app)?;
    Ok(record)
}

#[tauri::command]
pub fn import_files(
    app: AppHandle,
    database: State<'_, Database>,
    request: ImportFilesRequest,
) -> AppResult<Record> {
    if request.paths.is_empty() {
        return Err(AppError::Validation("at least one file path is required".into()));
    }

    let record = {
        let conn = database.conn.lock()?;
        import_files_impl(&conn, &database.attachments_dir, &request)?
    };
    emit_data_changed(&app)?;
    Ok(record)
}

#[tauri::command]
pub fn import_clipboard_image(
    app: AppHandle,
    database: State<'_, Database>,
    request: ClipboardImageRequest,
) -> AppResult<Record> {
    let image = RgbaImage::from_raw(request.width, request.height, request.rgba).ok_or_else(|| {
        AppError::Validation("clipboard image buffer does not match width/height".into())
    })?;

    let file_path = save_rgba_image(&database.attachments_dir, &image)?;
    let path_string = file_path.to_string_lossy().into_owned();
    let record = {
        let conn = database.conn.lock()?;
        import_files_impl(
            &conn,
            &database.attachments_dir,
            &ImportFilesRequest {
                paths: vec![path_string],
                source: request.source,
                create_as_task: request.create_as_task,
            },
        )?
    };
    emit_data_changed(&app)?;
    Ok(record)
}

#[tauri::command]
pub fn add_attachments_to_record(
    app: AppHandle,
    database: State<'_, Database>,
    record_id: String,
    paths: Vec<String>,
) -> AppResult<Record> {
    if paths.is_empty() {
        return Err(AppError::Validation("at least one file path is required".into()));
    }

    let record = {
        let conn = database.conn.lock()?;
        let existing = db::get_record_attachments(&conn, &record_id)?;
        let start_index = existing.len() as i64;

        for (offset, path) in paths.iter().enumerate() {
            let attachment_id =
                persist_attachment_from_path(&conn, &database.attachments_dir, Path::new(path))?;
            db::link_attachment(
                &conn,
                &record_id,
                &attachment_id,
                AttachmentRole::Reference,
                start_index + offset as i64,
            )?;
        }

        db::get_record(&conn, &record_id)?
    };
    emit_data_changed(&app)?;
    Ok(record)
}

#[tauri::command]
pub fn show_main_panel(app: AppHandle) -> AppResult<()> {
    windows::show_main_panel(&app)
}

#[tauri::command]
pub fn hide_window(app: AppHandle, label: String) -> AppResult<()> {
    if label.trim().is_empty() {
        return Err(AppError::Validation("window label is required".into()));
    }
    windows::hide_window(&app, &label)
}

#[tauri::command]
pub fn show_window(app: AppHandle, label: String) -> AppResult<()> {
    if label.trim().is_empty() {
        return Err(AppError::Validation("window label is required".into()));
    }
    windows::show_window(&app, &label)
}

/// Capture a region of the primary screen and save to the attachments directory.
/// Coordinates are in CSS/logical pixels (clientX/Y from the fullscreen overlay).
/// Returns the absolute path to the saved PNG.
#[tauri::command]
pub fn capture_screenshot(
    database: State<'_, Database>,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> AppResult<String> {
    let path = screenshot::capture_region(x, y, width, height, &database.attachments_dir)?;
    Ok(path.to_string_lossy().to_string())
}

/// Create a record with the screenshot as an attachment.
/// Called after the user confirms in the supplement box.
#[tauri::command]
pub fn save_screenshot_record(
    app: AppHandle,
    database: State<'_, Database>,
    content: Option<String>,
    screenshot_path: String,
    create_as_task: bool,
) -> AppResult<Record> {
    let record = {
        let conn = database.conn.lock()?;

        let record = db::insert_record(
            &conn,
            CreateRecordRequest {
                record_type: Some(if create_as_task {
                    RecordType::Task
                } else {
                    RecordType::Note
                }),
                title: None,
                content,
                source: RecordSource::BuiltInScreenshot,
                create_as_task,
                attachment_ids: vec![],
            },
        )?;

        if create_as_task {
            insert_default_task(&conn, &record.id)?;
        }

        let path = Path::new(&screenshot_path);
        let hash = screenshot::compute_file_hash(path)?;

        let attachment = db::insert_attachment(
            &conn,
            CreateAttachmentRequest {
                file_type: AttachmentType::Screenshot,
                mime_type: "image/png".into(),
                local_path: screenshot_path,
                thumbnail_path: None,
                ocr_text: None,
                hash,
            },
        )?;

        db::link_attachment(
            &conn,
            &record.id,
            &attachment.id,
            crate::models::AttachmentRole::Main,
            0,
        )?;

        record
    };
    emit_data_changed(&app)?;
    Ok(record)
}

// ── Task 7: record & task browsing commands ──────────────────────────

#[tauri::command]
pub fn list_records(
    database: State<'_, Database>,
    filter: Option<RecordFilter>,
) -> AppResult<Vec<RecordWithRelations>> {
    let conn = database.conn.lock()?;
    let records = db::list_records_filtered(&conn, filter.as_ref())?;
    // Return minimal relations for list view
    let result: Vec<RecordWithRelations> = records
        .into_iter()
        .map(RecordWithRelations::from_record_minimal)
        .collect();
    Ok(result)
}

#[tauri::command]
pub fn get_record_detail(
    database: State<'_, Database>,
    id: String,
) -> AppResult<RecordWithRelations> {
    if id.trim().is_empty() {
        return Err(AppError::Validation("record id is required".into()));
    }
    let conn = database.conn.lock()?;
    db::get_record_with_relations(&conn, &id)
}

#[tauri::command]
pub fn update_record(
    app: AppHandle,
    database: State<'_, Database>,
    id: String,
    update: UpdateRecordRequest,
) -> AppResult<Record> {
    if id.trim().is_empty() {
        return Err(AppError::Validation("record id is required".into()));
    }
    let record = {
        let conn = database.conn.lock()?;
        db::update_record(&conn, &id, update)?
    };
    emit_data_changed(&app)?;
    Ok(record)
}

#[tauri::command]
pub fn delete_record(app: AppHandle, database: State<'_, Database>, id: String) -> AppResult<()> {
    if id.trim().is_empty() {
        return Err(AppError::Validation("record id is required".into()));
    }
    {
        let conn = database.conn.lock()?;
        db::delete_record_physical(&conn, &id)?;
    }
    emit_data_changed(&app)?;
    Ok(())
}

#[tauri::command]
pub fn create_task(
    app: AppHandle,
    database: State<'_, Database>,
    request: CreateTaskRequest,
) -> AppResult<Task> {
    if request.record_id.trim().is_empty() {
        return Err(AppError::Validation("record id is required".into()));
    }
    let task = {
        let conn = database.conn.lock()?;
        db::create_task_for_record(&conn, request)?
    };
    emit_data_changed(&app)?;
    Ok(task)
}

#[tauri::command]
pub fn convert_record_to_task(
    app: AppHandle,
    database: State<'_, Database>,
    record_id: String,
) -> AppResult<Task> {
    if record_id.trim().is_empty() {
        return Err(AppError::Validation("record id is required".into()));
    }
    let task = {
        let conn = database.conn.lock()?;
        db::convert_record_to_task(&conn, &record_id)?
    };
    emit_data_changed(&app)?;
    Ok(task)
}

#[tauri::command]
pub fn list_tasks(
    database: State<'_, Database>,
    filter: Option<TaskFilter>,
) -> AppResult<Vec<Task>> {
    let conn = database.conn.lock()?;
    db::list_tasks_filtered(&conn, filter.as_ref())
}

#[tauri::command]
pub fn update_task_status(
    app: AppHandle,
    database: State<'_, Database>,
    task_id: String,
    status: TaskStatus,
) -> AppResult<Task> {
    if task_id.trim().is_empty() {
        return Err(AppError::Validation("task id is required".into()));
    }
    let task = {
        let conn = database.conn.lock()?;
        db::update_task_status(&conn, &task_id, status)?
    };
    emit_data_changed(&app)?;
    Ok(task)
}

#[tauri::command]
pub fn remove_task(app: AppHandle, database: State<'_, Database>, task_id: String) -> AppResult<Task> {
    if task_id.trim().is_empty() {
        return Err(AppError::Validation("task id is required".into()));
    }
    let task = {
        let conn = database.conn.lock()?;
        db::remove_task(&conn, &task_id)?
    };
    emit_data_changed(&app)?;
    Ok(task)
}

/// Return all unfinished tasks (todo / doing) with linked record fields
/// and attachment count, ordered by most-recently-updated first.
#[tauri::command]
pub fn list_unfinished_tasks(database: State<'_, Database>) -> AppResult<Vec<UnfinishedTaskItem>> {
    let conn = database.conn.lock()?;
    db::list_unfinished_tasks(&conn)
}

// ── Task 9: pet window commands ──────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PetPosition {
    pub x: u32,
    pub y: u32,
}

/// Retrieve saved pet window position from settings.
/// Returns None if no position has been saved yet.
#[tauri::command]
pub fn get_pet_position(database: State<'_, Database>) -> AppResult<Option<PetPosition>> {
    let conn = database.conn.lock()?;
    let x_raw = db::get_setting(&conn, "pet_position_x")?;
    let y_raw = db::get_setting(&conn, "pet_position_y")?;
    match (x_raw, y_raw) {
        (Some(x_entry), Some(y_entry)) => {
            let x: u32 = x_entry
                .value
                .parse()
                .map_err(|_| AppError::State("invalid pet_position_x".into()))?;
            let y: u32 = y_entry
                .value
                .parse()
                .map_err(|_| AppError::State("invalid pet_position_y".into()))?;
            Ok(Some(PetPosition { x, y }))
        }
        _ => Ok(None),
    }
}

/// Persist pet window position to settings for restoration on next launch.
#[tauri::command]
pub fn set_pet_position(database: State<'_, Database>, x: u32, y: u32) -> AppResult<()> {
    let conn = database.conn.lock()?;
    db::set_setting(&conn, "pet_position_x", &x.to_string())?;
    db::set_setting(&conn, "pet_position_y", &y.to_string())?;
    Ok(())
}

/// Toggle pet window visibility from the frontend.
#[tauri::command]
pub fn toggle_pet_window(app: AppHandle) -> AppResult<()> {
    windows::toggle_pet(&app)
}

// ── Task 10: settings commands ──────────────────────────────────────

/// Return all settings entries.
#[tauri::command]
pub fn get_all_settings(database: State<'_, Database>) -> AppResult<Vec<SettingsEntry>> {
    let conn = database.conn.lock()?;
    db::get_all_settings_with_defaults(&conn)
}

/// Upsert a single setting by key/value.
#[tauri::command]
pub fn update_setting(
    database: State<'_, Database>,
    key: String,
    value: String,
) -> AppResult<()> {
    if key.trim().is_empty() {
        return Err(AppError::Validation("setting key is required".into()));
    }
    let conn = database.conn.lock()?;
    db::set_setting(&conn, &key, &value)?;
    Ok(())
}

/// Delete all settings entries.
#[tauri::command]
pub fn reset_settings(database: State<'_, Database>) -> AppResult<()> {
    let conn = database.conn.lock()?;
    db::delete_all_settings(&conn)
}

// ── Editable global shortcuts ───────────────────────────────────────

/// Persist a new accelerator for the named shortcut and attempt dynamic
/// re-registration.  Returns a structured result the frontend can use to
/// show success or display a conflict message.
#[tauri::command]
pub fn set_shortcut(
    app: AppHandle,
    database: State<'_, Database>,
    shortcut_state: State<'_, crate::ShortcutState>,
    name: String,
    accelerator: String,
) -> SetShortcutResult {
    // Parse the accelerator string first so we fail fast on bad input.
    let new_shortcut: Shortcut = match accelerator.parse() {
        Ok(s) => s,
        Err(e) => {
            return SetShortcutResult {
                ok: false,
                error: Some(format!("invalid shortcut: {e}")),
            }
        }
    };

    match name.as_str() {
        "quick_capture_shortcut" => {
            let old_accel = shortcut_state
                .quick_capture
                .lock()
                .map(|g| g.clone())
                .unwrap_or_default();

            // Register the new shortcut first; if it conflicts the old one
            // stays registered so the user isn't left without a working shortcut.
            match app.global_shortcut().on_shortcut(
                new_shortcut,
                |app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        let _ = windows::show_quick_input(app);
                    }
                },
            ) {
                Ok(_) => {
                    // New shortcut registered — unregister the old one (best-effort).
                    if let Ok(old) = old_accel.parse::<Shortcut>() {
                        let _ = app.global_shortcut().unregister(old);
                    }
                    // Persist to DB and update in-memory state.
                    persist_and_update(&database, &shortcut_state, "quick_capture_shortcut", &accelerator);
                    SetShortcutResult { ok: true, error: None }
                }
                Err(e) => SetShortcutResult {
                    ok: false,
                    error: Some(e.to_string()),
                }
            }
        }
        "screenshot_shortcut" => {
            let old_accel = shortcut_state
                .screenshot
                .lock()
                .map(|g| g.clone())
                .unwrap_or_default();

            match app.global_shortcut().on_shortcut(
                new_shortcut,
                |app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        let _ = windows::show_window(app, windows::SCREENSHOT_OVERLAY_LABEL);
                    }
                },
            ) {
                Ok(_) => {
                    if let Ok(old) = old_accel.parse::<Shortcut>() {
                        let _ = app.global_shortcut().unregister(old);
                    }
                    persist_and_update(&database, &shortcut_state, "screenshot_shortcut", &accelerator);
                    SetShortcutResult { ok: true, error: None }
                }
                Err(e) => SetShortcutResult {
                    ok: false,
                    error: Some(e.to_string()),
                },
            }
        }
        _ => SetShortcutResult {
            ok: false,
            error: Some(format!("unknown shortcut name: {name}")),
        },
    }
}

/// Persist a shortcut accelerator to the settings table and update
/// the in-memory `ShortcutState` so subsequent reads are consistent.
fn persist_and_update(
    database: &State<'_, Database>,
    shortcut_state: &State<'_, crate::ShortcutState>,
    name: &str,
    accelerator: &str,
) {
    if let Ok(conn) = database.conn.lock() {
        let _ = db::set_setting(&conn, name, accelerator);
    }
    match name {
        "quick_capture_shortcut" => {
            if let Ok(mut g) = shortcut_state.quick_capture.lock() {
                *g = accelerator.to_string();
            }
        }
        "screenshot_shortcut" => {
            if let Ok(mut g) = shortcut_state.screenshot.lock() {
                *g = accelerator.to_string();
            }
        }
        _ => {}
    }
}

// ── Task 10: AI enhancement commands ────────────────────────────────

/// Store a pre-computed AI result (trivial wrapper around insert_ai_result).
#[tauri::command]
pub fn create_ai_result(
    app: AppHandle,
    database: State<'_, Database>,
    request: CreateAiResultRequest,
) -> AppResult<AiResult> {
    if request.record_id.trim().is_empty() {
        return Err(AppError::Validation("record id is required".into()));
    }
    let result = {
        let conn = database.conn.lock()?;
        db::insert_ai_result(&conn, request)?
    };
    emit_data_changed(&app)?;
    Ok(result)
}

/// Read a record + attachments, call Claude via HTTP, store an AiResult, and return it.
/// The Claude API key must be stored in settings under the key `claude_api_key`.
/// If the record has image attachments, the first one is sent as optional vision input.
#[tauri::command]
pub async fn request_ai_enhancement(
    database: State<'_, Database>,
    record_id: String,
) -> AppResult<AiResult> {
    if record_id.trim().is_empty() {
        return Err(AppError::Validation("record id is required".into()));
    }

    // Step 1: Fetch record + settings + attachments from DB (lock briefly)
    let (record, attachments, api_key) = {
        let conn = database.conn.lock()?;
        let record = db::get_record(&conn, &record_id)?;
        let api_key = db::get_setting(&conn, "claude_api_key")?
            .ok_or_else(|| {
                AppError::Validation(
                    "Claude API key not configured. Set it in settings under 'claude_api_key'."
                        .into(),
                )
            })?
            .value;
        let attachments = db::get_attachments_for_record(&conn, &record_id)?;
        (record, attachments, api_key)
    };

    // Step 2: Build a text summary of the record
    let mut text = String::new();
    if let Some(ref title) = record.title {
        text.push_str(&format!("Title: {title}\n\n"));
    }
    if let Some(ref content) = record.content {
        text.push_str(&format!("Content: {content}\n\n"));
    }
    text.push_str(&format!("Source: {}", record.source.as_str()));

    // Find the first image-type attachment
    let image_attachment = attachments
        .iter()
        .find(|a| a.file_type == AttachmentType::Image || a.file_type == AttachmentType::Screenshot);

    // Step 3: Build the Claude API request payload
    let system_prompt = r#"You are an AI analysis assistant. Analyze the provided captured record and return ONLY a raw JSON object (no markdown, no code fences) with these fields:
{
  "summary": "concise summary of the record",
  "tags": "comma-separated tags",
  "suggested_tasks": "any follow-up tasks or action items",
  "research_result": "additional insights or context",
  "sensitivity_flag": "one of: none, low, medium, high"
}"#;

    let mut content_blocks: Vec<serde_json::Value> = Vec::new();
    content_blocks.push(serde_json::json!({
        "type": "text",
        "text": format!("Please analyze this captured record:\n\n{text}")
    }));

    if let Some(att) = image_attachment {
        let path = std::path::Path::new(&att.local_path);
        if path.exists() {
            match std::fs::read(path) {
                Ok(bytes) => {
                    use base64::Engine;
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                    let media_type = if att.mime_type == "image/png"
                        || att.mime_type == "image/jpeg"
                        || att.mime_type == "image/webp"
                    {
                        &att.mime_type
                    } else {
                        "image/png"
                    };
                    content_blocks.push(serde_json::json!({
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": b64
                        }
                    }));
                }
                Err(_) => {
                    // skip image if read fails — still send text-only
                }
            }
        }
    }

    let request_body = serde_json::json!({
        "model": "claude-opus-4-7",
        "max_tokens": 4096,
        "system": system_prompt,
        "thinking": { "type": "adaptive" },
        "messages": [
            {
                "role": "user",
                "content": content_blocks
            }
        ]
    });

    // Step 4: Send the HTTP request to Anthropic
    let client = reqwest::Client::new();
    let response = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| AppError::State(format!("Claude API request failed: {e}")))?;

    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|e| AppError::State(format!("Failed to read Claude API response: {e}")))?;

    if !status.is_success() {
        return Err(AppError::State(format!(
            "Claude API returned {status}: {response_text}"
        )));
    }

    // Step 5: Parse the response — find the first text content block
    let response_json: serde_json::Value = serde_json::from_str(&response_text)
        .map_err(|e| AppError::State(format!("Failed to parse Claude JSON: {e}")))?;

    let raw_text = response_json["content"]
        .as_array()
        .and_then(|blocks| {
            blocks
                .iter()
                .find_map(|b| (b["type"] == "text").then(|| b["text"].as_str()))
                .flatten()
        })
        .unwrap_or("");

    // Claude might wrap in markdown fences — try to extract
    let cleaned = if raw_text.starts_with("```") {
        raw_text
            .lines()
            .skip(1)
            .take_while(|line| !line.starts_with("```"))
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        raw_text.to_string()
    };

    let parsed: serde_json::Value =
        serde_json::from_str(&cleaned).unwrap_or_else(|_| serde_json::json!({ "summary": raw_text }));

    let summary = parsed["summary"].as_str().map(String::from);
    let tags = parsed["tags"].as_str().map(String::from);
    let suggested_tasks = parsed["suggested_tasks"].as_str().map(String::from);
    let research_result = parsed["research_result"].as_str().map(String::from);
    let sensitivity_flag = parsed["sensitivity_flag"].as_str().map(String::from);

    // Step 6: Persist as an AiResult
    let ai_result = {
        let conn = database.conn.lock()?;
        db::insert_ai_result(
            &conn,
            CreateAiResultRequest {
                record_id,
                trigger_mode: AiTriggerMode::Manual,
                model_provider: Some("anthropic".into()),
                model_name: Some("claude-opus-4-7".into()),
                summary,
                tags,
                suggested_tasks,
                research_result,
                sensitivity_flag,
            },
        )?
    };

    Ok(ai_result)
}

fn insert_default_task(conn: &rusqlite::Connection, record_id: &str) -> AppResult<()> {
    db::insert_task(
        conn,
        CreateTaskRequest {
            record_id: record_id.to_string(),
            task_status: None,
            priority: None,
            due_at: None,
            remind_at: None,
            repeat_rule: None,
        },
    )?;
    Ok(())
}

fn persist_attachment_from_path(
    conn: &rusqlite::Connection,
    attachments_dir: &Path,
    source_path: &Path,
) -> AppResult<String> {
    if !source_path.exists() {
        return Err(AppError::NotFound(format!(
            "attachment source path {}",
            source_path.display()
        )));
    }

    let extension = source_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();

    let target_name = if extension.is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        format!("{}.{}", uuid::Uuid::new_v4(), extension)
    };

    let target_path = attachments_dir.join(target_name);
    fs::copy(source_path, &target_path)?;

    let attachment = db::insert_attachment(
        conn,
        CreateAttachmentRequest {
            file_type: infer_attachment_type(source_path),
            mime_type: infer_mime_type(source_path),
            local_path: target_path.to_string_lossy().into_owned(),
            thumbnail_path: None,
            ocr_text: None,
            hash: screenshot::compute_file_hash(&target_path)?,
        },
    )?;

    Ok(attachment.id)
}

fn save_rgba_image(attachments_dir: &Path, image: &RgbaImage) -> AppResult<PathBuf> {
    fs::create_dir_all(attachments_dir)?;
    let file_path = attachments_dir.join(format!("{}.png", uuid::Uuid::new_v4()));
    image
        .save(&file_path)
        .map_err(|error| AppError::Io(error.to_string()))?;
    Ok(file_path)
}

fn default_title_from_paths(paths: &[String]) -> String {
    if paths.len() == 1 {
        Path::new(&paths[0])
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value.to_string())
            .unwrap_or_else(|| "Imported attachment".into())
    } else {
        format!("Imported {} attachments", paths.len())
    }
}

fn infer_attachment_type(path: &Path) -> AttachmentType {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("png" | "jpg" | "jpeg" | "gif" | "bmp" | "webp") => AttachmentType::Image,
        _ => AttachmentType::File,
    }
}

fn infer_mime_type(path: &Path) -> String {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("bmp") => "image/bmp",
        Some("webp") => "image/webp",
        Some("pdf") => "application/pdf",
        Some("txt") => "text/plain",
        Some("md") => "text/markdown",
        _ => "application/octet-stream",
    }
    .into()
}

/// Structured result returned by `set_shortcut`.
/// Frontend uses `ok` to determine success and `error` for user-facing messages.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetShortcutResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_shortcut_result_ok_serializes() {
        let result = SetShortcutResult {
            ok: true,
            error: None,
        };
        let json = serde_json::to_string(&result).expect("serialize");
        assert_eq!(json, r#"{"ok":true}"#);
    }

    #[test]
    fn set_shortcut_result_error_serializes() {
        let result = SetShortcutResult {
            ok: false,
            error: Some("HotKey already registered".into()),
        };
        let json = serde_json::to_string(&result).expect("serialize");
        assert_eq!(json, r#"{"ok":false,"error":"HotKey already registered"}"#);
    }
}
