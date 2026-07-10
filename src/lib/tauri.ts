import { invoke } from "@tauri-apps/api/core";

import type {
  AiTaskRunItem,
  AiResultItem,
  ClipboardImageRequest,
  CreateAiResultRequest,
  CreateAttachmentRequest,
  CreateRecordRequest,
  FolderItem,
  ImportFilesRequest,
  CreateTaskRequest,
  RecordFilter,
  RecordItem,
  RecordWithRelations,
  RunAiTaskRequest,
  SettingsEntry,
  SetShortcutResult,
  Tag,
  UnfinishedTaskItem,
  TaskFilter,
  TaskItem,
  UpdateRecordRequest,
} from "../types";

type ApiRecordWithRelations = RecordWithRelations & {
  attachmentLinks?: RecordWithRelations["attachment_links"];
  aiResults?: RecordWithRelations["ai_results"];
  knowledgeTopics?: RecordWithRelations["knowledge_topics"];
};

function normalizeRecordWithRelations(record: ApiRecordWithRelations): RecordWithRelations {
  return {
    ...record,
    attachment_links: record.attachment_links ?? record.attachmentLinks ?? [],
    ai_results: record.ai_results ?? record.aiResults ?? [],
    knowledge_topics: record.knowledge_topics ?? record.knowledgeTopics ?? [],
  };
}

export async function createRecord(request: CreateRecordRequest): Promise<RecordItem> {
  return invoke<RecordItem>("create_record", { request });
}

export async function importFiles(request: ImportFilesRequest): Promise<RecordItem> {
  return invoke<RecordItem>("import_files", { request });
}

export async function importClipboardImage(
  request: ClipboardImageRequest,
): Promise<RecordItem> {
  return invoke<RecordItem>("import_clipboard_image", { request });
}

export async function addAttachmentsToRecord(
  recordId: string,
  paths: string[],
): Promise<RecordItem> {
  return invoke<RecordItem>("add_attachments_to_record", { recordId, paths });
}

export async function saveClipboardImage(
  rgba: number[],
  width: number,
  height: number,
): Promise<string> {
  return invoke<string>("save_clipboard_image", { rgba, width, height });
}

export async function showMainPanel(): Promise<void> {
  return invoke<void>("show_main_panel");
}

export async function showWindow(label: string): Promise<void> {
  return invoke<void>("show_window", { label });
}

export async function hideWindow(label: string): Promise<void> {
  return invoke<void>("hide_window", { label });
}

export async function listRecords(filter?: RecordFilter): Promise<RecordWithRelations[]> {
  const records = await invoke<ApiRecordWithRelations[]>("list_records", { filter });
  return records.map(normalizeRecordWithRelations);
}

export async function getRecordDetail(id: string): Promise<RecordWithRelations> {
  const record = await invoke<ApiRecordWithRelations>("get_record_detail", { id });
  return normalizeRecordWithRelations(record);
}

export async function updateRecord(
  id: string,
  update: UpdateRecordRequest,
): Promise<RecordItem> {
  return invoke<RecordItem>("update_record", { id, update });
}

export async function deleteRecord(id: string): Promise<void> {
  return invoke<void>("delete_record", { id });
}

export async function createTask(request: CreateTaskRequest): Promise<TaskItem> {
  return invoke<TaskItem>("create_task", { request });
}

export async function convertRecordToTask(recordId: string): Promise<TaskItem> {
  return invoke<TaskItem>("convert_record_to_task", { recordId });
}

export async function listTasks(filter?: TaskFilter): Promise<TaskItem[]> {
  return invoke<TaskItem[]>("list_tasks", { filter });
}

export async function updateTaskStatus(
  taskId: string,
  status: TaskItem["task_status"],
): Promise<TaskItem> {
  return invoke<TaskItem>("update_task_status", { taskId, status });
}

export async function listUnfinishedTasks(): Promise<UnfinishedTaskItem[]> {
  return invoke<UnfinishedTaskItem[]>("list_unfinished_tasks");
}

/**
 * Batch-update task sort order for drag-and-drop reordering.
 * Each item in the array maps a task_id to its new sort_order value.
 */
export async function reorderTasks(order: { task_id: string; sort_order: number }[]): Promise<void> {
  return invoke<void>("reorder_tasks", { order });
}

/**
 * Batch-update record sort order for drag-and-drop reordering in a specific view.
 * @param viewKey "notes" or "tasks" — which view's sort space to update
 * @param order Array of { record_id, sort_order } pairs
 */
export async function reorderRecords(
  viewKey: string,
  order: { record_id: string; sort_order: number }[],
): Promise<void> {
  return invoke<void>("reorder_records", { viewKey, order });
}

/**
 * 更新待办任务的截止日期。
 *
 * 前端传纯日期字符串 "YYYY-MM-DD"，这里补上 `T00:00:00Z` 使其符合 RFC 3339
 * 格式，否则 Rust 端的 `chrono::DateTime::parse_from_rfc3339` 会解析失败。
 * 传 `null` 表示清除截止日期（不设期限）。
 */
export async function updateTaskDueAt(
  taskId: string,
  dueAt: string | null,
): Promise<void> {
  return invoke<void>("update_task_due_at", {
    taskId,
    dueAt: dueAt ? `${dueAt}T00:00:00Z` : null,
  });
}

/**
 * 更新任务的重复规则。
 *
 * @param taskId     任务 ID
 * @param repeatRule 重复规则 JSON 字符串，传 null 表示取消重复
 */
export async function updateTaskRepeatRule(
  taskId: string,
  repeatRule: string | null,
): Promise<TaskItem> {
  return invoke<TaskItem>("update_task_repeat_rule", { taskId, repeatRule });
}

export async function removeTask(taskId: string): Promise<TaskItem> {
  return invoke<TaskItem>("remove_task", { taskId });
}

export async function insertAttachment(
  request: CreateAttachmentRequest,
): Promise<void> {
  return invoke<void>("create_attachment", { request });
}

export async function insertAiResult(
  request: CreateAiResultRequest,
): Promise<AiResultItem> {
  return invoke<AiResultItem>("create_ai_result", { request });
}

export async function getAllSettings(): Promise<SettingsEntry[]> {
  return invoke<SettingsEntry[]>("get_all_settings");
}

export async function updateSetting(key: string, value: string): Promise<void> {
  return invoke<void>("update_setting", { key, value });
}

export async function resetSettings(): Promise<void> {
  return invoke<void>("reset_settings");
}

// ── Screenshot capture ──────────────────────────────────────────────

export async function captureScreenshot(
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<string> {
  return invoke<string>("capture_screenshot", { x, y, width, height });
}

export async function saveScreenshotRecord(
  content: string | null,
  screenshotPath: string,
  createAsTask: boolean,
): Promise<RecordItem> {
  return invoke<RecordItem>("save_screenshot_record", {
    content,
    screenshotPath,
    createAsTask,
  });
}

// ── AI analysis trigger (backend in parallel) ─────────────────────

export async function triggerAiAnalysis(
  recordId: string,
  triggerMode: string = "manual",
): Promise<AiResultItem> {
  return invoke<AiResultItem>("trigger_ai_analysis", { recordId, triggerMode });
}

export async function runAiTask(
  request: RunAiTaskRequest,
): Promise<AiTaskRunItem> {
  return invoke<AiTaskRunItem>("run_ai_task", { request });
}

// ── Pet position (backend in parallel) ──────────────────────────────

export async function setPetPosition(x: number, y: number): Promise<void> {
  return invoke<void>("set_pet_position", { x, y });
}

export async function getPetPosition(): Promise<[number, number]> {
  return invoke<[number, number]>("get_pet_position");
}

// ── Shortcuts ────────────────────────────────────────────────────

export async function setShortcut(
  key: string,
  shortcut: string,
): Promise<SetShortcutResult> {
  return invoke<SetShortcutResult>("set_shortcut", {
    name: key,
    accelerator: shortcut,
  });
}

// ── Folder / Category commands ─────────────────────────────────────

export async function listFolders(): Promise<FolderItem[]> {
  return invoke<FolderItem[]>("list_folders");
}

export async function createFolder(name: string): Promise<FolderItem> {
  return invoke<FolderItem>("create_folder", { name });
}

export async function renameFolder(id: string, name: string): Promise<FolderItem> {
  return invoke<FolderItem>("rename_folder", { id, name });
}

export async function deleteFolder(id: string): Promise<void> {
  return invoke<void>("delete_folder", { id });
}

export async function moveTaskToFolder(
  taskId: string,
  folderId: string | null,
): Promise<void> {
  return invoke<void>("move_task_to_folder", { taskId, folderId });
}

export async function reorderFolders(
  order: { id: string; sort_order: number }[],
): Promise<void> {
  return invoke<void>("reorder_folders", { order });
}

// ── Tags ─────────────────────────────────────────────────────────────

export async function listTags(): Promise<Tag[]> {
  return invoke<Tag[]>("list_tags");
}

export async function createTag(name: string, color: string | null): Promise<Tag> {
  return invoke<Tag>("create_tag", { name, color });
}

export async function updateTag(
  id: string,
  name?: string,
  color?: string | null,
): Promise<Tag> {
  return invoke<Tag>("update_tag", { id, name, color });
}

export async function deleteTag(id: string): Promise<void> {
  return invoke<void>("delete_tag", { id });
}

export async function setRecordTags(
  recordId: string,
  tagIds: string[],
): Promise<void> {
  return invoke<void>("set_record_tags", { recordId, tagIds });
}

export async function listRecordTags(recordId: string): Promise<Tag[]> {
  return invoke<Tag[]>("list_record_tags", { recordId });
}
