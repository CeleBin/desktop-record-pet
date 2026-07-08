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

type ViewMode = "all" | "notes" | "tasks";

interface RecordListProps {
  records: RecordWithRelations[];
  selectedId: string | null;
  loading: boolean;
  viewMode: ViewMode;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onReorder?: (activeId: string, overId: string) => void;
}

export function RecordList({
  records,
  selectedId,
  loading,
  viewMode,
  onSelect,
  onDelete,
  onReorder,
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
            {viewMode === "tasks" ? "暂无任务" : viewMode === "notes" ? "暂无笔记" : "暂无记录"}
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

  const sortable = viewMode !== "all" && onReorder;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Column header */}
      <div className="shrink-0 border-b border-border px-4 py-3">
        <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-text0">
          {viewMode === "tasks" ? "任务列表" : viewMode === "notes" ? "笔记列表" : "记录列表"}
        </p>
        <p className="mt-0.5 text-xs text-text-muted">
          {records.length}{" "}
          {viewMode === "tasks" ? "项任务" : viewMode === "notes" ? "条笔记" : "条记录"}
          {viewMode === "all" && " · 按时间排序"}
        </p>
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {sortable ? (
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
                <RecordItemContent record={record} onDelete={onDelete} />
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
