import {
  DndContext,
  PointerSensor,
  rectIntersection,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

import type { FolderItem, RecordWithRelations } from "../../types";
import { RecordItemContent } from "./RecordItemContent";
import { SortableRecordItem } from "./SortableRecordItem";

type ViewMode = "notes" | "tasks";

function FolderListItem({ folder, onOpen }: { folder: FolderItem; onOpen: (folderId: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `note-folder:${folder.id}` });

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => onOpen(folder.id)}
      aria-label={`打开文件夹 ${folder.name}`}
      className={`group flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition ${isOver ? "bg-secondary/10 ring-1 ring-inset ring-secondary/35" : "hover:bg-white/[3%]"}`}
    >
      <svg className={`h-4 w-4 shrink-0 transition ${isOver ? "text-secondary" : "text-text-muted group-hover:text-secondary"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5A2.5 2.5 0 015.5 5H10l2 2h6.5A2.5 2.5 0 0121 9.5v7A2.5 2.5 0 0118.5 19h-13A2.5 2.5 0 013 16.5v-9z" />
      </svg>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">{folder.name}</span>
      <svg className="h-3.5 w-3.5 shrink-0 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
      </svg>
    </button>
  );
}

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
  onMoveNoteToFolder?: (recordId: string, folderId: string) => void;
  folders?: FolderItem[];
  onSelectFolder?: (folderId: string) => void;
  onCollapseList?: () => void;
  onNavigateUp?: () => void;
  notePath?: string[];
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
  onMoveNoteToFolder,
  folders,
  onSelectFolder,
  onCollapseList,
  onNavigateUp,
  notePath,
}: RecordListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (overId.startsWith("note-folder:")) {
      const record = records.find((item) => item.id === activeId);
      const folderId = overId.slice("note-folder:".length);
      if (viewMode === "notes" && record?.type === "note" && record.folderId !== folderId) {
        onMoveNoteToFolder?.(activeId, folderId);
      }
      return;
    }
    if (activeId !== overId) onReorder?.(activeId, overId);
  };

  const sortable = onReorder != null;
  const childFolders = viewMode === "notes" && onSelectFolder ? folders ?? [] : [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Column header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-text-muted">
            {viewMode === "tasks" ? "任务列表" : "笔记列表"}
          </p>
          {viewMode === "notes" && notePath && notePath.length > 0 && (
            <div className="mt-1 flex min-w-0 items-center gap-1">
              {onNavigateUp && (
                <button
                  type="button"
                  aria-label="返回上一级"
                  onClick={onNavigateUp}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-muted transition hover:bg-secondary/10 hover:text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m-7 7 7-7 7 7" />
                  </svg>
                </button>
              )}
              <p className="min-w-0 max-w-[18rem] truncate text-xs text-text-muted" title={notePath.join(" / ")}>
                {notePath.join(" / ")}
              </p>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {viewMode === "notes" && onCreateNote && (
            <button
              type="button"
              onClick={onCreateNote}
              className="inline-flex items-center gap-1 rounded-md border border-border/70 px-2.5 py-1.5 text-[13px] font-medium text-text-muted transition hover:border-secondary/35 hover:bg-secondary/5 hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
            >
              <span aria-hidden="true">＋</span>
              新建笔记
            </button>
          )}
          {onCollapseList && (
            <button
              type="button"
              aria-label="折叠列表"
              title="折叠列表"
              onClick={onCollapseList}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition hover:bg-secondary/10 hover:text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="m15 18-6-6 6-6" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {loading && records.length === 0 && childFolders.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-secondary/30 border-t-secondary" />
              <p className="text-xs text-text0">加载中…</p>
            </div>
          </div>
        ) : !loading && records.length === 0 && childFolders.length === 0 ? (
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
        ) : (
          <DndContext sensors={sensors} collisionDetection={rectIntersection} onDragEnd={handleDragEnd}>
            {childFolders.map((folder) => (
              <FolderListItem
                key={folder.id}
                folder={folder}
                onOpen={(folderId) => onSelectFolder?.(folderId)}
              />
            ))}
            {sortable ? (
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
          </DndContext>
        )}
        {!loading && childFolders.length > 0 && records.length === 0 && (
              <p className="px-4 py-3 text-xs text-text-muted">此文件夹中暂无笔记</p>
        )}

        {/* Bottom padding */}
        <div className="h-4" />
      </div>
    </div>
  );
}
