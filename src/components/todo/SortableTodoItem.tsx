/**
 * SortableTodoItem.tsx — 可拖拽排序的待办条目包装组件
 *
 * 使用 @dnd-kit/sortable 的 useSortable hook 将 TodoItem 包装为
 * 可拖拽的列表项，在拖拽过程中提供视觉反馈（透明度、缩放）。
 */

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { UnfinishedTaskItem } from "../../types";
import { TodoItem } from "./TodoItem";

interface SortableTodoItemProps {
  item: UnfinishedTaskItem;
  isFading: boolean;
  onToggleComplete: (taskId: string) => void;
  onOpen: (recordId: string) => void;
  onRemoveTask: (taskId: string) => void;
}

export function SortableTodoItem({
  item,
  isFading,
  onToggleComplete,
  onOpen,
  onRemoveTask,
}: SortableTodoItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.task_id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(
      transform
        ? { x: 0, y: transform.y, scaleX: transform.scaleX ?? 1, scaleY: transform.scaleY ?? 1 }
        : null
    ),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : "auto" as const,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TodoItem
        item={item}
        isFading={isFading}
        onToggleComplete={onToggleComplete}
        onOpen={onOpen}
        onRemoveTask={onRemoveTask}
      />
    </div>
  );
}