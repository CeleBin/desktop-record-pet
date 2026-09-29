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
    AiProfile, AiResult, AiTaskRun, AiTaskType, AiTriggerMode, Attachment, AttachmentRole,
    AttachmentType, CreateAiProfileRequest, CreateAiResultRequest, CreateAttachmentRequest,
    CreateRecordRequest, CreateTaskRequest, Folder, FolderScope, KnowledgeEvidence,
    KnowledgeMemoryDetail, KnowledgeMemoryEvidence, KnowledgeMemoryItem, KnowledgeTopic,
    LearningDialogSession, PetChatContextCandidate, PetChatMessage, PetChatSession, Record,
    RecordAttachmentLink, RecordFilter, RecordKnowledgeTopic, RecordSource, RecordStatus,
    RecordType, RecordWithRelations, RepeatRule, SettingsEntry, Tag, Task, TaskFilter,
    TaskPriority, TaskStatus, UnfinishedTaskItem, UpdateRecordRequest,
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
    // SQLite only honors foreign_keys changes outside a transaction. Disable
    // enforcement for the folders table swap, then keep every schema and data
    // change (including user_version) inside one rollback boundary.
    conn.execute_batch("PRAGMA foreign_keys = OFF;")?;
    if let Err(error) = conn.execute_batch("BEGIN IMMEDIATE;") {
        let _ = conn.execute_batch("PRAGMA foreign_keys = ON;");
        return Err(error.into());
    }

    let migration_result: AppResult<()> = (|| {
        conn.execute_batch(
            r#"
        CREATE TABLE IF NOT EXISTS records (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL DEFAULT 'note',
            title TEXT,
            content TEXT,
            source TEXT NOT NULL DEFAULT 'quick-text',
            status TEXT NOT NULL DEFAULT 'active',
            folder_id TEXT REFERENCES folders(id),
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

        CREATE TABLE IF NOT EXISTS ai_task_runs (
            id TEXT PRIMARY KEY,
            task_type TEXT NOT NULL,
            source_record_id TEXT,
            status TEXT NOT NULL,
            model_provider TEXT,
            model_name TEXT,
            model_variant TEXT,
            input_snapshot TEXT NOT NULL,
            result_json TEXT,
            error_message TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(source_record_id) REFERENCES records(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS knowledge_topics (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE COLLATE NOCASE,
            summary TEXT NOT NULL,
            mastery_level TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS knowledge_evidence (
            id TEXT PRIMARY KEY,
            topic_id TEXT NOT NULL,
            record_id TEXT NOT NULL,
            evidence_type TEXT NOT NULL,
            evidence_text TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(topic_id) REFERENCES knowledge_topics(id) ON DELETE CASCADE,
            FOREIGN KEY(record_id) REFERENCES records(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS learning_dialog_sessions (
            id TEXT PRIMARY KEY,
            topic_id TEXT NOT NULL,
            source_record_id TEXT NOT NULL,
            status TEXT NOT NULL,
            conversation_snapshot TEXT NOT NULL,
            conclusion_json TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(topic_id) REFERENCES knowledge_topics(id) ON DELETE CASCADE,
            FOREIGN KEY(source_record_id) REFERENCES records(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS pet_chat_sessions (
            id TEXT PRIMARY KEY,
            title TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS pet_chat_messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            context_snapshot TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            FOREIGN KEY(session_id) REFERENCES pet_chat_sessions(id) ON DELETE CASCADE
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

        CREATE TABLE IF NOT EXISTS ai_profiles (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            provider TEXT NOT NULL,
            base_url TEXT,
            default_model TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ai_profile_models (
            id TEXT PRIMARY KEY,
            profile_id TEXT NOT NULL,
            model TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            UNIQUE(profile_id, model),
            FOREIGN KEY(profile_id) REFERENCES ai_profiles(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS folders (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            parent_id TEXT REFERENCES folders(id),
            scope TEXT NOT NULL CHECK(scope IN ('note', 'task')),
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

        let schema_version: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if schema_version >= 1 {
            return Ok(());
        }

        // CREATE TABLE IF NOT EXISTS does not update existing tables. Keep this
        // versioned migration deliberately idempotent so partially-upgraded local
        // databases can safely retry at the next startup.
        let table_columns = |table: &str| -> AppResult<Vec<String>> {
            Ok(conn
                .prepare(&format!("SELECT * FROM {table} LIMIT 0"))?
                .column_names()
                .iter()
                .map(|s| s.to_string())
                .collect())
        };
        let tasks_columns = table_columns("tasks")?;
        if !tasks_columns.iter().any(|c| c == "sort_order") {
            conn.execute_batch(
                "ALTER TABLE tasks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
            )?;
        }

        // ── Migration: add folder_id column to tasks if missing ──
        if !tasks_columns.iter().any(|c| c == "folder_id") {
            conn.execute_batch(
            "ALTER TABLE tasks ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE",
        )?;
        }

        let records_columns = table_columns("records")?;
        if !records_columns.iter().any(|c| c == "folder_id") {
            conn.execute_batch(
                "ALTER TABLE records ADD COLUMN folder_id TEXT REFERENCES folders(id)",
            )?;
        }

        let folders_columns = table_columns("folders")?;
        if !folders_columns.iter().any(|c| c == "parent_id") {
            conn.execute_batch("ALTER TABLE folders ADD COLUMN parent_id TEXT")?;
        }
        if !folders_columns.iter().any(|c| c == "scope") {
            conn.execute_batch(
                "ALTER TABLE folders ADD COLUMN scope TEXT NOT NULL DEFAULT 'task'",
            )?;
        }

        let non_note_record_folders: i64 = conn.query_row(
            "SELECT COUNT(*)
             FROM records
             WHERE type <> 'note' AND folder_id IS NOT NULL",
            [],
            |row| row.get(0),
        )?;
        if non_note_record_folders != 0 {
            return Err(AppError::Database(format!(
                "folder scope migration failed: {non_note_record_folders} non-note record(s) have records.folder_id set"
            )));
        }

        // Legacy task folders become root-level task folders. Normalize names
        // before the final table gains its case-insensitive sibling uniqueness.
        conn.execute(
            "UPDATE folders SET scope = 'task' WHERE scope IS NULL OR scope NOT IN ('note', 'task')",
            [],
        )?;
        let mixed_scope_folders: i64 = conn.query_row(
            "SELECT COUNT(*)
             FROM folders f
             WHERE EXISTS (
                 SELECT 1 FROM records r
                 WHERE r.folder_id = f.id AND r.type = 'note'
             )
               AND EXISTS (
                 SELECT 1 FROM tasks t WHERE t.folder_id = f.id
             )",
            [],
            |row| row.get(0),
        )?;
        if mixed_scope_folders != 0 {
            return Err(AppError::Database(format!(
                "folder scope migration failed: {mixed_scope_folders} folder(s) are referenced by both note and task records"
            )));
        }
        conn.execute(
            "UPDATE folders
             SET scope = 'note'
             WHERE id IN (
                 SELECT folder_id FROM records
                 WHERE type = 'note' AND folder_id IS NOT NULL
             )",
            [],
        )?;
        conn.execute(
            "UPDATE folders
             SET scope = 'task'
             WHERE id IN (SELECT folder_id FROM tasks WHERE folder_id IS NOT NULL)",
            [],
        )?;
        let mismatched_parent_scopes: i64 = conn.query_row(
            "SELECT COUNT(*)
             FROM folders child
             JOIN folders parent ON parent.id = child.parent_id
             WHERE child.scope <> parent.scope",
            [],
            |row| row.get(0),
        )?;
        if mismatched_parent_scopes != 0 {
            return Err(AppError::Database(format!(
                "folder parent scope migration failed: {mismatched_parent_scopes} child folder(s) have a different scope from their parent"
            )));
        }
        conn.execute(
            "UPDATE folders SET parent_id = NULL WHERE parent_id = id",
            [],
        )?;
        let mut stmt = conn.prepare(
        "SELECT id, name, scope, parent_id FROM folders ORDER BY scope, parent_id IS NOT NULL, parent_id, sort_order, created_at, id",
    )?;
        let folders = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut seen = std::collections::HashSet::new();
        for (id, name, scope, parent_id) in folders {
            let base = match name.trim() {
                "" => "未命名文件夹".to_string(),
                value => value.to_string(),
            };
            let (suffix_base, mut next_suffix) = folder_name_suffix_base(&base);
            let parent_key = parent_id.clone().unwrap_or_else(|| "__root__".to_string());
            let mut candidate = base.clone();
            while !seen.insert((
                scope.clone(),
                parent_key.clone(),
                candidate.trim().to_lowercase(),
            )) {
                let suffix = next_suffix.ok_or_else(|| {
                    AppError::Database(format!(
                        "folder name suffix exhausted while normalizing '{base}'"
                    ))
                })?;
                candidate = format!("{suffix_base} ({suffix})");
                next_suffix = suffix.checked_add(1);
            }
            conn.execute(
                "UPDATE folders SET name = ?2 WHERE id = ?1",
                params![id, candidate],
            )?;
        }

        // SQLite cannot add the final CHECK constraint with ALTER TABLE.
        // Replace folders while preserving every ID and existing association.
        conn.execute_batch(
            "CREATE TABLE folders_new (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                parent_id TEXT REFERENCES folders_new(id),
                scope TEXT NOT NULL CHECK(scope IN ('note', 'task')),
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
             );
             INSERT INTO folders_new (id, name, parent_id, scope, sort_order, created_at, updated_at)
                SELECT id, name, parent_id, scope, sort_order, created_at, updated_at FROM folders;
             DROP TABLE folders;
             ALTER TABLE folders_new RENAME TO folders;
             CREATE UNIQUE INDEX IF NOT EXISTS folders_sibling_name_uq ON folders(scope, COALESCE(parent_id, '__root__'), lower(trim(name)));
             CREATE INDEX IF NOT EXISTS folders_scope_parent_idx ON folders(scope, parent_id);
             CREATE INDEX IF NOT EXISTS records_folder_id_idx ON records(folder_id);",
        )?;
        let foreign_key_errors: i64 =
            conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })?;
        if foreign_key_errors != 0 {
            return Err(AppError::Database(format!(
                "foreign key check failed with {foreign_key_errors} violation(s)"
            )));
        }
        conn.execute_batch("PRAGMA user_version = 1;")?;
        Ok(())
    })();

    match migration_result {
        Ok(()) => {
            if let Err(error) = conn.execute_batch("COMMIT;") {
                let _ = conn.execute_batch("ROLLBACK;");
                let _ = conn.execute_batch("PRAGMA foreign_keys = ON;");
                return Err(error.into());
            }
            conn.execute_batch("PRAGMA foreign_keys = ON;")?;
            Ok(())
        }
        Err(error) => {
            let rollback_result = conn.execute_batch("ROLLBACK;");
            let foreign_keys_result = conn.execute_batch("PRAGMA foreign_keys = ON;");
            rollback_result?;
            foreign_keys_result?;
            Err(error)
        }
    }
}

fn folder_name_suffix_base(name: &str) -> (&str, Option<usize>) {
    let Some(prefix) = name.strip_suffix(')') else {
        return (name, Some(2));
    };
    let Some(open_paren) = prefix.rfind(" (") else {
        return (name, Some(2));
    };
    let Ok(suffix) = prefix[open_paren + 2..].parse::<usize>() else {
        return (name, Some(2));
    };
    if suffix < 2 {
        return (name, Some(2));
    }
    (&name[..open_paren], suffix.checked_add(1))
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
        folder_id: request.folder_id.clone(),
        created_at: now,
        updated_at: now,
    };

    if let Some(folder_id) = &record.folder_id {
        if record.record_type != RecordType::Note {
            return Err(AppError::Validation(
                "task records cannot use note folders".into(),
            ));
        }
        let scope: Option<String> = conn
            .query_row(
                "SELECT scope FROM folders WHERE id = ?1",
                params![folder_id],
                |row| row.get(0),
            )
            .optional()?;
        if scope.as_deref() != Some("note") {
            return Err(AppError::Validation(
                "record folder must be a note folder".into(),
            ));
        }
    }

    conn.execute(
        "INSERT INTO records (id, type, title, content, source, status, folder_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            record.id,
            record.record_type.as_str(),
            record.title,
            record.content,
            record.source.as_str(),
            record.status.as_str(),
            record.folder_id,
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
        "SELECT id, type, title, content, source, status, folder_id, created_at, updated_at FROM records WHERE id = ?1",
        params![id],
        map_record,
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("record {id}")))
}

pub fn list_records(conn: &Connection) -> AppResult<Vec<Record>> {
    let mut stmt = conn.prepare(
        "SELECT id, type, title, content, source, status, folder_id, created_at, updated_at FROM records ORDER BY datetime(created_at) DESC, rowid DESC",
    )?;
    let rows = stmt.query_map([], map_record)?;
    let records = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(records)
}

pub fn update_record(
    conn: &Connection,
    id: &str,
    update: UpdateRecordRequest,
) -> AppResult<Record> {
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

/// Remove a task by physically deleting the linked record. The record
/// cascade removes the task row, attachments, and other linked rows, so
/// the removed todo never resurfaces in another category.
pub fn remove_task(conn: &Connection, task_id: &str) -> AppResult<Task> {
    let task = get_task(conn, task_id)?;
    delete_record_physical(conn, &task.record_id)?;
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
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM tasks",
            [],
            |row| row.get(0),
        )
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
                                folder_id: None,
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

pub fn update_task_priority(
    conn: &Connection,
    id: &str,
    priority: TaskPriority,
) -> AppResult<Task> {
    let mut task = get_task(conn, id)?;
    task.priority = priority;
    conn.execute(
        "UPDATE tasks SET priority = ?2 WHERE id = ?1",
        params![task.id, task.priority.as_str()],
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
pub fn update_task_due_at(
    conn: &Connection,
    id: &str,
    due_at: Option<DateTime<Utc>>,
) -> AppResult<Task> {
    let mut task = get_task(conn, id)?;
    task.due_at = due_at;

    conn.execute(
        "UPDATE tasks SET due_at = ?2 WHERE id = ?1",
        params![task.id, task.due_at.map(|value| value.to_rfc3339()),],
    )?;

    Ok(task)
}

pub fn insert_attachment(
    conn: &Connection,
    request: CreateAttachmentRequest,
) -> AppResult<Attachment> {
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

pub fn get_record_attachments(
    conn: &Connection,
    record_id: &str,
) -> AppResult<Vec<RecordAttachmentLink>> {
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

pub fn upsert_knowledge_topic(
    conn: &Connection,
    name: &str,
    summary: &str,
    mastery_level: &str,
) -> AppResult<KnowledgeTopic> {
    let existing = conn
        .query_row(
            "SELECT id FROM knowledge_topics WHERE name = ?1 COLLATE NOCASE",
            params![name],
            |row| row.get::<_, String>(0),
        )
        .optional()?;

    let now = Utc::now();
    let had_existing = existing.is_some();
    let id = existing.unwrap_or_else(|| Uuid::new_v4().to_string());
    let created_at = if had_existing {
        conn.query_row(
            "SELECT created_at FROM knowledge_topics WHERE id = ?1",
            params![&id],
            |row| row.get::<_, String>(0),
        )?
    } else {
        now.to_rfc3339()
    };

    conn.execute(
        "INSERT INTO knowledge_topics (id, name, summary, mastery_level, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           summary = excluded.summary,
           mastery_level = excluded.mastery_level,
           updated_at = excluded.updated_at",
        params![
            &id,
            name,
            summary,
            mastery_level,
            created_at,
            now.to_rfc3339(),
        ],
    )?;

    get_knowledge_topic(conn, &id)
}

pub fn append_knowledge_evidence(
    conn: &Connection,
    topic_id: &str,
    record_id: &str,
    evidence_type: &str,
    evidence_text: &str,
) -> AppResult<KnowledgeEvidence> {
    let evidence = KnowledgeEvidence {
        id: Uuid::new_v4().to_string(),
        topic_id: topic_id.to_string(),
        record_id: record_id.to_string(),
        evidence_type: evidence_type.to_string(),
        evidence_text: evidence_text.to_string(),
        created_at: Utc::now(),
    };

    conn.execute(
        "INSERT INTO knowledge_evidence (id, topic_id, record_id, evidence_type, evidence_text, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            evidence.id,
            evidence.topic_id,
            evidence.record_id,
            evidence.evidence_type,
            evidence.evidence_text,
            evidence.created_at.to_rfc3339(),
        ],
    )?;

    Ok(evidence)
}

pub fn update_knowledge_topic_status(
    conn: &Connection,
    topic_id: &str,
    summary: &str,
    mastery_level: &str,
) -> AppResult<KnowledgeTopic> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE knowledge_topics
         SET summary = ?2, mastery_level = ?3, updated_at = ?4
         WHERE id = ?1",
        params![topic_id, summary, mastery_level, now],
    )?;
    get_knowledge_topic(conn, topic_id)
}

pub fn insert_learning_dialog_session(
    conn: &Connection,
    session: LearningDialogSession,
) -> AppResult<LearningDialogSession> {
    conn.execute(
        "INSERT INTO learning_dialog_sessions (
            id, topic_id, source_record_id, status, conversation_snapshot, conclusion_json, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            session.id,
            session.topic_id,
            session.source_record_id,
            session.status,
            session.conversation_snapshot,
            session.conclusion_json,
            session.created_at.to_rfc3339(),
        ],
    )?;
    Ok(session)
}

pub fn get_learning_dialog_session(
    conn: &Connection,
    id: &str,
) -> AppResult<LearningDialogSession> {
    conn.query_row(
        "SELECT id, topic_id, source_record_id, status, conversation_snapshot, conclusion_json, created_at
         FROM learning_dialog_sessions
         WHERE id = ?1",
        params![id],
        map_learning_dialog_session,
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("learning_dialog_session {id}")))
}

pub fn get_knowledge_topic(conn: &Connection, id: &str) -> AppResult<KnowledgeTopic> {
    conn.query_row(
        "SELECT id, name, summary, mastery_level, created_at, updated_at FROM knowledge_topics WHERE id = ?1",
        params![id],
        map_knowledge_topic,
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("knowledge_topic {id}")))
}

pub fn find_knowledge_topic_by_name(
    conn: &Connection,
    name: &str,
) -> AppResult<Option<KnowledgeTopic>> {
    Ok(conn
        .query_row(
            "SELECT id, name, summary, mastery_level, created_at, updated_at
             FROM knowledge_topics
             WHERE name = ?1 COLLATE NOCASE",
            params![name],
            map_knowledge_topic,
        )
        .optional()?)
}

pub fn get_knowledge_topics_for_record(
    conn: &Connection,
    record_id: &str,
) -> AppResult<Vec<RecordKnowledgeTopic>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT
          kt.id,
          kt.name,
          kt.summary,
          kt.mastery_level,
          ke.evidence_text,
          kt.updated_at
        FROM knowledge_topics kt
        JOIN knowledge_evidence ke
          ON ke.topic_id = kt.id
        WHERE ke.record_id = ?1
          AND ke.created_at = (
            SELECT MAX(ke2.created_at)
            FROM knowledge_evidence ke2
            WHERE ke2.topic_id = kt.id
              AND ke2.record_id = ?1
          )
        ORDER BY datetime(kt.updated_at) DESC, kt.rowid DESC
        "#,
    )?;
    let rows = stmt.query_map(params![record_id], map_record_knowledge_topic)?;
    let items = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(items)
}

pub fn list_knowledge_memory(conn: &Connection) -> AppResult<Vec<KnowledgeMemoryItem>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT
          kt.id,
          kt.name,
          kt.summary,
          kt.mastery_level,
          COUNT(ke.id) AS evidence_count,
          COALESCE((
            SELECT latest_ke.evidence_text
            FROM knowledge_evidence latest_ke
            WHERE latest_ke.topic_id = kt.id
            ORDER BY datetime(latest_ke.created_at) DESC, latest_ke.rowid DESC
            LIMIT 1
          ), '') AS latest_evidence_text,
          kt.updated_at
        FROM knowledge_topics kt
        LEFT JOIN knowledge_evidence ke ON ke.topic_id = kt.id
        GROUP BY kt.id
        ORDER BY
          CASE kt.mastery_level
            WHEN 'understanding' THEN 0
            WHEN 'candidate' THEN 1
            WHEN 'rejected' THEN 2
            ELSE 3
          END,
          datetime(kt.updated_at) DESC,
          kt.rowid DESC
        "#,
    )?;
    let rows = stmt.query_map([], map_knowledge_memory_item)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get_knowledge_memory_detail(
    conn: &Connection,
    topic_id: &str,
) -> AppResult<KnowledgeMemoryDetail> {
    let topic = list_knowledge_memory(conn)?
        .into_iter()
        .find(|item| item.id == topic_id)
        .ok_or_else(|| AppError::NotFound(format!("knowledge topic {topic_id}")))?;

    let mut evidence_stmt = conn.prepare(
        r#"
        SELECT ke.id, ke.record_id, r.title, ke.evidence_type, ke.evidence_text, ke.created_at
        FROM knowledge_evidence ke
        JOIN records r ON r.id = ke.record_id
        WHERE ke.topic_id = ?1
        ORDER BY datetime(ke.created_at) DESC, ke.rowid DESC
        "#,
    )?;
    let evidence = evidence_stmt
        .query_map(params![topic_id], map_knowledge_memory_evidence)?
        .collect::<Result<Vec<_>, _>>()?;

    let latest_conclusion_json = conn
        .query_row(
            "SELECT conclusion_json
             FROM learning_dialog_sessions
             WHERE topic_id = ?1
             ORDER BY datetime(created_at) DESC, rowid DESC
             LIMIT 1",
            params![topic_id],
            |row| row.get(0),
        )
        .optional()?;

    Ok(KnowledgeMemoryDetail {
        topic,
        evidence,
        latest_conclusion_json,
    })
}

pub fn insert_ai_task_run(conn: &Connection, run: AiTaskRun) -> AppResult<AiTaskRun> {
    conn.execute(
        "INSERT INTO ai_task_runs (id, task_type, source_record_id, status, model_provider, model_name, model_variant, input_snapshot, result_json, error_message, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            run.id,
            run.task_type.as_str(),
            run.source_record_id,
            run.status,
            run.model_provider,
            run.model_name,
            run.model_variant,
            run.input_snapshot,
            run.result_json,
            run.error_message,
            run.created_at.to_rfc3339(),
        ],
    )?;

    Ok(run)
}

pub fn update_ai_task_run_result(
    conn: &Connection,
    id: &str,
    status: &str,
    result_json: Option<&str>,
    error_message: Option<&str>,
) -> AppResult<AiTaskRun> {
    conn.execute(
        "UPDATE ai_task_runs
         SET status = ?2, result_json = ?3, error_message = ?4
         WHERE id = ?1",
        params![id, status, result_json, error_message],
    )?;

    get_ai_task_run(conn, id)
}

pub fn get_ai_task_run(conn: &Connection, id: &str) -> AppResult<AiTaskRun> {
    conn.query_row(
        "SELECT id, task_type, source_record_id, status, model_provider, model_name, model_variant, input_snapshot, result_json, error_message, created_at
         FROM ai_task_runs WHERE id = ?1",
        params![id],
        map_ai_task_run,
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("ai_task_run {id}")))
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
    let mut stmt = conn.prepare("SELECT key, value FROM settings ORDER BY key ASC")?;
    let rows = stmt.query_map([], |row| {
        Ok(SettingsEntry {
            key: row.get(0)?,
            value: row.get(1)?,
        })
    })?;
    let entries = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(entries)
}

pub fn create_ai_profile(
    conn: &Connection,
    request: &CreateAiProfileRequest,
) -> AppResult<AiProfile> {
    if request.name.trim().is_empty() {
        return Err(AppError::Validation("AI profile name is required".into()));
    }
    if request.provider.trim().is_empty() {
        return Err(AppError::Validation(
            "AI profile provider is required".into(),
        ));
    }
    let models = normalize_ai_models(&request.models, &request.default_model)?;
    let default_model = request.default_model.trim().to_string();
    let now = Utc::now();
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO ai_profiles (id, name, provider, base_url, default_model, enabled, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![id, request.name.trim(), request.provider.trim(), request.base_url.as_deref().map(str::trim), default_model, request.enabled, now],
    )?;
    for (sort_order, model) in models.iter().enumerate() {
        conn.execute(
            "INSERT INTO ai_profile_models (id, profile_id, model, sort_order) VALUES (?1, ?2, ?3, ?4)",
            params![Uuid::new_v4().to_string(), id, model, sort_order as i64],
        )?;
    }
    Ok(AiProfile {
        id,
        name: request.name.trim().into(),
        provider: request.provider.trim().into(),
        base_url: request
            .base_url
            .as_ref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        default_model,
        models,
        enabled: request.enabled,
        api_key_configured: false,
        created_at: now,
        updated_at: now,
    })
}

pub fn list_ai_profiles(conn: &Connection) -> AppResult<Vec<AiProfile>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, provider, base_url, default_model, enabled, created_at, updated_at FROM ai_profiles ORDER BY datetime(created_at) ASC, rowid ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        let id: String = row.get(0)?;
        let mut model_stmt = conn
            .prepare("SELECT model FROM ai_profile_models WHERE profile_id = ?1 ORDER BY sort_order ASC, rowid ASC")
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
        let models = model_stmt
            .query_map(params![id], |model_row| model_row.get(0))
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?
            .collect::<Result<Vec<String>, _>>()?;
        Ok(AiProfile {
            id,
            name: row.get(1)?,
            provider: row.get(2)?,
            base_url: row.get(3)?,
            default_model: row.get(4)?,
            models,
            enabled: row.get::<_, i64>(5)? != 0,
            api_key_configured: false,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn update_ai_profile(
    conn: &Connection,
    id: &str,
    request: &CreateAiProfileRequest,
) -> AppResult<()> {
    if request.name.trim().is_empty() || request.provider.trim().is_empty() {
        return Err(AppError::Validation(
            "AI profile name and provider are required".into(),
        ));
    }
    let models = normalize_ai_models(&request.models, &request.default_model)?;
    let now = Utc::now();
    let changed = conn.execute(
        "UPDATE ai_profiles SET name = ?2, provider = ?3, base_url = ?4, default_model = ?5, enabled = ?6, updated_at = ?7 WHERE id = ?1",
        params![id, request.name.trim(), request.provider.trim(), request.base_url.as_deref().map(str::trim), request.default_model.trim(), request.enabled, now],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("ai profile {id}")));
    }
    conn.execute(
        "DELETE FROM ai_profile_models WHERE profile_id = ?1",
        params![id],
    )?;
    for (sort_order, model) in models.iter().enumerate() {
        conn.execute(
            "INSERT INTO ai_profile_models (id, profile_id, model, sort_order) VALUES (?1, ?2, ?3, ?4)",
            params![Uuid::new_v4().to_string(), id, model, sort_order as i64],
        )?;
    }
    Ok(())
}

pub fn delete_ai_profile(conn: &Connection, id: &str) -> AppResult<()> {
    let changed = conn.execute("DELETE FROM ai_profiles WHERE id = ?1", params![id])?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("ai profile {id}")));
    }
    Ok(())
}

fn normalize_ai_models(models: &[String], default_model: &str) -> AppResult<Vec<String>> {
    let mut normalized = models
        .iter()
        .map(|model| model.trim().to_string())
        .filter(|model| !model.is_empty())
        .collect::<Vec<_>>();
    let default_model = default_model.trim();
    if default_model.is_empty() {
        return Err(AppError::Validation(
            "AI profile default model is required".into(),
        ));
    }
    if !normalized.iter().any(|model| model == default_model) {
        normalized.insert(0, default_model.to_string());
    }
    normalized.dedup();
    Ok(normalized)
}

pub fn default_settings() -> Vec<SettingsEntry> {
    vec![
        SettingsEntry {
            key: "language".into(),
            value: "zh-CN".into(),
        },
        SettingsEntry {
            key: "auto_ocr".into(),
            value: "false".into(),
        },
        SettingsEntry {
            key: "screenshot_quality".into(),
            value: "2".into(),
        },
        SettingsEntry {
            key: "quick_capture_shortcut".into(),
            value: "Alt+Shift+R".into(),
        },
        SettingsEntry {
            key: "screenshot_shortcut".into(),
            value: "Alt+Shift+S".into(),
        },
        SettingsEntry {
            key: "ai_provider".into(),
            value: "claude".into(),
        },
        SettingsEntry {
            key: "ai_default_profile_id".into(),
            value: "".into(),
        },
        SettingsEntry {
            key: "ai_model".into(),
            value: "claude-sonnet-4-20250514".into(),
        },
        SettingsEntry {
            key: "ai_model_variant".into(),
            value: "default".into(),
        },
        SettingsEntry {
            key: "ai_auto_analyze".into(),
            value: "false".into(),
        },
        SettingsEntry {
            key: "product_mode".into(),
            value: "free".into(),
        },
        SettingsEntry {
            key: "ai_base_url".into(),
            value: "".into(),
        },
        SettingsEntry {
            key: "reminder_channel".into(),
            value: "pet-bubble".into(),
        },
        SettingsEntry {
            key: "pet_always_on_top".into(),
            value: "true".into(),
        },
        SettingsEntry {
            key: "pet_visible".into(),
            value: "true".into(),
        },
        SettingsEntry {
            key: "pet_name".into(),
            value: "小宠物".into(),
        },
        SettingsEntry {
            key: "pet_persona".into(),
            value: "gentle-companion".into(),
        },
        SettingsEntry {
            key: "pet_custom_prompt".into(),
            value: "".into(),
        },
        SettingsEntry {
            key: "pet_proactive_ai_enabled".into(),
            value: "false".into(),
        },
        SettingsEntry {
            key: "pet_meal_companion_enabled".into(),
            value: "true".into(),
        },
        SettingsEntry {
            key: "pet_quiet_hours".into(),
            value: "22:00-08:00".into(),
        },
        SettingsEntry {
            key: "pet_proactive_min_interval_minutes".into(),
            value: "120".into(),
        },
        // ── Todo-overlay settings ──
        SettingsEntry {
            key: "todo_overlay_visibility_mode".into(),
            value: "unfinished-only".into(),
        },
        SettingsEntry {
            key: "todo_overlay_always_on_top".into(),
            value: "true".into(),
        },
        SettingsEntry {
            key: "todo_overlay_opacity".into(),
            value: "0.8".into(),
        },
        SettingsEntry {
            key: "todo_overlay_auto_collapse".into(),
            value: "false".into(),
        },
        SettingsEntry {
            key: "todo_overlay_open_behavior".into(),
            value: "drawer".into(),
        },
    ]
}

pub fn get_all_settings_with_defaults(conn: &Connection) -> AppResult<Vec<SettingsEntry>> {
    let persisted = get_all_settings(conn)?;
    let mut merged: BTreeMap<String, String> = default_settings()
        .into_iter()
        .map(|entry| (entry.key, entry.value))
        .collect();

    for entry in persisted {
        if !is_sensitive_setting_key(&entry.key) {
            merged.insert(entry.key, entry.value);
        }
    }

    Ok(merged
        .into_iter()
        .map(|(key, value)| SettingsEntry { key, value })
        .collect())
}

pub fn delete_setting(conn: &Connection, key: &str) -> AppResult<()> {
    conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
    Ok(())
}

fn is_sensitive_setting_key(key: &str) -> bool {
    matches!(key, "ai_api_key" | "claude_api_key")
}

pub fn delete_all_settings(conn: &Connection) -> AppResult<()> {
    conn.execute("DELETE FROM settings", [])?;
    Ok(())
}

pub fn create_pet_chat_session(
    conn: &Connection,
    title: Option<String>,
) -> AppResult<PetChatSession> {
    let now = Utc::now();
    let session = PetChatSession {
        id: Uuid::new_v4().to_string(),
        title,
        created_at: now,
        updated_at: now,
    };
    conn.execute(
        "INSERT INTO pet_chat_sessions (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![
            session.id,
            session.title,
            session.created_at,
            session.updated_at
        ],
    )?;
    Ok(session)
}

pub fn update_pet_chat_session_title(
    conn: &Connection,
    session_id: &str,
    title: &str,
) -> AppResult<PetChatSession> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::Validation(
            "conversation title cannot be empty".into(),
        ));
    }
    let changed = conn.execute(
        "UPDATE pet_chat_sessions SET title = ?2 WHERE id = ?1",
        params![session_id, title],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("pet_chat_session {session_id}")));
    }
    conn.query_row(
        "SELECT id, title, created_at, updated_at FROM pet_chat_sessions WHERE id = ?1",
        params![session_id],
        map_pet_chat_session,
    )
    .map_err(AppError::from)
}

pub fn delete_pet_chat_session(conn: &Connection, session_id: &str) -> AppResult<()> {
    let changed = conn.execute(
        "DELETE FROM pet_chat_sessions WHERE id = ?1",
        params![session_id],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("pet_chat_session {session_id}")));
    }
    Ok(())
}

pub fn append_pet_chat_message(
    conn: &Connection,
    session_id: &str,
    role: &str,
    content: &str,
    context_snapshot: &str,
) -> AppResult<PetChatMessage> {
    let message = PetChatMessage {
        id: Uuid::new_v4().to_string(),
        session_id: session_id.to_string(),
        role: role.to_string(),
        content: content.to_string(),
        context_snapshot: context_snapshot.to_string(),
        created_at: Utc::now(),
    };
    conn.execute(
        "INSERT INTO pet_chat_messages (id, session_id, role, content, context_snapshot, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![message.id, message.session_id, message.role, message.content, message.context_snapshot, message.created_at],
    )?;
    conn.execute(
        "UPDATE pet_chat_sessions SET updated_at = ?2 WHERE id = ?1",
        params![session_id, message.created_at],
    )?;
    Ok(message)
}

pub fn list_pet_chat_sessions(conn: &Connection, limit: i64) -> AppResult<Vec<PetChatSession>> {
    if limit == 0 {
        return Ok(vec![]);
    }
    if limit < 0 {
        let mut stmt = conn.prepare(
            "SELECT id, title, created_at, updated_at FROM pet_chat_sessions ORDER BY datetime(updated_at) DESC, rowid DESC",
        )?;
        let rows = stmt.query_map([], map_pet_chat_session)?;
        return Ok(rows.collect::<Result<Vec<_>, _>>()?);
    }
    let mut stmt = conn.prepare(
        "SELECT id, title, created_at, updated_at FROM pet_chat_sessions ORDER BY datetime(updated_at) DESC, rowid DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], map_pet_chat_session)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn count_pet_chat_sessions(conn: &Connection) -> AppResult<i64> {
    Ok(
        conn.query_row("SELECT COUNT(*) FROM pet_chat_sessions", [], |row| {
            row.get(0)
        })?,
    )
}

pub fn get_latest_pet_chat_session(conn: &Connection) -> AppResult<Option<PetChatSession>> {
    Ok(list_pet_chat_sessions(conn, 1)?.into_iter().next())
}

pub fn list_pet_chat_messages(
    conn: &Connection,
    session_id: &str,
) -> AppResult<Vec<PetChatMessage>> {
    let mut stmt = conn.prepare(
        "SELECT id, session_id, role, content, context_snapshot, created_at FROM pet_chat_messages WHERE session_id = ?1 ORDER BY datetime(created_at) ASC, rowid ASC",
    )?;
    let rows = stmt.query_map(params![session_id], map_pet_chat_message)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn list_pet_chat_context_candidates(
    conn: &Connection,
    query: &str,
    limit: i64,
) -> AppResult<Vec<PetChatContextCandidate>> {
    let trimmed = query.trim();
    if trimmed.is_empty() || limit <= 0 {
        return Ok(vec![]);
    }
    let pattern = format!("%{}%", trimmed.to_lowercase());
    let mut stmt = conn.prepare(
        "SELECT r.id,
                CASE WHEN t.id IS NULL THEN 'note' ELSE 'task' END,
                COALESCE(NULLIF(r.title, ''), '未命名记录'),
                substr(COALESCE(r.content, ''), 1, 240)
         FROM records r
         LEFT JOIN tasks t ON t.record_id = r.id
         WHERE r.status = 'active'
           AND (t.id IS NULL OR t.task_status IN ('todo', 'doing'))
           AND lower(COALESCE(r.title, '') || ' ' || COALESCE(r.content, '')) LIKE ?1
         ORDER BY CASE WHEN lower(COALESCE(r.title, '')) LIKE ?1 THEN 0 ELSE 1 END,
                  datetime(r.updated_at) DESC,
                  r.rowid DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![pattern, limit.min(3)], |row| {
        Ok(PetChatContextCandidate {
            record_id: row.get(0)?,
            item_type: row.get(1)?,
            title: row.get(2)?,
            excerpt: row.get(3)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
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
    let note_folder_mode = filter.note_folder_mode.as_deref();
    let is_task_query = matches!(filter.type_filter, Some(RecordType::Task))
        || matches!(filter.view_key.as_deref(), Some("tasks"));

    if matches!(note_folder_mode, Some("folder")) && filter.folder_id.is_none() && !is_task_query {
        return Err(AppError::Validation(
            "folder id is required for note folder filtering".into(),
        ));
    }

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
    let mut sql = String::new();
    if matches!(note_folder_mode, Some("folder"))
        && filter.include_descendants.unwrap_or(false)
        && !is_task_query
    {
        param_values.push(filter.folder_id.as_ref().unwrap().clone());
        sql.push_str(
            "WITH RECURSIVE note_folder_tree(id) AS ( \
             SELECT id FROM folders WHERE id = ?1 AND scope = 'note' \
             UNION ALL \
             SELECT f.id FROM folders f JOIN note_folder_tree tree ON f.parent_id = tree.id \
             WHERE f.scope = 'note' \
             ) ",
        );
    }
    sql.push_str(
        "SELECT r.id, r.type, r.title, r.content, r.source, r.status, r.folder_id, r.created_at, r.updated_at FROM records r",
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

    if !is_task_query {
        match note_folder_mode {
            Some("all") => {
                sql.push_str(" AND r.type = 'note' AND r.status = 'active'");
            }
            Some("unfiled") => {
                sql.push_str(
                    " AND r.type = 'note' AND r.status = 'active' AND r.folder_id IS NULL",
                );
            }
            Some("folder") => {
                sql.push_str(" AND r.type = 'note' AND r.status = 'active'");
                if filter.include_descendants.unwrap_or(false) {
                    sql.push_str(" AND r.folder_id IN (SELECT id FROM note_folder_tree)");
                } else {
                    param_values.push(filter.folder_id.as_ref().unwrap().clone());
                    sql.push_str(&format!(" AND r.folder_id = ?{}", param_values.len()));
                }
            }
            Some(other) => {
                return Err(AppError::Validation(format!(
                    "invalid note folder mode: {other}"
                )));
            }
            None => {}
        }
    }
    if let Some(q) = &filter.search_query {
        let idx = param_values.len() + 1;
        sql.push_str(&format!(
            " AND (r.title LIKE ?{idx} OR r.content LIKE ?{idx})"
        ));
        let escaped = q
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_");
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
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = param_values
        .iter()
        .map(|s| s as &dyn rusqlite::types::ToSql)
        .collect();
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
        "SELECT id, record_id, task_status, priority, due_at, remind_at, repeat_rule, completed_at, sort_order FROM tasks WHERE 1=1",
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
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = param_values
        .iter()
        .map(|s| s as &dyn rusqlite::types::ToSql)
        .collect();
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

pub fn get_attachments_for_record(
    conn: &Connection,
    record_id: &str,
) -> AppResult<Vec<Attachment>> {
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
    let knowledge_topics = get_knowledge_topics_for_record(conn, id)?;
    let tags = list_record_tags(conn, id)?;
    Ok(RecordWithRelations::from_record(
        record,
        task,
        attachments,
        attachment_links,
        ai_results,
        knowledge_topics,
        tags,
    ))
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

fn map_folder(row: &Row<'_>) -> rusqlite::Result<Folder> {
    Ok(Folder {
        id: row.get(0)?,
        name: row.get(1)?,
        parent_id: row.get(2)?,
        scope: FolderScope::parse(&row.get::<_, String>(3)?),
        sort_order: row.get(4)?,
        created_at: parse_datetime(&row.get::<_, String>(5)?)?,
        updated_at: parse_datetime(&row.get::<_, String>(6)?)?,
    })
}

fn get_folder(conn: &Connection, id: &str) -> AppResult<Folder> {
    conn.query_row(
        "SELECT id, name, parent_id, scope, sort_order, created_at, updated_at FROM folders WHERE id = ?1",
        params![id],
        map_folder,
    )
    .optional()?
    .ok_or_else(|| AppError::NotFound(format!("folder {id}")))
}

fn list_scoped_folders(
    conn: &Connection,
    scope: FolderScope,
    root_only: bool,
) -> AppResult<Vec<Folder>> {
    let parent_clause = if root_only {
        " AND parent_id IS NULL"
    } else {
        ""
    };
    let sql = format!(
        "SELECT id, name, parent_id, scope, sort_order, created_at, updated_at FROM folders \
         WHERE scope = ?1{parent_clause} \
         ORDER BY scope, parent_id, sort_order ASC, created_at ASC, id ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![scope.as_str()], map_folder)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn required_folder_name(name: &str) -> AppResult<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("folder name is required".into()));
    }
    Ok(name.to_string())
}

fn assert_unique_sibling_name(
    conn: &Connection,
    scope: FolderScope,
    parent_id: Option<&str>,
    name: &str,
    excluding_id: Option<&str>,
) -> AppResult<()> {
    let duplicate: Option<String> = conn
        .query_row(
            "SELECT id FROM folders
             WHERE scope = ?1 AND parent_id IS ?2
               AND lower(trim(name)) = lower(trim(?3))
               AND (?4 IS NULL OR id <> ?4)
             LIMIT 1",
            params![scope.as_str(), parent_id, name, excluding_id],
            |row| row.get(0),
        )
        .optional()?;
    if duplicate.is_some() {
        return Err(AppError::Validation(
            "a folder with this name already exists here".into(),
        ));
    }
    Ok(())
}

fn append_sort_order(
    conn: &Connection,
    scope: FolderScope,
    parent_id: Option<&str>,
) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) FROM folders WHERE scope = ?1 AND parent_id IS ?2",
        params![scope.as_str(), parent_id],
        |row| row.get::<_, i64>(0),
    )? + 1)
}

fn reindex_note_siblings(conn: &Connection, parent_id: Option<&str>) -> AppResult<()> {
    let mut stmt = conn.prepare(
        "SELECT id FROM folders WHERE scope = 'note' AND parent_id IS ?1
         ORDER BY sort_order ASC, created_at ASC, id ASC",
    )?;
    let ids = stmt
        .query_map(params![parent_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    for (sort_order, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE folders SET sort_order = ?2 WHERE id = ?1",
            params![id, sort_order as i64],
        )?;
    }
    Ok(())
}

fn create_scoped_folder(
    conn: &Connection,
    scope: FolderScope,
    name: &str,
    parent_id: Option<&str>,
) -> AppResult<Folder> {
    let name = required_folder_name(name)?;
    if let Some(parent_id) = parent_id {
        let parent = get_folder(conn, parent_id)?;
        if parent.scope != scope {
            return Err(AppError::Validation(
                "folder parent must have the same scope".into(),
            ));
        }
    }
    assert_unique_sibling_name(conn, scope, parent_id, &name, None)?;
    let now = Utc::now();
    let folder = Folder {
        id: Uuid::new_v4().to_string(),
        name,
        parent_id: parent_id.map(str::to_string),
        scope,
        sort_order: append_sort_order(conn, scope, parent_id)?,
        created_at: now,
        updated_at: now,
    };
    conn.execute(
        "INSERT INTO folders (id, name, parent_id, scope, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            folder.id,
            folder.name,
            folder.parent_id,
            folder.scope.as_str(),
            folder.sort_order,
            folder.created_at.to_rfc3339(),
            folder.updated_at.to_rfc3339()
        ],
    )?;
    Ok(folder)
}

pub fn list_folders(conn: &Connection) -> AppResult<Vec<Folder>> {
    list_scoped_folders(conn, FolderScope::Task, true)
}

pub fn create_folder(conn: &Connection, name: &str) -> AppResult<Folder> {
    create_scoped_folder(conn, FolderScope::Task, name, None)
}

pub fn rename_folder(conn: &Connection, id: &str, name: &str) -> AppResult<Folder> {
    let folder = get_folder(conn, id)?;
    if folder.scope != FolderScope::Task || folder.parent_id.is_some() {
        return Err(AppError::Validation("folder is not a task folder".into()));
    }
    let name = required_folder_name(name)?;
    assert_unique_sibling_name(conn, FolderScope::Task, None, &name, Some(id))?;
    let now = Utc::now();
    conn.execute(
        "UPDATE folders SET name = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, name, now.to_rfc3339()],
    )?;

    get_folder(conn, id)
}

pub fn delete_folder(conn: &Connection, id: &str) -> AppResult<()> {
    let folder = get_folder(conn, id)?;
    if folder.scope != FolderScope::Task || folder.parent_id.is_some() {
        return Err(AppError::Validation("folder is not a task folder".into()));
    }

    conn.execute("DELETE FROM folders WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn move_task_to_folder(
    conn: &Connection,
    task_id: &str,
    folder_id: Option<&str>,
) -> AppResult<()> {
    if let Some(folder_id) = folder_id {
        let folder = get_folder(conn, folder_id)?;
        if folder.scope != FolderScope::Task || folder.parent_id.is_some() {
            return Err(AppError::Validation(
                "task folder must be a root task folder".into(),
            ));
        }
    }
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
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result: AppResult<()> = (|| {
        for (folder_id, sort_order) in order {
            let folder = get_folder(conn, folder_id)?;
            if folder.scope != FolderScope::Task || folder.parent_id.is_some() {
                return Err(AppError::Validation("folder is not a task folder".into()));
            }
            conn.execute(
                "UPDATE folders SET sort_order = ?2 WHERE id = ?1",
                params![folder_id, sort_order],
            )?;
        }
        Ok(())
    })();
    match result {
        Ok(()) => {
            conn.execute_batch("COMMIT")?;
            Ok(())
        }
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

pub fn list_note_folders(conn: &Connection) -> AppResult<Vec<Folder>> {
    list_scoped_folders(conn, FolderScope::Note, false)
}

pub fn create_note_folder(
    conn: &Connection,
    name: &str,
    parent_id: Option<&str>,
) -> AppResult<Folder> {
    create_scoped_folder(conn, FolderScope::Note, name, parent_id)
}

pub fn rename_note_folder(conn: &Connection, id: &str, name: &str) -> AppResult<Folder> {
    let folder = get_folder(conn, id)?;
    if folder.scope != FolderScope::Note {
        return Err(AppError::Validation("folder is not a note folder".into()));
    }
    let name = required_folder_name(name)?;
    assert_unique_sibling_name(
        conn,
        FolderScope::Note,
        folder.parent_id.as_deref(),
        &name,
        Some(id),
    )?;
    conn.execute(
        "UPDATE folders SET name = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, name, Utc::now().to_rfc3339()],
    )?;
    get_folder(conn, id)
}

pub fn move_note_folder(conn: &Connection, id: &str, parent_id: Option<&str>) -> AppResult<()> {
    let folder = get_folder(conn, id)?;
    if folder.scope != FolderScope::Note {
        return Err(AppError::Validation("folder is not a note folder".into()));
    }
    if parent_id == Some(id) {
        return Err(AppError::Validation(
            "a folder cannot be its own parent".into(),
        ));
    }
    if let Some(parent_id) = parent_id {
        let parent = get_folder(conn, parent_id)?;
        if parent.scope != FolderScope::Note {
            return Err(AppError::Validation(
                "folder parent must be a note folder".into(),
            ));
        }
        let is_descendant: bool = conn.query_row(
            "WITH RECURSIVE descendants(id) AS (
                 SELECT id FROM folders WHERE parent_id = ?1
                 UNION ALL
                 SELECT f.id FROM folders f JOIN descendants d ON f.parent_id = d.id
             ) SELECT EXISTS(SELECT 1 FROM descendants WHERE id = ?2)",
            params![id, parent_id],
            |row| row.get(0),
        )?;
        if is_descendant {
            return Err(AppError::Validation(
                "a folder cannot move into a descendant".into(),
            ));
        }
    }
    assert_unique_sibling_name(conn, FolderScope::Note, parent_id, &folder.name, Some(id))?;
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result: AppResult<()> = (|| {
        let new_sort_order = append_sort_order(conn, FolderScope::Note, parent_id)?;
        conn.execute(
            "UPDATE folders SET parent_id = ?2, sort_order = ?3, updated_at = ?4 WHERE id = ?1",
            params![id, parent_id, new_sort_order, Utc::now().to_rfc3339()],
        )?;
        reindex_note_siblings(conn, folder.parent_id.as_deref())?;
        if folder.parent_id.as_deref() != parent_id {
            reindex_note_siblings(conn, parent_id)?;
        }
        Ok(())
    })();
    match result {
        Ok(()) => {
            conn.execute_batch("COMMIT")?;
            Ok(())
        }
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

pub fn move_note_to_folder(
    conn: &Connection,
    record_id: &str,
    folder_id: Option<&str>,
) -> AppResult<()> {
    let record = get_record(conn, record_id)?;
    if record.record_type != RecordType::Note {
        return Err(AppError::Validation(
            "only note records can be filed in note folders".into(),
        ));
    }
    if let Some(folder_id) = folder_id {
        let folder = get_folder(conn, folder_id)?;
        if folder.scope != FolderScope::Note {
            return Err(AppError::Validation(
                "record folder must be a note folder".into(),
            ));
        }
    }
    conn.execute(
        "UPDATE records SET folder_id = ?2, updated_at = ?3 WHERE id = ?1",
        params![record_id, folder_id, Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

pub fn delete_note_folder(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result: AppResult<()> = (|| {
        let folder = get_folder(conn, id)?;
        if folder.scope != FolderScope::Note {
            return Err(AppError::Validation("folder is not a note folder".into()));
        }
        let mut child_stmt = conn.prepare(
            "SELECT id, name FROM folders WHERE parent_id = ?1 AND scope = 'note'
             ORDER BY sort_order ASC, created_at ASC, id ASC",
        )?;
        let children = child_stmt
            .query_map(params![id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        for (_, name) in &children {
            assert_unique_sibling_name(
                conn,
                FolderScope::Note,
                folder.parent_id.as_deref(),
                name,
                Some(id),
            )?;
        }
        // A direct child may share this folder's name because it previously
        // lived under a different parent. Release that sibling name before
        // promoting children so the unique sibling index sees the final,
        // rather than a transient, folder layout.
        conn.execute(
            "UPDATE folders SET name = ?2 WHERE id = ?1",
            params![id, format!("__deleting__{}", Uuid::new_v4())],
        )?;
        let mut promoted_sort_order =
            append_sort_order(conn, FolderScope::Note, folder.parent_id.as_deref())?;
        for (child_id, _) in &children {
            conn.execute(
                "UPDATE folders SET parent_id = ?2, sort_order = ?3, updated_at = ?4 WHERE id = ?1",
                params![
                    child_id,
                    folder.parent_id,
                    promoted_sort_order,
                    Utc::now().to_rfc3339()
                ],
            )?;
            promoted_sort_order += 1;
        }
        conn.execute(
            "UPDATE records SET folder_id = ?2, updated_at = ?3 WHERE folder_id = ?1 AND type = 'note'",
            params![id, folder.parent_id, Utc::now().to_rfc3339()],
        )?;
        conn.execute("DELETE FROM folders WHERE id = ?1", params![id])?;
        reindex_note_siblings(conn, folder.parent_id.as_deref())?;
        Ok(())
    })();
    match result {
        Ok(()) => {
            conn.execute_batch("COMMIT")?;
            Ok(())
        }
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

pub fn reorder_note_folders(conn: &Connection, order: &[(String, i64)]) -> AppResult<()> {
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result: AppResult<()> = (|| {
        let mut shared_parent_id: Option<Option<String>> = None;
        for (folder_id, _) in order {
            let folder = get_folder(conn, folder_id)?;
            if folder.scope != FolderScope::Note {
                return Err(AppError::Validation("folder is not a note folder".into()));
            }
            if let Some(parent_id) = &shared_parent_id {
                if parent_id != &folder.parent_id {
                    return Err(AppError::Validation(
                        "note folders must share the same parent".into(),
                    ));
                }
            } else {
                shared_parent_id = Some(folder.parent_id);
            }
        }
        for (folder_id, sort_order) in order {
            conn.execute(
                "UPDATE folders SET sort_order = ?2 WHERE id = ?1",
                params![folder_id, sort_order],
            )?;
        }
        Ok(())
    })();
    match result {
        Ok(()) => {
            conn.execute_batch("COMMIT")?;
            Ok(())
        }
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(error)
        }
    }
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
    let mut stmt = conn
        .prepare("SELECT id, name, color, created_at FROM tags ORDER BY name COLLATE NOCASE ASC")?;
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
    conn.execute(
        "DELETE FROM record_tags WHERE record_id = ?1",
        params![record_id],
    )?;
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

pub fn link_tags_to_record(
    conn: &Connection,
    record_id: &str,
    tag_ids: &[String],
) -> AppResult<()> {
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
        folder_id: row.get(6)?,
        created_at: parse_datetime(&row.get::<_, String>(7)?)?,
        updated_at: parse_datetime(&row.get::<_, String>(8)?)?,
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

fn map_ai_task_run(row: &Row<'_>) -> rusqlite::Result<AiTaskRun> {
    Ok(AiTaskRun {
        id: row.get(0)?,
        task_type: AiTaskType::parse(&row.get::<_, String>(1)?),
        source_record_id: row.get(2)?,
        status: row.get(3)?,
        model_provider: row.get(4)?,
        model_name: row.get(5)?,
        model_variant: row.get(6)?,
        input_snapshot: row.get(7)?,
        result_json: row.get(8)?,
        error_message: row.get(9)?,
        created_at: parse_datetime(&row.get::<_, String>(10)?)?,
    })
}

fn map_knowledge_topic(row: &Row<'_>) -> rusqlite::Result<KnowledgeTopic> {
    Ok(KnowledgeTopic {
        id: row.get(0)?,
        name: row.get(1)?,
        summary: row.get(2)?,
        mastery_level: row.get(3)?,
        created_at: parse_datetime(&row.get::<_, String>(4)?)?,
        updated_at: parse_datetime(&row.get::<_, String>(5)?)?,
    })
}

fn map_record_knowledge_topic(row: &Row<'_>) -> rusqlite::Result<RecordKnowledgeTopic> {
    Ok(RecordKnowledgeTopic {
        topic_id: row.get(0)?,
        name: row.get(1)?,
        summary: row.get(2)?,
        mastery_level: row.get(3)?,
        evidence_text: row.get(4)?,
        updated_at: parse_datetime(&row.get::<_, String>(5)?)?,
    })
}

fn map_knowledge_memory_item(row: &Row<'_>) -> rusqlite::Result<KnowledgeMemoryItem> {
    Ok(KnowledgeMemoryItem {
        id: row.get(0)?,
        name: row.get(1)?,
        summary: row.get(2)?,
        mastery_level: row.get(3)?,
        evidence_count: row.get(4)?,
        latest_evidence_text: row.get(5)?,
        updated_at: parse_datetime(&row.get::<_, String>(6)?)?,
    })
}

fn map_knowledge_memory_evidence(row: &Row<'_>) -> rusqlite::Result<KnowledgeMemoryEvidence> {
    Ok(KnowledgeMemoryEvidence {
        id: row.get(0)?,
        record_id: row.get(1)?,
        record_title: row.get(2)?,
        evidence_type: row.get(3)?,
        evidence_text: row.get(4)?,
        created_at: parse_datetime(&row.get::<_, String>(5)?)?,
    })
}

fn map_learning_dialog_session(row: &Row<'_>) -> rusqlite::Result<LearningDialogSession> {
    Ok(LearningDialogSession {
        id: row.get(0)?,
        topic_id: row.get(1)?,
        source_record_id: row.get(2)?,
        status: row.get(3)?,
        conversation_snapshot: row.get(4)?,
        conclusion_json: row.get(5)?,
        created_at: parse_datetime(&row.get::<_, String>(6)?)?,
    })
}

fn map_pet_chat_message(row: &Row<'_>) -> rusqlite::Result<PetChatMessage> {
    Ok(PetChatMessage {
        id: row.get(0)?,
        session_id: row.get(1)?,
        role: row.get(2)?,
        content: row.get(3)?,
        context_snapshot: row.get(4)?,
        created_at: row.get(5)?,
    })
}

fn map_pet_chat_session(row: &Row<'_>) -> rusqlite::Result<PetChatSession> {
    Ok(PetChatSession {
        id: row.get(0)?,
        title: row.get(1)?,
        created_at: row.get(2)?,
        updated_at: row.get(3)?,
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
        AttachmentRole, CreateAiProfileRequest, CreateAttachmentRequest, CreateRecordRequest,
        CreateTaskRequest, RecordSource, RecordType, TaskPriority, TaskStatus,
        UpdateAiProfileRequest,
    };

    fn in_memory() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        run_migrations(&conn).expect("migrations");
        conn
    }

    fn note(conn: &Connection, title: &str, folder_id: Option<String>) -> Record {
        insert_record(
            conn,
            CreateRecordRequest {
                record_type: Some(RecordType::Note),
                title: Some(title.into()),
                content: Some("body".into()),
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
                folder_id,
            },
        )
        .expect("note record")
    }

    #[test]
    fn note_folders_are_scoped_nested_and_validate_moves() {
        let conn = in_memory();
        let project = create_note_folder(&conn, " Project ", None).expect("root folder");
        let child = create_note_folder(&conn, "Ideas", Some(&project.id)).expect("child folder");
        let task = create_folder(&conn, "Project").expect("task folder may share name");

        assert_eq!(project.name, "Project");
        assert_eq!(child.parent_id.as_deref(), Some(project.id.as_str()));
        assert_eq!(list_note_folders(&conn).expect("note folders").len(), 2);
        assert_eq!(
            list_folders(&conn).expect("task folders"),
            vec![task.clone()]
        );
        assert!(create_note_folder(&conn, "project", None).is_err());
        assert!(create_note_folder(&conn, " ", None).is_err());
        assert!(move_note_folder(&conn, &project.id, Some(&child.id)).is_err());
        assert!(move_note_folder(&conn, &child.id, Some(&child.id)).is_err());

        move_note_folder(&conn, &child.id, None).expect("move child to root");
        let moved = list_note_folders(&conn).expect("note folders");
        assert_eq!(
            moved
                .iter()
                .find(|folder| folder.id == child.id)
                .unwrap()
                .parent_id,
            None
        );
        assert!(rename_note_folder(&conn, &project.id, "IDEAS").is_err());
    }

    #[test]
    fn note_folder_filters_and_note_moves_exclude_tasks_and_archived_notes() {
        let conn = in_memory();
        let root = create_note_folder(&conn, "Root", None).expect("root");
        let child = create_note_folder(&conn, "Child", Some(&root.id)).expect("child");
        let direct = note(&conn, "direct", None);
        let descendant = note(&conn, "descendant", Some(child.id.clone()));
        let archived = note(&conn, "archived", Some(root.id.clone()));
        conn.execute(
            "UPDATE records SET status = 'archived' WHERE id = ?1",
            params![archived.id],
        )
        .expect("archive note");
        let task_record = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: Some(RecordType::Task),
                title: Some("task".into()),
                content: None,
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
                folder_id: None,
            },
        )
        .expect("task record");

        move_note_to_folder(&conn, &direct.id, Some(&root.id)).expect("file note");
        assert!(move_note_to_folder(&conn, &task_record.id, Some(&root.id)).is_err());
        assert!(move_note_to_folder(&conn, &direct.id, Some("missing")).is_err());

        let direct_ids: Vec<_> = list_records_filtered(
            &conn,
            Some(&RecordFilter {
                note_folder_mode: Some("folder".into()),
                folder_id: Some(root.id.clone()),
                include_descendants: Some(false),
                ..RecordFilter::default()
            }),
            &[],
        )
        .expect("direct folder query")
        .into_iter()
        .map(|record| record.id)
        .collect();
        assert_eq!(direct_ids, vec![direct.id.clone()]);
        let recursive_ids: Vec<_> = list_records_filtered(
            &conn,
            Some(&RecordFilter {
                note_folder_mode: Some("folder".into()),
                folder_id: Some(root.id.clone()),
                include_descendants: Some(true),
                ..RecordFilter::default()
            }),
            &[],
        )
        .expect("recursive folder query")
        .into_iter()
        .map(|record| record.id)
        .collect();
        assert!(recursive_ids.contains(&direct.id));
        assert!(recursive_ids.contains(&descendant.id));
        assert!(!recursive_ids.contains(&archived.id));
        assert!(!recursive_ids.contains(&task_record.id));
        let unfiled = note(&conn, "unfiled", None);
        let unfiled_ids: Vec<_> = list_records_filtered(
            &conn,
            Some(&RecordFilter {
                note_folder_mode: Some("unfiled".into()),
                ..RecordFilter::default()
            }),
            &[],
        )
        .expect("unfiled query")
        .into_iter()
        .map(|record| record.id)
        .collect();
        assert_eq!(unfiled_ids, vec![unfiled.id.clone()]);
        let all_ids: Vec<_> = list_records_filtered(
            &conn,
            Some(&RecordFilter {
                note_folder_mode: Some("all".into()),
                ..RecordFilter::default()
            }),
            &[],
        )
        .expect("all note query")
        .into_iter()
        .map(|record| record.id)
        .collect();
        assert!(all_ids.contains(&direct.id));
        assert!(all_ids.contains(&descendant.id));
        assert!(all_ids.contains(&unfiled.id));
    }

    #[test]
    fn deleting_note_folder_promotes_direct_contents_and_rolls_back_on_conflict() {
        let conn = in_memory();
        let root = create_note_folder(&conn, "Root", None).expect("root");
        let deleting = create_note_folder(&conn, "Deleting", Some(&root.id)).expect("deleting");
        let child = create_note_folder(&conn, "Child", Some(&deleting.id)).expect("child");
        let grandchild =
            create_note_folder(&conn, "Grandchild", Some(&child.id)).expect("grandchild");
        let direct = note(&conn, "direct", Some(deleting.id.clone()));
        let nested = note(&conn, "nested", Some(grandchild.id.clone()));
        let tag = create_tag(&conn, "preserved", None).expect("tag");
        set_record_tags(&conn, &direct.id, std::slice::from_ref(&tag.id)).expect("tag note");
        delete_note_folder(&conn, &deleting.id).expect("delete folder");
        assert_eq!(
            get_record(&conn, &direct.id)
                .expect("direct note")
                .folder_id,
            Some(root.id.clone())
        );
        assert_eq!(
            list_note_folders(&conn)
                .expect("folders")
                .iter()
                .find(|folder| folder.id == child.id)
                .unwrap()
                .parent_id,
            Some(root.id.clone())
        );
        assert_eq!(
            get_record(&conn, &nested.id)
                .expect("nested note")
                .folder_id,
            Some(grandchild.id)
        );
        assert_eq!(
            list_record_tags(&conn, &direct.id)
                .expect("preserved tags")
                .into_iter()
                .map(|tag| tag.id)
                .collect::<Vec<_>>(),
            vec![tag.id]
        );

        let top_level = create_note_folder(&conn, "Top", None).expect("top level");
        let top_child =
            create_note_folder(&conn, "Top child", Some(&top_level.id)).expect("top child");
        let top_note = note(&conn, "top note", Some(top_level.id.clone()));
        delete_note_folder(&conn, &top_level.id).expect("delete top level folder");
        assert_eq!(
            get_record(&conn, &top_note.id)
                .expect("top level note")
                .folder_id,
            None
        );
        assert_eq!(
            list_note_folders(&conn)
                .expect("top child promoted")
                .iter()
                .find(|folder| folder.id == top_child.id)
                .unwrap()
                .parent_id,
            None
        );

        let conflict =
            create_note_folder(&conn, "Conflict", Some(&root.id)).expect("conflict parent");
        let duplicate_child = create_note_folder(&conn, "Same", Some(&conflict.id)).expect("child");
        let existing =
            create_note_folder(&conn, "Same", Some(&root.id)).expect("existing root child");
        let error =
            delete_note_folder(&conn, &conflict.id).expect_err("promotion duplicate rejects");
        assert!(matches!(error, AppError::Validation(_)));
        assert_eq!(
            list_note_folders(&conn)
                .expect("rollback folders")
                .iter()
                .find(|folder| folder.id == duplicate_child.id)
                .unwrap()
                .parent_id,
            Some(conflict.id)
        );
        assert!(list_note_folders(&conn)
            .expect("existing folder")
            .iter()
            .any(|folder| folder.id == existing.id));
    }

    #[test]
    fn deleting_note_folder_releases_its_name_before_promoting_same_named_child() {
        let conn = in_memory();
        let parent = create_note_folder(&conn, "Parent", None).expect("parent");
        let deleting =
            create_note_folder(&conn, "Repeat", Some(&parent.id)).expect("deleting folder");
        let child =
            create_note_folder(&conn, "Repeat", Some(&deleting.id)).expect("same child name");

        delete_note_folder(&conn, &deleting.id).expect("promotion may reuse deleted name");

        let promoted = list_note_folders(&conn)
            .expect("folders")
            .into_iter()
            .find(|folder| folder.id == child.id)
            .expect("promoted child");
        assert_eq!(promoted.parent_id.as_deref(), Some(parent.id.as_str()));
        assert_eq!(promoted.name, "Repeat");
    }

    #[test]
    fn note_folder_sorting_keeps_fractional_created_at_and_reorders_siblings() {
        let conn = in_memory();
        conn.execute_batch(
            "INSERT INTO folders (id, name, parent_id, scope, sort_order, created_at, updated_at)
             VALUES
               ('z-earlier', 'Earlier', NULL, 'note', 0, '2026-01-01T00:00:00.100Z', '2026-01-01T00:00:00.100Z'),
               ('a-later', 'Later', NULL, 'note', 0, '2026-01-01T00:00:00.900Z', '2026-01-01T00:00:00.900Z');",
        )
        .expect("folder fixtures");
        let initial_ids: Vec<_> = list_note_folders(&conn)
            .expect("sorted folders")
            .into_iter()
            .map(|folder| folder.id)
            .collect();
        assert_eq!(initial_ids, vec!["z-earlier", "a-later"]);

        reorder_note_folders(&conn, &[("a-later".into(), -1), ("z-earlier".into(), 1)])
            .expect("reorder note folders");
        let reordered_ids: Vec<_> = list_note_folders(&conn)
            .expect("reordered folders")
            .into_iter()
            .map(|folder| folder.id)
            .collect();
        assert_eq!(reordered_ids, vec!["a-later", "z-earlier"]);
    }

    #[test]
    fn note_folder_reorder_rejects_mixed_parents_before_any_update() {
        let conn = in_memory();
        let root = create_note_folder(&conn, "Root", None).expect("root");
        let other_root = create_note_folder(&conn, "Other", None).expect("other root");
        let nested = create_note_folder(&conn, "Nested", Some(&root.id)).expect("nested");
        let original_root_order = other_root.sort_order;
        let original_nested_order = nested.sort_order;
        conn.execute_batch(
            "CREATE TRIGGER reject_folder_sort_update
             BEFORE UPDATE OF sort_order ON folders
             BEGIN SELECT RAISE(ABORT, 'sort must not be touched'); END;",
        )
        .expect("update guard");

        let error =
            reorder_note_folders(&conn, &[(other_root.id.clone(), 9), (nested.id.clone(), 8)])
                .expect_err("mixed parents must be rejected before updates");
        assert!(matches!(error, AppError::Validation(_)));
        assert_eq!(
            get_folder(&conn, &other_root.id)
                .expect("other root")
                .sort_order,
            original_root_order
        );
        assert_eq!(
            get_folder(&conn, &nested.id).expect("nested").sort_order,
            original_nested_order
        );
    }

    #[test]
    fn note_folder_operations_reject_cross_scope_and_same_name_move_target() {
        let conn = in_memory();
        let task_folder = create_folder(&conn, "Tasks").expect("task folder");
        let root = create_note_folder(&conn, "Root", None).expect("note root");
        let target = create_note_folder(&conn, "Target", None).expect("target root");
        let sibling = create_note_folder(&conn, "Same", Some(&target.id)).expect("target child");
        let moving = create_note_folder(&conn, "Same", Some(&root.id)).expect("moving child");
        let record = note(&conn, "note", Some(root.id.clone()));

        assert!(rename_note_folder(&conn, &task_folder.id, "Nope").is_err());
        assert!(move_note_folder(&conn, &moving.id, Some(&task_folder.id)).is_err());
        assert!(move_note_to_folder(&conn, &record.id, Some(&task_folder.id)).is_err());
        assert!(move_note_folder(&conn, &moving.id, Some(&target.id)).is_err());
        assert_eq!(
            list_note_folders(&conn)
                .expect("same-name move left untouched")
                .into_iter()
                .find(|folder| folder.id == moving.id)
                .unwrap()
                .parent_id,
            Some(root.id)
        );
        assert!(list_note_folders(&conn)
            .expect("target sibling remains")
            .iter()
            .any(|folder| folder.id == sibling.id));
    }

    #[test]
    fn task_filters_ignore_note_folder_modes_and_note_move_can_unfile() {
        let conn = in_memory();
        let note_folder = create_note_folder(&conn, "Notes", None).expect("note folder");
        let filed = note(&conn, "filed", Some(note_folder.id.clone()));
        let task = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: Some(RecordType::Task),
                title: Some("task".into()),
                content: None,
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
                folder_id: None,
            },
        )
        .expect("task record");

        move_note_to_folder(&conn, &filed.id, None).expect("unfile note");
        assert_eq!(
            get_record(&conn, &filed.id)
                .expect("unfiled note")
                .folder_id,
            None
        );
        let task_ids: Vec<_> = list_records_filtered(
            &conn,
            Some(&RecordFilter {
                type_filter: Some(RecordType::Task),
                note_folder_mode: Some("unfiled".into()),
                ..RecordFilter::default()
            }),
            &[],
        )
        .expect("task query ignores note filter")
        .into_iter()
        .map(|record| record.id)
        .collect();
        assert_eq!(task_ids, vec![task.id]);

        let legacy_note_ids: Vec<_> = list_records_filtered(
            &conn,
            Some(&RecordFilter {
                type_filter: Some(RecordType::Note),
                // These fields were ignored before noteFolderMode existed and
                // must remain inert until that mode is explicitly selected.
                folder_id: Some("missing-folder".into()),
                include_descendants: Some(true),
                ..RecordFilter::default()
            }),
            &[],
        )
        .expect("legacy note query remains compatible")
        .into_iter()
        .map(|record| record.id)
        .collect();
        assert_eq!(legacy_note_ids, vec![filed.id]);
    }

    #[test]
    fn note_folder_delete_rolls_back_after_a_sql_failure() {
        let conn = in_memory();
        let parent = create_note_folder(&conn, "Parent", None).expect("parent");
        let deleting = create_note_folder(&conn, "Delete", Some(&parent.id)).expect("deleting");
        let child = create_note_folder(&conn, "Child", Some(&deleting.id)).expect("child");
        let direct = note(&conn, "direct", Some(deleting.id.clone()));
        conn.execute_batch(&format!(
            "CREATE TRIGGER fail_note_folder_delete BEFORE DELETE ON folders
             WHEN OLD.id = '{}' BEGIN SELECT RAISE(ABORT, 'forced delete failure'); END;",
            deleting.id
        ))
        .expect("failure trigger");

        assert!(delete_note_folder(&conn, &deleting.id).is_err());
        assert_eq!(
            get_record(&conn, &direct.id)
                .expect("record rolled back")
                .folder_id,
            Some(deleting.id.clone())
        );
        assert_eq!(
            list_note_folders(&conn)
                .expect("child rolled back")
                .into_iter()
                .find(|folder| folder.id == child.id)
                .unwrap()
                .parent_id,
            Some(deleting.id.clone())
        );
        assert_eq!(
            get_folder(&conn, &deleting.id)
                .expect("folder rolled back")
                .name,
            "Delete"
        );
    }

    #[test]
    fn creates_schema_in_memory() {
        let conn = in_memory();
        run_migrations(&conn).expect("second migration run");
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('records','tasks','attachments','record_attachments','ai_results','ai_task_runs','knowledge_topics','knowledge_evidence','reminders','settings','tags','record_tags')",
                [],
                |row| row.get(0),
            )
            .expect("table count");
        assert_eq!(count, 12);

        let record_columns: Vec<(String, i64)> = conn
            .prepare("PRAGMA table_info(records)")
            .expect("record columns query")
            .query_map([], |row| Ok((row.get(1)?, row.get(3)?)))
            .expect("record columns")
            .collect::<Result<_, _>>()
            .expect("record columns result");
        let folder_columns: Vec<(String, i64)> = conn
            .prepare("PRAGMA table_info(folders)")
            .expect("folder columns query")
            .query_map([], |row| Ok((row.get(1)?, row.get(3)?)))
            .expect("folder columns")
            .collect::<Result<_, _>>()
            .expect("folder columns result");
        let task_columns: Vec<(String, i64)> = conn
            .prepare("PRAGMA table_info(tasks)")
            .expect("task columns query")
            .query_map([], |row| Ok((row.get(1)?, row.get(3)?)))
            .expect("task columns")
            .collect::<Result<_, _>>()
            .expect("task columns result");
        let folder_schema: String = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'folders'",
                [],
                |row| row.get(0),
            )
            .expect("folder schema");
        let user_version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("user version");
        let foreign_keys: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .expect("foreign keys");

        assert!(record_columns.contains(&("folder_id".into(), 0)));
        assert!(folder_columns.contains(&("parent_id".into(), 0)));
        assert!(folder_columns.contains(&("scope".into(), 1)));
        assert!(task_columns.contains(&("sort_order".into(), 1)));
        assert!(task_columns.contains(&("folder_id".into(), 0)));
        assert!(folder_schema.contains("CHECK(scope IN ('note', 'task'))"));
        assert_eq!(user_version, 1);
        assert_eq!(foreign_keys, 1);
        assert!(conn
            .execute(
                "INSERT INTO folders (id, name, scope, created_at, updated_at) VALUES ('bad', 'bad', 'other', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
                [],
            )
            .is_err());
    }

    #[test]
    fn migrates_legacy_folders_to_scoped_schema_idempotently() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE records (id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT, content TEXT, source TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE tasks (id TEXT PRIMARY KEY, record_id TEXT NOT NULL UNIQUE, task_status TEXT NOT NULL, priority TEXT NOT NULL, due_at TEXT, remind_at TEXT, repeat_rule TEXT, completed_at TEXT, sort_order INTEGER NOT NULL DEFAULT 0, folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE);
             INSERT INTO folders VALUES ('f1', ' A ', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO folders VALUES ('f2', 'A', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO folders VALUES ('f3', 'A (2)', 2, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO folders VALUES ('f4', '', 3, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO records VALUES ('r1', 'task', 'task', 'keep task content', 'quick-text', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO records VALUES ('r2', 'note', 'note', 'keep note content', 'quick-text', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO tasks (id, record_id, task_status, priority, sort_order, folder_id) VALUES ('t1', 'r1', 'todo', 'medium', 0, 'f1');",
        )
        .expect("legacy fixture");

        run_migrations(&conn).expect("migrate legacy schema");
        run_migrations(&conn).expect("migration is idempotent");

        let scope: String = conn
            .query_row("SELECT scope FROM folders WHERE id = 'f1'", [], |r| {
                r.get(0)
            })
            .expect("scope");
        let task_folder: String = conn
            .query_row("SELECT folder_id FROM tasks WHERE id = 't1'", [], |r| {
                r.get(0)
            })
            .expect("task folder");
        let task_record: (String, String) = conn
            .query_row("SELECT id, content FROM records WHERE id = 'r1'", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .expect("migrated task record");
        let note: (String, String, Option<String>) = conn
            .query_row(
                "SELECT id, content, folder_id FROM records WHERE id = 'r2'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("migrated note");
        let names: Vec<String> = conn
            .prepare("SELECT name FROM folders ORDER BY id")
            .expect("names query")
            .query_map([], |r| r.get(0))
            .expect("names")
            .collect::<Result<_, _>>()
            .expect("names result");
        let fk_errors: i64 = conn
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| {
                r.get(0)
            })
            .expect("fk check");
        let index_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name IN ('folders_sibling_name_uq', 'folders_scope_parent_idx', 'records_folder_id_idx')",
                [],
                |r| r.get(0),
            )
            .expect("folder indexes");

        assert_eq!(scope, "task");
        assert_eq!(task_folder, "f1");
        assert_eq!(task_record, ("r1".into(), "keep task content".into()));
        assert_eq!(note, ("r2".into(), "keep note content".into(), None));
        assert_eq!(names, vec!["A", "A (2)", "A (3)", "未命名文件夹"]);
        assert_eq!(fk_errors, 0);
        assert_eq!(index_count, 3);
    }

    #[test]
    fn migration_infers_note_scope_from_existing_record_folder_association() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT, scope TEXT NOT NULL DEFAULT 'task', sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE records (id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT, content TEXT, source TEXT NOT NULL, status TEXT NOT NULL, folder_id TEXT REFERENCES folders(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE tasks (id TEXT PRIMARY KEY, record_id TEXT NOT NULL UNIQUE, task_status TEXT NOT NULL, priority TEXT NOT NULL, due_at TEXT, remind_at TEXT, repeat_rule TEXT, completed_at TEXT, sort_order INTEGER NOT NULL DEFAULT 0, folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE);
             INSERT INTO folders VALUES ('parent', 'Notes', NULL, 'note', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO folders VALUES ('child', 'Child', 'parent', 'task', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO records VALUES ('note-1', 'note', 'note', 'keep this body', 'quick-text', 'active', 'child', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');",
        )
        .expect("partially upgraded fixture");

        run_migrations(&conn).expect("migration");

        let migrated: (String, String, String, String) = conn
            .query_row(
                "SELECT r.id, r.content, r.folder_id, f.scope FROM records r JOIN folders f ON f.id = r.folder_id WHERE r.id = 'note-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("migrated note association");
        assert_eq!(
            migrated,
            (
                "note-1".into(),
                "keep this body".into(),
                "child".into(),
                "note".into()
            )
        );
    }

    #[test]
    fn migration_rejects_folder_shared_by_note_and_task_and_rolls_back() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT, scope TEXT NOT NULL DEFAULT 'task', sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE records (id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT, content TEXT, source TEXT NOT NULL, status TEXT NOT NULL, folder_id TEXT REFERENCES folders(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE tasks (id TEXT PRIMARY KEY, record_id TEXT NOT NULL UNIQUE, task_status TEXT NOT NULL, priority TEXT NOT NULL, due_at TEXT, remind_at TEXT, repeat_rule TEXT, completed_at TEXT, sort_order INTEGER NOT NULL DEFAULT 0, folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE);
             INSERT INTO folders VALUES ('shared', ' Shared ', NULL, 'task', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO records VALUES ('note-1', 'note', 'note', 'note body', 'quick-text', 'active', 'shared', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO records VALUES ('task-record', 'task', 'task', 'task body', 'quick-text', 'active', NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO tasks (id, record_id, task_status, priority, sort_order, folder_id) VALUES ('task-1', 'task-record', 'todo', 'medium', 0, 'shared');",
        )
        .expect("conflicting fixture");

        let error = run_migrations(&conn).expect_err("shared scope must be rejected");

        let folder: (String, String) = conn
            .query_row(
                "SELECT name, scope FROM folders WHERE id = 'shared'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("rolled back folder");
        let user_version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("user version");
        assert!(error.to_string().contains("both note and task"));
        assert_eq!(folder, (" Shared ".into(), "task".into()));
        assert_eq!(user_version, 0);
    }

    #[test]
    fn migration_rejects_non_note_record_folder_id_and_rolls_back() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE records (id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT, content TEXT, source TEXT NOT NULL, status TEXT NOT NULL, folder_id TEXT REFERENCES folders(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE tasks (id TEXT PRIMARY KEY, record_id TEXT NOT NULL UNIQUE, task_status TEXT NOT NULL, priority TEXT NOT NULL, due_at TEXT, remind_at TEXT, repeat_rule TEXT, completed_at TEXT, sort_order INTEGER NOT NULL DEFAULT 0, folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE);
             INSERT INTO folders VALUES ('f1', ' Tasks ', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO records VALUES ('task-record', 'task', 'task', 'task body', 'quick-text', 'active', 'f1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');",
        )
        .expect("partially upgraded fixture");
        let original_record_columns: Vec<String> = conn
            .prepare("PRAGMA table_info(records)")
            .expect("original record columns query")
            .query_map([], |row| row.get(1))
            .expect("original record columns")
            .collect::<Result<_, _>>()
            .expect("original record columns result");

        let error = run_migrations(&conn).expect_err("task record folder must be rejected");

        let record_columns: Vec<String> = conn
            .prepare("PRAGMA table_info(records)")
            .expect("record columns query")
            .query_map([], |row| row.get(1))
            .expect("record columns")
            .collect::<Result<_, _>>()
            .expect("record columns result");
        let folder_columns: Vec<String> = conn
            .prepare("PRAGMA table_info(folders)")
            .expect("folder columns query")
            .query_map([], |row| row.get(1))
            .expect("folder columns")
            .collect::<Result<_, _>>()
            .expect("folder columns result");
        let folder_id: String = conn
            .query_row(
                "SELECT folder_id FROM records WHERE id = 'task-record'",
                [],
                |row| row.get(0),
            )
            .expect("rolled back record folder");
        let folder_name: String = conn
            .query_row("SELECT name FROM folders WHERE id = 'f1'", [], |row| {
                row.get(0)
            })
            .expect("rolled back folder name");
        let user_version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("user version");

        assert!(error.to_string().contains("non-note"));
        assert_eq!(record_columns, original_record_columns);
        assert!(!folder_columns.iter().any(|column| column == "parent_id"));
        assert!(!folder_columns.iter().any(|column| column == "scope"));
        assert_eq!(folder_id, "f1");
        assert_eq!(folder_name, " Tasks ");
        assert_eq!(user_version, 0);
    }

    #[test]
    fn migration_rejects_parent_child_scope_mismatch_and_rolls_back() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT, scope TEXT NOT NULL DEFAULT 'task', sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE records (id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT, content TEXT, source TEXT NOT NULL, status TEXT NOT NULL, folder_id TEXT REFERENCES folders(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE tasks (id TEXT PRIMARY KEY, record_id TEXT NOT NULL UNIQUE, task_status TEXT NOT NULL, priority TEXT NOT NULL, due_at TEXT, remind_at TEXT, repeat_rule TEXT, completed_at TEXT, sort_order INTEGER NOT NULL DEFAULT 0, folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE);
             INSERT INTO folders VALUES ('parent', 'Tasks', NULL, 'task', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO folders VALUES ('child', 'Notes', 'parent', 'task', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO records VALUES ('note-1', 'note', 'note', 'body', 'quick-text', 'active', 'child', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');",
        )
        .expect("scope mismatch fixture");

        let error = run_migrations(&conn).expect_err("scope mismatch must be rejected");

        let child_scope: String = conn
            .query_row("SELECT scope FROM folders WHERE id = 'child'", [], |row| {
                row.get(0)
            })
            .expect("rolled back child scope");
        let user_version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("user version");
        assert!(error.to_string().contains("parent scope"));
        assert_eq!(child_scope, "task");
        assert_eq!(user_version, 0);
    }

    #[test]
    fn migration_reports_folder_suffix_exhaustion_without_panicking() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "CREATE TABLE folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE records (id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT, content TEXT, source TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE tasks (id TEXT PRIMARY KEY, record_id TEXT NOT NULL UNIQUE, task_status TEXT NOT NULL, priority TEXT NOT NULL, due_at TEXT, remind_at TEXT, repeat_rule TEXT, completed_at TEXT, sort_order INTEGER NOT NULL DEFAULT 0, folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE);",
        )
        .expect("legacy schema");
        let exhausted_name = format!("A ({})", usize::MAX);
        conn.execute(
            "INSERT INTO folders VALUES ('f1', ?1, 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            params![exhausted_name],
        )
        .expect("first folder");
        conn.execute(
            "INSERT INTO folders VALUES ('f2', ?1, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            params![exhausted_name],
        )
        .expect("second folder");

        let error = run_migrations(&conn).expect_err("suffix exhaustion must be reported");

        let names: Vec<String> = conn
            .prepare("SELECT name FROM folders ORDER BY id")
            .expect("names query")
            .query_map([], |row| row.get(0))
            .expect("names")
            .collect::<Result<_, _>>()
            .expect("names result");
        let user_version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("user version");
        assert!(error.to_string().contains("suffix"));
        assert_eq!(names, vec![exhausted_name.clone(), exhausted_name]);
        assert_eq!(user_version, 0);
    }

    #[test]
    fn foreign_key_violation_rolls_back_real_legacy_migration() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "PRAGMA foreign_keys = OFF;
             CREATE TABLE folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE records (id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT, content TEXT, source TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE tasks (id TEXT PRIMARY KEY, record_id TEXT NOT NULL UNIQUE, task_status TEXT NOT NULL, priority TEXT NOT NULL, due_at TEXT, remind_at TEXT, repeat_rule TEXT, completed_at TEXT, sort_order INTEGER NOT NULL DEFAULT 0, folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE);
             INSERT INTO records VALUES ('r1', 'experience', 'title', 'content', 'quick-text', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO tasks (id, record_id, task_status, priority, sort_order, folder_id) VALUES ('t1', 'r1', 'todo', 'medium', 0, 'missing-folder');
             PRAGMA foreign_keys = ON;",
        )
        .expect("invalid legacy fixture");

        let error = run_migrations(&conn).expect_err("foreign key violation must fail migration");

        let record_type: String = conn
            .query_row("SELECT type FROM records WHERE id = 'r1'", [], |row| {
                row.get(0)
            })
            .expect("record type");
        let record_columns: Vec<String> = conn
            .prepare("PRAGMA table_info(records)")
            .expect("record columns query")
            .query_map([], |row| row.get(1))
            .expect("record columns")
            .collect::<Result<_, _>>()
            .expect("record columns result");
        let user_version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .expect("user version");
        let foreign_keys: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .expect("foreign keys");
        assert!(error.to_string().contains("foreign key check failed"));
        assert_eq!(record_type, "experience");
        assert!(!record_columns.iter().any(|column| column == "folder_id"));
        assert_eq!(user_version, 0);
        assert_eq!(foreign_keys, 1);
    }

    #[test]
    fn migration_failure_rolls_back_every_schema_and_data_change() {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE records (id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT, content TEXT, source TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE tasks (id TEXT PRIMARY KEY, record_id TEXT NOT NULL UNIQUE, task_status TEXT NOT NULL, priority TEXT NOT NULL, due_at TEXT, remind_at TEXT, repeat_rule TEXT, completed_at TEXT);
             CREATE TABLE folders_sibling_name_uq (collision TEXT);
             INSERT INTO folders VALUES ('f1', ' A ', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO records VALUES ('r1', 'experience', 'title', 'content', 'quick-text', 'active', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');",
        )
        .expect("legacy fixture");

        run_migrations(&conn).expect_err("index name collision must fail migration");

        let record_type: String = conn
            .query_row("SELECT type FROM records WHERE id = 'r1'", [], |r| r.get(0))
            .expect("record type");
        let folder_name: String = conn
            .query_row("SELECT name FROM folders WHERE id = 'f1'", [], |r| r.get(0))
            .expect("folder name");
        let record_columns: Vec<String> = conn
            .prepare("PRAGMA table_info(records)")
            .expect("record columns query")
            .query_map([], |row| row.get(1))
            .expect("record columns")
            .collect::<Result<_, _>>()
            .expect("record columns result");
        let task_columns: Vec<String> = conn
            .prepare("PRAGMA table_info(tasks)")
            .expect("task columns query")
            .query_map([], |row| row.get(1))
            .expect("task columns")
            .collect::<Result<_, _>>()
            .expect("task columns result");
        let attachments_table: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'attachments'",
                [],
                |r| r.get(0),
            )
            .expect("attachments table count");
        let user_version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .expect("user version");
        let foreign_keys: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .expect("foreign keys");

        assert_eq!(record_type, "experience");
        assert_eq!(folder_name, " A ");
        assert!(!record_columns.iter().any(|column| column == "folder_id"));
        assert!(!task_columns.iter().any(|column| column == "sort_order"));
        assert_eq!(attachments_table, 0);
        assert_eq!(user_version, 0);
        assert_eq!(foreign_keys, 1);
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
                folder_id: None,
            },
        )
        .expect("insert record");

        let fetched = get_record(&conn, &record.id).expect("get record");
        assert_eq!(fetched.record_type, RecordType::Note);
        assert_eq!(fetched.title.as_deref(), Some("VPN broken"));
    }

    #[test]
    fn note_folder_id_roundtrips_through_every_record_read_path() {
        let conn = in_memory();
        conn.execute(
            "INSERT INTO folders (id, name, parent_id, scope, sort_order, created_at, updated_at) VALUES ('notes', 'Notes', NULL, 'note', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .expect("note folder");
        let record = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: Some(RecordType::Note),
                title: Some("folder roundtrip".into()),
                content: Some("body".into()),
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
                folder_id: Some("notes".into()),
            },
        )
        .expect("insert record");

        let fetched = get_record(&conn, &record.id).expect("get record");
        let listed = list_records(&conn).expect("list records");
        let filtered = list_records_filtered(
            &conn,
            Some(&RecordFilter {
                type_filter: Some(RecordType::Note),
                search_query: Some("folder roundtrip".into()),
                ..RecordFilter::default()
            }),
            &[],
        )
        .expect("filtered records");
        let detailed = get_record_with_relations(&conn, &record.id).expect("record relations");

        assert_eq!(record.folder_id.as_deref(), Some("notes"));
        assert_eq!(fetched.folder_id.as_deref(), Some("notes"));
        assert_eq!(listed[0].folder_id.as_deref(), Some("notes"));
        assert_eq!(filtered[0].folder_id.as_deref(), Some("notes"));
        assert_eq!(detailed.folder_id.as_deref(), Some("notes"));
    }

    #[test]
    fn rejects_task_record_folder_id() {
        let conn = in_memory();
        let folder = create_folder(&conn, "tasks").expect("task folder");
        let error = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: Some(RecordType::Task),
                title: Some("cannot be in note folder".into()),
                content: None,
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
                folder_id: Some(folder.id),
            },
        )
        .expect_err("task record folder must be rejected");
        assert!(matches!(error, AppError::Validation(_)));
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
                folder_id: None,
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
                folder_id: None,
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
                folder_id: None,
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
                folder_id: None,
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
                folder_id: None,
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
        assert!(get_record_attachments(&conn, &record.id)
            .expect("links")
            .is_empty());
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
                folder_id: None,
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
                folder_id: None,
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
                priority: Some(TaskPriority::High),  // should be ignored
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
                folder_id: None,
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
                folder_id: None,
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
                folder_id: None,
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
        let value =
            get_setting_or(&conn, "quick_capture_shortcut", "Alt+Shift+R").expect("get_setting_or");
        assert_eq!(value, "Alt+Shift+R");
    }

    #[test]
    fn get_setting_or_returns_stored_value_when_set() {
        let conn = in_memory();
        set_setting(&conn, "quick_capture_shortcut", "Alt+Shift+T").expect("set");
        let value =
            get_setting_or(&conn, "quick_capture_shortcut", "Alt+Shift+R").expect("get_setting_or");
        assert_eq!(value, "Alt+Shift+T");
    }

    // ── Task 1: remove-task semantics ─────────────────────────────

    #[test]
    fn remove_task_deletes_task_and_linked_record() {
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
                folder_id: None,
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

        // Assert: task row is gone (cascade from record deletion)
        assert!(get_task(&conn, &task.id).is_err());

        // Assert: linked record is physically deleted too — it must never
        // resurface in another category
        assert!(get_record(&conn, &record.id).is_err());
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
                folder_id: None,
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
        link_attachment(&conn, &record.id, &att_b.id, AttachmentRole::Reference, 1)
            .expect("link b");

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
                folder_id: None,
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
                folder_id: None,
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
                folder_id: None,
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
        link_attachment(&conn, &record_b.id, &att.id, AttachmentRole::Reference, 0)
            .expect("link B");

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
        let qc = get_setting_or(&conn, "quick_capture_shortcut", "Alt+Shift+R").expect("qc");
        let ss = get_setting_or(&conn, "screenshot_shortcut", "Alt+Shift+S").expect("ss");

        assert_eq!(qc, "Ctrl+Shift+1");
        assert_eq!(ss, "Ctrl+Shift+2");
    }

    #[test]
    fn run_migrations_creates_ai_task_runs_table() {
        let conn = in_memory();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='ai_task_runs'",
                [],
                |row| row.get(0),
            )
            .expect("query table count");

        assert_eq!(count, 1, "ai_task_runs table should exist after migrations");
    }

    #[test]
    fn run_migrations_creates_knowledge_memory_tables() {
        let conn = in_memory();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('knowledge_topics', 'knowledge_evidence')",
                [],
                |row| row.get(0),
            )
            .expect("query table count");

        assert_eq!(
            count, 2,
            "knowledge memory tables should exist after migrations"
        );
    }

    #[test]
    fn run_migrations_creates_learning_dialog_sessions_table() {
        let conn = in_memory();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='learning_dialog_sessions'",
                [],
                |row| row.get(0),
            )
            .expect("query table count");

        assert_eq!(
            count, 1,
            "learning dialog session table should exist after migrations"
        );
    }

    #[test]
    fn upsert_knowledge_topic_and_fetch_for_record_roundtrips() {
        let conn = in_memory();
        let record = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: Some(RecordType::Note),
                title: Some("memory source".into()),
                content: Some("span decorator note".into()),
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
                folder_id: None,
            },
        )
        .expect("record");

        let topic = upsert_knowledge_topic(
            &conn,
            "Python 装饰器",
            "已能结合 span 装饰器理解监控场景中的用法",
            "understanding",
        )
        .expect("topic");
        append_knowledge_evidence(
            &conn,
            &topic.id,
            &record.id,
            "ai-suggestion",
            "在应用监控系统笔记中分析过 span 装饰器",
        )
        .expect("evidence");

        let topics = get_knowledge_topics_for_record(&conn, &record.id).expect("topics");
        assert_eq!(topics.len(), 1);
        assert_eq!(topics[0].name, "Python 装饰器");
        assert_eq!(topics[0].mastery_level, "understanding");
        assert_eq!(
            topics[0].evidence_text,
            "在应用监控系统笔记中分析过 span 装饰器"
        );
    }

    #[test]
    fn knowledge_memory_list_and_detail_include_evidence_and_latest_conclusion() {
        let conn = in_memory();
        let first_record = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: Some(RecordType::Note),
                title: Some("监控系统笔记".into()),
                content: Some("span decorator".into()),
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
                folder_id: None,
            },
        )
        .expect("first record");
        let second_record = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: Some(RecordType::Note),
                title: Some("补充笔记".into()),
                content: Some("span usage".into()),
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
                folder_id: None,
            },
        )
        .expect("second record");

        let understanding = upsert_knowledge_topic(
            &conn,
            "Python 装饰器",
            "用户已能解释 span 装饰器的用途",
            "understanding",
        )
        .expect("understanding topic");
        append_knowledge_evidence(
            &conn,
            &understanding.id,
            &first_record.id,
            "dialog_answer",
            "用户能用自己的话说明 span 装饰器的作用。",
        )
        .expect("first evidence");
        append_knowledge_evidence(
            &conn,
            &understanding.id,
            &second_record.id,
            "task_practice",
            "用户在新的监控代码中复用了该模式。",
        )
        .expect("second evidence");
        insert_learning_dialog_session(
            &conn,
            crate::models::LearningDialogSession {
                id: "session-1".into(),
                topic_id: understanding.id.clone(),
                source_record_id: second_record.id.clone(),
                status: "promote_to_understanding".into(),
                conversation_snapshot: "[]".into(),
                conclusion_json: Some("{\"reason\":\"用户已能应用\"}".into()),
                created_at: chrono::Utc::now(),
            },
        )
        .expect("session");

        let candidate =
            upsert_knowledge_topic(&conn, "OKR 执行", "待确认的目标管理知识", "candidate")
                .expect("candidate topic");
        append_knowledge_evidence(
            &conn,
            &candidate.id,
            &first_record.id,
            "analysis_suggestion",
            "笔记中出现 KR 交付讨论。",
        )
        .expect("candidate evidence");

        let items = list_knowledge_memory(&conn).expect("memory list");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].name, "Python 装饰器");
        assert_eq!(items[0].mastery_level, "understanding");
        assert_eq!(items[0].evidence_count, 2);
        assert_eq!(
            items[0].latest_evidence_text,
            "用户在新的监控代码中复用了该模式。"
        );

        let detail = get_knowledge_memory_detail(&conn, &understanding.id).expect("memory detail");
        assert_eq!(detail.evidence.len(), 2);
        assert_eq!(detail.evidence[0].record_title.as_deref(), Some("补充笔记"));
        assert_eq!(
            detail.latest_conclusion_json.as_deref(),
            Some("{\"reason\":\"用户已能应用\"}")
        );
    }

    #[test]
    fn get_record_with_relations_includes_knowledge_topics() {
        let conn = in_memory();
        let record = insert_record(
            &conn,
            CreateRecordRequest {
                record_type: Some(RecordType::Note),
                title: Some("okr note".into()),
                content: Some("KR 定义".into()),
                source: RecordSource::QuickText,
                create_as_task: false,
                attachment_ids: vec![],
                folder_id: None,
            },
        )
        .expect("record");

        let topic = upsert_knowledge_topic(
            &conn,
            "OKR 执行理解",
            "开始形成对 KR 交付形式的判断",
            "awareness",
        )
        .expect("topic");
        append_knowledge_evidence(
            &conn,
            &topic.id,
            &record.id,
            "ai-suggestion",
            "KR 是交付的内容？",
        )
        .expect("evidence");

        let detailed = get_record_with_relations(&conn, &record.id).expect("detail");
        assert_eq!(detailed.knowledge_topics.len(), 1);
        assert_eq!(detailed.knowledge_topics[0].name, "OKR 执行理解");
    }

    #[test]
    fn get_all_settings_with_defaults_includes_ai_model_variant_and_ai_base_url() {
        let conn = in_memory();

        let settings = get_all_settings_with_defaults(&conn).expect("settings");

        assert!(settings
            .iter()
            .any(|entry| entry.key == "ai_model_variant" && entry.value == "default"));
        assert!(settings
            .iter()
            .any(|entry| entry.key == "ai_base_url" && entry.value.is_empty()));
        assert!(settings
            .iter()
            .any(|entry| entry.key == "product_mode" && entry.value == "free"));
    }

    #[test]
    fn get_all_settings_with_defaults_returns_defaults_when_table_empty() {
        let conn = in_memory();

        let settings = get_all_settings_with_defaults(&conn).expect("settings");

        assert!(settings
            .iter()
            .any(|entry| entry.key == "quick_capture_shortcut" && entry.value == "Alt+Shift+R"));
        assert!(settings
            .iter()
            .any(|entry| entry.key == "screenshot_shortcut" && entry.value == "Alt+Shift+S"));
        assert!(settings.iter().any(|entry| entry.key == "pet_visible"));
    }

    #[test]
    fn get_all_settings_with_defaults_prefers_persisted_values() {
        let conn = in_memory();

        set_setting(&conn, "quick_capture_shortcut", "Ctrl+Shift+9").expect("set shortcut");
        set_setting(&conn, "ai_provider", "openai").expect("set provider");

        let settings = get_all_settings_with_defaults(&conn).expect("settings");

        assert!(settings
            .iter()
            .any(|entry| entry.key == "quick_capture_shortcut" && entry.value == "Ctrl+Shift+9"));
        assert!(settings
            .iter()
            .any(|entry| entry.key == "ai_provider" && entry.value == "openai"));
        assert!(settings
            .iter()
            .any(|entry| entry.key == "screenshot_shortcut" && entry.value == "Alt+Shift+S"));
    }

    #[test]
    fn get_all_settings_with_defaults_never_returns_api_key_values() {
        let conn = in_memory();
        set_setting(&conn, "ai_api_key", "current-secret").expect("set current key");
        set_setting(&conn, "claude_api_key", "legacy-secret").expect("set legacy key");

        let settings = get_all_settings_with_defaults(&conn).expect("settings");

        assert!(settings.iter().all(|entry| entry.key != "ai_api_key"));
        assert!(settings.iter().all(|entry| entry.key != "claude_api_key"));
        assert!(settings.iter().all(|entry| entry.value != "current-secret"));
        assert!(settings.iter().all(|entry| entry.value != "legacy-secret"));
    }

    #[test]
    fn pet_chat_sessions_persist_messages_and_limit_context_candidates() {
        let conn = in_memory();
        let session = create_pet_chat_session(&conn, Some("监控迁移".into())).expect("session");
        append_pet_chat_message(&conn, &session.id, "user", "Signoz 迁移先做什么", "[]")
            .expect("message");

        for title in [
            "Signoz 迁移方案",
            "Signoz trace 验证",
            "Signoz 仪表盘清单",
            "无关的周末购物",
        ] {
            insert_record(
                &conn,
                CreateRecordRequest {
                    record_type: Some(RecordType::Note),
                    title: Some(title.into()),
                    content: Some("迁移监控系统的工作记录".into()),
                    source: RecordSource::QuickText,
                    create_as_task: false,
                    attachment_ids: vec![],
                    folder_id: None,
                },
            )
            .expect("record");
        }

        let candidates =
            list_pet_chat_context_candidates(&conn, "Signoz", 3).expect("context candidates");
        let messages = list_pet_chat_messages(&conn, &session.id).expect("messages");

        assert_eq!(messages.len(), 1);
        assert_eq!(candidates.len(), 3);
        assert!(candidates
            .iter()
            .all(|candidate| candidate.title.contains("Signoz")));
    }

    #[test]
    fn pet_chat_sessions_are_listed_by_recent_activity_and_can_restore_latest() {
        let conn = in_memory();
        let older = create_pet_chat_session(&conn, Some("较早对话".into())).expect("older session");
        let newer = create_pet_chat_session(&conn, Some("最近对话".into())).expect("newer session");
        conn.execute(
            "UPDATE pet_chat_sessions SET updated_at = ?2 WHERE id = ?1",
            params![older.id, "2100-01-01T00:00:00+00:00"],
        )
        .expect("newer activity");

        let sessions = list_pet_chat_sessions(&conn, 10).expect("sessions");
        let latest = get_latest_pet_chat_session(&conn).expect("latest session");

        assert_eq!(
            sessions
                .iter()
                .map(|session| &session.id)
                .collect::<Vec<_>>(),
            vec![&older.id, &newer.id]
        );
        assert_eq!(latest.expect("a latest session").id, older.id);
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
                folder_id: None,
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

    #[test]
    fn ai_profiles_schema_supports_multiple_profiles_and_models() {
        let conn = Connection::open_in_memory().expect("connection");
        run_migrations(&conn).expect("migrations");

        let profile = create_ai_profile(
            &conn,
            &CreateAiProfileRequest {
                name: "OpenAI 工作".into(),
                provider: "openai".into(),
                base_url: None,
                default_model: "gpt-4.1".into(),
                models: vec!["gpt-4.1".into(), "gpt-4o".into()],
                enabled: true,
            },
        )
        .expect("profile");

        let profiles = list_ai_profiles(&conn).expect("profiles");
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].id, profile.id);
        assert_eq!(profiles[0].models, vec!["gpt-4.1", "gpt-4o"]);
        assert_eq!(profiles[0].default_model, "gpt-4.1");
    }

    #[test]
    fn ai_profile_update_and_delete_are_scoped_to_profile() {
        let conn = Connection::open_in_memory().expect("connection");
        run_migrations(&conn).expect("migrations");
        let profile = create_ai_profile(
            &conn,
            &CreateAiProfileRequest {
                name: "旧名称".into(),
                provider: "openai".into(),
                base_url: None,
                default_model: "gpt-4o".into(),
                models: vec!["gpt-4o".into()],
                enabled: true,
            },
        )
        .expect("profile");

        update_ai_profile(
            &conn,
            &profile.id,
            &UpdateAiProfileRequest {
                name: "新名称".into(),
                provider: "openai".into(),
                base_url: Some("https://example.test/v1".into()),
                default_model: "gpt-4.1".into(),
                models: vec!["gpt-4.1".into()],
                enabled: false,
            },
        )
        .expect("update");
        let updated = list_ai_profiles(&conn).expect("profiles");
        assert_eq!(updated[0].name, "新名称");
        assert!(!updated[0].enabled);
        assert_eq!(updated[0].models, vec!["gpt-4.1"]);

        delete_ai_profile(&conn, &profile.id).expect("delete");
        assert!(list_ai_profiles(&conn).expect("profiles").is_empty());
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
                folder_id: None,
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
                folder_id: None,
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
                folder_id: None,
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
                folder_id: None,
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
        assert!(
            returned_ids.contains(&task_todo.id.as_str()),
            "should contain todo task"
        );
        assert!(
            returned_ids.contains(&task_doing.id.as_str()),
            "should contain doing task"
        );

        // Assert: done/cancelled are excluded
        assert!(
            !returned_ids.contains(&task_done.id.as_str()),
            "should NOT contain done task"
        );

        // Assert: todo item has correct record fields
        let todo_item = items
            .iter()
            .find(|i| i.task_id == task_todo.id)
            .expect("todo item");
        assert_eq!(todo_item.record_id, record_todo.id);
        assert_eq!(todo_item.record_title.as_deref(), Some("todo item"));
        assert_eq!(todo_item.record_content.as_deref(), Some("need to do this"));
        assert_eq!(todo_item.task_status, TaskStatus::Todo);
        assert_eq!(todo_item.priority, TaskPriority::High);
        assert_eq!(todo_item.attachment_count, 0);

        // Assert: doing item has attachment_count = 1
        let doing_item = items
            .iter()
            .find(|i| i.task_id == task_doing.id)
            .expect("doing item");
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
