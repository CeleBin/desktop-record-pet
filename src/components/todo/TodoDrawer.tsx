import { useCallback, useEffect, useRef, useState } from "react";

import type { TaskStatus, UnfinishedTaskItem } from "../../types";
import { DatePicker } from "./DatePicker";

/**
 * TodoDrawer 组件的属性接口。
 *
 * 从右侧滑入的半屏抽屉面板，展示单项任务的完整详情与编辑操作。
 *
 * @param item         当前选中的任务项，为 null 时抽屉关闭
 * @param onClose      关闭抽屉的回调
 * @param onUpdateTitle   保存标题（record_title）
 * @param onUpdateContent 保存内容（record_content）
 * @param onUpdateTaskStatus 更新任务状态（todo / doing / done / cancelled）
 */
interface TodoDrawerProps {
  item: UnfinishedTaskItem | null;
  onClose: () => void;
  onUpdateTitle: (recordId: string, title: string) => Promise<void>;
  onUpdateContent: (recordId: string, content: string) => Promise<void>;
  onUpdateTaskStatus: (taskId: string, status: TaskStatus) => Promise<void>;
  onUpdateDueAt: (recordId: string, taskId: string, dueAt: string | null) => Promise<void>;
}

/**
 * 四种任务状态的 UI 配置。
 * 每种状态包含中文标签、对应的枚举值、小圆点颜色类和激活态样式。
 * 用于底部的状态切换按钮组渲染。
 */
const STATUS_OPTIONS: {
  label: string;
  value: TaskStatus;
  dot: string;
  activeClasses: string;
}[] = [
  {
    label: "待办",
    value: "todo",
    dot: "bg-amber-400",
    activeClasses:
      "bg-amber-400/20 text-amber-300 ring-1 ring-amber-400/30",
  },
  {
    label: "进行中",
    value: "doing",
    dot: "bg-sky-400",
    activeClasses: "bg-sky-400/20 text-sky-300 ring-1 ring-sky-400/30",
  },
  {
    label: "已完成",
    value: "done",
    dot: "bg-emerald-400",
    activeClasses:
      "bg-emerald-400/20 text-emerald-300 ring-1 ring-emerald-400/30",
  },
  {
    label: "已取消",
    value: "cancelled",
    dot: "bg-slate-400",
    activeClasses:
      "bg-slate-500/20 text-slate-400 ring-1 ring-slate-400/20",
  },
];

/**
 * 获取任务行的显示标题。
 * 优先使用 record_title；如果标题为空则取 record_content 的前几个字（压缩空白后）；
 * 都为空时返回 null，由调用方展示占位符。
 */
function displayTitle(item: UnfinishedTaskItem): string | null {
  if (item.record_title) return item.record_title;
  const content = item.record_content?.replace(/\s+/g, " ").trim();
  return content || null;
}

/**
 * TodoDrawer 组件：从右侧滑入的半屏详情抽屉。
 *
 * 当用户在 TodoOverlay 的任务列表中点击某一行时，该组件被渲染。
 * 它提供标题/内容的行内编辑、任务状态切换、删除确认以及跳转到主面板等功能。
 */
export function TodoDrawer({
  item,
  onClose,
  onUpdateTitle,
  onUpdateContent,
  onUpdateTaskStatus,
  onUpdateDueAt,
}: TodoDrawerProps) {
  // item 不为 null 时抽屉打开，否则不渲染
  const isOpen = item !== null;

  // ── 编辑状态 ──
  const [editingTitle, setEditingTitle] = useState(false);   // 标题是否处于编辑模式
  const [editingContent, setEditingContent] = useState(false); // 内容是否处于编辑模式
  const [titleDraft, setTitleDraft] = useState("");           // 标题编辑中的草稿值
  const [contentDraft, setContentDraft] = useState("");       // 内容编辑中的草稿值

  const [updatingStatus, setUpdatingStatus] = useState(false); // 状态切换请求进行中
  const [showDatePicker, setShowDatePicker] = useState(false); // 日期选择器可见性

  // 标题 input 的 ref，用于自动聚焦
  const titleRef = useRef<HTMLInputElement>(null);
  // 内容 textarea 的 ref，用于自动聚焦
  const contentRef = useRef<HTMLTextAreaElement>(null);
  // 抽屉面板本身的 ref（当前预留，可用于 future 的点击外部判断等逻辑）
  const drawerRef = useRef<HTMLDivElement>(null);

  /**
   * Escape 键关闭抽屉。
   * 仅在抽屉打开时注册键盘监听；用 capture phase 以防被其它处理抢先。
   */
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  /**
   * 当用户点击不同任务时（item 变化），重置所有本地编辑状态，
   * 避免上一个任务的编辑框残留在新任务上。
   */
  useEffect(() => {
    setEditingTitle(false);
    setEditingContent(false);
  }, [item?.record_id]);

  /**
   * 标题编辑模式激活时自动聚焦 input 并全选文字，
   * 方便用户直接覆盖输入。
   */
  useEffect(() => {
    if (editingTitle && titleRef.current) {
      titleRef.current.focus();
      titleRef.current.select();
    }
  }, [editingTitle]);

  /**
   * 内容编辑模式激活时自动聚焦 textarea，
   * 并将光标置于末尾（不 select，适合较长的正文）。
   */
  useEffect(() => {
    if (editingContent && contentRef.current) {
      contentRef.current.focus();
    }
  }, [editingContent]);

  // ── 事件处理函数 ──

  /**
   * 进入标题编辑模式：将当前标题填入草稿，然后显示 input。
   */
  const startEditTitle = useCallback(() => {
    setTitleDraft(item?.record_title ?? "");
    setEditingTitle(true);
  }, [item]);

  /**
   * 进入内容编辑模式：将当前内容填入草稿，然后显示 textarea。
   */
  const startEditContent = useCallback(() => {
    setContentDraft(item?.record_content ?? "");
    setEditingContent(true);
  }, [item]);

  /**
   * 保存标题：退出编辑模式，去除首尾空格后如果变化则调用 onUpdateTitle。
   * 触发时机：blur / Enter 键。
   */
  const saveTitle = useCallback(async () => {
    if (!item) return;
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed === (item.record_title ?? "")) return;
    await onUpdateTitle(item.record_id, trimmed);
  }, [item, titleDraft, onUpdateTitle]);

  /**
   * 保存内容：退出编辑模式，去除首尾空格后如果变化则调用 onUpdateContent。
   * 触发时机：blur（textarea 失去焦点）。
   */
  const saveContent = useCallback(async () => {
    if (!item) return;
    setEditingContent(false);
    const trimmed = contentDraft.trim();
    if (trimmed === (item.record_content ?? "")) return;
    await onUpdateContent(item.record_id, trimmed);
  }, [item, contentDraft, onUpdateContent]);

  /**
   * 切换任务状态。
   * 如果与当前状态相同或已有请求进行中则直接忽略；
   * 请求期间显示 loading 动画（小旋转圆圈），同时禁用按钮以防重复提交。
   */
  const handleStatusChange = useCallback(
    async (status: TaskStatus) => {
      if (!item || updatingStatus) return;
      if (item.task_status === status) return;
      setUpdatingStatus(true);
      try {
        await onUpdateTaskStatus(item.task_id, status);
      } finally {
        setUpdatingStatus(false);
      }
    },
    [item, updatingStatus, onUpdateTaskStatus],
  );

  // item 为空时直接返回 null，不渲染任何内容
  if (!isOpen) return null;

  return (
    <>
      {/*
        CSS 关键帧动画：抽屉从右侧滑入（translateX(100%) → 0），
        背景遮罩从透明渐变为半透明。
        使用 cubic-bezier(0.16, 1, 0.3, 1) 营造略带弹性的自然感。
      */}
      <style>{`
        @keyframes drawer-slide-in {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
        .drawer-panel {
          animation: drawer-slide-in 220ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .drawer-backdrop {
          animation: drawer-backdrop-in 220ms ease-out;
        }
      `}</style>

      {/*
        外层容器：绝对定位铺满整个 Overlay 区域，z-30 使其位于任务列表之上。
        flex 布局让左边的遮罩与右边的面板并排。
      */}
      <div className="absolute inset-0 z-30 flex">
        {/*
          左侧半透明遮罩层。
          点击遮罩区域等同于按 Escape 键——关闭抽屉。
          backdrop-blur-sm 为背景毛玻璃效果。
        */}
        <div
          className="drawer-backdrop flex-1 cursor-pointer bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        />

        {/*
          右侧抽屉面板：固定宽度 340px，不可收缩（shrink-0）。
          半透明深色背景（bg-slate-950/90）加上 backdrop-blur-2xl 毛玻璃。
          左侧细边框用于与遮罩区分。
        */}
        <div
          ref={drawerRef}
          className="drawer-panel flex w-[340px] shrink-0 flex-col overflow-hidden
            border-l border-white/[6%] bg-slate-950/90 backdrop-blur-2xl"
        >
          {/* ── 顶部栏 ── */}
          <div className="flex shrink-0 items-center gap-2 border-b border-white/5 px-4 py-3">
            <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
              编辑
            </span>
            <div className="flex-1" />
            {/*
              手动关闭按钮（X 图标），与 Escape 快捷键效果相同。
            */}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-slate-500 transition hover:bg-white/10 hover:text-slate-200"
            >
              <svg
                className="h-4 w-4"
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

          {/* ── 可滚动内容区域 ── */}
          <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain p-4">
            {/* 标题行（行内编辑） */}
            <section>
              {editingTitle ? (
                <input
                  ref={titleRef}
                  type="text"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={() => void saveTitle()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void saveTitle();
                    }
                    if (e.key === "Escape") {
                      setEditingTitle(false);
                    }
                  }}
                  placeholder="添加标题…"
                  className="w-full rounded-lg border border-white/10 bg-slate-900/80
                    px-3 py-2 text-sm font-medium text-slate-100 outline-none
                    transition focus:border-emerald-400/40 focus:ring-2
                    focus:ring-emerald-400/20"
                />
              ) : (
                <button
                  type="button"
                  onClick={startEditTitle}
                  className="group w-full text-left"
                >
                  <h3 className="text-sm font-medium leading-6 text-slate-200 transition group-hover:text-emerald-300">
                    {displayTitle(item) || (
                      <span className="italic text-slate-500">无标题</span>
                    )}
                  </h3>
                  <span className="mt-0.5 block text-[10px] text-slate-600 opacity-0 transition group-hover:opacity-100">
                    点击编辑
                  </span>
                </button>
              )}
            </section>

            {/* 任务状态切换 */}
            <section>
              <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
                任务状态
              </p>
              <div className="flex flex-wrap gap-1.5">
                {STATUS_OPTIONS.map((opt) => {
                  const isActive = item.task_status === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => void handleStatusChange(opt.value)}
                      disabled={updatingStatus || isActive}
                      className={`
                        inline-flex items-center gap-1.5 rounded-full px-3 py-1.5
                        text-xs font-medium transition-all duration-150
                        ${
                          isActive
                            ? opt.activeClasses
                            : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200"
                        }
                        disabled:cursor-not-allowed disabled:opacity-60
                      `}
                    >
                      {/*
                        状态指示圆点：激活时全不透明，非激活时半透明。
                      */}
                      <span
                        className={`inline-block h-1.5 w-1.5 rounded-full ${isActive ? opt.dot : `${opt.dot} opacity-40`}`}
                      />
                      {opt.label}
                      {/*
                        状态切换进行中：在当前激活的按钮内显示一个旋转圆圈。
                      */}
                      {updatingStatus && isActive && (
                        <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" />
                      )}
                    </button>
                  );
                })}
              </div>
            </section>

            {/**
              * ── 截止日期 ──
              * 点击日期按钮展开/收起 DatePicker 日历组件。
              * 选择日期后调用 onUpdateDueAt 保存，传 null 清除。
              * 显示文字根据到期情况自动变色：过期=红，3天内=橙，未来=灰。
              */}
            <section>
              <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
                截止日期
              </p>
              {(() => {
                /**
                 * 将 "YYYY-MM-DD" 字符串解析为中文本地化显示，附带颜色编码。
                 * - 已过期：玫瑰色（text-rose-400）
                 * - 今天/3天内：琥珀色（text-amber-400）
                 * - 未来：默认灰色（text-slate-500）
                 */
                function getDueDisplay(dueAt: string | null): {
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

                const dueInfo = item.due_at ? getDueDisplay(item.due_at) : null;

                return (
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowDatePicker((v) => !v)}
                      className="flex w-full items-center gap-2 rounded-lg border border-white/10
                        bg-slate-900/80 px-3 py-2 text-sm transition
                        hover:border-white/20"
                    >
                      {/* 日历图标 */}
                      <svg
                        className="h-4 w-4 shrink-0 text-slate-500"
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

                      {dueInfo ? (
                        <span className={`${dueInfo.className}`}>{dueInfo.display}</span>
                      ) : (
                        <span className="italic text-slate-500">未设置</span>
                      )}

                      <div className="flex-1" />

                      {/* 展开/收起箭头 */}
                      <svg
                        className={`h-3.5 w-3.5 text-slate-500 transition-transform duration-200 ${
                          showDatePicker ? "rotate-180" : ""
                        }`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                      </svg>
                    </button>

                    {showDatePicker && (
                      <div className="mt-2">
                        <DatePicker
                          value={item.due_at ? (() => {
                            // new Date() 而非 split("-")：后端返回 RFC 3339 格式
                            // ("2026-06-14T00:00:00Z")，split 会产出 NaN。
                            const d = new Date(item.due_at);
                            return isNaN(d.getTime()) ? null : d;
                          })() : null}
                          onChange={(date) => {
                            const y = date.getFullYear();
                            const m = String(date.getMonth() + 1).padStart(2, "0");
                            const day = String(date.getDate()).padStart(2, "0");
                            const dateStr = `${y}-${m}-${day}`;
                            void onUpdateDueAt(item.record_id, item.task_id, dateStr);
                            setShowDatePicker(false);
                          }}
                          onClear={() => {
                            void onUpdateDueAt(item.record_id, item.task_id, null);
                            setShowDatePicker(false);
                          }}
                        />
                      </div>
                    )}
                  </div>
                );
              })()}
            </section>

            {/* 内容编辑区 */}
            <section>
              <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
                内容
              </p>
              {editingContent ? (
                <textarea
                  ref={contentRef}
                  value={contentDraft}
                  onChange={(e) => setContentDraft(e.target.value)}
                  onBlur={() => void saveContent()}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setEditingContent(false);
                    }
                  }}
                  placeholder="添加内容…"
                  rows={4}
                  className="w-full resize-none rounded-lg border border-white/10
                    bg-slate-900/80 px-3 py-2 text-sm leading-6 text-slate-100
                    outline-none transition focus:border-emerald-400/40
                    focus:ring-2 focus:ring-emerald-400/20"
                />
              ) : (
                <button
                  type="button"
                  onClick={startEditContent}
                  className="group w-full text-left"
                >
                  {item.record_content ? (
                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300 transition group-hover:text-slate-200">
                      {item.record_content}
                    </p>
                  ) : (
                    <p className="text-sm italic leading-6 text-slate-500">
                      无内容
                    </p>
                  )}
                  <span className="mt-0.5 block text-[10px] text-slate-600 opacity-0 transition group-hover:opacity-100">
                    点击编辑
                  </span>
                </button>
              )}
            </section>

            {/* 附件区域（占位实现） */}
            <section>
              <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
                附件
              </p>
              <div
                className="rounded-xl border border-dashed border-white/[8%] p-4
                  text-center transition hover:border-white/[15%]"
              >
                {item.attachment_count > 0 ? (
                  <p className="text-xs text-slate-400">
                    共 {item.attachment_count} 个附件
                  </p>
                ) : (
                  <p className="text-xs text-slate-500">暂无附件</p>
                )}
                {/*
                  添加附件按钮——当前为占位，文件选择器将在后续任务中接入。
                  计划通过 lib/tauri 的 addAttachmentsToRecord 实现。
                */}
                <button
                  type="button"
                  className="mt-2 inline-flex items-center gap-1 rounded-lg
                    bg-white/[5%] px-3 py-1.5 text-[11px] text-slate-400
                    transition hover:bg-white/[10%] hover:text-slate-200"
                  onClick={() => {
                    // Placeholder — file picker will be wired in a later task
                    // using addAttachmentsToRecord from lib/tauri
                  }}
                >
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
                      d="M12 4.5v15m7.5-7.5h-15"
                    />
                  </svg>
                  添加附件
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
