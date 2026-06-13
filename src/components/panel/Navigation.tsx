import { useState } from "react";

import type { RecordStatus, RecordType, TaskStatus } from "../../types";

type ViewMode = "records" | "tasks";

interface NavigationProps {
  viewMode: ViewMode;
  activeType: RecordType | null;
  activeStatus: RecordStatus | null;
  taskStatusFilter: TaskStatus | null;
  searchQuery: string;
  settingsOpen: boolean;
  onViewModeChange: (mode: ViewMode) => void;
  onTypeChange: (type: RecordType | null) => void;
  onStatusChange: (status: RecordStatus | null) => void;
  onTaskStatusFilterChange: (status: TaskStatus | null) => void;
  onSearchChange: (query: string) => void;
  onToggleSettings: () => void;
}

const TYPE_OPTIONS: { label: string; value: RecordType | null }[] = [
  { label: "全部", value: null },
  { label: "笔记", value: "note" },
  { label: "待办", value: "task" },
  { label: "经验", value: "experience" },
  { label: "问题", value: "issue" },
  { label: "文件", value: "file-note" },
];

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

const TASK_STATUS_STYLES: Record<string, string> = {
  todo: "bg-amber-400/20 text-amber-300 ring-amber-400/30",
  doing: "bg-sky-400/20 text-sky-300 ring-sky-400/30",
  done: "bg-emerald-400/20 text-emerald-300 ring-emerald-400/30",
  cancelled: "bg-slate-500/20 text-slate-400 ring-slate-400/20",
};

export function Navigation({
  viewMode,
  activeType,
  activeStatus,
  taskStatusFilter,
  searchQuery,
  settingsOpen,
  onViewModeChange,
  onTypeChange,
  onStatusChange,
  onTaskStatusFilterChange,
  onSearchChange,
  onToggleSettings,
}: NavigationProps) {
  const [focused, setFocused] = useState(false);

  return (
    <nav className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      {/* ── View mode toggle ── */}
      <div className="flex rounded-xl bg-slate-900/60 p-0.5 ring-1 ring-white/[5%]">
        <button
          type="button"
          onClick={() => onViewModeChange("records")}
          className={`
            flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150
            ${
              viewMode === "records"
                ? "bg-emerald-400/15 text-emerald-300 shadow-sm shadow-emerald-400/10"
                : "text-slate-400 hover:text-slate-200"
            }
          `}
        >
          <div className="flex items-center justify-center gap-1.5">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            记录
          </div>
        </button>
        <button
          type="button"
          onClick={() => onViewModeChange("tasks")}
          className={`
            flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150
            ${
              viewMode === "tasks"
                ? "bg-emerald-400/15 text-emerald-300 shadow-sm shadow-emerald-400/10"
                : "text-slate-400 hover:text-slate-200"
            }
          `}
        >
          <div className="flex items-center justify-center gap-1.5">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            任务
          </div>
        </button>
      </div>

      {/* ── Search ── */}
      <div className="relative">
        <div
          className={`
            flex items-center gap-2 rounded-2xl border bg-slate-900/60 px-3 py-2.5
            text-sm transition-all duration-200
            ${focused
              ? "border-emerald-400/40 ring-2 ring-emerald-400/15"
              : "border-white/10"
            }
          `}
        >
          <svg
            className="h-4 w-4 shrink-0 text-slate-400"
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
            placeholder={viewMode === "tasks" ? "搜索任务…" : "搜索记录…"}
            className="min-w-0 flex-1 bg-transparent text-sm text-slate-100 placeholder-slate-500 outline-none"
          />
          {searchQuery.length > 0 && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="rounded-full p-0.5 text-slate-500 transition hover:text-slate-300"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ── Record filters ── */}
      {viewMode === "records" ? (
        <>
          {/* Type filter */}
          <section>
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
              类型
            </p>
            <div className="flex flex-wrap gap-1.5">
              {TYPE_OPTIONS.map((opt) => {
                const isActive = activeType === opt.value;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => onTypeChange(opt.value)}
                    className={`
                      rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-150
                      ${
                        isActive
                          ? "bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-400/30"
                          : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200"
                      }
                    `}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Status filter */}
          <section>
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
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
                          : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200"
                      }
                    `}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </section>
        </>
      ) : (
        <>
          {/* ── Task status filter ── */}
          <section>
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
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
                            ? "bg-emerald-400/15 text-emerald-300 ring-1 ring-emerald-400/30"
                            : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200"
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
          <section className="rounded-2xl bg-emerald-400/5 border border-emerald-400/10 p-3">
            <p className="text-[11px] leading-5 text-slate-400">
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
              ? "bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/30"
              : "text-slate-500 hover:bg-white/5 hover:text-slate-300"
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

        <p className="text-[10px] text-slate-600">
          Ctrl+N 新建
        </p>
      </div>
    </nav>
  );
}
