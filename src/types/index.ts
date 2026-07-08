export type RecordType = "note" | "task";
export type RecordSource =
  | "quick-text"
  | "built-in-screenshot"
  | "drag-drop"
  | "clipboard-paste"
  | "file-picker";
export type RecordStatus = "active" | "archived";
export type TaskStatus = "todo" | "doing" | "done" | "cancelled";
export type TaskPriority = "low" | "medium" | "high";
export type AttachmentType = "image" | "screenshot" | "file";
export type AttachmentRole = "main" | "reference";
export type AiTriggerMode = "manual" | "auto" | "smart";
export type ReminderChannel = "pet-bubble" | "system-notification";
export type ReminderStatus = "pending" | "triggered" | "cancelled";
export type JobStatus = "pending" | "running" | "success" | "failed";

export interface RecordItem {
  id: string;
  type: RecordType;
  title: string | null;
  content: string | null;
  source: RecordSource;
  status: RecordStatus;
  created_at: string;
  updated_at: string;
}

export interface TaskItem {
  id: string;
  record_id: string;
  task_status: TaskStatus;
  priority: TaskPriority;
  due_at: string | null;
  remind_at: string | null;
  repeat_rule: string | null;
  completed_at: string | null;
}

export interface UnfinishedTaskItem {
  task_id: string;
  record_id: string;
  task_status: TaskStatus;
  priority: TaskPriority;
  due_at: string | null;
  remind_at: string | null;
  repeat_rule: string | null;
  completed_at: string | null;
  record_title: string | null;
  record_content: string | null;
  record_updated_at: string;
  attachment_count: number;
  sort_order: number;
  folder_id: string | null;
}

export interface AttachmentItem {
  id: string;
  file_type: AttachmentType;
  mime_type: string;
  local_path: string;
  thumbnail_path: string | null;
  ocr_text: string | null;
  hash: string;
  created_at: string;
}

export interface RecordAttachmentLink {
  id: string;
  record_id: string;
  attachment_id: string;
  role: AttachmentRole;
  sort_order: number;
}

export interface AiResultItem {
  id: string;
  record_id: string;
  trigger_mode: AiTriggerMode;
  model_provider: string | null;
  model_name: string | null;
  summary: string | null;
  tags: string | null;
  suggested_tasks: string | null;
  research_result: string | null;
  sensitivity_flag: string | null;
  created_at: string;
}

export interface ReminderItem {
  id: string;
  record_id: string;
  task_id: string | null;
  trigger_at: string;
  channel: ReminderChannel;
  status: ReminderStatus;
}

export interface SettingsEntry {
  key: string;
  value: string;
}

export interface RecordWithRelations extends RecordItem {
  task?: TaskItem | null;
  attachments: AttachmentItem[];
  attachment_links?: RecordAttachmentLink[];
  ai_results?: AiResultItem[];
  tags: Tag[];
}

export interface CreateRecordRequest {
  type?: RecordType;
  title?: string | null;
  content?: string | null;
  source: RecordSource;
  createAsTask?: boolean;
  attachmentIds?: string[];
}

export interface ImportFilesRequest {
  paths: string[];
  source: RecordSource;
  createAsTask?: boolean;
}

export interface ClipboardImageRequest {
  rgba: number[];
  width: number;
  height: number;
  source: RecordSource;
  createAsTask?: boolean;
}

export interface UpdateRecordRequest {
  title?: string | null;
  content?: string | null;
  status?: RecordStatus;
}

export interface CreateTaskRequest {
  record_id: string;
  task_status?: TaskStatus;
  priority?: TaskPriority;
  due_at?: string | null;
  remind_at?: string | null;
  repeat_rule?: string | null;
}

export interface CreateAttachmentRequest {
  file_type: AttachmentType;
  mime_type: string;
  local_path: string;
  thumbnail_path?: string | null;
  ocr_text?: string | null;
  hash: string;
}

export interface CreateAiResultRequest {
  record_id: string;
  trigger_mode: AiTriggerMode;
  model_provider?: string | null;
  model_name?: string | null;
  summary?: string | null;
  tags?: string | null;
  suggested_tasks?: string | null;
  research_result?: string | null;
  sensitivity_flag?: string | null;
}

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
}

export interface RecordFilter {
  typeFilter?: RecordType;
  statusFilter?: RecordStatus;
  searchQuery?: string;
  tagIds?: string[];
  viewKey?: string;
  limit?: number;
  offset?: number;
}

export interface TaskFilter {
  status?: TaskStatus;
  priority?: TaskPriority;
}

// ── Folder / Category ──────────────────────────────────────────

export interface FolderItem {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// ── Recurrence / Repeat rules ──────────────────────────────────

export type RepeatRule =
  | { type: "daily" }
  | { type: "weekdays" }
  | { type: "weekly"; days: number[] };

/** 将 RepeatRule 对象格式化为中文可读文字（例如 "每天"、"工作日"、"每周一、三"）。 */
export function formatRepeatRule(rule: RepeatRule | null): string | null {
  if (!rule) return null;
  switch (rule.type) {
    case "daily":
      return "每天";
    case "weekdays":
      return "工作日";
    case "weekly": {
      const dayNames = ["一", "二", "三", "四", "五", "六", "日"];
      return `每${rule.days.map((d) => `周${dayNames[d]}`).join("、")}`;
    }
  }
}

/** 将 RepeatRule 对象序列化为 JSON 字符串，null 返回 null。 */
export function serializeRepeatRule(rule: RepeatRule | null): string | null {
  return rule ? JSON.stringify(rule) : null;
}

/** 从 JSON 字符串反序列化 RepeatRule，无效时返回 null。 */
export function parseRepeatRule(json: string | null): RepeatRule | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (
      parsed &&
      typeof parsed.type === "string" &&
      ["daily", "weekdays", "weekly"].includes(parsed.type)
    ) {
      if (parsed.type === "weekly") {
        if (
          Array.isArray(parsed.days) &&
          parsed.days.every((d: unknown) => typeof d === "number" && d >= 0 && d <= 6)
        ) {
          return parsed as RepeatRule;
        }
        return null;
      }
      return parsed as RepeatRule;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Shortcut commands ────────────────────────────────────────────

export interface SetShortcutResult {
  ok: boolean;
  error?: string | null;
}
