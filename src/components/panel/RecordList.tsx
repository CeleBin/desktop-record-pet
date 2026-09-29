import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

import type { RecordWithRelations } from "../../types";
import { RecordItemContent } from "./RecordItemContent";
import { SortableRecordItem } from "./SortableRecordItem";

type ViewMode = "notes" | "tasks";

interface RecordListProps {
  records: RecordWithRelations[];
  selectedId: string | null;
  loading: boolean;
  viewMode: ViewMode;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onReorder?: (activeId: string, overId: string) => void;
  onCreateNote?: () => void;
  onMoveNote?: (recordId: string) => void;
  notePath?: string[];
  includeDescendants?: boolean;
  onSetIncludeDescendants?: (value: boolean) => void;
}

export function RecordList({
  records,
  selectedId,
  loading,
  viewMode,
  onSelect,
  onDelete,
  onReorder,
  onCreateNote,
  onMoveNote,
  notePath,
  includeDescendants,
  onSetIncludeDescendants,
}: RecordListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onReorder?.(String(active.id), String(over.id));
  };

  const sortable = onReorder != null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Column header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-text0">
            {viewMode === "tasks" ? "任务列表" : "笔记列表"}
          </p>
          {viewMode === "notes" && notePath && notePath.length > 0 && (
            <p className="mt-1 max-w-[18rem] truncate text-xs text-text-muted" title={notePath.join(" / ")}>
              {notePath.join(" / ")}
            </p>
          )}
          {viewMode === "notes" && notePath && notePath.length > 0 && notePath[0] !== "全部笔记" && notePath[0] !== "未归类" && onSetIncludeDescendants && (
            <label className="mt-1.5 inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-text-muted">
              <input
                type="checkbox"
                checked={includeDescendants ?? false}
                onChange={(event) => onSetIncludeDescendants(event.target.checked)}
                className="accent-secondary"
              />
              包含子文件夹
            </label>
          )}
          <p className="mt-0.5 text-xs text-text-muted">
            {records.length}{" "}
            {viewMode === "tasks" ? "项任务" : "条笔记"}
          </p>
        </div>
        {viewMode === "notes" && onCreateNote && (
          <button
            type="button"
            onClick={onCreateNote}
            className="inline-flex items-center gap-1 rounded-lg bg-secondary/15 px-2.5 py-1.5 text-xs font-medium text-secondary transition hover:bg-secondary/25"
          >
            <span aria-hidden="true">＋</span>
            新建笔记
          </button>
        )}
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {loading && records.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-secondary/30 border-t-secondary" />
              <p className="text-xs text-text0">加载中…</p>
            </div>
          </div>
        ) : !loading && records.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4">
            <div className="text-center">
              <p className="text-sm text-text0">
                {viewMode === "tasks" ? "暂无任务" : "暂无笔记"}
              </p>
              <p className="mt-1 text-xs text-text-muted">
                {viewMode === "tasks"
                  ? "在记录详情中可将记录转为待办"
                  : "点击右上角“新建笔记”开始记录"}
              </p>
            </div>
          </div>
        ) : sortable ? (
          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <SortableContext
              items={records.map((r) => r.id)}
              strategy={verticalListSortingStrategy}
            >
              {records.map((record) => (
                <SortableRecordItem
                  key={record.id}
                  record={record}
                  isSelected={record.id === selectedId}
                  onSelect={onSelect}
                  onDelete={onDelete}
                  onMoveNote={onMoveNote}
                />
              ))}
            </SortableContext>
          </DndContext>
        ) : (
          records.map((record) => {
            const isSelected = record.id === selectedId;
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
                <RecordItemContent record={record} onDelete={onDelete} onMoveNote={onMoveNote} />
              </div>
            );
          })
        )}

        {/* Bottom padding */}
        <div className="h-4" />
      </div>
    </div>
  );
}
