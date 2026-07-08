/**
 * RecordItemContent.tsx — 记录条目的内部内容（类型圆点 + 标题 + 元信息 + 删除按钮）
 *
 * 纯展示组件，不包含外层 wrapper（onClick / dnd 监听由外层处理）。
 * 删除按钮内部 stopPropagation 防止触发外层 onSelect 和拖拽。
 */

import type { RecordWithRelations } from "../../types";

const TYPE_LABELS: Record<string, { label: string; dot: string }> = {
  note: { label: "笔记", dot: "bg-text-muted" },
  task: { label: "待办", dot: "bg-secondary" },
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

interface RecordItemContentProps {
  record: RecordWithRelations;
  onDelete: (id: string) => void;
}

export function RecordItemContent({ record, onDelete }: RecordItemContentProps) {
  const meta = TYPE_LABELS[record.type] ?? TYPE_LABELS.note;
  const hasTask = !!record.task;
  const attachmentCount = record.attachments?.length ?? 0;
  const ts = record.task?.task_status;

  return (
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

      {/* Delete button — stopPropagation 防止触发外层 onSelect 和 dnd 拖拽 */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(record.id);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="shrink-0 rounded-lg p-1 text-text-muted opacity-0 transition
          hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
        title="删除"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </div>
  );
}
