import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

import { triggerAiAnalysis } from "../../lib/tauri";
import { useRecordsStore } from "../../store/records";
import type {
  AttachmentItem,
  RecordWithRelations,
  TaskStatus,
  UpdateRecordRequest,
} from "../../types";

interface RecordDetailProps {
  record: RecordWithRelations | null;
  loading: boolean;
  onUpdate: (id: string, update: UpdateRecordRequest) => Promise<void>;
  onConvertToTask: (recordId: string) => Promise<void>;
  onUpdateTaskStatus: (taskId: string, status: TaskStatus, recordId: string) => Promise<void>;
  onDelete: (id: string) => void;
}

const TYPE_LABELS: Record<string, string> = {
  note: "笔记",
  task: "待办",
  experience: "经验",
  issue: "问题",
  "file-note": "文件",
};

const STATUS_LABELS: Record<string, string> = {
  active: "活跃",
  archived: "已归档",
};

const SOURCE_LABELS: Record<string, string> = {
  "quick-text": "文字速记",
  "built-in-screenshot": "截图收录",
  "drag-drop": "拖拽导入",
  "clipboard-paste": "剪贴板粘贴",
  "file-picker": "文件选择",
};

const TASK_STATUS_OPTIONS: { label: string; value: TaskStatus; activeClasses: string; dot: string }[] = [
  { label: "待办", value: "todo", activeClasses: "bg-amber-400/20 text-amber-300 ring-1 ring-amber-400/30", dot: "bg-amber-400" },
  { label: "进行中", value: "doing", activeClasses: "bg-sky-400/20 text-sky-300 ring-1 ring-sky-400/30", dot: "bg-sky-400" },
  { label: "已完成", value: "done", activeClasses: "bg-emerald-400/20 text-emerald-300 ring-1 ring-emerald-400/30", dot: "bg-emerald-400" },
  { label: "已取消", value: "cancelled", activeClasses: "bg-slate-500/20 text-slate-400 ring-1 ring-slate-400/20", dot: "bg-slate-400" },
];

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function AttachmentThumbnail({ attachment }: { attachment: AttachmentItem }) {
  const [error, setError] = useState(false);

  if (error || (attachment.file_type !== "image" && attachment.file_type !== "screenshot")) {
    return (
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-800/50">
        <svg className="h-5 w-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
      </div>
    );
  }

  return (
    <img
      src={convertFileSrc(attachment.local_path)}
      alt="attachment"
      className="h-12 w-12 rounded-lg object-cover"
      onError={() => setError(true)}
    />
  );
}

export function RecordDetail({
  record,
  loading,
  onUpdate,
  onConvertToTask,
  onUpdateTaskStatus,
  onDelete,
}: RecordDetailProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingContent, setEditingContent] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [contentDraft, setContentDraft] = useState("");
  const [converting, setConverting] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const { selectRecord } = useRecordsStore();

  const titleRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  // Reset editing state when record changes
  useEffect(() => {
    setEditingTitle(false);
    setEditingContent(false);
  }, [record?.id]);

  // Focus when entering edit mode
  useEffect(() => {
    if (editingTitle && titleRef.current) {
      titleRef.current.focus();
      titleRef.current.select();
    }
  }, [editingTitle]);

  useEffect(() => {
    if (editingContent && contentRef.current) {
      contentRef.current.focus();
      contentRef.current.select();
    }
  }, [editingContent]);

  const startEditTitle = useCallback(() => {
    if (!record?.title) {
      setTitleDraft("");
    } else {
      setTitleDraft(record.title);
    }
    setEditingTitle(true);
  }, [record]);

  const startEditContent = useCallback(() => {
    if (!record?.content) {
      setContentDraft("");
    } else {
      setContentDraft(record.content);
    }
    setEditingContent(true);
  }, [record]);

  const saveTitle = useCallback(async () => {
    if (!record) return;
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed === (record.title ?? "")) return;
    await onUpdate(record.id, { title: trimmed.length > 0 ? trimmed : null });
  }, [record, titleDraft, onUpdate]);

  const saveContent = useCallback(async () => {
    if (!record) return;
    setEditingContent(false);
    const trimmed = contentDraft.trim();
    if (trimmed === (record.content ?? "")) return;
    await onUpdate(record.id, {
      content: trimmed.length > 0 ? trimmed : null,
    });
  }, [record, contentDraft, onUpdate]);

  const handleConvertToTask = useCallback(async () => {
    if (!record || converting) return;
    setConverting(true);
    try {
      await onConvertToTask(record.id);
    } finally {
      setConverting(false);
    }
  }, [record, converting, onConvertToTask]);

  const handleUpdateStatus = useCallback(
    async (status: TaskStatus) => {
      if (!record?.task || updatingStatus) return;
      if (record.task.task_status === status) return; // No-op if same status
      setUpdatingStatus(true);
      try {
        await onUpdateTaskStatus(record.task.id, status, record.id);
      } finally {
        setUpdatingStatus(false);
      }
    },
    [record, updatingStatus, onUpdateTaskStatus],
  );

  const handleTriggerAi = useCallback(async () => {
    if (!record || aiAnalyzing) return;
    setAiAnalyzing(true);
    setAiError(null);
    try {
      await triggerAiAnalysis(record.id, "manual");
      // Re-fetch detail to get fresh ai_results
      await selectRecord(record.id);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : String(error));
    } finally {
      setAiAnalyzing(false);
    }
  }, [record, aiAnalyzing, selectRecord]);

  // Empty state
  if (!record) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800/50">
            <svg className="h-6 w-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          </div>
          <p className="mt-4 text-sm text-slate-500">选择一条记录查看详情</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-400/30 border-t-emerald-400" />
      </div>
    );
  }

  const hasTask = !!record.task;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-white/5 px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
            详情
          </span>
          <span className="text-slate-600">·</span>
          <span className="text-[10px] text-slate-500">
            {formatDateTime(record.created_at)}
          </span>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="space-y-5 p-5">
          {/* Title */}
          <section>
            {editingTitle ? (
              <input
                ref={titleRef}
                type="text"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => void saveTitle()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void saveTitle();
                  }
                  if (e.key === "Escape") {
                    setEditingTitle(false);
                  }
                }}
                placeholder="添加标题…"
                className="w-full rounded-xl border border-white/10 bg-slate-900/80 px-3 py-2
                  text-lg font-medium text-slate-100 outline-none transition
                  focus:border-emerald-400/40 focus:ring-2 focus:ring-emerald-400/20"
              />
            ) : (
              <button
                type="button"
                onClick={startEditTitle}
                className="group w-full text-left"
              >
                <h2 className="text-lg font-medium leading-7 text-slate-100 transition group-hover:text-emerald-300">
                  {record.title || (
                    <span className="italic text-slate-500">无标题</span>
                  )}
                </h2>
                <span className="mt-0.5 block text-[10px] text-slate-600 opacity-0 transition group-hover:opacity-100">
                  点击编辑
                </span>
              </button>
            )}
          </section>

          {/* Meta badges */}
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-slate-300">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                record.type === "note" ? "bg-slate-400"
                : record.type === "task" ? "bg-emerald-400"
                : record.type === "experience" ? "bg-amber-400"
                : record.type === "issue" ? "bg-rose-400"
                : "bg-sky-400"
              }`} />
              {TYPE_LABELS[record.type] ?? record.type}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-slate-300">
              {STATUS_LABELS[record.status] ?? record.status}
            </span>
            <span className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] text-slate-400">
              {SOURCE_LABELS[record.source] ?? record.source}
            </span>
          </div>

          {/* Content */}
          <section>
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
              内容
            </p>
            {editingContent ? (
              <textarea
                ref={contentRef}
                value={contentDraft}
                onChange={(e) => setContentDraft(e.target.value)}
                onBlur={() => void saveContent()}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setEditingContent(false);
                  }
                }}
                placeholder="添加内容…"
                rows={5}
                className="w-full resize-none rounded-xl border border-white/10 bg-slate-900/80
                  px-3 py-2.5 text-sm leading-6 text-slate-100 outline-none transition
                  focus:border-emerald-400/40 focus:ring-2 focus:ring-emerald-400/20"
              />
            ) : (
              <button
                type="button"
                onClick={startEditContent}
                className="group w-full text-left"
              >
                {record.content ? (
                  <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300 transition group-hover:text-slate-200">
                    {record.content}
                  </p>
                ) : (
                  <p className="text-sm italic leading-6 text-slate-500">
                    无内容
                  </p>
                )}
                <span className="mt-0.5 block text-[10px] text-slate-600 opacity-0 transition group-hover:opacity-100">
                  点击编辑
                </span>
              </button>
            )}
          </section>

          {/* ── Task section ── */}
          {hasTask && record.task && (
            <section>
              <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
                待办信息
              </p>
              <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/5 p-4">
                {/* Interactive status update buttons */}
                <div className="mb-3">
                  <p className="mb-2 text-[10px] font-medium text-slate-400">
                    更新状态
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {TASK_STATUS_OPTIONS.map((opt) => {
                      const isActive = record.task!.task_status === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => void handleUpdateStatus(opt.value)}
                          disabled={updatingStatus || isActive}
                          className={`
                            inline-flex items-center gap-1.5 rounded-full px-3 py-1.5
                            text-xs font-medium transition-all duration-150
                            ${
                              isActive
                                ? opt.activeClasses
                                : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200"
                            }
                            disabled:opacity-60 disabled:cursor-not-allowed
                          `}
                        >
                          {!isActive && (
                            <span className={`inline-block h-1.5 w-1.5 rounded-full ${opt.dot} opacity-40`} />
                          )}
                          {isActive && (
                            <span className={`inline-block h-1.5 w-1.5 rounded-full ${opt.dot}`} />
                          )}
                          {opt.label}
                          {updatingStatus && isActive && (
                            <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Task metadata */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-emerald-400/10 pt-3">
                  <span className="text-[11px] text-slate-400">
                    优先级：
                    {record.task.priority === "high"
                      ? "高"
                      : record.task.priority === "low"
                        ? "低"
                        : "中"}
                  </span>
                  {record.task.due_at && (
                    <span className="rounded-full bg-rose-400/10 px-2 py-0.5 text-[10px] text-rose-300">
                      截止：{formatDateTime(record.task.due_at)}
                    </span>
                  )}
                  {record.task.completed_at && (
                    <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-300">
                      完成于 {formatDateTime(record.task.completed_at)}
                    </span>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* Attachments */}
          {record.attachments && record.attachments.length > 0 && (
            <section>
              <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
                附件（{record.attachments.length}）
              </p>
              <div className="flex flex-wrap gap-2">
                {record.attachments.map((att) => (
                  <div
                    key={att.id}
                    className="group relative flex items-center gap-2.5 rounded-xl border border-white/8 bg-slate-900/50 px-3 py-2"
                  >
                    <AttachmentThumbnail attachment={att} />
                    <div className="min-w-0">
                      <p className="truncate text-xs text-slate-300 max-w-[160px]">
                        {att.local_path.split(/[\\/]/).pop()}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {att.file_type === "image"
                          ? "图片"
                          : att.file_type === "screenshot"
                            ? "截图"
                            : "文件"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* AI Results */}
          {record.ai_results && record.ai_results.length > 0 && (
            <section>
              <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
                AI 分析
              </p>
              <div className="space-y-3">
                {record.ai_results.map((ai) => (
                  <div
                    key={ai.id}
                    className="overflow-hidden rounded-xl border border-violet-400/12 bg-violet-400/[3%]"
                  >
                    {/* Summary */}
                    {ai.summary && (
                      <div className="px-4 py-3">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-violet-400/10">
                            <svg className="h-3 w-3 text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
                            </svg>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-medium text-violet-300 mb-1">
                              智能摘要
                            </p>
                            <p className="text-xs leading-6 text-slate-300">
                              {ai.summary}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Suggested tasks */}
                    {ai.suggested_tasks && (
                      <div className="border-t border-violet-400/8 px-4 py-3">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-amber-400/10">
                            <svg className="h-3 w-3 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                            </svg>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-medium text-amber-300 mb-1">
                              建议待办
                            </p>
                            <ul className="space-y-1">
                              {ai.suggested_tasks.split("\n").filter(Boolean).map((task, i) => (
                                <li key={i} className="flex items-start gap-2 text-xs leading-5 text-slate-400">
                                  <span className="mt-[5px] inline-block h-1 w-1 shrink-0 rounded-full bg-amber-400/40" />
                                  {task}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Tags */}
                    {ai.tags && (
                      <div className="border-t border-violet-400/8 px-4 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <svg className="h-3 w-3 text-violet-400/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
                          </svg>
                          {ai.tags.split(",").map((tag, i) => (
                            <span
                              key={i}
                              className="rounded-full bg-violet-400/8 px-2 py-0.5 text-[10px] text-violet-300/80"
                            >
                              {tag.trim()}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Model & trigger meta */}
                    <div className="border-t border-violet-400/8 px-4 py-2">
                      <div className="flex items-center gap-3 text-[10px] text-slate-500">
                        {ai.model_name && (
                          <span>{ai.model_name}</span>
                        )}
                        <span className="text-slate-600">·</span>
                        <span>
                          {ai.trigger_mode === "auto"
                            ? "自动分析"
                            : ai.trigger_mode === "smart"
                              ? "智能分析"
                              : "手动分析"}
                        </span>
                        <span className="text-slate-600">·</span>
                        <span>
                          {(() => {
                            try {
                              return new Date(ai.created_at).toLocaleString("zh-CN", {
                                month: "2-digit",
                                day: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit",
                              });
                            } catch {
                              return ai.created_at;
                            }
                          })()}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          {/* AI Error */}
          {aiError && (
            <section>
              <div className="flex items-start gap-2.5 rounded-xl border border-rose-400/15 bg-rose-400/5 px-4 py-3">
                <svg className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <div>
                  <p className="text-xs font-medium text-rose-300 mb-0.5">
                    AI 分析失败
                  </p>
                  <p className="text-[11px] leading-5 text-rose-300/70">
                    {aiError}
                  </p>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="shrink-0 border-t border-white/5 px-5 py-3">
        <div className="flex items-center gap-2">
          {!hasTask && (
            <button
              type="button"
              onClick={() => void handleConvertToTask()}
              disabled={converting}
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-3.5 py-1.5
                text-xs font-medium text-emerald-300 transition hover:bg-emerald-400/20
                disabled:opacity-50"
            >
              {converting ? (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border border-emerald-400/30 border-t-emerald-400" />
              ) : (
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              )}
              转为待办
            </button>
          )}

          {/* AI analysis trigger */}
          <button
            type="button"
            onClick={() => void handleTriggerAi()}
            disabled={aiAnalyzing}
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5
              text-xs font-medium text-violet-300 transition
              hover:bg-violet-400/15 disabled:opacity-50"
          >
            {aiAnalyzing ? (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border border-violet-400/30 border-t-violet-400" />
            ) : (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            )}
            {aiAnalyzing ? "分析中…" : "AI 分析"}
          </button>

          <div className="flex-1" />

          <button
            type="button"
            onClick={() => onDelete(record.id)}
            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5
              text-xs text-slate-500 transition hover:bg-rose-400/10 hover:text-rose-300"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            删除
          </button>
        </div>
      </div>
    </div>
  );
}
