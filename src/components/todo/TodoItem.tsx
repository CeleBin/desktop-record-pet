import { useCallback, useState } from "react";

import type { UnfinishedTaskItem } from "../../types";

interface TodoItemProps {
  item: UnfinishedTaskItem;
  isFading: boolean;
  onToggleComplete: (taskId: string) => void;
  onOpen: (recordId: string) => void;
  onRemoveTask: (taskId: string) => void;
  onDeleteRecord: (recordId: string) => void;
  onOpenInMainPanel: (recordId: string) => void;
}

/** Fallback display text: title → content preview → null (caller shows placeholder). */
function displayTitle(item: UnfinishedTaskItem): string | null {
  if (item.record_title) return item.record_title;
  const content = item.record_content?.replace(/\s+/g, " ").trim();
  return content || null;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function TodoItem({
  item,
  isFading,
  onToggleComplete,
  onOpen,
  onRemoveTask,
  onDeleteRecord,
  onOpenInMainPanel,
}: TodoItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleComplete(item.task_id);
    },
    [item.task_id, onToggleComplete],
  );

  const handleOpen = useCallback(() => {
    onOpen(item.record_id);
  }, [item.record_id, onOpen]);

  const handleRemove = useCallback(() => {
    onRemoveTask(item.task_id);
  }, [item.task_id, onRemoveTask]);

  const handleDelete = useCallback(() => {
    setMenuOpen(false);
    onDeleteRecord(item.record_id);
  }, [item.record_id, onDeleteRecord]);

  const handleOpenInMain = useCallback(() => {
    setMenuOpen(false);
    onOpenInMainPanel(item.record_id);
  }, [item.record_id, onOpenInMainPanel]);

  const toggleMenu = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen((prev) => !prev);
  }, []);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

  return (
    <div
      className={`
        group relative flex items-start gap-2.5 rounded-xl px-3 py-2.5
        transition-all duration-500
        ${
          isFading
            ? "pointer-events-none translate-x-3 scale-95 opacity-0"
            : "hover:bg-white/[4%]"
        }
      `}
    >
      {/* ── Checkbox ── */}
      <button
        type="button"
        onClick={handleToggle}
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded
          border border-slate-600/60 bg-slate-800/40 transition
          hover:border-emerald-400/50 hover:bg-emerald-400/10
          focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
        aria-label="标记完成"
      />

      {/* ── Body ── */}
      <div className="min-w-0 flex-1 cursor-pointer" onClick={handleOpen}>
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-slate-200">
            {displayTitle(item) || (
              <span className="italic text-slate-500">无标题</span>
            )}
          </p>

          {/* Status badge */}
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              item.task_status === "doing"
                ? "bg-sky-400/10 text-sky-300"
                : "bg-amber-400/10 text-amber-300"
            }`}
          >
            <span
              className={`inline-block h-1 w-1 rounded-full ${
                item.task_status === "doing" ? "bg-sky-400" : "bg-amber-400"
              }`}
            />
            {item.task_status === "doing" ? "进行中" : "待办"}
          </span>
        </div>

        {/* Meta row */}
        <div className="mt-0.5 flex items-center gap-2">
          {item.attachment_count > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-500">
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
                  d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13"
                />
              </svg>
              {item.attachment_count}
            </span>
          )}

          <span className="text-[10px] text-slate-600">
            {formatTime(item.record_updated_at)}
          </span>
        </div>
      </div>

      {/* ── Hover actions ── */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {/* Open (opens drawer) */}
        <button
          type="button"
          onClick={handleOpen}
          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/10 hover:text-slate-200"
          title="打开"
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
              d="M4.5 12h15m0 0l-6.75-6.75M19.5 12l-6.75 6.75"
            />
          </svg>
        </button>

        {/* Remove task */}
        <button
          type="button"
          onClick={handleRemove}
          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-rose-400/10 hover:text-rose-300"
          title="移除待办"
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
        </button>

        {/* More menu */}
        <div className="relative">
          <button
            type="button"
            onClick={toggleMenu}
            className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/10 hover:text-slate-200"
            title="更多"
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
                d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
              />
            </svg>
          </button>

          {menuOpen && (
            <>
              {/* Backdrop */}
              <div className="fixed inset-0 z-40" onClick={closeMenu} />
              {/* Dropdown */}
              <div className="absolute right-0 top-full z-50 mt-1 min-w-[160px] overflow-hidden rounded-xl border border-white/[8%] bg-slate-900/95 shadow-xl shadow-black/60 backdrop-blur-xl">
                <button
                  type="button"
                  onClick={handleOpenInMain}
                  className="flex w-full items-center gap-2 px-3.5 py-2.5 text-xs text-slate-300 transition hover:bg-white/[6%]"
                >
                  在主面板中打开
                </button>
                <div className="mx-3 h-px bg-white/[6%]" />
                <button
                  type="button"
                  onClick={handleDelete}
                  className="flex w-full items-center gap-2 px-3.5 py-2.5 text-xs text-rose-400 transition hover:bg-rose-400/10"
                >
                  删除记录
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
