/**
 * CategoryManager.tsx — 分类管理浮层
 *
 * 功能：创建 / 重命名 / 删除分类，以及拖拽手柄重排分类顺序。
 * 拖拽排序使用 @dnd-kit/sortable：每行用 useSortable 注册，
 * 但 listeners 只挂在左侧拖拽手柄上，避免与编辑/删除按钮冲突。
 */

import { useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { FolderItem } from "../../types";

interface CategoryManagerProps {
  folders: FolderItem[];
  /** 返回每个分类下的任务数 */
  taskCountByFolder: Record<string, number>;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** 拖拽重排分类：传入被拖动项 id 与目标位置项 id */
  onReorder: (activeId: string, overId: string) => void;
  onClose: () => void;
}

export function CategoryManager({
  folders,
  taskCountByFolder,
  onCreate,
  onRename,
  onDelete,
  onReorder,
  onClose,
}: CategoryManagerProps) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── 拖拽传感器：PointerSensor + 5px 激活距离，防止误触 ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;
    onReorder(activeId, overId);
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await onCreate(newName.trim());
    setNewName("");
  };

  const handleRename = async (id: string) => {
    if (!editingName.trim()) {
      setEditingId(null);
      return;
    }
    await onRename(id, editingName.trim());
    setEditingId(null);
    setEditingName("");
  };

  const startEdit = (f: FolderItem) => {
    setEditingId(f.id);
    setEditingName(f.name);
  };

  const handleDelete = (id: string) => {
    const count = taskCountByFolder[id] || 0;
    if (count > 0) {
      setDeletingId(id);
    } else {
      void onDelete(id);
    }
  };

  const confirmDelete = async () => {
    if (deletingId) {
      await onDelete(deletingId);
      setDeletingId(null);
    }
  };

  return (
    <>
      {/* 遮罩 */}
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
        onMouseDown={(e) => e.stopPropagation()}
      />

      {/* 浮层 */}
      <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-xl border border-border bg-surface/95 p-3 shadow-2xl backdrop-blur-xl">
        <h3 className="mb-2 text-[10px] font-medium uppercase tracking-[0.15em] text-text0">
          分类管理
        </h3>

        {/* 分类列表（可拖拽排序） */}
        <div className="max-h-48 overflow-y-auto">
          {folders.length === 0 ? (
            <p className="py-3 text-center text-[11px] text-text-muted">
              暂无分类
            </p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={folders.map((f) => f.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex flex-col">
                  {folders.map((f) => (
                    <SortableFolderRow
                      key={f.id}
                      folder={f}
                      taskCount={taskCountByFolder[f.id] || 0}
                      isEditing={editingId === f.id}
                      editingName={editingName}
                      onEditingNameChange={setEditingName}
                      onCommitRename={() => void handleRename(f.id)}
                      onCancelEdit={() => setEditingId(null)}
                      onStartEdit={() => startEdit(f)}
                      onDelete={() => handleDelete(f.id)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        {/* 新建分类 */}
        <div className="mt-2 flex items-center gap-1.5">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
            }}
            placeholder="新建分类..."
            className="min-w-0 flex-1 rounded-lg bg-white/5 px-2.5 py-1.5 text-[12px] text-text outline-none placeholder:text-text-muted"
          />
          <button
            onClick={() => void handleCreate()}
            disabled={!newName.trim()}
            className="rounded-lg px-2.5 py-1.5 text-[12px] text-secondary transition hover:bg-secondary/10 disabled:cursor-not-allowed disabled:opacity-30"
          >
            创建
          </button>
        </div>
      </div>

      {/* 删除确认对话框 */}
      {deletingId && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/50"
            onClick={() => setDeletingId(null)}
            onMouseDown={(e) => e.stopPropagation()}
          />
          <div className="fixed inset-0 z-[60] flex items-center justify-center">
            <div className="w-64 rounded-xl border border-border bg-surface p-4 shadow-2xl">
              <p className="text-[12px] text-text">
                分类「
                {folders.find((f) => f.id === deletingId)?.name}
                」下有 {taskCountByFolder[deletingId] || 0}{" "}
                个待办，是否一起删除？此操作不可撤销。
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => setDeletingId(null)}
                  className="rounded-lg px-3 py-1.5 text-[11px] text-text-muted transition hover:bg-white/5"
                >
                  取消
                </button>
                <button
                  onClick={() => void confirmDelete()}
                  className="rounded-lg bg-danger/20 px-3 py-1.5 text-[11px] text-danger transition hover:bg-danger/30"
                >
                  确认删除
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ── 可拖拽的分类行 ──
interface SortableFolderRowProps {
  folder: FolderItem;
  taskCount: number;
  isEditing: boolean;
  editingName: string;
  onEditingNameChange: (v: string) => void;
  onCommitRename: () => void;
  onCancelEdit: () => void;
  onStartEdit: () => void;
  onDelete: () => void;
}

function SortableFolderRow({
  folder,
  taskCount,
  isEditing,
  editingName,
  onEditingNameChange,
  onCommitRename,
  onCancelEdit,
  onStartEdit,
  onDelete,
}: SortableFolderRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: folder.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(
      transform
        ? { x: 0, y: transform.y, scaleX: transform.scaleX ?? 1, scaleY: transform.scaleY ?? 1 }
        : null,
    ),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : ("auto" as const),
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 hover:bg-white/[4%] ${isDragging ? "ring-1 ring-secondary/30" : ""}`}
    >
      {/* 编辑态隐藏拖拽手柄，避免与 input 抢焦点 */}
      {!isEditing && (
        <button
          type="button"
          className="cursor-grab p-0.5 text-text-muted transition hover:text-text-muted active:cursor-grabbing"
          title="拖拽排序"
          {...attributes}
          {...listeners}
        >
          <svg
            className="h-3 w-3"
            viewBox="0 0 12 12"
            fill="currentColor"
            aria-hidden="true"
          >
            <circle cx="3.5" cy="3" r="1.1" />
            <circle cx="3.5" cy="9" r="1.1" />
            <circle cx="8.5" cy="3" r="1.1" />
            <circle cx="8.5" cy="9" r="1.1" />
          </svg>
        </button>
      )}

      {isEditing ? (
        <>
          <input
            value={editingName}
            onChange={(e) => onEditingNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommitRename();
              if (e.key === "Escape") onCancelEdit();
            }}
            className="min-w-0 flex-1 rounded bg-white/5 px-2 py-0.5 text-[12px] text-text outline-none ring-1 ring-secondary/50"
            autoFocus
          />
          <button
            onClick={onCommitRename}
            className="text-[10px] text-secondary"
          >
            确定
          </button>
        </>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-[12px] text-text">
            {folder.name}
          </span>
          <span className="text-[10px] text-text-muted">{taskCount}</span>
          <button
            onClick={onStartEdit}
            className="p-0.5 text-text-muted hover:text-text"
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
                d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
              />
            </svg>
          </button>
          <button
            onClick={onDelete}
            className="p-0.5 text-text-muted hover:text-danger"
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
                d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
              />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
