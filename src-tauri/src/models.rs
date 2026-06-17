#![allow(dead_code)]

// Task 2 intentionally defines the shared domain surface ahead of command wiring.
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RecordType {
    Note,
    Task,
    Experience,
    Issue,
    FileNote,
}

impl Default for RecordType {
    fn default() -> Self {
        Self::Note
    }
}

impl RecordType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Note => "note",
            Self::Task => "task",
            Self::Experience => "experience",
            Self::Issue => "issue",
            Self::FileNote => "file-note",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "task" => Self::Task,
            "experience" => Self::Experience,
            "issue" => Self::Issue,
            "file-note" => Self::FileNote,
            _ => Self::Note,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RecordSource {
    QuickText,
    BuiltInScreenshot,
    DragDrop,
    ClipboardPaste,
    FilePicker,
}

impl Default for RecordSource {
    fn default() -> Self {
        Self::QuickText
    }
}

impl RecordSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::QuickText => "quick-text",
            Self::BuiltInScreenshot => "built-in-screenshot",
            Self::DragDrop => "drag-drop",
            Self::ClipboardPaste => "clipboard-paste",
            Self::FilePicker => "file-picker",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "built-in-screenshot" => Self::BuiltInScreenshot,
            "drag-drop" => Self::DragDrop,
            "clipboard-paste" => Self::ClipboardPaste,
            "file-picker" => Self::FilePicker,
            _ => Self::QuickText,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RecordStatus {
    Active,
    Archived,
}

impl Default for RecordStatus {
    fn default() -> Self {
        Self::Active
    }
}

impl RecordStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Archived => "archived",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "archived" => Self::Archived,
            _ => Self::Active,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TaskStatus {
    Todo,
    Doing,
    Done,
    Cancelled,
}

impl Default for TaskStatus {
    fn default() -> Self {
        Self::Todo
    }
}

impl TaskStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Todo => "todo",
            Self::Doing => "doing",
            Self::Done => "done",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "doing" => Self::Doing,
            "done" => Self::Done,
            "cancelled" => Self::Cancelled,
            _ => Self::Todo,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TaskPriority {
    Low,
    Medium,
    High,
}

impl Default for TaskPriority {
    fn default() -> Self {
        Self::Medium
    }
}

impl TaskPriority {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "low" => Self::Low,
            "high" => Self::High,
            _ => Self::Medium,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AttachmentType {
    Image,
    Screenshot,
    File,
}

impl AttachmentType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::Screenshot => "screenshot",
            Self::File => "file",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "screenshot" => Self::Screenshot,
            "file" => Self::File,
            _ => Self::Image,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AttachmentRole {
    Main,
    Reference,
}

impl Default for AttachmentRole {
    fn default() -> Self {
        Self::Main
    }
}

impl AttachmentRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Main => "main",
            Self::Reference => "reference",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "reference" => Self::Reference,
            _ => Self::Main,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AiTriggerMode {
    Manual,
    Auto,
    Smart,
}

impl AiTriggerMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Auto => "auto",
            Self::Smart => "smart",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "auto" => Self::Auto,
            "smart" => Self::Smart,
            _ => Self::Manual,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ReminderChannel {
    PetBubble,
    SystemNotification,
}

impl ReminderChannel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::PetBubble => "pet-bubble",
            Self::SystemNotification => "system-notification",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "system-notification" => Self::SystemNotification,
            _ => Self::PetBubble,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ReminderStatus {
    Pending,
    Triggered,
    Cancelled,
}

impl ReminderStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Triggered => "triggered",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "triggered" => Self::Triggered,
            "cancelled" => Self::Cancelled,
            _ => Self::Pending,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum JobStatus {
    Pending,
    Running,
    Success,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Record {
    pub id: String,
    #[serde(rename = "type")]
    pub record_type: RecordType,
    pub title: Option<String>,
    pub content: Option<String>,
    pub source: RecordSource,
    pub status: RecordStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Task {
    pub id: String,
    pub record_id: String,
    pub task_status: TaskStatus,
    pub priority: TaskPriority,
    pub due_at: Option<DateTime<Utc>>,
    pub remind_at: Option<DateTime<Utc>>,
    pub repeat_rule: Option<String>,
    pub completed_at: Option<DateTime<Utc>>,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Attachment {
    pub id: String,
    pub file_type: AttachmentType,
    pub mime_type: String,
    pub local_path: String,
    pub thumbnail_path: Option<String>,
    pub ocr_text: Option<String>,
    pub hash: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecordAttachmentLink {
    pub id: String,
    pub record_id: String,
    pub attachment_id: String,
    pub role: AttachmentRole,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AiResult {
    pub id: String,
    pub record_id: String,
    pub trigger_mode: AiTriggerMode,
    pub model_provider: Option<String>,
    pub model_name: Option<String>,
    pub summary: Option<String>,
    pub tags: Option<String>,
    pub suggested_tasks: Option<String>,
    pub research_result: Option<String>,
    pub sensitivity_flag: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Reminder {
    pub id: String,
    pub record_id: String,
    pub task_id: Option<String>,
    pub trigger_at: DateTime<Utc>,
    pub channel: ReminderChannel,
    pub status: ReminderStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SettingsEntry {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CreateRecordRequest {
    #[serde(rename = "type")]
    pub record_type: Option<RecordType>,
    pub title: Option<String>,
    pub content: Option<String>,
    pub source: RecordSource,
    #[serde(default, rename = "createAsTask")]
    pub create_as_task: bool,
    #[serde(default, rename = "attachmentIds")]
    pub attachment_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImportFilesRequest {
    pub paths: Vec<String>,
    pub source: RecordSource,
    #[serde(default, rename = "createAsTask")]
    pub create_as_task: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ClipboardImageRequest {
    pub rgba: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub source: RecordSource,
    #[serde(default, rename = "createAsTask")]
    pub create_as_task: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UpdateRecordRequest {
    pub title: Option<String>,
    pub content: Option<String>,
    pub status: Option<RecordStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CreateTaskRequest {
    pub record_id: String,
    pub task_status: Option<TaskStatus>,
    pub priority: Option<TaskPriority>,
    pub due_at: Option<DateTime<Utc>>,
    pub remind_at: Option<DateTime<Utc>>,
    pub repeat_rule: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CreateAttachmentRequest {
    pub file_type: AttachmentType,
    pub mime_type: String,
    pub local_path: String,
    pub thumbnail_path: Option<String>,
    pub ocr_text: Option<String>,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CreateAiResultRequest {
    pub record_id: String,
    pub trigger_mode: AiTriggerMode,
    pub model_provider: Option<String>,
    pub model_name: Option<String>,
    pub summary: Option<String>,
    pub tags: Option<String>,
    pub suggested_tasks: Option<String>,
    pub research_result: Option<String>,
    pub sensitivity_flag: Option<String>,
}

/// Lightweight filter for listing records.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RecordFilter {
    #[serde(rename = "typeFilter")]
    pub type_filter: Option<RecordType>,
    #[serde(rename = "statusFilter")]
    pub status_filter: Option<RecordStatus>,
    #[serde(rename = "searchQuery")]
    pub search_query: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// Lightweight filter for listing tasks.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TaskFilter {
    pub status: Option<TaskStatus>,
    pub priority: Option<TaskPriority>,
}

/// Lightweight item returned by the unfinished-task query for the todo overlay.
/// Merges the task row with the linked record's metadata and an attachment
/// count so the overlay can render a brief summary without fetching relations.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UnfinishedTaskItem {
    pub task_id: String,
    pub record_id: String,
    pub task_status: TaskStatus,
    pub priority: TaskPriority,
    pub due_at: Option<DateTime<Utc>>,
    pub remind_at: Option<DateTime<Utc>>,
    pub repeat_rule: Option<String>,
    pub completed_at: Option<DateTime<Utc>>,
    /// Linked-record fields so the overlay can show a title line and "last
    /// updated" timestamp without an extra round-trip.
    pub record_title: Option<String>,
    pub record_content: Option<String>,
    pub record_updated_at: DateTime<Utc>,
    /// Number of attachments linked to this record (cheaper than sending the
    /// full attachment list for every unfinished task).
    pub attachment_count: i64,
    /// Sort order for drag-and-drop reordering. Lower values appear first.
    pub sort_order: i64,
}

/// Full record payload returned by list-records / get-record-detail.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordWithRelations {
    pub id: String,
    #[serde(rename = "type")]
    pub record_type: RecordType,
    pub title: Option<String>,
    pub content: Option<String>,
    pub source: RecordSource,
    pub status: RecordStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub task: Option<Task>,
    pub attachments: Vec<Attachment>,
    #[serde(rename = "attachmentLinks")]
    pub attachment_links: Vec<RecordAttachmentLink>,
    #[serde(rename = "aiResults")]
    pub ai_results: Vec<AiResult>,
}

impl RecordWithRelations {
    pub fn from_record(
        record: Record,
        task: Option<Task>,
        attachments: Vec<Attachment>,
        attachment_links: Vec<RecordAttachmentLink>,
        ai_results: Vec<AiResult>,
    ) -> Self {
        Self {
            id: record.id,
            record_type: record.record_type,
            title: record.title,
            content: record.content,
            source: record.source,
            status: record.status,
            created_at: record.created_at,
            updated_at: record.updated_at,
            task,
            attachments,
            attachment_links,
            ai_results,
        }
    }

    /// Build a minimal RecordWithRelations (no related data) from a Record.
    pub fn from_record_minimal(record: Record) -> Self {
        Self {
            id: record.id,
            record_type: record.record_type,
            title: record.title,
            content: record.content,
            source: record.source,
            status: record.status,
            created_at: record.created_at,
            updated_at: record.updated_at,
            task: None,
            attachments: vec![],
            attachment_links: vec![],
            ai_results: vec![],
        }
    }
}
