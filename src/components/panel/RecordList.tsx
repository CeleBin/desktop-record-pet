import type { RecordWithRelations } from "../../types";

type ViewMode = "records" | "tasks";

interface RecordListProps {
  records: RecordWithRelations[];
  selectedId: string | null;
  loading: boolean;
  viewMode: ViewMode;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

const TYPE_LABELS: Record<string, { label: string; dot: string }> = {
  note: { label: "笔记", dot: "bg-text-muted" },
  task: { label: "待办", dot: "bg-secondary" },
  experience: { label: "经验", dot: "bg-primary" },
  issue: { label: "问题", dot: "bg-danger" },
  "file-note": { label: "文件", dot: "bg-sky-400" },
};

const TASK_STATUS_BADGE: Record<
  string,
  { label: string; bg: string; text: string }
> = {
  todo: { label: "待办", bg: "bg-primary/15", text: "text-primary" },
  doing: { label: "进行中", bg: "bg-sky-400/15", text: "text-sky-300" },
  done: { label: "已完成", bg: "bg-secondary/15", text: "text-secondary" },
  cancelled: {
    label: "已取消",
    bg: "bg-text-muted/15",
    text: "text-text-muted",
  },
};

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `${month}-${day} ${hours}:${minutes}`;
  } catch {
    return iso;
  }
}

function contentPreview(record: RecordWithRelations): string {
  if (record.title) return record.title;
  if (record.content) {
    const trimmed = record.content.replace(/\s+/g, " ").trim();
    return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
  }
  const count = record.attachments?.length ?? 0;
  return count > 0 ? `${count} 个附件` : "无标题";
}

export function RecordList({
  records,
  selectedId,
  loading,
  viewMode,
  onSelect,
  onDelete,
}: RecordListProps) {
  if (loading && records.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-secondary/30 border-t-secondary" />
          <p className="text-xs text-text0">加载中…</p>
        </div>
      </div>
    );
  }

  if (!loading && records.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="text-center">
          <p className="text-sm text-text0">
            {viewMode === "tasks" ? "暂无任务" : "暂无记录"}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {viewMode === "tasks"
              ? "在记录详情中可将记录转为待办"
              : "Ctrl+Shift+R 打开速记窗口"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Column header */}
      <div className="shrink-0 border-b border-border px-4 py-3">
        <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-text0">
          {viewMode === "tasks" ? "任务列表" : "记录列表"}
        </p>
        <p className="mt-0.5 text-xs text-text-muted">
          {records.length}{" "}
          {viewMode === "tasks" ? "项任务" : "条记录"}
        </p>
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {records.map((record) => {
          const meta = TYPE_LABELS[record.type] ?? TYPE_LABELS.note;
          const isSelected = record.id === selectedId;
          const hasTask = !!record.task;
          const attachmentCount = record.attachments?.length ?? 0;
          const ts = record.task?.task_status;

          return (
            <div
              key={record.id}
              onClick={() => onSelect(record.id)}
              className={`
                group cursor-pointer border-b border-border px-4 py-3
                transition-all duration-150
                ${isSelected
                  ? "bg-secondary/8 border-l-2 border-l-secondary"
                  : "border-l-2 border-l-transparent hover:bg-white/[3%]"
                }
              `}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {/* Type + title row */}
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`}
                    />
                    <span className="truncate text-sm font-medium text-text">
                      {contentPreview(record)}
                    </span>
                  </div>

                  {/* Meta row */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-text0">
                    <span>{meta.label}</span>
                    <span className="text-text-muted">·</span>
                    <span>{formatDate(record.created_at)}</span>
                    {hasTask && ts && (
                      <>
                        <span className="text-text-muted">·</span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            TASK_STATUS_BADGE[ts].bg
                          } ${TASK_STATUS_BADGE[ts].text}`}
                        >
                          {/* Dot indicator matches status color */}
                          <span
                            className={`inline-block h-1 w-1 rounded-full ${
                              ts === "todo"
                                ? "bg-primary"
                                : ts === "doing"
                                  ? "bg-sky-400"
                                  : ts === "done"
                                    ? "bg-secondary"
                                    : "bg-text-muted"
                            }`}
                          />
                          {TASK_STATUS_BADGE[ts].label}
                        </span>
                      </>
                    )}
                    {attachmentCount > 0 && (
                      <>
                        <span className="text-text-muted">·</span>
                        <span>{attachmentCount} 个附件</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Delete button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(record.id);
                  }}
                  className="shrink-0 rounded-lg p-1 text-text-muted opacity-0 transition
                    hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
                  title="删除"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}

        {/* Bottom padding */}
        <div className="h-4" />
      </div>
    </div>
  );
}
