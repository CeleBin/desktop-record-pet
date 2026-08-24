/**
 * SortableRecordItem.tsx — 可拖拽排序的记录条目包装组件
 *
 * 使用 @dnd-kit/sortable 的 useSortable hook 将 RecordItemContent 包装为
 * 可拖拽的列表项，在拖拽过程中提供视觉反馈（透明度、x 轴锁定）。
 *
 * 模式与 SortableTodoItem 一致：
 * - transform 只取 y 分量（锁定水平方向）
 * - 拖拽中 opacity 0.5
 * - 删除按钮在 RecordItemContent 内部 stopPropagation，不触发拖拽
 */

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { RecordWithRelations } from "../../types";
import { RecordItemContent } from "./RecordItemContent";

interface SortableRecordItemProps {
  record: RecordWithRelations;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export function SortableRecordItem({
  record,
  isSelected,
  onSelect,
  onDelete,
}: SortableRecordItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: record.id });

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
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
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
}
