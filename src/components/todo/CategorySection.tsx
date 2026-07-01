import { useDroppable } from "@dnd-kit/core";
import type { UnfinishedTaskItem } from "../../types";
import { SortableTodoItem } from "./SortableTodoItem";

interface CategorySectionProps {
  folderName: string;
  folderId: string;
  items: UnfinishedTaskItem[];
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isFading: (taskId: string) => boolean;
  onToggleComplete: (taskId: string) => void;
  onOpen: (recordId: string) => void;
  onRemoveTask: (taskId: string) => void;
}

export function CategorySection({
  folderName,
  folderId,
  items,
  isCollapsed,
  onToggleCollapse,
  isFading,
  onToggleComplete,
  onOpen,
  onRemoveTask,
}: CategorySectionProps) {
  // 注册为 droppable 区域，用于接收拖入的任务
  const { setNodeRef, isOver } = useDroppable({ id: `folder-${folderId}` });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg transition-colors ${isOver ? "bg-secondary/10 ring-1 ring-secondary/30" : ""}`}
    >
      {/* 分类头部 */}
      <button
        type="button"
        onClick={onToggleCollapse}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/[3%]"
      >
        <svg
          className="h-3 w-3 shrink-0 text-text0 transition-transform duration-200"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          style={{
            transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
          }}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.5 8.25l-7.5 7.5-7.5-7.5"
          />
        </svg>
        <span className="text-[11px] font-medium text-text">
          {folderName}
        </span>
        <span className="text-[10px] text-text-muted">{items.length}</span>
      </button>

      {/* 任务列表（折叠时隐藏） */}
      {!isCollapsed &&
        items.length > 0 && (
          <div className="divide-y divide-white/[2%]">
            {items.map((item) => (
              <SortableTodoItem
                key={item.task_id}
                item={item}
                isFading={isFading(item.task_id)}
                onToggleComplete={onToggleComplete}
                onOpen={onOpen}
                onRemoveTask={onRemoveTask}
              />
            ))}
          </div>
        )}
    </div>
  );
}
