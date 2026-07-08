import { useEffect, useRef, useState } from "react";

import type { RecordStatus, RecordType, TaskStatus } from "../../types";
import { useTagsStore } from "../../store/tags";

type ViewMode = "all" | "notes" | "tasks";

interface NavigationProps {
  selectedTypes: Set<RecordType>;
  onToggleTypeFilter: (type: RecordType) => void;
  viewMode: ViewMode;
  activeStatus: RecordStatus | null;
  taskStatusFilter: TaskStatus | null;
  searchQuery: string;
  settingsOpen: boolean;
  onStatusChange: (status: RecordStatus | null) => void;
  onTaskStatusFilterChange: (status: TaskStatus | null) => void;
  onSearchChange: (query: string) => void;
  onToggleSettings: () => void;
  activeTagIds: string[];
  onToggleTagFilter: (id: string) => void;
}

const STATUS_OPTIONS: { label: string; value: RecordStatus | null }[] = [
  { label: "所有状态", value: null },
  { label: "活跃", value: "active" },
  { label: "归档", value: "archived" },
];

const TASK_STATUS_OPTIONS: { label: string; value: TaskStatus | null }[] = [
  { label: "全部任务", value: null },
  { label: "待办", value: "todo" },
  { label: "进行中", value: "doing" },
  { label: "已完成", value: "done" },
  { label: "已取消", value: "cancelled" },
];

const TAG_COLORS = [
  "#a78bfa",
  "#fbbf24",
  "#34d399",
  "#fb7185",
  "#38bdf8",
  "#fb923c",
  "#e879f9",
  "#2dd4bf",
];

const TASK_STATUS_STYLES: Record<string, string> = {
  todo: "bg-primary/20 text-primary ring-primary/30",
  doing: "bg-sky-400/20 text-sky-300 ring-sky-400/30",
  done: "bg-secondary/20 text-secondary ring-secondary/30",
  cancelled: "bg-text-muted/20 text-text-muted ring-text-muted/20",
};

export function Navigation({
  selectedTypes,
  onToggleTypeFilter,
  viewMode,
  activeStatus,
  taskStatusFilter,
  searchQuery,
  settingsOpen,
  activeTagIds,
  onStatusChange,
  onTaskStatusFilterChange,
  onSearchChange,
  onToggleSettings,
  onToggleTagFilter,
}: NavigationProps) {
  const [focused, setFocused] = useState(false);

  // ── Tag create popover ──
  const [showTagPopover, setShowTagPopover] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0]);
  const tags = useTagsStore((s) => s.tags);
  const createTag = useTagsStore((s) => s.createTag);

  const tagPopoverRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!showTagPopover) return;
    const handler = (e: MouseEvent) => {
      if (tagPopoverRef.current && !tagPopoverRef.current.contains(e.target as Node)) {
        setShowTagPopover(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showTagPopover]);

  const handleCreateTag = async () => {
    const trimmed = newTagName.trim();
    if (!trimmed) return;
    try {
      await createTag(trimmed, newTagColor);
      setNewTagName("");
      setNewTagColor(TAG_COLORS[0]);
      setShowTagPopover(false);
    } catch {
      // error handled by store
    }
  };

  return (
    <nav className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      {/* ── Type filter (multi-select: both active = all) ── */}
      <div className="flex rounded-xl bg-surface/60 p-0.5 ring-1 ring-white/[5%]">
        <button
          type="button"
          onClick={() => onToggleTypeFilter("note")}
          className={`
            flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150
            ${
              selectedTypes.has("note")
                ? "bg-secondary/15 text-secondary shadow-sm shadow-secondary/10"
                : "text-text-muted hover:text-text"
            }
          `}
        >
          <div className="flex items-center justify-center gap-1.5">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            笔记
          </div>
        </button>
        <button
          type="button"
          onClick={() => onToggleTypeFilter("task")}
          className={`
            flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150
            ${
              selectedTypes.has("task")
                ? "bg-secondary/15 text-secondary shadow-sm shadow-secondary/10"
                : "text-text-muted hover:text-text"
            }
          `}
        >
          <div className="flex items-center justify-center gap-1.5">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            待办
          </div>
        </button>
      </div>

      {/* ── Search ── */}
      <div className="relative">
        <div
          className={`
            flex items-center gap-2 rounded-2xl border bg-surface/60 px-3 py-2.5
            text-sm transition-all duration-200
            ${focused
              ? "border-secondary/40 ring-2 ring-secondary/15"
              : "border-border"
            }
          `}
        >
          <svg
            className="h-4 w-4 shrink-0 text-text-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={viewMode === "tasks" ? "搜索任务…" : viewMode === "notes" ? "搜索笔记…" : "搜索记录…"}
            className="min-w-0 flex-1 bg-transparent text-sm text-text placeholder-text-muted outline-none"
          />
          {searchQuery.length > 0 && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="rounded-full p-0.5 text-text0 transition hover:text-text"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ── Record filters ── */}
      {viewMode !== "tasks" ? (
        <>
          {/* Status filter */}
          <section>
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-text0">
              状态
            </p>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_OPTIONS.map((opt) => {
                const isActive = activeStatus === opt.value;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => onStatusChange(opt.value)}
                    className={`
                      rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-150
                      ${
                        isActive
                          ? "bg-sky-400/15 text-sky-300 ring-1 ring-sky-400/30"
                          : "bg-white/5 text-text-muted hover:bg-white/10 hover:text-text"
                      }
                    `}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Tags filter */}
          <section>
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-text0">
              标签
            </p>
            {tags.length === 0 ? (
              <p className="text-[11px] text-text-muted">暂无标签</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => {
                  const isActive = activeTagIds.includes(tag.id);
                  const hasColor = !!tag.color;
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => onToggleTagFilter(tag.id)}
                      className={`
                        rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-150
                        ${!hasColor
                          ? isActive
                            ? "bg-secondary/15 text-secondary ring-1 ring-secondary/30"
                            : "bg-white/5 text-text-muted hover:bg-white/10 hover:text-text"
                          : ""
                        }
                      `}
                      style={
                        hasColor
                          ? {
                              backgroundColor: isActive
                                ? `${tag.color!}33`
                                : `${tag.color!}1a`,
                              color: tag.color!,
                              boxShadow: isActive
                                ? `0 0 0 1px ${tag.color!}4d`
                                : undefined,
                            }
                          : undefined
                      }
                    >
                      {tag.name}
                      {isActive && (
                        <svg className="ml-1 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            {/* Create tag button + popover */}
            <div className="relative mt-2">
              <button
                type="button"
                onClick={() => setShowTagPopover((prev) => !prev)}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-text-muted transition hover:bg-white/5 hover:text-text"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                新建标签
              </button>

              {showTagPopover && (
                <div ref={tagPopoverRef} className="absolute left-0 z-50 mt-1 w-56 rounded-xl border border-border bg-surface/95 p-3 shadow-2xl backdrop-blur-xl">
                  <input
                    type="text"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleCreateTag();
                      }
                      if (e.key === "Escape") {
                        setShowTagPopover(false);
                      }
                    }}
                    placeholder="标签名称…"
                    className="mb-2 w-full rounded-lg border border-border bg-white/5 px-2.5 py-1.5 text-xs text-text placeholder-text-muted outline-none transition focus:border-secondary/40 focus:ring-2 focus:ring-secondary/20"
                    autoFocus
                  />
                  <div className="mb-2 flex gap-1.5">
                    {TAG_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setNewTagColor(color)}
                        className={`h-5 w-5 rounded-full transition-all duration-150 ${
                          newTagColor === color
                            ? "ring-2 ring-white ring-offset-1 ring-offset-surface/95"
                            : "ring-1 ring-white/10"
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCreateTag()}
                    disabled={!newTagName.trim()}
                    className="w-full rounded-lg bg-secondary/15 px-3 py-1.5 text-xs font-medium text-secondary transition hover:bg-secondary/25 disabled:opacity-40"
                  >
                    创建
                  </button>
                </div>
              )}
            </div>
          </section>
        </>
      ) : (
        <>
          {/* ── Task status filter ── */}
          <section>
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-text0">
              任务状态
            </p>
            <div className="flex flex-wrap gap-1.5">
              {TASK_STATUS_OPTIONS.map((opt) => {
                const isActive = taskStatusFilter === opt.value;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => onTaskStatusFilterChange(opt.value)}
                    className={`
                      rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-150
                      ${
                        isActive && opt.value
                          ? `${TASK_STATUS_STYLES[opt.value]} ring-1`
                          : isActive && !opt.value
                            ? "bg-secondary/15 text-secondary ring-1 ring-secondary/30"
                            : "bg-white/5 text-text-muted hover:bg-white/10 hover:text-text"
                      }
                    `}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Hint about task context */}
          <section className="rounded-2xl bg-secondary/5 border border-secondary/10 p-3">
            <p className="text-[11px] leading-5 text-text-muted">
              显示所有已转为待办的记录。点击记录可查看详情并更新进度。
            </p>
          </section>
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Settings toggle + bottom hint */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggleSettings}
          className={`
            inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5
            text-xs font-medium transition-all duration-150
            ${settingsOpen
              ? "bg-primary/15 text-primary ring-1 ring-primary/30"
              : "text-text0 hover:bg-white/5 hover:text-text"
            }
          `}
          title="设置"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
          </svg>
          {settingsOpen ? "关闭设置" : "设置"}
        </button>

        <div className="flex-1" />

        <p className="text-[10px] text-text-muted">
          Ctrl+N 新建
        </p>
      </div>
    </nav>
  );
}
