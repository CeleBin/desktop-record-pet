import { useCallback, useEffect, useRef, useState } from "react";

import type { TaskStatus, UnfinishedTaskItem } from "../../types";

interface TodoDrawerProps {
  item: UnfinishedTaskItem | null;
  onClose: () => void;
  onUpdateTitle: (recordId: string, title: string) => Promise<void>;
  onUpdateContent: (recordId: string, content: string) => Promise<void>;
  onUpdateTaskStatus: (taskId: string, status: TaskStatus) => Promise<void>;
  onRemoveTask: (taskId: string) => void;
  onDeleteRecord: (recordId: string) => void;
  onOpenInMainPanel: (recordId: string) => void;
}

const STATUS_OPTIONS: {
  label: string;
  value: TaskStatus;
  dot: string;
  activeClasses: string;
}[] = [
  {
    label: "待办",
    value: "todo",
    dot: "bg-amber-400",
    activeClasses:
      "bg-amber-400/20 text-amber-300 ring-1 ring-amber-400/30",
  },
  {
    label: "进行中",
    value: "doing",
    dot: "bg-sky-400",
    activeClasses: "bg-sky-400/20 text-sky-300 ring-1 ring-sky-400/30",
  },
  {
    label: "已完成",
    value: "done",
    dot: "bg-emerald-400",
    activeClasses:
      "bg-emerald-400/20 text-emerald-300 ring-1 ring-emerald-400/30",
  },
  {
    label: "已取消",
    value: "cancelled",
    dot: "bg-slate-400",
    activeClasses:
      "bg-slate-500/20 text-slate-400 ring-1 ring-slate-400/20",
  },
];

/** Fallback display text: title → content preview → null (caller shows placeholder). */
function displayTitle(item: UnfinishedTaskItem): string | null {
  if (item.record_title) return item.record_title;
  const content = item.record_content?.replace(/\s+/g, " ").trim();
  return content || null;
}

export function TodoDrawer({
  item,
  onClose,
  onUpdateTitle,
  onUpdateContent,
  onUpdateTaskStatus,
  onRemoveTask,
  onDeleteRecord,
  onOpenInMainPanel,
}: TodoDrawerProps) {
  const isOpen = item !== null;

  // ── Editing state ──
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingContent, setEditingContent] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [contentDraft, setContentDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  // ── Close on Escape ──
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  // ── Reset editing state when item changes ──
  useEffect(() => {
    setEditingTitle(false);
    setEditingContent(false);
    setConfirmDelete(false);
  }, [item?.record_id]);

  // ── Focus helpers ──
  useEffect(() => {
    if (editingTitle && titleRef.current) {
      titleRef.current.focus();
      titleRef.current.select();
    }
  }, [editingTitle]);

  useEffect(() => {
    if (editingContent && contentRef.current) {
      contentRef.current.focus();
    }
  }, [editingContent]);

  // ── Handlers ──

  const startEditTitle = useCallback(() => {
    setTitleDraft(item?.record_title ?? "");
    setEditingTitle(true);
  }, [item]);

  const startEditContent = useCallback(() => {
    setContentDraft(item?.record_content ?? "");
    setEditingContent(true);
  }, [item]);

  const saveTitle = useCallback(async () => {
    if (!item) return;
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed === (item.record_title ?? "")) return;
    await onUpdateTitle(item.record_id, trimmed);
  }, [item, titleDraft, onUpdateTitle]);

  const saveContent = useCallback(async () => {
    if (!item) return;
    setEditingContent(false);
    const trimmed = contentDraft.trim();
    if (trimmed === (item.record_content ?? "")) return;
    await onUpdateContent(item.record_id, trimmed);
  }, [item, contentDraft, onUpdateContent]);

  const handleStatusChange = useCallback(
    async (status: TaskStatus) => {
      if (!item || updatingStatus) return;
      if (item.task_status === status) return;
      setUpdatingStatus(true);
      try {
        await onUpdateTaskStatus(item.task_id, status);
      } finally {
        setUpdatingStatus(false);
      }
    },
    [item, updatingStatus, onUpdateTaskStatus],
  );

  const handleRemove = useCallback(() => {
    if (!item) return;
    onClose();
    onRemoveTask(item.task_id);
  }, [item, onClose, onRemoveTask]);

  const handleDelete = useCallback(() => {
    if (!item) return;
    onClose();
    onDeleteRecord(item.record_id);
  }, [item, onClose, onDeleteRecord]);

  const handleOpenInMain = useCallback(() => {
    if (!item) return;
    onClose();
    onOpenInMainPanel(item.record_id);
  }, [item, onClose, onOpenInMainPanel]);

  if (!isOpen) return null;

  return (
    <>
      {/* Mount animation */}
      <style>{`
        @keyframes drawer-slide-in {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
        @keyframes drawer-backdrop-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .drawer-panel {
          animation: drawer-slide-in 220ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .drawer-backdrop {
          animation: drawer-backdrop-in 220ms ease-out;
        }
      `}</style>

      <div className="absolute inset-0 z-30 flex">
        {/* Backdrop */}
        <div
          className="drawer-backdrop flex-1 cursor-pointer bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* Drawer panel */}
        <div
          ref={drawerRef}
          className="drawer-panel flex w-[340px] shrink-0 flex-col overflow-hidden
            border-l border-white/[6%] bg-slate-950/90 backdrop-blur-2xl"
        >
          {/* ── Header ── */}
          <div className="flex shrink-0 items-center gap-2 border-b border-white/5 px-4 py-3">
            <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
              编辑
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-slate-500 transition hover:bg-white/10 hover:text-slate-200"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* ── Scrollable body ── */}
          <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain p-4">
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
                  className="w-full rounded-lg border border-white/10 bg-slate-900/80
                    px-3 py-2 text-sm font-medium text-slate-100 outline-none
                    transition focus:border-emerald-400/40 focus:ring-2
                    focus:ring-emerald-400/20"
                />
              ) : (
                <button
                  type="button"
                  onClick={startEditTitle}
                  className="group w-full text-left"
                >
                  <h3 className="text-sm font-medium leading-6 text-slate-200 transition group-hover:text-emerald-300">
                    {displayTitle(item) || (
                      <span className="italic text-slate-500">无标题</span>
                    )}
                  </h3>
                  <span className="mt-0.5 block text-[10px] text-slate-600 opacity-0 transition group-hover:opacity-100">
                    点击编辑
                  </span>
                </button>
              )}
            </section>

            {/* Status */}
            <section>
              <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
                任务状态
              </p>
              <div className="flex flex-wrap gap-1.5">
                {STATUS_OPTIONS.map((opt) => {
                  const isActive = item.task_status === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => void handleStatusChange(opt.value)}
                      disabled={updatingStatus || isActive}
                      className={`
                        inline-flex items-center gap-1.5 rounded-full px-3 py-1.5
                        text-xs font-medium transition-all duration-150
                        ${
                          isActive
                            ? opt.activeClasses
                            : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200"
                        }
                        disabled:cursor-not-allowed disabled:opacity-60
                      `}
                    >
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${isActive ? opt.dot : `${opt.dot} opacity-40`}`}
                      />
                      {opt.label}
                      {updatingStatus && isActive && (
                        <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" />
                      )}
                    </button>
                  );
                })}
              </div>
            </section>

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
                  rows={4}
                  className="w-full resize-none rounded-lg border border-white/10
                    bg-slate-900/80 px-3 py-2 text-sm leading-6 text-slate-100
                    outline-none transition focus:border-emerald-400/40
                    focus:ring-2 focus:ring-emerald-400/20"
                />
              ) : (
                <button
                  type="button"
                  onClick={startEditContent}
                  className="group w-full text-left"
                >
                  {item.record_content ? (
                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300 transition group-hover:text-slate-200">
                      {item.record_content}
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

            {/* Attachments */}
            <section>
              <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
                附件
              </p>
              <div
                className="rounded-xl border border-dashed border-white/[8%] p-4
                  text-center transition hover:border-white/[15%]"
              >
                {item.attachment_count > 0 ? (
                  <p className="text-xs text-slate-400">
                    共 {item.attachment_count} 个附件
                  </p>
                ) : (
                  <p className="text-xs text-slate-500">暂无附件</p>
                )}
                <button
                  type="button"
                  className="mt-2 inline-flex items-center gap-1 rounded-lg
                    bg-white/[5%] px-3 py-1.5 text-[11px] text-slate-400
                    transition hover:bg-white/[10%] hover:text-slate-200"
                  onClick={() => {
                    // Placeholder — file picker will be wired in a later task
                    // using addAttachmentsToRecord from lib/tauri
                  }}
                >
                  <svg
                    className="h-3 w-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 4.5v15m7.5-7.5h-15"
                    />
                  </svg>
                  添加附件
                </button>
              </div>
            </section>
          </div>

          {/* ── Footer actions ── */}
          <div className="shrink-0 space-y-1.5 border-t border-white/5 px-4 py-3">
            {/* 移除待办 */}
            <button
              type="button"
              onClick={handleRemove}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs
                text-slate-300 transition hover:bg-amber-400/10 hover:text-amber-300"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              移除待办（保留记录）
            </button>

            {/* 删除记录 with confirmation */}
            {confirmDelete ? (
              <div className="flex items-center gap-2 rounded-lg bg-rose-400/10 px-3 py-2">
                <span className="flex-1 text-[11px] text-rose-300">
                  确认删除记录及附件？
                </span>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="rounded-md bg-rose-400/20 px-2.5 py-1 text-[11px]
                    font-medium text-rose-300 transition hover:bg-rose-400/30"
                >
                  确认
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-md px-2.5 py-1 text-[11px] text-slate-400
                    transition hover:bg-white/10"
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2
                  text-xs text-rose-400/80 transition hover:bg-rose-400/10
                  hover:text-rose-300"
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0
                      01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0
                      00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
                删除记录
              </button>
            )}

            {/* 在主面板中打开 */}
            <button
              type="button"
              onClick={handleOpenInMain}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2
                text-xs text-slate-400 transition hover:bg-white/[6%]
                hover:text-slate-200"
            >
              <svg
                className="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75
                    20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5
                    0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5
                    0v-4.5m0 4.5L15 15"
                />
              </svg>
              在主面板中打开
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
