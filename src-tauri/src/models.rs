#![allow(dead_code)]

// Task 2 intentionally defines the shared domain surface ahead of command wiring.
use chrono::{DateTime, Datelike, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RecordType {
    Note,
    Task,
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
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "task" => Self::Task,
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

/// Controls which product surface is exposed without deleting future modules.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProductMode {
    Free,
    GrowthPreview,
}

impl ProductMode {
    pub fn parse(value: Option<&str>) -> Self {
        match value {
            Some("growth-preview") => Self::GrowthPreview,
            _ => Self::Free,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Free => "free",
            Self::GrowthPreview => "growth-preview",
        }
    }

    pub fn allows_learning_tasks(self) -> bool {
        matches!(self, Self::GrowthPreview)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AiTaskType {
    LearningAnalysis,
    LearningDialogReply,
    LearningConversation,
    WeeklyReport,
}

impl AiTaskType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::LearningAnalysis => "learning_analysis",
            Self::LearningDialogReply => "learning_dialog_reply",
            Self::LearningConversation => "learning_conversation",
            Self::WeeklyReport => "weekly_report",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "learning_dialog_reply" => Self::LearningDialogReply,
            "learning_conversation" => Self::LearningConversation,
            "weekly_report" => Self::WeeklyReport,
            _ => Self::LearningAnalysis,
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

// ── Recurrence / Repeat rule ────────────────────────────────────

/// 任务重复规则，与前端 `RepeatRule` 类型保持同步。
/// 序列化为 `{ "type": "daily" }` / `{ "type": "weekdays" }` /
/// `{ "type": "weekly", "days": [0, 2, 4] }`（0=周一, 6=周日）。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum RepeatRule {
    #[serde(rename = "daily")]
    Daily,
    #[serde(rename = "weekdays")]
    Weekdays,
    #[serde(rename = "weekly")]
    Weekly { days: Vec<u32> },
}

impl RepeatRule {
    /// 从 JSON 字符串解析。空字符串或无效 JSON 返回 `None`。
    pub fn from_json(s: &str) -> Option<Self> {
        serde_json::from_str(s).ok()
    }

    /// 序列化为 JSON 字符串。
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }

    /// 计算 `after` 日期之后的下一次出现日期（不含当天）。
    ///
    /// * `Daily` → `after + 1`
    /// * `Weekdays` → 下一个周一至周五
    /// * `Weekly { days }` → 本周内下一个匹配的星期几，若已过则跳到下周第一个
    pub fn next_date(&self, after: chrono::NaiveDate) -> Option<chrono::NaiveDate> {
        match self {
            RepeatRule::Daily => Some(after + chrono::Duration::days(1)),
            RepeatRule::Weekdays => {
                let mut next = after + chrono::Duration::days(1);
                loop {
                    let weekday = next.weekday().num_days_from_monday(); // 0=Mon..6=Sun
                    if weekday <= 4 {
                        return Some(next);
                    }
                    next = next + chrono::Duration::days(1);
                }
            }
            RepeatRule::Weekly { days } => {
                if days.is_empty() {
                    return None;
                }
                let today_weekday = after.weekday().num_days_from_monday(); // 0=Mon
                for &day in days {
                    if day > today_weekday {
                        return Some(after + chrono::Duration::days((day - today_weekday) as i64));
                    }
                }
                // 本周已无匹配，跳到下周第一个
                let first = days[0];
                let offset = 7 - today_weekday + first;
                Some(after + chrono::Duration::days(offset as i64))
            }
        }
    }
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LearningAnalysisPayload {
    #[serde(rename = "recordId")]
    pub record_id: String,
    #[serde(default, rename = "includeRelatedTasks")]
    pub include_related_tasks: bool,
    #[serde(rename = "interactionMode")]
    pub interaction_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WeeklyReportDateRange {
    pub start: String,
    pub end: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WeeklyReportPayload {
    #[serde(rename = "dateRange")]
    pub date_range: WeeklyReportDateRange,
    #[serde(default, rename = "includeTasks")]
    pub include_tasks: bool,
    #[serde(default, rename = "includeNotes")]
    pub include_notes: bool,
    pub tone: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LearningConversationMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LearningConversationPayload {
    #[serde(rename = "topicId")]
    pub topic_id: String,
    #[serde(rename = "sourceRecordId")]
    pub source_record_id: String,
    #[serde(rename = "dialogSessionId")]
    pub dialog_session_id: Option<String>,
    pub messages: Vec<LearningConversationMessage>,
    #[serde(default, rename = "sourceSignals")]
    pub source_signals: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LearningDialogReplyPayload {
    #[serde(rename = "topicId")]
    pub topic_id: String,
    #[serde(rename = "topicName")]
    pub topic_name: String,
    #[serde(rename = "sourceRecordId")]
    pub source_record_id: String,
    pub summary: String,
    #[serde(rename = "evidenceText")]
    pub evidence_text: String,
    #[serde(rename = "noteExample")]
    pub note_example: Option<String>,
    #[serde(default, rename = "suggestedQuestions")]
    pub suggested_questions: Vec<String>,
    pub messages: Vec<LearningConversationMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LearningKnowledgePoint {
    pub name: String,
    pub confidence: f64,
    #[serde(rename = "example_from_note")]
    pub example_from_note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SuggestedMemoryUpdate {
    pub topic: String,
    pub mastery_level: String,
    pub evidence: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LearningAnalysisResult {
    pub knowledge_points: Vec<LearningKnowledgePoint>,
    pub questions_for_user: Vec<String>,
    pub suggested_memory_updates: Vec<SuggestedMemoryUpdate>,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WeeklyReportResult {
    pub summary: String,
    pub completed_work: Vec<String>,
    pub in_progress: Vec<String>,
    pub risks: Vec<String>,
    pub next_steps: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LearningConversationResult {
    pub topic: String,
    pub decision: String,
    pub reason: String,
    #[serde(rename = "memory_write")]
    pub memory_write: Option<LearningConversationMemoryWrite>,
    #[serde(rename = "next_action")]
    pub next_action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LearningDialogReplyResult {
    pub reply: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LearningConversationMemoryWrite {
    pub status: String,
    #[serde(rename = "evidence_type")]
    pub evidence_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RunAiTaskRequest {
    #[serde(rename = "taskType")]
    pub task_type: AiTaskType,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AiTaskRun {
    pub id: String,
    pub task_type: AiTaskType,
    pub source_record_id: Option<String>,
    pub status: String,
    pub model_provider: Option<String>,
    pub model_name: Option<String>,
    pub model_variant: Option<String>,
    pub input_snapshot: String,
    pub result_json: Option<String>,
    pub error_message: Option<String>,
    pub created_at: DateTime<Utc>,
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
    #[serde(default, rename = "tagIds")]
    pub tag_ids: Option<Vec<String>>,
    /// When set to "notes" or "tasks", the listing joins the per-view sort
    /// order table and returns records ordered by user-defined drag position.
    /// When None (the "all" view), records are ordered by created_at desc.
    #[serde(default, rename = "viewKey")]
    pub view_key: Option<String>,
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
    /// Category folder ID (None = uncategorized).
    pub folder_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Tag {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct KnowledgeTopic {
    pub id: String,
    pub name: String,
    pub summary: String,
    pub mastery_level: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct KnowledgeEvidence {
    pub id: String,
    pub topic_id: String,
    pub record_id: String,
    pub evidence_type: String,
    pub evidence_text: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct KnowledgeMemoryItem {
    pub id: String,
    pub name: String,
    pub summary: String,
    pub mastery_level: String,
    pub evidence_count: i64,
    pub latest_evidence_text: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct KnowledgeMemoryEvidence {
    pub id: String,
    pub record_id: String,
    pub record_title: Option<String>,
    pub evidence_type: String,
    pub evidence_text: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct KnowledgeMemoryDetail {
    pub topic: KnowledgeMemoryItem,
    pub evidence: Vec<KnowledgeMemoryEvidence>,
    pub latest_conclusion_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LearningDialogSession {
    pub id: String,
    pub topic_id: String,
    pub source_record_id: String,
    pub status: String,
    pub conversation_snapshot: String,
    pub conclusion_json: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecordKnowledgeTopic {
    pub topic_id: String,
    pub name: String,
    pub summary: String,
    pub mastery_level: String,
    pub evidence_text: String,
    pub updated_at: DateTime<Utc>,
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
    #[serde(rename = "knowledgeTopics")]
    pub knowledge_topics: Vec<RecordKnowledgeTopic>,
    pub tags: Vec<Tag>,
}

impl RecordWithRelations {
    pub fn from_record(
        record: Record,
        task: Option<Task>,
        attachments: Vec<Attachment>,
        attachment_links: Vec<RecordAttachmentLink>,
        ai_results: Vec<AiResult>,
        knowledge_topics: Vec<RecordKnowledgeTopic>,
        tags: Vec<Tag>,
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
            knowledge_topics,
            tags,
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
            knowledge_topics: vec![],
            tags: vec![],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ai_task_type_roundtrips_learning_and_weekly() {
        assert_eq!(AiTaskType::LearningAnalysis.as_str(), "learning_analysis");
        assert_eq!(AiTaskType::LearningDialogReply.as_str(), "learning_dialog_reply");
        assert_eq!(AiTaskType::LearningConversation.as_str(), "learning_conversation");
        assert_eq!(AiTaskType::WeeklyReport.as_str(), "weekly_report");
        assert_eq!(AiTaskType::parse("learning_analysis"), AiTaskType::LearningAnalysis);
        assert_eq!(
            AiTaskType::parse("learning_dialog_reply"),
            AiTaskType::LearningDialogReply
        );
        assert_eq!(
            AiTaskType::parse("learning_conversation"),
            AiTaskType::LearningConversation
        );
        assert_eq!(AiTaskType::parse("weekly_report"), AiTaskType::WeeklyReport);
    }

    #[test]
    fn product_mode_defaults_to_free_and_only_enables_explicit_preview() {
        assert_eq!(ProductMode::parse(None), ProductMode::Free);
        assert_eq!(ProductMode::parse(Some("invalid")), ProductMode::Free);
        assert_eq!(
            ProductMode::parse(Some("growth-preview")),
            ProductMode::GrowthPreview
        );
        assert!(!ProductMode::Free.allows_learning_tasks());
        assert!(ProductMode::GrowthPreview.allows_learning_tasks());
    }
}
