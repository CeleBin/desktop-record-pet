import { useCallback, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalSize } from "@tauri-apps/api/dpi";

import {
  deleteRecord as deleteRecordCommand,
  showMainPanel,
  updateRecord,
  updateTaskStatus,
} from "../../lib/tauri";
import { useTodoOverlayStore } from "../../store/todoOverlay";
import { useSettingsStore } from "../../store/settings";
import type { TaskStatus } from "../../types";
import { TodoDrawer } from "./TodoDrawer";
import { TodoItem } from "./TodoItem";

const appWindow = getCurrentWebviewWindow();
const DATA_CHANGED_EVENT = "data-changed";

export function TodoOverlay() {
  const {
    items,
    collapsed,
    drawerRecordId,
    fadingTaskIds,
    loading,
    error,
    fetchItems,
    completeTask,
    removeTask: removeTaskAction,
    openDrawer,
    closeDrawer,
    toggleCollapse,
    clearError,
  } = useTodoOverlayStore();

  // ── Overlay background opacity from settings (0.0–1.0, default 0.8) ──
  const opacityRaw = useSettingsStore((s) => s.settings["todo_overlay_opacity"]);
  const overlayBgOpacity = Math.min(1, Math.max(0, Number.parseFloat(opacityRaw ?? "0.8") || 0.8));

  // ── Fetch items on mount ──
  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  // ── Re-fetch when data changes elsewhere (Rust emits "data-changed") ──
  useEffect(() => {
    const unlistenPromise = listen(DATA_CHANGED_EVENT, () => {
      void fetchItems();
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [fetchItems]);

  // ── Auto-dismiss error after 4 s ──
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => clearError(), 4000);
    return () => clearTimeout(timer);
  }, [error, clearError]);

  // ── Async callback helpers ──

  const handleUpdateTitle = useCallback(
    async (recordId: string, title: string) => {
      await updateRecord(recordId, { title: title || null });
      await fetchItems();
    },
    [fetchItems],
  );

  const handleUpdateContent = useCallback(
    async (recordId: string, content: string) => {
      await updateRecord(recordId, { content: content || null });
      await fetchItems();
    },
    [fetchItems],
  );

  const handleUpdateTaskStatus = useCallback(
    async (taskId: string, status: TaskStatus) => {
      await updateTaskStatus(taskId, status);
      await fetchItems();
    },
    [fetchItems],
  );

  const handleDeleteRecord = useCallback(
    async (recordId: string) => {
      await deleteRecordCommand(recordId);
      await fetchItems();
    },
    [fetchItems],
  );

  const handleOpenInMainPanel = useCallback(
    async (_recordId: string) => {
      await showMainPanel();
    },
    [],
  );

  // ── Derived ──

  const drawerItem = drawerRecordId
    ? items.find((i) => i.record_id === drawerRecordId) ?? null
    : null;

  // ── Drag region handler ──

  const handleDragMouseDown = useCallback(
    async (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      await appWindow.startDragging();
    },
    [],
  );

  // ── Resize handle handler ──

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const startW = window.innerWidth;
      const startH = window.innerHeight;
      const MIN_W = 280;
      const MIN_H = 300;

      const handleMouseMove = (ev: MouseEvent) => {
        const newW = Math.max(MIN_W, startW + ev.clientX - startX);
        const newH = Math.max(MIN_H, startH + ev.clientY - startY);
        void appWindow.setSize(new LogicalSize(Math.round(newW), Math.round(newH)));
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [],
  );

  // ── Render ──

  return (
    <div className="relative flex h-screen flex-col overflow-hidden">
      {/* ── Scrim background (opacity from settings, pointer-events-none so clicks pass through) ── */}
      <div
        className="pointer-events-none absolute inset-0 backdrop-blur-xl"
        style={{ backgroundColor: `rgba(2, 6, 23, ${overlayBgOpacity})` }}
      />

      {/* ── Content – full opacity so text/controls stay readable ── */}
      <div className="relative z-10 flex h-screen flex-col overflow-hidden">
        {/* ── Error bar ── */}
      {error && (
        <div className="flex shrink-0 items-center gap-2 border-b border-rose-400/10 bg-rose-400/10 px-3 py-1.5">
          <svg
            className="h-3 w-3 shrink-0 text-rose-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118
                0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
          <span className="flex-1 text-[11px] text-rose-300">{error}</span>
          <button
            type="button"
            onClick={clearError}
            className="text-rose-400/60 transition hover:text-rose-300"
          >
            <svg
              className="h-3 w-3"
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
      )}

      {/* ── Top bar / drag region ── */}
      <div
        className="flex shrink-0 cursor-grab select-none items-center gap-2 px-3 py-2 active:cursor-grabbing"
        onMouseDown={handleDragMouseDown}
      >
        {/* Collapse toggle */}
        <button
          type="button"
          onClick={toggleCollapse}
          className="rounded-lg p-1 text-slate-500 transition hover:bg-white/10 hover:text-slate-200"
          title={collapsed ? "展开" : "折叠"}
        >
          <svg
            className="h-4 w-4 transition-transform duration-200"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.5 8.25l-7.5 7.5-7.5-7.5"
            />
          </svg>
        </button>

        <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
          待办
        </span>
        {!collapsed && items.length > 0 && (
          <span className="text-[10px] text-slate-600">
            {items.length} 项
          </span>
        )}

        <div className="flex-1" />

        {/* Open main panel */}
        <button
          type="button"
          onClick={() => void showMainPanel()}
          className="rounded-lg p-1 text-slate-500 transition hover:bg-white/10 hover:text-slate-200"
          title="打开主面板"
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
              d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75
                20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5
                0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
            />
          </svg>
        </button>
      </div>

      {/* ── List area ── */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {loading && items.length === 0 ? (
            /* Loading state */
            <div className="flex items-center justify-center py-12">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-emerald-400/30 border-t-emerald-400" />
            </div>
          ) : items.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-800/40">
                <svg
                  className="h-5 w-5 text-slate-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12h3.75M9 15h3.75M9 18h3.75m3
                      .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424
                     48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0
                     .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0
                     00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0
                     1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095
                     4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621
                     0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125
                     1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75
                     12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0
                     3h.008v.008H6.75V18z"
                  />
                </svg>
              </div>
              <p className="text-sm text-slate-500">暂无待办事项</p>
              <p className="mt-1 text-xs text-slate-600">所有任务已完成</p>
            </div>
          ) : (
            /* Task list */
            <div className="divide-y divide-white/[3%]">
              {items.map((item) => (
                <TodoItem
                  key={item.task_id}
                  item={item}
                  isFading={fadingTaskIds.includes(item.task_id)}
                  onToggleComplete={completeTask}
                  onOpen={openDrawer}
                  onRemoveTask={removeTaskAction}
                  onDeleteRecord={handleDeleteRecord}
                  onOpenInMainPanel={handleOpenInMainPanel}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Drawer ── */}
      {drawerRecordId && (
        <TodoDrawer
          item={drawerItem}
          onClose={closeDrawer}
          onUpdateTitle={handleUpdateTitle}
          onUpdateContent={handleUpdateContent}
          onUpdateTaskStatus={handleUpdateTaskStatus}
          onRemoveTask={removeTaskAction}
          onDeleteRecord={handleDeleteRecord}
          onOpenInMainPanel={handleOpenInMainPanel}
        />
      )}

      {/* ── Native resize handle ── */}
      <div
        className="absolute bottom-0 right-0 z-50 cursor-se-resize select-none p-1.5 text-slate-600/40 hover:text-slate-400/70 transition-colors"
        onMouseDown={handleResizeMouseDown}
      >
        <svg
          className="h-3 w-3"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
        >
          <path d="M11 3L3 11" />
          <path d="M11 7L7 11" />
        </svg>
      </div>
    </div>
  </div>
  );
}
