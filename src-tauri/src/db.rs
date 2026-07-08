#![allow(dead_code)]

// Task 2 intentionally lands the local-first persistence API before capture flows use it.
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::collections::BTreeMap;
use uuid::Uuid;

use crate::errors::{AppError, AppResult};
use crate::models::{
    AiResult, AiTriggerMode, Attachment, AttachmentRole, AttachmentType, CreateAiResultRequest,
    CreateAttachmentRequest, CreateRecordRequest, CreateTaskRequest, Folder, Record,
    RecordAttachmentLink, RecordFilter, RecordSource, RecordStatus, RecordType,
    RecordWithRelations, RepeatRule, SettingsEntry, Tag, Task, TaskFilter, TaskPriority,
    TaskStatus, UnfinishedTaskItem, UpdateRecordRequest,
};

pub struct Database {
    pub conn: Mutex<Connection>,
    pub db_path: PathBuf,
    pub attachments_dir: PathBuf,
}

pub fn attachments_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("attachments")
}

pub fn db_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("records.db")
}

pub fn init_db(app_data_dir: &Path) -> AppResult<Database> {
    fs::create_dir_all(app_data_dir)?;
    let attachments_dir = attachments_dir(app_data_dir);
    fs::create_dir_all(&attachments_dir)?;

    let db_path = db_path(app_data_dir);
    let conn = Connection::open(&db_path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
    run_migrations(&conn)?;

    Ok(Database {
        conn: Mutex::new(conn),
        db_path,
        attachments_dir,
    })
}

pub fn run_migrations(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS records (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL DEFAULT 'note',
            title TEXT,
            content TEXT,
            source TEXT NOT NULL DEFAULT 'quick-text',
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            record_id TEXT NOT NULL UNIQUE,
            task_status TEXT NOT NULL DEFAULT 'todo',
            priority TEXT NOT NULL DEFAULT 'medium',
            due_at TEXT,
            remind_at TEXT,
            repeat_rule TEXT,
            completed_at TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY(record_id) REFERENCES records(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS attachments (
            id TEXT PRIMARY KEY,
            file_type TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            local_path TEXT NOT NULL,
            thumbnail_path TEXT,
            ocr_text TEXT,
            hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS record_attachments (
            id TEXT PRIMARY KEY,
            record_id TEXT NOT NULL,
            attachment_id TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'main',
            sort_order INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY(record_id) REFERENCES records(id) ON DELETE CASCADE,
            FOREIGN KEY(attachment_id) REFERENCES attachments(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS ai_results (
            id TEXT PRIMARY KEY,
            record_id TEXT NOT NULL,
            trigger_mode TEXT NOT NULL DEFAULT 'manual',
            model_provider TEXT,
            model_name TEXT,
            summary TEXT,
            tags TEXT,
            suggested_tasks TEXT,
            research_result TEXT,
            sensitivity_flag TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(record_id) REFERENCES records(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS reminders (
            id TEXT PRIMARY KEY,
            record_id TEXT NOT NULL,
            task_id TEXT,
            trigger_at TEXT NOT NULL,
            channel TEXT NOT NULL DEFAULT 'pet-bubble',
            status TEXT NOT NULL DEFAULT 'pending',
            FOREIGN KEY(record_id) REFERENCES records(id) ON DELETE CASCADE,
            FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS folders (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tags (
            id TEXT PRIMARY KEY NOT NULL,
            name TEXT NOT NULL UNIQUE COLLATE NOCASE,
            color TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS record_tags (
            record_id TEXT NOT NULL,
            tag_id TEXT NOT NULL,
            PRIMARY KEY (record_id, tag_id),
            FOREIGN KEY (record_id) REFERENCES records(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS record_sort_orders (
            view_key TEXT NOT NULL,
            record_id TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (view_key, record_id),
            FOREIGN KEY (record_id) REFERENCES records(id) ON DELETE CASCADE
        );
        "#,
    )?;

    // ── Migration: convert old record types to 'note' ──
    conn.execute(
        "UPDATE records SET type = 'note' WHERE type IN ('experience', 'issue', 'file-note')",
        [],
    )?;

    // ── Migration: add sort_order column to tasks if missing ──
    // CREATE TABLE IF NOT EXISTS won't add columns to existing tables,
    // so we need an ALTER TABLE for databases created before this change.
    let tasks_columns: Vec<String> = conn
        .prepare("SELECT * FROM tasks LIMIT 0")?
        .column_names()
        .iter()
        .map(|s| s.to_string())
        .collect();
    if !tasks_columns.iter().any(|c| c == "sort_order") {
        conn.execute_batch("ALTER TABLE tasks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")?;
    }

    // ── Migration: add folder_id column to tasks if missing ──
    if !tasks_columns.iter().any(|c| c == "folder_id") {
        conn.execute_batch("ALTER TABLE tasks ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE")?;
    }

    Ok(())
}

pub fn insert_record(conn: &Connection, request: CreateRecordRequest) -> AppResult<Record> {
    let now = Utc::now();
    let record = Record {
        id: Uuid::new_v4().to_string(),
        record_type: request.record_type.unwrap_or_default(),
        title: request.title,
        content: request.content,
        source: request.source,
        status: RecordStatus::Active,
        created_at: now,
        updated_at: now,
    };

    conn.execute(
        "INSERT INTO records (id, type, title, content, source, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            record.id,
            record.record_type.as_str(),
            record.title,
            record.content,
            record.source.as_str(),
            record.status.as_str(),
            record.created_at.to_rfc3339(),
            record.updated_at.to_rfc3339(),
        ],
    )?;

    // Place new record at top of its type-view's sort order.
    // view_key uses plural form: note -> "notes", task -> "tasks".
    if let Some(view_key) = match record.record_type {
        RecordType::Note => Some("notes"),
        RecordType::Task => Some("tasks"),
    } {
        conn.execute(
            "INSERT INTO record_sort_orders (view_key, record_id, sort_order)
             VALUES (?1, ?2, (SELECT COALESCE(MIN(sort_order), 1) - 1 FROM record_sort_orders WHERE view_key = ?1))",
            params![view_key, record.id],
        )?;
    }

    Ok(record)
}

pub fn get_record(conn: &Connection, id: &str) -> AppResult<Record> {
    conn.query_row(
        "SELECT id, type, title, content, source, status, created_at, updated_at FROM records WHERE id = ?1",
        params![id],
        map_record,
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("record {id}")))
}

pub fn list_records(conn: &Connection) -> AppResult<Vec<Record>> {
    let mut stmt = conn.prepare(
        "SELECT id, type, title, content, source, status, created_at, updated_at FROM records ORDER BY datetime(created_at) DESC, rowid DESC",
    )?;
    let rows = stmt.query_map([], map_record)?;
    let records = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(records)
}

pub fn update_record(conn: &Connection, id: &str, update: UpdateRecordRequest) -> AppResult<Record> {
    let current = get_record(conn, id)?;
    let updated = Record {
        title: update.title.or(current.title),
        content: update.content.or(current.content),
        status: update.status.unwrap_or(current.status),
        updated_at: Utc::now(),
        ..current
    };

    conn.execute(
        "UPDATE records SET title = ?2, content = ?3, status = ?4, updated_at = ?5 WHERE id = ?1",
        params![
            updated.id,
            updated.title,
            updated.content,
            updated.status.as_str(),
            updated.updated_at.to_rfc3339(),
        ],
    )?;

    Ok(updated)
}

/// Remove a task by deleting the task row and reverting the linked record
/// type to `note`. The linked record itself is preserved.
pub fn remove_task(conn: &Connection, task_id: &str) -> AppResult<Task> {
    let task = get_task(conn, task_id)?;
    let record_id = task.record_id.clone();

    conn.execute("DELETE FROM tasks WHERE id = ?1", params![task_id])?;

    // Revert the linked record type back to note
    let now = Utc::now();
    conn.execute(
        "UPDATE records SET type = 'note', updated_at = ?2 WHERE id = ?1",
        params![record_id, now.to_rfc3339()],
    )?;

    Ok(task)
}

/// Delete a record physically: removes DB rows (record + cascaded tasks, links,
/// ai_results, reminders) and deletes linked attachment files on disk.
///
/// **DB atomicity**: All DB mutations (attachment and record deletion) are
/// performed inside a BEGIN/COMMIT transaction so the set is atomic.
///
/// **Shared-attachment safety**: Only sole-owner attachments (those linked to
/// exactly one record) are removed from the DB and filesystem.  Attachments
/// shared with other records are simply unlinked from this record and preserved.
///
/// **File-deletion ordering**: The DB transaction is committed **before** any
/// files are touched.  Missing files produce a warning (eprintln!) but do not
/// roll back or fail; other IO errors are surfaced but the DB is already
/// committed.
pub fn delete_record_physical(conn: &Connection, record_id: &str) -> AppResult<()> {
    // 1. Collect attachment IDs and local_paths before any mutation
    let mut stmt = conn.prepare(
        "SELECT a.id, a.local_path FROM attachments a
         JOIN record_attachments ra ON ra.attachment_id = a.id
         WHERE ra.record_id = ?1",
    )?;
    let rows = stmt.query_map(params![record_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let all_attachments: Vec<(String, String)> = rows.collect::<Result<_, _>>()?;

    // 2. Separate sole-owner attachments from ones shared with other records.
    //    Only sole-owner attachments get their DB rows and files removed.
    let mut sole_ids_and_paths: Vec<(String, String)> = Vec::new();
    for (attachment_id, local_path) in &all_attachments {
        let other_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM record_attachments \
                 WHERE attachment_id = ?1 AND record_id != ?2",
                params![attachment_id, record_id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if other_count == 0 {
            sole_ids_and_paths.push((attachment_id.clone(), local_path.clone()));
        }
    }

    // 3. DB mutations inside a transaction for atomicity
    conn.execute_batch("BEGIN")?;
    let db_result = (|| -> AppResult<()> {
        // Delete sole-owner attachment rows (cascades record_attachments links)
        for (attachment_id, _) in &sole_ids_and_paths {
            conn.execute(
                "DELETE FROM attachments WHERE id = ?1",
                params![attachment_id],
            )?;
        }
        // Delete the record (cascades tasks, ai_results, reminders, plus
        // any remaining record_attachments for shared attachments)
        conn.execute("DELETE FROM records WHERE id = ?1", params![record_id])?;
        Ok(())
    })();

    match db_result {
        Ok(()) => {
            conn.execute_batch("COMMIT")?;
        }
        Err(e) => {
            conn.execute_batch("ROLLBACK")?;
            return Err(e);
        }
    }

    // 4. Delete physical files for sole-owner attachments (best-effort after commit)
    for (_, local_path) in &sole_ids_and_paths {
        match std::fs::remove_file(local_path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                eprintln!("warning: attachment file not found, skipping: {local_path}");
            }
            Err(e) => {
                // DB already committed; surface the error but don't undo
                return Err(AppError::Io(e.to_string()));
            }
        }
    }

    Ok(())
}

pub fn insert_task(conn: &Connection, request: CreateTaskRequest) -> AppResult<Task> {
    // Assign sort_order: use max existing + 1, or 0 if table empty
    let max_sort: i64 = conn
        .query_row("SELECT COALESCE(MAX(sort_order), -1) FROM tasks", [], |row| row.get(0))
        .unwrap_or(-1);
    let sort_order = max_sort + 1;

    let task = Task {
        id: Uuid::new_v4().to_string(),
        record_id: request.record_id,
        task_status: request.task_status.unwrap_or_default(),
        priority: request.priority.unwrap_or_default(),
        due_at: request.due_at,
        remind_at: request.remind_at,
        repeat_rule: request.repeat_rule,
        completed_at: None,
        sort_order,
    };

    conn.execute(
        "INSERT INTO tasks (id, record_id, task_status, priority, due_at, remind_at, repeat_rule, completed_at, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            task.id,
            task.record_id,
            task.task_status.as_str(),
            task.priority.as_str(),
            task.due_at.map(|value| value.to_rfc3339()),
            task.remind_at.map(|value| value.to_rfc3339()),
            task.repeat_rule,
            task.completed_at.map(|value| value.to_rfc3339()),
            task.sort_order,
        ],
    )?;

    Ok(task)
}

pub fn get_task(conn: &Connection, id: &str) -> AppResult<Task> {
    conn.query_row(
        "SELECT id, record_id, task_status, priority, due_at, remind_at, repeat_rule, completed_at, sort_order FROM tasks WHERE id = ?1",
        params![id],
        map_task,
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("task {id}")))
}

pub fn list_tasks(conn: &Connection) -> AppResult<Vec<Task>> {
    let mut stmt = conn.prepare(
        "SELECT id, record_id, task_status, priority, due_at, remind_at, repeat_rule, completed_at, sort_order FROM tasks ORDER BY sort_order ASC, COALESCE(due_at, ''), rowid DESC",
    )?;
    let rows = stmt.query_map([], map_task)?;
    let tasks = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(tasks)
}

pub fn update_task_status(conn: &Connection, id: &str, task_status: TaskStatus) -> AppResult<Task> {
    let mut task = get_task(conn, id)?;
    task.task_status = task_status;
    let now = Utc::now();
    if task_status == TaskStatus::Done {
        task.completed_at = Some(now);

        // 如果是重复任务，创建一个新的 Record + Task 作为下一次出现
        if let Some(ref rule_json) = task.repeat_rule {
            if let Some(rule) = RepeatRule::from_json(rule_json) {
                let base_date = task
                    .due_at
                    .map(|dt| dt.date_naive())
                    .unwrap_or_else(|| now.date_naive());
                if let Some(next_date) = rule.next_date(base_date) {
                    let next_dt = next_date
                        .and_hms_opt(0, 0, 0)
                        .and_then(|t| t.and_local_timezone(Utc).earliest())
                        .unwrap_or(now);

                    // 获取原记录内容并创建新记录
                    if let Ok(record) = get_record(conn, &task.record_id) {
                        let new_record = insert_record(
                            conn,
                            CreateRecordRequest {
                                record_type: Some(RecordType::Task),
                                title: record.title.clone(),
                                content: record.content.clone(),
                                source: record.source,
                                create_as_task: false,
                                attachment_ids: vec![],
                            },
                        )?;

                        // 为新记录创建任务（设置下次出现日期和相同重复规则）
                        let _new_task = insert_task(
                            conn,
                            CreateTaskRequest {
                                record_id: new_record.id,
                                task_status: Some(TaskStatus::Todo),
                                priority: Some(task.priority),
                                due_at: Some(next_dt),
                                remind_at: task.remind_at,
                                repeat_rule: task.repeat_rule.clone(),
                            },
                        )?;
                    }
                }
            }
        }
    }

    conn.execute(
        "UPDATE tasks SET task_status = ?2, completed_at = ?3 WHERE id = ?1",
        params![
            task.id,
            task.task_status.as_str(),
            task.completed_at.map(|value| value.to_rfc3339()),
        ],
    )?;

    Ok(task)
}

/// 更新任务的重复规则。
pub fn update_task_repeat_rule(
    conn: &Connection,
    id: &str,
    repeat_rule: Option<&str>,
) -> AppResult<Task> {
    let mut task = get_task(conn, id)?;
    task.repeat_rule = repeat_rule.map(String::from);

    conn.execute(
        "UPDATE tasks SET repeat_rule = ?2 WHERE id = ?1",
        params![task.id, task.repeat_rule],
    )?;

    Ok(task)
}

/// 更新任务的截止日期。
///
/// `due_at` 为 `None` 时清除截止日期（不设期限）。
/// 返回更新后的 Task 结构体，供前端乐观更新使用。
pub fn update_task_due_at(conn: &Connection, id: &str, due_at: Option<DateTime<Utc>>) -> AppResult<Task> {
    let mut task = get_task(conn, id)?;
    task.due_at = due_at;

    conn.execute(
        "UPDATE tasks SET due_at = ?2 WHERE id = ?1",
        params![
            task.id,
            task.due_at.map(|value| value.to_rfc3339()),
        ],
    )?;

    Ok(task)
}

pub fn insert_attachment(conn: &Connection, request: CreateAttachmentRequest) -> AppResult<Attachment> {
    let attachment = Attachment {
        id: Uuid::new_v4().to_string(),
        file_type: request.file_type,
        mime_type: request.mime_type,
        local_path: request.local_path,
        thumbnail_path: request.thumbnail_path,
        ocr_text: request.ocr_text,
        hash: request.hash,
        created_at: Utc::now(),
    };

    conn.execute(
        "INSERT INTO attachments (id, file_type, mime_type, local_path, thumbnail_path, ocr_text, hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            attachment.id,
            attachment.file_type.as_str(),
            attachment.mime_type,
            attachment.local_path,
            attachment.thumbnail_path,
            attachment.ocr_text,
            attachment.hash,
            attachment.created_at.to_rfc3339(),
        ],
    )?;

    Ok(attachment)
}

pub fn get_attachment(conn: &Connection, id: &str) -> AppResult<Attachment> {
    conn.query_row(
        "SELECT id, file_type, mime_type, local_path, thumbnail_path, ocr_text, hash, created_at FROM attachments WHERE id = ?1",
        params![id],
        map_attachment,
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("attachment {id}")))
}

pub fn delete_attachment(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM attachments WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn link_attachment(
    conn: &Connection,
    record_id: &str,
    attachment_id: &str,
    role: AttachmentRole,
    sort_order: i64,
) -> AppResult<RecordAttachmentLink> {
    let link = RecordAttachmentLink {
        id: Uuid::new_v4().to_string(),
        record_id: record_id.to_string(),
        attachment_id: attachment_id.to_string(),
        role,
        sort_order,
    };

    conn.execute(
        "INSERT INTO record_attachments (id, record_id, attachment_id, role, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![link.id, link.record_id, link.attachment_id, link.role.as_str(), link.sort_order],
    )?;

    Ok(link)
}

pub fn get_record_attachments(conn: &Connection, record_id: &str) -> AppResult<Vec<RecordAttachmentLink>> {
    let mut stmt = conn.prepare(
        "SELECT id, record_id, attachment_id, role, sort_order FROM record_attachments WHERE record_id = ?1 ORDER BY sort_order ASC, rowid ASC",
    )?;
    let rows = stmt.query_map(params![record_id], |row| {
        Ok(RecordAttachmentLink {
            id: row.get(0)?,
            record_id: row.get(1)?,
            attachment_id: row.get(2)?,
            role: AttachmentRole::parse(&row.get::<_, String>(3)?),
            sort_order: row.get(4)?,
        })
    })?;
    let links = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(links)
}

pub fn insert_ai_result(conn: &Connection, request: CreateAiResultRequest) -> AppResult<AiResult> {
    let result = AiResult {
        id: Uuid::new_v4().to_string(),
        record_id: request.record_id,
        trigger_mode: request.trigger_mode,
        model_provider: request.model_provider,
        model_name: request.model_name,
        summary: request.summary,
        tags: request.tags,
        suggested_tasks: request.suggested_tasks,
        research_result: request.research_result,
        sensitivity_flag: request.sensitivity_flag,
        created_at: Utc::now(),
    };

    conn.execute(
        "INSERT INTO ai_results (id, record_id, trigger_mode, model_provider, model_name, summary, tags, suggested_tasks, research_result, sensitivity_flag, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            result.id,
            result.record_id,
            result.trigger_mode.as_str(),
            result.model_provider,
            result.model_name,
            result.summary,
            result.tags,
            result.suggested_tasks,
            result.research_result,
            result.sensitivity_flag,
            result.created_at.to_rfc3339(),
        ],
    )?;

    Ok(result)
}

pub fn get_ai_results_for_record(conn: &Connection, record_id: &str) -> AppResult<Vec<AiResult>> {
    let mut stmt = conn.prepare(
        "SELECT id, record_id, trigger_mode, model_provider, model_name, summary, tags, suggested_tasks, research_result, sensitivity_flag, created_at FROM ai_results WHERE record_id = ?1 ORDER BY datetime(created_at) DESC, rowid DESC",
    )?;
    let rows = stmt.query_map(params![record_id], map_ai_result)?;
    let items = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}

pub fn get_setting(conn: &Connection, key: &str) -> AppResult<Option<SettingsEntry>> {
    conn.query_row(
        "SELECT key, value FROM settings WHERE key = ?1",
        params![key],
        |row| {
            Ok(SettingsEntry {
                key: row.get(0)?,
                value: row.get(1)?,
            })
        },
    )
    .optional()
    .map_err(Into::into)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> AppResult<SettingsEntry> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;

    Ok(SettingsEntry {
        key: key.to_string(),
        value: value.to_string(),
    })
}

/// Read a setting by key, returning `default` when the row is missing.
/// Used for shortcut keys and other settings where a fallback is needed.
pub fn get_setting_or(conn: &Connection, key: &str, default: &str) -> AppResult<String> {
    Ok(get_setting(conn, key)?
        .map(|entry| entry.value)
        .unwrap_or_else(|| default.to_string()))
}

pub fn get_all_settings(conn: &Connection) -> AppResult<Vec<SettingsEntry>> {
    let mut stmt = conn.prepare(
        "SELECT key, value FROM settings ORDER BY key ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(SettingsEntry {
            key: row.get(0)?,
            value: row.get(1)?,
        })
    })?;
    let entries = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(entries)
}

pub fn default_settings() -> Vec<SettingsEntry> {
    vec![
        SettingsEntry { key: "language".into(), value: "zh-CN".into() },
        SettingsEntry { key: "auto_ocr".into(), value: "false".into() },
        SettingsEntry { key: "screenshot_quality".into(), value: "2".into() },
        SettingsEntry { key: "quick_capture_shortcut".into(), value: "Alt+Shift+R".into() },
        SettingsEntry { key: "screenshot_shortcut".into(), value: "Alt+Shift+S".into() },
        SettingsEntry { key: "ai_provider".into(), value: "claude".into() },
        SettingsEntry { key: "ai_model".into(), value: "claude-sonnet-4-20250514".into() },
        SettingsEntry { key: "ai_auto_analyze".into(), value: "false".into() },
        SettingsEntry { key: "ai_api_key".into(), value: "".into() },
        SettingsEntry { key: "reminder_channel".into(), value: "pet-bubble".into() },
        SettingsEntry { key: "pet_always_on_top".into(), value: "true".into() },
        SettingsEntry { key: "pet_visible".into(), value: "true".into() },
        // ── Todo-overlay settings ──
        SettingsEntry { key: "todo_overlay_visibility_mode".into(), value: "unfinished-only".into() },
        SettingsEntry { key: "todo_overlay_always_on_top".into(), value: "true".into() },
        SettingsEntry { key: "todo_overlay_opacity".into(), value: "0.8".into() },
        SettingsEntry { key: "todo_overlay_auto_collapse".into(), value: "false".into() },
        SettingsEntry { key: "todo_overlay_open_behavior".into(), value: "drawer".into() },
    ]
}

pub fn get_all_settings_with_defaults(conn: &Connection) -> AppResult<Vec<SettingsEntry>> {
    let persisted = get_all_settings(conn)?;
    let mut merged: BTreeMap<String, String> = default_settings()
        .into_iter()
        .map(|entry| (entry.key, entry.value))
        .collect();

    for entry in persisted {
        merged.insert(entry.key, entry.value);
    }

    Ok(merged
        .into_iter()
        .map(|(key, value)| SettingsEntry { key, value })
        .collect())
}

pub fn delete_all_settings(conn: &Connection) -> AppResult<()> {
    conn.execute("DELETE FROM settings", [])?;
    Ok(())
}

// ── Task 7: filtered listing helpers ──────────────────────────────────

pub fn list_records_filtered(
    conn: &Connection,
    filter: Option<&RecordFilter>,
    tag_ids: &[String],
) -> AppResult<Vec<Record>> {
    let filter = match filter {
        Some(f) => f,
        None => return list_records(conn),
    };

    let mut param_values: Vec<String> = Vec::new();

    // If a view_key is provided (notes/tasks single-type view), LEFT JOIN the
    // per-view sort order table so results can be ordered by user-defined
    // drag position. When view_key is None ("all" view), skip the join and
    // fall back to created_at ordering.
    let has_view_key = filter
        .view_key
        .as_ref()
        .map(|vk| !vk.is_empty())
        .unwrap_or(false);

    // Build SQL in correct clause order: SELECT ... FROM ... [LEFT JOIN ...] WHERE 1=1 [AND ...]
    let mut sql = String::from(
        "SELECT r.id, r.type, r.title, r.content, r.source, r.status, r.created_at, r.updated_at FROM records r",
    );
    if has_view_key {
        param_values.push(filter.view_key.as_ref().unwrap().clone());
        sql.push_str(&format!(
            " LEFT JOIN record_sort_orders rso ON rso.record_id = r.id AND rso.view_key = ?{}",
            param_values.len()
        ));
    }
    sql.push_str(" WHERE 1=1");

    if let Some(t) = &filter.type_filter {
        param_values.push(t.as_str().to_string());
        sql.push_str(&format!(" AND r.type = ?{}", param_values.len()));
    }
    if let Some(s) = &filter.status_filter {
        param_values.push(s.as_str().to_string());
        sql.push_str(&format!(" AND r.status = ?{}", param_values.len()));
    }
    if let Some(q) = &filter.search_query {
        let idx = param_values.len() + 1;
        sql.push_str(&format!(
            " AND (r.title LIKE ?{idx} OR r.content LIKE ?{idx})"
        ));
        let escaped = q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
        param_values.push(format!("%{escaped}%"));
    }

    for tag_id in tag_ids {
        let idx = param_values.len() + 1;
        sql.push_str(&format!(
            " AND EXISTS (SELECT 1 FROM record_tags rt WHERE rt.record_id = r.id AND rt.tag_id = ?{idx})"
        ));
        param_values.push(tag_id.clone());
    }

    if has_view_key {
        sql.push_str(
            " ORDER BY COALESCE(rso.sort_order, 0), datetime(r.created_at) DESC, r.rowid DESC",
        );
    } else {
        sql.push_str(" ORDER BY datetime(r.created_at) DESC, r.rowid DESC");
    }

    if let Some(limit) = filter.limit {
        sql.push_str(&format!(" LIMIT {limit}"));
    }
    if let Some(offset) = filter.offset {
        sql.push_str(&format!(" OFFSET {offset}"));
    }

    let mut stmt = conn.prepare(&sql)?;
    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|s| s as &dyn rusqlite::types::ToSql).collect();
    let rows = stmt.query_map(rusqlite::params_from_iter(param_refs), map_record)?;
    let records = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(records)
}

pub fn list_tasks_filtered(conn: &Connection, filter: Option<&TaskFilter>) -> AppResult<Vec<Task>> {
    let filter = match filter {
        Some(f) => f,
        None => return list_tasks(conn),
    };

    let mut sql = String::from(
        "SELECT id, record_id, task_status, priority, due_at, remind_at, repeat_rule, completed_at FROM tasks WHERE 1=1",
    );
    let mut param_values: Vec<String> = Vec::new();

    if let Some(s) = &filter.status {
        param_values.push(s.as_str().to_string());
        sql.push_str(&format!(" AND task_status = ?{}", param_values.len()));
    }
    if let Some(p) = &filter.priority {
        param_values.push(p.as_str().to_string());
        sql.push_str(&format!(" AND priority = ?{}", param_values.len()));
    }

    sql.push_str(" ORDER BY COALESCE(due_at, ''), rowid DESC");

    let mut stmt = conn.prepare(&sql)?;
    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|s| s as &dyn rusqlite::types::ToSql).collect();
    let rows = stmt.query_map(rusqlite::params_from_iter(param_refs), map_task)?;
    let tasks = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(tasks)
}

pub fn get_task_for_record(conn: &Connection, record_id: &str) -> AppResult<Option<Task>> {
    conn.query_row(
        "SELECT id, record_id, task_status, priority, due_at, remind_at, repeat_rule, completed_at, sort_order FROM tasks WHERE record_id = ?1",
        params![record_id],
        map_task,
    )
    .optional()
    .map_err(Into::into)
}

pub fn get_attachments_for_record(conn: &Connection, record_id: &str) -> AppResult<Vec<Attachment>> {
    let mut stmt = conn.prepare(
        "SELECT a.id, a.file_type, a.mime_type, a.local_path, a.thumbnail_path, a.ocr_text, a.hash, a.created_at
         FROM attachments a
         JOIN record_attachments ra ON ra.attachment_id = a.id
         WHERE ra.record_id = ?1
         ORDER BY ra.sort_order ASC, ra.rowid ASC",
    )?;
    let rows = stmt.query_map(params![record_id], map_attachment)?;
    let items = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}

pub fn get_record_with_relations(conn: &Connection, id: &str) -> AppResult<RecordWithRelations> {
    let record = get_record(conn, id)?;
    let task = get_task_for_record(conn, id)?;
    let attachment_links = get_record_attachments(conn, id)?;
    let attachments = get_attachments_for_record(conn, id)?;
    let ai_results = get_ai_results_for_record(conn, id)?;
    let tags = list_record_tags(conn, id)?;
    Ok(RecordWithRelations::from_record(record, task, attachments, attachment_links, ai_results, tags))
}

/// Create a task for a record with full parameter control.
/// Idempotent: if a task already exists for this record, returns it unchanged.
/// Also updates the record type to "task" to maintain consistency.
pub fn create_task_for_record(conn: &Connection, request: CreateTaskRequest) -> AppResult<Task> {
    // Idempotent: return existing task if one already exists
    if let Some(task) = get_task_for_record(conn, &request.record_id)? {
        return Ok(task);
    }

    // Verify the record exists before proceeding
    get_record(conn, &request.record_id)?;

    // Update the record type to "task"
    let now = Utc::now();
    conn.execute(
        "UPDATE records SET type = 'task', updated_at = ?2 WHERE id = ?1",
        params![request.record_id, now.to_rfc3339()],
    )?;

    insert_task(conn, request)
}

pub fn convert_record_to_task(conn: &Connection, record_id: &str) -> AppResult<Task> {
    // If a task already exists, return it
    if let Some(task) = get_task_for_record(conn, record_id)? {
        return Ok(task);
    }

    // Update the record type to "task"
    let now = Utc::now();
    conn.execute(
        "UPDATE records SET type = 'task', updated_at = ?2 WHERE id = ?1",
        params![record_id, now.to_rfc3339()],
    )?;

    // Insert the task
    insert_task(
        conn,
        CreateTaskRequest {
            record_id: record_id.to_string(),
            task_status: None,
            priority: None,
            due_at: None,
            remind_at: None,
            repeat_rule: None,
        },
    )
}

/// 刷新已到期的重复任务：将 status=done 且 repeat_rule 不为空、
/// 且 due_at 已到今天的任务重置为 "todo" 状态。
///
/// 这样用户完成一个"每天"任务后它会消失，第二天自动重新出现。
pub fn refresh_recurring_tasks(conn: &Connection) -> AppResult<()> {
    let now = Utc::now();
    let today = now.date_naive();
    // 用当天 00:00:00 UTC 作为比较阈值，所有 due_at <= 今天 00:00 的任务都该刷新
    let threshold = today
        .and_hms_opt(0, 0, 0)
        .and_then(|t| t.and_local_timezone(Utc).earliest())
        .unwrap_or(now);

    conn.execute(
        "UPDATE tasks SET task_status = 'todo', completed_at = NULL
         WHERE task_status = 'done'
           AND repeat_rule IS NOT NULL
           AND repeat_rule != ''
           AND due_at IS NOT NULL
           AND due_at <= ?1",
        params![threshold.to_rfc3339()],
    )?;

    Ok(())
}

/// Return all tasks with status `todo` or `doing`, joined with the linked
/// record's title/content/updated_at and an attachment count.
///
/// The returned vector is ordered by `sort_order` ascending so users can
/// reorder tasks via drag-and-drop, with fallback to `updated_at` desc.
pub fn list_unfinished_tasks(conn: &Connection) -> AppResult<Vec<UnfinishedTaskItem>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.record_id, t.task_status, t.priority, t.due_at, t.remind_at,
                t.repeat_rule, t.completed_at, t.sort_order,
                r.title, r.content, r.updated_at,
                (SELECT COUNT(*) FROM record_attachments WHERE record_id = r.id) AS attachment_count,
                t.folder_id
         FROM tasks t
         JOIN records r ON r.id = t.record_id
         WHERE t.task_status IN ('todo', 'doing')
         ORDER BY t.sort_order ASC, datetime(r.updated_at) DESC, r.rowid DESC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(UnfinishedTaskItem {
            task_id: row.get(0)?,
            record_id: row.get(1)?,
            task_status: TaskStatus::parse(&row.get::<_, String>(2)?),
            priority: TaskPriority::parse(&row.get::<_, String>(3)?),
            due_at: parse_optional_datetime(row.get::<_, Option<String>>(4)?)?,
            remind_at: parse_optional_datetime(row.get::<_, Option<String>>(5)?)?,
            repeat_rule: row.get(6)?,
            completed_at: parse_optional_datetime(row.get::<_, Option<String>>(7)?)?,
            sort_order: row.get(8)?,
            record_title: row.get(9)?,
            record_content: row.get(10)?,
            record_updated_at: parse_datetime(&row.get::<_, String>(11)?)?,
            attachment_count: row.get(12)?,
            folder_id: row.get(13)?,
        })
    })?;

    let items = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}

/// Batch-update the `sort_order` of multiple tasks.
///
/// `order` is a list of `(task_id, new_sort_order)` pairs. Each task's
/// `sort_order` is set to the provided value inside a single transaction
/// so the reorder is atomic.
pub fn reorder_tasks(conn: &Connection, order: &[(String, i64)]) -> AppResult<()> {
    conn.execute_batch("BEGIN")?;
    for (task_id, sort_order) in order {
        conn.execute(
            "UPDATE tasks SET sort_order = ?2 WHERE id = ?1",
            params![task_id, sort_order],
        )?;
    }
    conn.execute_batch("COMMIT")?;
    Ok(())
}

/// Batch-update the sort order of records within a single view (notes/tasks).
///
/// `view_key` is "notes" or "tasks". `order` is a list of
/// `(record_id, new_sort_order)` pairs. Uses INSERT OR REPLACE so records
/// that don't yet have a sort_order row for this view are inserted rather
/// than silently dropped. Atomic via a single transaction.
pub fn reorder_records(
    conn: &Connection,
    view_key: &str,
    order: &[(String, i64)],
) -> AppResult<()> {
    conn.execute_batch("BEGIN")?;
    for (record_id, sort_order) in order {
        conn.execute(
            "INSERT OR REPLACE INTO record_sort_orders (view_key, record_id, sort_order) VALUES (?1, ?2, ?3)",
            params![view_key, record_id, sort_order],
        )?;
    }
    conn.execute_batch("COMMIT")?;
    Ok(())
}

// ── Folder CRUD ─────────────────────────────────────────────────

pub fn list_folders(conn: &Connection) -> AppResult<Vec<Folder>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, sort_order, created_at, updated_at FROM folders ORDER BY sort_order ASC, created_at ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Folder {
            id: row.get(0)?,
            name: row.get(1)?,
            sort_order: row.get(2)?,
            created_at: parse_datetime(&row.get::<_, String>(3)?)?,
            updated_at: parse_datetime(&row.get::<_, String>(4)?)?,
        })
    })?;
    let folders = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(folders)
}

pub fn create_folder(conn: &Connection, name: &str) -> AppResult<Folder> {
    let now = Utc::now();
    let max_sort: i64 = conn
        .query_row("SELECT COALESCE(MAX(sort_order), -1) FROM folders", [], |row| row.get(0))
        .unwrap_or(-1);

    let folder = Folder {
        id: Uuid::new_v4().to_string(),
        name: name.to_string(),
        sort_order: max_sort + 1,
        created_at: now,
        updated_at: now,
    };

    conn.execute(
        "INSERT INTO folders (id, name, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![folder.id, folder.name, folder.sort_order, folder.created_at.to_rfc3339(), folder.updated_at.to_rfc3339()],
    )?;

    Ok(folder)
}

pub fn rename_folder(conn: &Connection, id: &str, name: &str) -> AppResult<Folder> {
    let now = Utc::now();
    conn.execute(
        "UPDATE folders SET name = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, name, now.to_rfc3339()],
    )?;

    conn.query_row(
        "SELECT id, name, sort_order, created_at, updated_at FROM folders WHERE id = ?1",
        params![id],
        |row| {
            Ok(Folder {
                id: row.get(0)?,
                name: row.get(1)?,
                sort_order: row.get(2)?,
                created_at: parse_datetime(&row.get::<_, String>(3)?)?,
                updated_at: parse_datetime(&row.get::<_, String>(4)?)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("folder {id}")))
}

pub fn delete_folder(conn: &Connection, id: &str) -> AppResult<()> {
    conn.query_row("SELECT id FROM folders WHERE id = ?1", params![id], |_| Ok(()))
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("folder {id}")))?;

    conn.execute("DELETE FROM folders WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn move_task_to_folder(conn: &Connection, task_id: &str, folder_id: Option<&str>) -> AppResult<()> {
    let updated = conn.execute(
        "UPDATE tasks SET folder_id = ?2 WHERE id = ?1",
        params![task_id, folder_id],
    )?;
    if updated == 0 {
        return Err(AppError::NotFound(format!("task {task_id}")));
    }
    Ok(())
}

pub fn reorder_folders(conn: &Connection, order: &[(String, i64)]) -> AppResult<()> {
    conn.execute_batch("BEGIN")?;
    for (folder_id, sort_order) in order {
        conn.execute(
            "UPDATE folders SET sort_order = ?2 WHERE id = ?1",
            params![folder_id, sort_order],
        )?;
    }
    conn.execute_batch("COMMIT")?;
    Ok(())
}

// ── Tag CRUD ────────────────────────────────────────────────────

pub fn create_tag(conn: &Connection, name: &str, color: Option<&str>) -> AppResult<Tag> {
    let tag = Tag {
        id: Uuid::new_v4().to_string(),
        name: name.to_string(),
        color: color.map(String::from),
        created_at: Utc::now(),
    };

    conn.execute(
        "INSERT INTO tags (id, name, color, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![tag.id, tag.name, tag.color, tag.created_at.to_rfc3339()],
    )?;

    Ok(tag)
}

pub fn list_tags(conn: &Connection) -> AppResult<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, color, created_at FROM tags ORDER BY name COLLATE NOCASE ASC",
    )?;
    let rows = stmt.query_map([], map_tag)?;
    let tags = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(tags)
}

pub fn update_tag(
    conn: &Connection,
    id: &str,
    name: Option<&str>,
    color: Option<Option<&str>>,
) -> AppResult<Tag> {
    if let Some(n) = name {
        conn.execute("UPDATE tags SET name = ?2 WHERE id = ?1", params![id, n])?;
    }
    match color {
        Some(Some(c)) => {
            conn.execute("UPDATE tags SET color = ?2 WHERE id = ?1", params![id, c])?;
        }
        Some(None) => {
            conn.execute("UPDATE tags SET color = NULL WHERE id = ?1", params![id])?;
        }
        None => {}
    }

    conn.query_row(
        "SELECT id, name, color, created_at FROM tags WHERE id = ?1",
        params![id],
        map_tag,
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("tag {id}")))
}

pub fn delete_tag(conn: &Connection, id: &str) -> AppResult<()> {
    let updated = conn.execute("DELETE FROM tags WHERE id = ?1", params![id])?;
    if updated == 0 {
        return Err(AppError::NotFound(format!("tag {id}")));
    }
    Ok(())
}

pub fn set_record_tags(conn: &Connection, record_id: &str, tag_ids: &[String]) -> AppResult<()> {
    conn.execute("DELETE FROM record_tags WHERE record_id = ?1", params![record_id])?;
    for tag_id in tag_ids {
        conn.execute(
            "INSERT OR IGNORE INTO record_tags (record_id, tag_id) VALUES (?1, ?2)",
            params![record_id, tag_id],
        )?;
    }
    Ok(())
}

pub fn list_record_tags(conn: &Connection, record_id: &str) -> AppResult<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, t.color, t.created_at
         FROM tags t
         INNER JOIN record_tags rt ON rt.tag_id = t.id
         WHERE rt.record_id = ?1
         ORDER BY t.name COLLATE NOCASE ASC",
    )?;
    let rows = stmt.query_map(params![record_id], map_tag)?;
    let tags = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(tags)
}

pub fn find_or_create_tag_by_name(conn: &Connection, name: &str) -> AppResult<Tag> {
    conn.query_row(
        "SELECT id, name, color, created_at FROM tags WHERE name = ?1 COLLATE NOCASE",
        params![name],
        map_tag,
    )
    .optional()?
    .map_or_else(|| create_tag(conn, name, None), Ok)
}

pub fn link_tags_to_record(conn: &Connection, record_id: &str, tag_ids: &[String]) -> AppResult<()> {
    for tag_id in tag_ids {
        conn.execute(
            "INSERT OR IGNORE INTO record_tags (record_id, tag_id) VALUES (?1, ?2)",
            params![record_id, tag_id],
        )?;
    }
    Ok(())
}

fn map_tag(row: &Row<'_>) -> rusqlite::Result<Tag> {
    Ok(Tag {
        id: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        created_at: parse_datetime(&row.get::<_, String>(3)?)?,
    })
}

fn map_record(row: &Row<'_>) -> rusqlite::Result<Record> {
    Ok(Record {
        id: row.get(0)?,
        record_type: RecordType::parse(&row.get::<_, String>(1)?),
        title: row.get(2)?,
        content: row.get(3)?,
        source: RecordSource::parse(&row.get::<_, String>(4)?),
        status: RecordStatus::parse(&row.get::<_, String>(5)?),
        created_at: parse_datetime(&row.get::<_, String>(6)?)?,
        updated_at: parse_datetime(&row.get::<_, String>(7)?)?,
    })
}

fn map_task(row: &Row<'_>) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get(0)?,
        record_id: row.get(1)?,
        task_status: TaskStatus::parse(&row.get::<_, String>(2)?),
        priority: TaskPriority::parse(&row.get::<_, String>(3)?),
        due_at: parse_optional_datetime(row.get(4)?)?,
        remind_at: parse_optional_datetime(row.get(5)?)?,
        repeat_rule: row.get(6)?,
        completed_at: parse_optional_datetime(row.get(7)?)?,
        sort_order: row.get(8)?,
    })
}

fn map_attachment(row: &Row<'_>) -> rusqlite::Result<Attachment> {
    Ok(Attachment {
        id: row.get(0)?,
        file_type: AttachmentType::parse(&row.get::<_, String>(1)?),
        mime_type: row.get(2)?,
        local_path: row.get(3)?,
        thumbnail_path: row.get(4)?,
        ocr_text: row.get(5)?,
        hash: row.get(6)?,
        created_at: parse_datetime(&row.get::<_, String>(7)?)?,
    })
}

fn map_ai_result(row: &Row<'_>) -> rusqlite::Result<AiResult> {
    Ok(AiResult {
        id: row.get(0)?,
        record_id: row.get(1)?,
        trigger_mode: AiTriggerMode::parse(&row.get::<_, String>(2)?),
        model_provider: row.get(3)?,
        model_name: row.get(4)?,
        summary: row.get(5)?,
        tags: row.get(6)?,
        suggested_tasks: row.get(7)?,
        research_result: row.get(8)?,
        sensitivity_flag: row.get(9)?,
        created_at: parse_datetime(&row.get::<_, String>(10)?)?,
    })
}

fn parse_datetime(value: &str) -> rusqlite::Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })
}

fn parse_optional_datetime(value: Option<String>) -> rusqlite::Result<Option<DateTime<Utc>>> {
    value.map(|value| parse_datetime(&value)).transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
    AttachmentRole, CreateAttachmentRequest, CreateRecordRequest, CreateTaskRequest, RecordSource,
    RecordType, TaskPriority, TaskStatus,
};

    fn in_memory() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        run_migrations(&conn).expect("migrations");
        conn
    }

    #[test]
    fn creates_schema_in_memory() {
        let conn = in_memory();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('records','tasks','attachments','record_attachments','ai_results','reminders','settings','tags','record_tags')",
                [],
                |row| row.get(0),
            )
            .expect("table count");
        assert_eq!(count, 9);
    }

    #[test]
    fn inserts_and_reads_record() {
        let conn = in_memory();
        let record = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: Some(RecordType::Note),
                title: Some("VPN broken".into()),
                content: Some("Cannot connect after reboot".into()),
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
            },
        )
        .expect("insert record");

        let fetched = get_record(&conn, &record.id).expect("get record");
        assert_eq!(fetched.record_type, RecordType::Note);
        assert_eq!(fetched.title.as_deref(), Some("VPN broken"));
    }

    #[test]
    fn inserts_and_reads_task_for_record() {
        let conn = in_memory();
        let record = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: Some(RecordType::Task),
                title: Some("Follow up incident".into()),
                content: None,
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
            },
        )
        .expect("record");

        let task = insert_task(
            &conn,
            CreateTaskRequest {
                record_id: record.id,
                task_status: None,
                priority: Some(TaskPriority::High),
                due_at: None,
                remind_at: None,
                repeat_rule: None,
            },
        )
        .expect("task");

        let fetched = get_task(&conn, &task.id).expect("get task");
        assert_eq!(fetched.priority, TaskPriority::High);
        assert_eq!(fetched.task_status, TaskStatus::Todo);
    }

    #[test]
    fn inserts_attachment_and_link() {
        let conn = in_memory();
        let record = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: None,
                title: None,
                content: None,
                source: RecordSource::DragDrop,
                create_as_task: false,
                attachment_ids: vec![],
            },
        )
        .expect("record");

        let attachment = insert_attachment(
            &conn,
            CreateAttachmentRequest {
                file_type: AttachmentType::File,
                mime_type: "text/plain".into(),
                local_path: "C:/tmp/test.txt".into(),
                thumbnail_path: None,
                ocr_text: None,
                hash: "hash-1".into(),
            },
        )
        .expect("attachment");

        link_attachment(&conn, &record.id, &attachment.id, AttachmentRole::Main, 0).expect("link");

        let links = get_record_attachments(&conn, &record.id).expect("links");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].attachment_id, attachment.id);
    }

    #[test]
    fn lists_records_newest_first() {
        let conn = in_memory();
        let older = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: None,
                title: Some("older".into()),
                content: None,
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
            },
        )
        .expect("older");
        std::thread::sleep(std::time::Duration::from_millis(5));
        let newer = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: None,
                title: Some("newer".into()),
                content: None,
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
            },
        )
        .expect("newer");

        let records = list_records(&conn).expect("list");
        assert_eq!(records[0].id, newer.id);
        assert_eq!(records[1].id, older.id);
    }

    #[test]
    fn settings_roundtrip() {
        let conn = in_memory();
        set_setting(&conn, "pet_mode", "normal").expect("set");
        let value = get_setting(&conn, "pet_mode").expect("get").expect("some");
        assert_eq!(value.value, "normal");
    }

    #[test]
    fn deleting_record_cascades_to_task_and_links() {
        let conn = in_memory();
        let record = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: Some(RecordType::Task),
                title: Some("cascade".into()),
                content: None,
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
            },
        )
        .expect("record");

        let task = insert_task(
            &conn,
            CreateTaskRequest {
                record_id: record.id.clone(),
                task_status: None,
                priority: None,
                due_at: None,
                remind_at: None,
                repeat_rule: None,
            },
        )
        .expect("task");

        let attachment = insert_attachment(
            &conn,
            CreateAttachmentRequest {
                file_type: AttachmentType::Image,
                mime_type: "image/png".into(),
                local_path: "C:/tmp/test.png".into(),
                thumbnail_path: None,
                ocr_text: None,
                hash: "hash-2".into(),
            },
        )
        .expect("attachment");
        link_attachment(&conn, &record.id, &attachment.id, AttachmentRole::Main, 0).expect("link");

        delete_record_physical(&conn, &record.id).expect("delete record physical");

        assert!(get_record(&conn, &record.id).is_err());
        assert!(get_task(&conn, &task.id).is_err());
        assert!(get_record_attachments(&conn, &record.id).expect("links").is_empty());
        // Attachment DB row is cleaned up (sole-owner)
        assert!(get_attachment(&conn, &attachment.id).is_err());
    }

    #[test]
    fn create_task_for_record_creates_and_updates_type() {
        let conn = in_memory();
        let record = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: Some(RecordType::Note),
                title: Some("make a task".into()),
                content: None,
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
            },
        )
        .expect("record");

        let task = create_task_for_record(
            &conn,
            CreateTaskRequest {
                record_id: record.id.clone(),
                task_status: Some(TaskStatus::Doing),
                priority: Some(TaskPriority::High),
                due_at: None,
                remind_at: None,
                repeat_rule: None,
            },
        )
        .expect("create task");

        assert_eq!(task.record_id, record.id);
        assert_eq!(task.task_status, TaskStatus::Doing);
        assert_eq!(task.priority, TaskPriority::High);
        assert!(task.completed_at.is_none());

        // Record type was updated
        let updated = get_record(&conn, &record.id).expect("get record");
        assert_eq!(updated.record_type, RecordType::Task);
    }

    #[test]
    fn create_task_for_record_is_idempotent() {
        let conn = in_memory();
        let record = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: Some(RecordType::Note),
                title: Some("idempotent task".into()),
                content: None,
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
            },
        )
        .expect("record");

        let first = create_task_for_record(
            &conn,
            CreateTaskRequest {
                record_id: record.id.clone(),
                task_status: Some(TaskStatus::Todo),
                priority: Some(TaskPriority::Low),
                due_at: None,
                remind_at: None,
                repeat_rule: None,
            },
        )
        .expect("first call");

        let second = create_task_for_record(
            &conn,
            CreateTaskRequest {
                record_id: record.id.clone(),
                task_status: Some(TaskStatus::Done), // should be ignored
                priority: Some(TaskPriority::High),   // should be ignored
                due_at: None,
                remind_at: None,
                repeat_rule: None,
            },
        )
        .expect("second call");

        // Same task returned (idempotent)
        assert_eq!(first.id, second.id);
        assert_eq!(first.task_status, second.task_status);
        assert_eq!(first.priority, second.priority);
    }

    #[test]
    fn create_task_for_record_errors_on_missing_record() {
        let conn = in_memory();
        let result = create_task_for_record(
            &conn,
            CreateTaskRequest {
                record_id: "nonexistent-id".into(),
                task_status: None,
                priority: None,
                due_at: None,
                remind_at: None,
                repeat_rule: None,
            },
        );
        assert!(result.is_err());
    }

    #[test]
    fn convert_record_to_task_is_idempotent() {
        let conn = in_memory();
        let record = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: Some(RecordType::Note),
                title: Some("convert me".into()),
                content: None,
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
            },
        )
        .expect("record");

        let first = convert_record_to_task(&conn, &record.id).expect("first convert");
        assert_eq!(first.task_status, TaskStatus::Todo);
        assert_eq!(first.priority, TaskPriority::Medium);

        // Second call returns same task
        let second = convert_record_to_task(&conn, &record.id).expect("second convert");
        assert_eq!(first.id, second.id);
    }

    #[test]
    fn list_tasks_filtered_by_status() {
        let conn = in_memory();

        // Create records and tasks
        let record_a = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: Some(RecordType::Task),
                title: Some("done task".into()),
                content: None,
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
            },
        )
        .expect("record a");
        create_task_for_record(
            &conn,
            CreateTaskRequest {
                record_id: record_a.id.clone(),
                task_status: Some(TaskStatus::Done),
                priority: None,
                due_at: None,
                remind_at: None,
                repeat_rule: None,
            },
        )
        .expect("task a");

        let record_b = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: Some(RecordType::Task),
                title: Some("todo task".into()),
                content: None,
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
            },
        )
        .expect("record b");
        create_task_for_record(
            &conn,
            CreateTaskRequest {
                record_id: record_b.id.clone(),
                task_status: Some(TaskStatus::Todo),
                priority: None,
                due_at: None,
                remind_at: None,
                repeat_rule: None,
            },
        )
        .expect("task b");

        // Filter by "done"
        let done_tasks = list_tasks_filtered(
            &conn,
            Some(&TaskFilter {
                status: Some(TaskStatus::Done),
                priority: None,
            }),
        )
        .expect("filter done");
        assert_eq!(done_tasks.len(), 1);
        assert_eq!(done_tasks[0].record_id, record_a.id);

        // Filter by "todo"
        let todo_tasks = list_tasks_filtered(
            &conn,
            Some(&TaskFilter {
                status: Some(TaskStatus::Todo),
                priority: None,
            }),
        )
        .expect("filter todo");
        assert_eq!(todo_tasks.len(), 1);
        assert_eq!(todo_tasks[0].record_id, record_b.id);
    }

    // ── Editable shortcuts: persisted defaults/read path ────────────

    #[test]
    fn get_setting_or_returns_default_when_missing() {
        let conn = in_memory();
        let value = get_setting_or(&conn, "quick_capture_shortcut", "Alt+Shift+R")
            .expect("get_setting_or");
        assert_eq!(value, "Alt+Shift+R");
    }

    #[test]
    fn get_setting_or_returns_stored_value_when_set() {
        let conn = in_memory();
        set_setting(&conn, "quick_capture_shortcut", "Alt+Shift+T").expect("set");
        let value = get_setting_or(&conn, "quick_capture_shortcut", "Alt+Shift+R")
            .expect("get_setting_or");
        assert_eq!(value, "Alt+Shift+T");
    }

    // ── Task 1: remove-task semantics ─────────────────────────────

    #[test]
    fn remove_task_deletes_task_only_and_reverts_record_type() {
        let conn = in_memory();
        let record = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: Some(RecordType::Task),
                title: Some("task to remove".into()),
                content: None,
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
            },
        )
        .expect("record");

        let task = create_task_for_record(
            &conn,
            CreateTaskRequest {
                record_id: record.id.clone(),
                task_status: Some(TaskStatus::Doing),
                priority: Some(TaskPriority::High),
                due_at: None,
                remind_at: None,
                repeat_rule: None,
            },
        )
        .expect("task");

        // Verify preconditions
        assert!(get_task(&conn, &task.id).is_ok());
        let rec = get_record(&conn, &record.id).expect("record exists");
        assert_eq!(rec.record_type, RecordType::Task);

        // Act
        let removed = remove_task(&conn, &task.id).expect("remove_task");
        assert_eq!(removed.id, task.id);

        // Assert: task row is gone
        assert!(get_task(&conn, &task.id).is_err());

        // Assert: record still exists
        let rec = get_record(&conn, &record.id).expect("record still exists");

        // Assert: record type reverted to note
        assert_eq!(rec.record_type, RecordType::Note);
    }

    // ── Task 1: physical delete semantics ─────────────────────────

    #[test]
    fn delete_record_physical_removes_files_and_db_rows() {
        let conn = in_memory();

        // Create temp files for physical deletion
        let tmp = std::env::temp_dir().join(format!("phys_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).expect("create tmp dir");
        let file_a = tmp.join("a.txt");
        let file_b = tmp.join("b.png");
        std::fs::write(&file_a, b"hello").expect("write a");
        std::fs::write(&file_b, b"image").expect("write b");

        let record = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: Some(RecordType::Task),
                title: Some("physical delete".into()),
                content: None,
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
            },
        )
        .expect("record");

        let task = create_task_for_record(
            &conn,
            CreateTaskRequest {
                record_id: record.id.clone(),
                task_status: Some(TaskStatus::Todo),
                priority: None,
                due_at: None,
                remind_at: None,
                repeat_rule: None,
            },
        )
        .expect("task");

        let att_a = insert_attachment(
            &conn,
            CreateAttachmentRequest {
                file_type: AttachmentType::File,
                mime_type: "text/plain".into(),
                local_path: file_a.to_string_lossy().into_owned(),
                thumbnail_path: None,
                ocr_text: None,
                hash: "hash-a".into(),
            },
        )
        .expect("attachment a");
        let att_b = insert_attachment(
            &conn,
            CreateAttachmentRequest {
                file_type: AttachmentType::Image,
                mime_type: "image/png".into(),
                local_path: file_b.to_string_lossy().into_owned(),
                thumbnail_path: None,
                ocr_text: None,
                hash: "hash-b".into(),
            },
        )
        .expect("attachment b");

        link_attachment(&conn, &record.id, &att_a.id, AttachmentRole::Main, 0).expect("link a");
        link_attachment(&conn, &record.id, &att_b.id, AttachmentRole::Reference, 1).expect("link b");

        // Verify files exist before deletion
        assert!(file_a.exists());
        assert!(file_b.exists());

        // Act
        delete_record_physical(&conn, &record.id).expect("delete_record_physical");

        // Assert: DB rows gone
        assert!(get_record(&conn, &record.id).is_err());
        assert!(get_task(&conn, &task.id).is_err());
        assert!(get_attachment(&conn, &att_a.id).is_err());
        assert!(get_attachment(&conn, &att_b.id).is_err());

        // Assert: physical files deleted
        assert!(!file_a.exists());
        assert!(!file_b.exists());

        // Cleanup
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn delete_record_physical_missing_files_logs_warning_does_not_rollback() {
        let conn = in_memory();

        let record = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: Some(RecordType::Note),
                title: Some("missing file record".into()),
                content: None,
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
            },
        )
        .expect("record");

        let nonexistent_path =
            std::env::temp_dir().join("nonexistent_file_that_does_not_exist.txt");

        let att = insert_attachment(
            &conn,
            CreateAttachmentRequest {
                file_type: AttachmentType::File,
                mime_type: "text/plain".into(),
                local_path: nonexistent_path.to_string_lossy().into_owned(),
                thumbnail_path: None,
                ocr_text: None,
                hash: "hash-missing".into(),
            },
        )
        .expect("attachment");

        link_attachment(&conn, &record.id, &att.id, AttachmentRole::Main, 0).expect("link");

        // Act — should NOT error even though the file is missing
        delete_record_physical(&conn, &record.id).expect("delete_record_physical succeeds");

        // Assert: record is gone despite missing file
        assert!(get_record(&conn, &record.id).is_err());
        assert!(get_attachment(&conn, &att.id).is_err());
    }

    #[test]
    fn delete_record_physical_does_not_delete_shared_attachments() {
        let conn = in_memory();

        // Create a real temp file
        let tmp = std::env::temp_dir().join(format!("shared_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).expect("create tmp dir");
        let shared_file = tmp.join("shared.txt");
        std::fs::write(&shared_file, b"shared content").expect("write shared file");

        // Two records
        let record_a = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: Some(RecordType::Note),
                title: Some("record A".into()),
                content: None,
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
            },
        )
        .expect("record A");
        let record_b = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: Some(RecordType::Note),
                title: Some("record B".into()),
                content: None,
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
            },
        )
        .expect("record B");

        // One attachment shared between both records
        let att = insert_attachment(
            &conn,
            CreateAttachmentRequest {
                file_type: AttachmentType::File,
                mime_type: "text/plain".into(),
                local_path: shared_file.to_string_lossy().into_owned(),
                thumbnail_path: None,
                ocr_text: None,
                hash: "shared-hash".into(),
            },
        )
        .expect("attachment");

        link_attachment(&conn, &record_a.id, &att.id, AttachmentRole::Main, 0).expect("link A");
        link_attachment(&conn, &record_b.id, &att.id, AttachmentRole::Reference, 0).expect("link B");

        assert!(shared_file.exists());

        // Act — delete record A
        delete_record_physical(&conn, &record_a.id).expect("delete_record_physical");

        // Assert: record A is gone
        assert!(get_record(&conn, &record_a.id).is_err());

        // Assert: record B still exists
        assert!(get_record(&conn, &record_b.id).is_ok());

        // Assert: attachment still in DB (shared with record B)
        assert!(get_attachment(&conn, &att.id).is_ok());

        // Assert: the physical file still exists
        assert!(shared_file.exists());

        // Assert: record B's link to the attachment is intact
        let b_links = get_record_attachments(&conn, &record_b.id).expect("B links");
        assert_eq!(b_links.len(), 1);
        assert_eq!(b_links[0].attachment_id, att.id);

        // Cleanup
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn get_setting_or_shortcut_keys_persist_roundtrip() {
        let conn = in_memory();

        // Write both shortcut keys
        set_setting(&conn, "quick_capture_shortcut", "Ctrl+Shift+1").expect("set qc");
        set_setting(&conn, "screenshot_shortcut", "Ctrl+Shift+2").expect("set ss");

        // Read back
        let qc = get_setting_or(&conn, "quick_capture_shortcut", "Alt+Shift+R")
            .expect("qc");
        let ss = get_setting_or(&conn, "screenshot_shortcut", "Alt+Shift+S")
            .expect("ss");

        assert_eq!(qc, "Ctrl+Shift+1");
        assert_eq!(ss, "Ctrl+Shift+2");
    }

    #[test]
    fn get_all_settings_with_defaults_returns_defaults_when_table_empty() {
        let conn = in_memory();

        let settings = get_all_settings_with_defaults(&conn).expect("settings");

        assert!(settings.iter().any(|entry| entry.key == "quick_capture_shortcut" && entry.value == "Alt+Shift+R"));
        assert!(settings.iter().any(|entry| entry.key == "screenshot_shortcut" && entry.value == "Alt+Shift+S"));
        assert!(settings.iter().any(|entry| entry.key == "pet_visible"));
    }

    #[test]
    fn get_all_settings_with_defaults_prefers_persisted_values() {
        let conn = in_memory();

        set_setting(&conn, "quick_capture_shortcut", "Ctrl+Shift+9").expect("set shortcut");
        set_setting(&conn, "ai_provider", "openai").expect("set provider");

        let settings = get_all_settings_with_defaults(&conn).expect("settings");

        assert!(settings.iter().any(|entry| entry.key == "quick_capture_shortcut" && entry.value == "Ctrl+Shift+9"));
        assert!(settings.iter().any(|entry| entry.key == "ai_provider" && entry.value == "openai"));
        assert!(settings.iter().any(|entry| entry.key == "screenshot_shortcut" && entry.value == "Alt+Shift+S"));
    }

    #[test]
    fn update_task_status_sets_completed_at_when_done() {
        let conn = in_memory();
        let record = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: Some(RecordType::Task),
                title: Some("complete me".into()),
                content: None,
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
            },
        )
        .expect("record");

        let task = create_task_for_record(
            &conn,
            CreateTaskRequest {
                record_id: record.id.clone(),
                task_status: Some(TaskStatus::Todo),
                priority: None,
                due_at: None,
                remind_at: None,
                repeat_rule: None,
            },
        )
        .expect("task");

        let updated = update_task_status(&conn, &task.id, TaskStatus::Done).expect("update");
        assert_eq!(updated.task_status, TaskStatus::Done);
        assert!(updated.completed_at.is_some());

        // Switching away from done does NOT clear completed_at (intentional: preserves history)
        let switched = update_task_status(&conn, &task.id, TaskStatus::Doing).expect("switch");
        assert_eq!(switched.task_status, TaskStatus::Doing);
        // completed_at should still be set from the previous update
        assert!(switched.completed_at.is_some());
    }

    // ── Task 2: unfinished-task query ──────────────────────────────

    #[test]
    fn list_unfinished_tasks_returns_only_todo_and_doing() {
        let conn = in_memory();

        // Create records for each status variant
        let record_todo = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: Some(RecordType::Task),
                title: Some("todo item".into()),
                content: Some("need to do this".into()),
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
            },
        )
        .expect("record todo");
        let task_todo = create_task_for_record(
            &conn,
            CreateTaskRequest {
                record_id: record_todo.id.clone(),
                task_status: Some(TaskStatus::Todo),
                priority: Some(TaskPriority::High),
                due_at: None,
                remind_at: None,
                repeat_rule: None,
            },
        )
        .expect("task todo");

        let record_doing = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: Some(RecordType::Task),
                title: Some("doing item".into()),
                content: Some("in progress".into()),
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
            },
        )
        .expect("record doing");
        let task_doing = create_task_for_record(
            &conn,
            CreateTaskRequest {
                record_id: record_doing.id.clone(),
                task_status: Some(TaskStatus::Doing),
                priority: Some(TaskPriority::Medium),
                due_at: None,
                remind_at: None,
                repeat_rule: None,
            },
        )
        .expect("task doing");

        let record_done = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: Some(RecordType::Task),
                title: Some("done item".into()),
                content: None,
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
            },
        )
        .expect("record done");
        let task_done = create_task_for_record(
            &conn,
            CreateTaskRequest {
                record_id: record_done.id.clone(),
                task_status: Some(TaskStatus::Done),
                priority: None,
                due_at: None,
                remind_at: None,
                repeat_rule: None,
            },
        )
        .expect("task done");

        let record_cancelled = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: Some(RecordType::Task),
                title: Some("cancelled item".into()),
                content: None,
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
            },
        )
        .expect("record cancelled");
        let _task_cancelled = create_task_for_record(
            &conn,
            CreateTaskRequest {
                record_id: record_cancelled.id.clone(),
                task_status: Some(TaskStatus::Cancelled),
                priority: None,
                due_at: None,
                remind_at: None,
                repeat_rule: None,
            },
        )
        .expect("task cancelled");

        // Add an attachment to the "doing" task record
        let att = insert_attachment(
            &conn,
            CreateAttachmentRequest {
                file_type: AttachmentType::Image,
                mime_type: "image/png".into(),
                local_path: "C:/tmp/unfinished_test.png".into(),
                thumbnail_path: None,
                ocr_text: None,
                hash: "unfinished-hash".into(),
            },
        )
        .expect("attachment");
        link_attachment(&conn, &record_doing.id, &att.id, AttachmentRole::Main, 0)
            .expect("link attachment");

        // Re-read records from DB so we compare against the stored updated_at
        // (create_task_for_record modifies updated_at when it sets type='task')
        let record_todo_final = get_record(&conn, &record_todo.id).expect("todo final");
        let record_doing_final = get_record(&conn, &record_doing.id).expect("doing final");

        // Act
        let items = list_unfinished_tasks(&conn).expect("list_unfinished_tasks");

        // Assert: only 2 items (todo + doing)
        assert_eq!(items.len(), 2, "should return exactly todo and doing tasks");

        // Assert: both returned task IDs match
        let returned_ids: Vec<&str> = items.iter().map(|i| i.task_id.as_str()).collect();
        assert!(returned_ids.contains(&task_todo.id.as_str()), "should contain todo task");
        assert!(returned_ids.contains(&task_doing.id.as_str()), "should contain doing task");

        // Assert: done/cancelled are excluded
        assert!(!returned_ids.contains(&task_done.id.as_str()), "should NOT contain done task");

        // Assert: todo item has correct record fields
        let todo_item = items.iter().find(|i| i.task_id == task_todo.id).expect("todo item");
        assert_eq!(todo_item.record_id, record_todo.id);
        assert_eq!(todo_item.record_title.as_deref(), Some("todo item"));
        assert_eq!(todo_item.record_content.as_deref(), Some("need to do this"));
        assert_eq!(todo_item.task_status, TaskStatus::Todo);
        assert_eq!(todo_item.priority, TaskPriority::High);
        assert_eq!(todo_item.attachment_count, 0);

        // Assert: doing item has attachment_count = 1
        let doing_item = items.iter().find(|i| i.task_id == task_doing.id).expect("doing item");
        assert_eq!(doing_item.record_title.as_deref(), Some("doing item"));
        assert_eq!(doing_item.record_content.as_deref(), Some("in progress"));
        assert_eq!(doing_item.task_status, TaskStatus::Doing);
        assert_eq!(doing_item.attachment_count, 1);

        // Assert: record_updated_at matches the stored value (non-arbitrary time)
        assert_eq!(
            todo_item.record_updated_at, record_todo_final.updated_at,
            "record_updated_at should match the stored record's updated_at"
        );
        assert_eq!(
            doing_item.record_updated_at, record_doing_final.updated_at,
            "record_updated_at should match the stored record's updated_at"
        );
    }
}
