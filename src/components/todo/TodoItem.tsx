import { useCallback } from "react";

import type { UnfinishedTaskItem } from "../../types";

/**
 * TodoItem 组件的属性接口
 *
 * @param item        - 待办任务数据对象（包含标题、状态、附件数、更新时间等）
 * @param isFading    - 是否正在播放"完成淡出"动画
 * @param onToggleComplete - 切换任务完成状态的回调（复选框勾选后触发）
 * @param onOpen      - 打开任务详情抽屉的回调
 * @param onRemoveTask - 从待办列表中移除任务的回调（不删除记录）
 */
interface TodoItemProps {
  item: UnfinishedTaskItem;
  isFading: boolean;
  onToggleComplete: (taskId: string) => void;
  onOpen: (recordId: string) => void;
  onRemoveTask: (taskId: string) => void;
}

/**
 * 获取待办项目的显示标题。
 * 优先级：record_title（用户设置的标题） > record_content（去空白后的内容预览） > null（由调用方显示占位符）。
 */
function displayTitle(item: UnfinishedTaskItem): string | null {
  if (item.record_title) return item.record_title;
  const content = item.record_content?.replace(/\s+/g, " ").trim();
  return content || null;
}

/**
 * 将 ISO 时间字符串格式化为中文可读的简写形式，例如 "06/14 15:30"。
 * 若解析失败则直接返回原始字符串作为降级方案。
 */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/**
 * 根据 "YYYY-MM-DD" 格式的截止日期字符串计算相对时间显示文字和颜色类名。
 *
 * 返回值为 null 表示无需显示（传入 null 时）。
 * 颜色规则：
 *   - 已过期（diffDays < 0）：text-rose-400（玫瑰红）
 *   - 今天到期（diffDays === 0）：text-amber-400（琥珀色）
 *   - 3 天内（diffDays <= 3）：text-amber-400（琥珀色）
 *   - 未来（diffDays > 3）：text-slate-500（灰色）
 */
function getDueDateInfo(dueAt: string | null): {
  display: string;
  className: string;
} | null {
  if (!dueAt) return null;
  const dueDate = new Date(dueAt);
  if (isNaN(dueDate.getTime())) return null;
  const m = dueDate.getMonth() + 1;
  const d = dueDate.getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffTime = dueDate.getTime() - today.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  const dateStr = `${m}月${d}日`;

  if (diffDays < 0) return { display: `${dateStr} · 已过期`, className: "text-rose-400" };
  if (diffDays === 0) return { display: `${dateStr} · 今天到期`, className: "text-amber-400" };
  if (diffDays <= 3) return { display: `${dateStr} · ${diffDays}天后`, className: "text-amber-400" };
  return { display: `${dateStr} · ${diffDays}天后`, className: "text-slate-500" };
}

export function TodoItem({
  item,
  isFading,
  onToggleComplete,
  onOpen,
  onRemoveTask,
}: TodoItemProps) {
  /**
   * 点击复选框时触发，停止冒泡防止意外打开记录，然后调用父组件的完成回调。
   * 父组件会设置 isFading = true，触发淡出动画。
   */
  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleComplete(item.task_id);
    },
    [item.task_id, onToggleComplete],
  );

  /** 点击标题/正文区域 → 在抽屉中打开记录详情。 */
  const handleOpen = useCallback(() => {
    onOpen(item.record_id);
  }, [item.record_id, onOpen]);

  /** 从待办列表中移除该任务（不删除底层记录，仅移除任务项）。 */
  const handleRemove = useCallback(() => {
    onRemoveTask(item.task_id);
  }, [item.task_id, onRemoveTask]);

  return (
    /**
     * 最外层容器：
     * - `group` 使子元素的 group-hover 样式在容器悬停时生效
     * - `isFading=true` 时：禁用指针事件、向右偏移 + 缩小 + 完全透明 → 模拟"淡出消失"动画（2 秒 duration-500 × 4 个过渡属性）
     * - `isFading=false` 时：仅显示 hover 背景微亮效果
     */
    <div
      className={`
        group relative flex items-start gap-2.5 rounded-xl px-3 py-2.5
        transition-all duration-500
        ${
          isFading
            ? "pointer-events-none translate-x-3 scale-95 opacity-0"
            : "hover:bg-white/[4%]"
        }
      `}
    >
      {/* ── 复选框：点击后触发完成流程 ── */}
      {/**
       * 空心方框复选框，hover 时变为绿色边框 + 浅绿背景以提供视觉反馈。
       * 点击后调用 handleToggle → onToggleComplete → 父组件设置 isFading=true → 2s 渐变 → 删除。
       */}
      <button
        type="button"
        onClick={handleToggle}
        className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded
          border border-slate-600/60 bg-slate-800/40 transition
          hover:border-emerald-400/50 hover:bg-emerald-400/10
          focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
        aria-label="标记完成"
      />

      {/* ── 正文区域：点击打开记录详情 ── */}
      <div className="min-w-0 flex-1 cursor-pointer" onClick={handleOpen}>
        <div className="flex items-center gap-2">
          {/**
           * 标题行：优先显示用户设置的标题，无标题则回退到内容预览，均无则显示"无标题"占位符。
           * truncate 保证超长文本单行省略。
           */}
          <p className="truncate text-sm font-medium text-slate-200">
            {displayTitle(item) || (
              <span className="italic text-slate-500">无标题</span>
            )}
          </p>

          {/**
           * 状态标签（徽章）：
           * - doing（进行中）：天蓝色文字 + 天蓝色圆点
           * - todo（待办）：琥珀色文字 + 琥珀色圆点
           * 圆点使用 inline-block 模拟，与文字通过 gap-1 间距对齐。
           */}
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              item.task_status === "doing"
                ? "bg-sky-400/10 text-sky-300"
                : "bg-amber-400/10 text-amber-300"
            }`}
          >
            <span
              className={`inline-block h-1 w-1 rounded-full ${
                item.task_status === "doing" ? "bg-sky-400" : "bg-amber-400"
              }`}
            />
            {item.task_status === "doing" ? "进行中" : "待办"}
          </span>
        </div>

        {/**
         * 元信息行：附件数量（> 0 时显示回形针图标 + 数量） + 更新时间。
         * 附件图标使用 SVG 回形针路径。
         */}
        <div className="mt-0.5 flex items-center gap-2">
          {item.attachment_count > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-500">
              <svg
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13"
                />
              </svg>
              {item.attachment_count}
            </span>
          )}

          <span className="text-[10px] text-slate-600">
            {formatTime(item.record_updated_at)}
          </span>

          {/**
            * 重复规则图标。
            * 当任务设置了 repeat_rule 时，显示一个循环箭头图标。
            */}
          {item.repeat_rule && (
            <span className="inline-flex items-center text-[10px] text-emerald-400" title="重复任务">
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
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182"
                />
              </svg>
            </span>
          )}

          {/**
            * 截止日期显示。
            * 仅当 item.due_at 非空且能解析为有效日期时才渲染。
            * 使用 getDueDateInfo 计算相对天数并决定颜色（过期红/临期橙/未来灰）。
            */}
          {item.due_at && (() => {
            const dueInfo = getDueDateInfo(item.due_at);
            if (!dueInfo) return null;
            return (
              <span className={`inline-flex items-center gap-0.5 text-[10px] ${dueInfo.className}`}>
                <svg
                  className="h-3 w-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25
                      2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021
                      18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
                  />
                </svg>
                {dueInfo.display}
              </span>
            );
          })()}
        </div>
      </div>

      {/**
       * ── Hover 操作按钮 ──
       * 默认 opacity-0 隐藏，鼠标悬停到整个 group 上时通过 group-hover:opacity-100 显示。
       * 包含三个按钮：打开（抽屉）、移除待办、更多菜单（⋯）。
       */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {/** 移除待办按钮：从列表中移除当前任务项（不影响底层记录）。hover 时变为红色主题以表示"移除"的破坏性。 */}
        <button
          type="button"
          onClick={handleRemove}
          className="rounded-lg p-1.5 text-slate-500 transition hover:bg-rose-400/10 hover:text-rose-300"
          title="移除待办"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
