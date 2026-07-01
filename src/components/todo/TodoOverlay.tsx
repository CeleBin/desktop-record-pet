/*
 * TodoOverlay.tsx — 待办事项浮窗组件
 *
 * 功能概述：
 * 这是应用在桌面上独立显示的「待办列表浮窗」。它作为一个独立
 * 的 WebView 窗口运行，通过 Zustand store 与主应用共享状态。
 * 窗口支持拖拽移动（顶部栏区域）和缩放（右下角拖拽手柄），
 * 并从 Tauri 后端监听 "data-changed" 事件以实现数据实时同步。
 *
 * 交互状态机：
 *   collapsed（折叠/展开 toggle）、loading（首次加载 loading
 *   动画）、empty（空列表提示）、列表（正常条目渲染）、Drawer
 *   （侧边详情面板）、fading（完成任务后的淡出动画）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// Tauri 的全局事件监听 API，用于接收后端 Rust 发来的数据变更通知
import { listen } from "@tauri-apps/api/event";
// 获取当前 WebView 窗口实例（用于拖拽、设置尺寸等原生窗口操作）
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
// 逻辑像素单位包装类型，用于设置窗口大小时无需关心系统缩放比
import { LogicalSize } from "@tauri-apps/api/dpi";
// dnd-kit：拖拽排序核心 + 传感器
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

// Tauri 后端命令封装：删除记录、打开主面板、更新记录、更新任务状态
import {
  showMainPanel,
  updateRecord,
  updateTaskStatus,
  updateTaskRepeatRule,
} from "../../lib/tauri";
// Zustand 状态管理：todoOverlay store 持有浮窗的条目、折叠态、Drawer 等
import { useTodoOverlayStore } from "../../store/todoOverlay";
// Zustand 状态管理：settings store 用于读取背景透明度、字号等配置
import { useSettingsStore } from "../../store/settings";
import type { TaskStatus, UnfinishedTaskItem } from "../../types";
// 子组件：详情 Drawer、单条待办条目、分类区块、分类管理器
import { TodoDrawer } from "./TodoDrawer";
import { SortableTodoItem } from "./SortableTodoItem";
import { CategorySection } from "./CategorySection";
import { CategoryManager } from "./CategoryManager";
import { useFolderStore } from "../../store/folderStore";

// 当前 WebView 窗口的单例缓存（模块级），避免每次调用都重新获取
const appWindow = getCurrentWebviewWindow();
// 数据变更事件名常量，与 Rust 后端约定一致
const DATA_CHANGED_EVENT = "data-changed";

export function TodoOverlay() {
  /*
   * 从 Zustand store 解构出所有状态和动作。
   *
   * items          – 当前待办任务数组（每条包含 record_id、task_id、title、content、status 等）
   * collapsed      – 是否折叠（折叠后仅显示顶栏，隐藏列表）
   * drawerRecordId – 当前打开的 Drawer 对应的 record_id，null 表示 Drawer 关闭
   * fadingTaskIds  – 正在播放"完成淡出"动画的任务 ID 集合（2 秒后自动移除）
   * loading        – 是否正在从后端拉取数据
   * error          – 错误信息字符串，非空时渲染错误条
   * fetchItems     – 异步拉取最新待办列表
   * completeTask   – 标记任务完成（将任务加入 fadingTaskIds，2s 后再实际移除）
   * removeTask     – 从 UI 列表中移除任务（配合后端删除或状态变更）
   * openDrawer     – 打开指定记录的 Drawer 详情面板
   * closeDrawer    – 关闭 Drawer
   * toggleCollapse – 切换折叠/展开状态
   * clearError     – 清空错误信息
   */
  const {
    items,
    collapsed,
    drawerRecordId,
    fadingTaskIds,
    loading,
    error,
    fetchItems,
    completeTask,
    removeTask: removeTaskAction,
    openDrawer,
    closeDrawer,
    toggleCollapse,
    clearError,
    updateDueAt,
    reorderItems,
    collapsedFolders,
    toggleFolderCollapse,
  } = useTodoOverlayStore();

  // ── 分类 store ──
  const {
    folders,
    fetchFolders,
    createFolder,
    renameFolder,
    deleteFolder,
    moveTask,
    reorderFolders,
  } = useFolderStore();

  // 分类管理浮层显示状态
  const [showCategoryManager, setShowCategoryManager] = useState(false);

  // ── 从 settings 读取遮罩背景透明度 (0.0–1.0，默认 0.8) ──
  // 从存设置中获取原始字符串值，做安全解析，若非法则回退到 0.8
  const opacityRaw = useSettingsStore((s) => s.settings["todo_overlay_opacity"]);
  const overlayBgOpacity = Math.min(1, Math.max(0, Number.parseFloat(opacityRaw ?? "0.8") || 0.8));

  // ── dnd-kit 拖拽传感器 ──
  // 使用 PointerSensor 检测拖拽（支持鼠标和触摸）
  // activationConstraint.distance = 5px 防止误触（点击不会触发拖拽）
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  // ── 拖拽结束回调 ──
  // 判断目标：如果是分类 droppable → 移动任务到该分类；否则 → 同列表内排序
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;
      const activeId = String(active.id);
      const overId = String(over.id);

      // 跨分类拖拽：拖到分类 droppable 上
      if (overId.startsWith("folder-")) {
        const targetFolderId = overId.replace("folder-", "");
        const item = items.find((i) => i.task_id === activeId);
        if (item && item.folder_id !== targetFolderId) {
          void moveTask(activeId, targetFolderId);
          void fetchItems();
        }
        return;
      }

      // 拖到未分类区域
      if (overId === "__uncategorized__") {
        const item = items.find((i) => i.task_id === activeId);
        if (item && item.folder_id !== null) {
          void moveTask(activeId, null);
          void fetchItems();
        }
        return;
      }

      // 同列表内排序
      if (active.id !== over.id) {
        reorderItems(activeId, overId);
      }
    },
    [items, moveTask, fetchItems, reorderItems],
  );

  // ── 组件挂载时立即拉取一次待办列表和分类列表 ──
  useEffect(() => {
    void fetchItems();
    void fetchFolders();
  }, [fetchItems, fetchFolders]);

  // ── 监听后端 Rust 发出的 "data-changed" 事件，有变更时重新拉取 ──
  // 这样在其他窗口（如主面板）修改了数据后浮窗能自动刷新
  useEffect(() => {
    const unlistenPromise = listen(DATA_CHANGED_EVENT, () => {
      void fetchItems();
      void fetchFolders();
    });
    return () => {
      // 清理：解除事件监听，防止内存泄漏
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [fetchItems]);

  // ── 错误信息 4 秒后自动消失 ──
  // 当 error 非空时设置定时器，超时后调用 clearError 清空
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => clearError(), 4000);
    return () => clearTimeout(timer);
  }, [error, clearError]);

  // ── 内容容器 ref，用于动态测量 DOM 尺寸 ──
  // 通过 getBoundingClientRect() 获取容器折叠/展开后的真实物理渲染尺寸
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Header ref，用于折叠时精确测量仅显示的头部尺寸 ──
  const headerRef = useRef<HTMLDivElement>(null);

  // ── 保存展开时的窗口尺寸，折叠前记录，展开时恢复 ──
  // 展开时存在"鸡生蛋"问题：视口仍为折叠宽度，无法直接测量展开后的自然宽度
  // 因此折叠前先保存当前窗口尺寸，展开时直接恢复保存值
  const expandedSizeRef = useRef<{ width: number; height: number } | null>(null);

  // ── 折叠/展开时自动调整窗口尺寸 ──
  // 折叠：根 div 添加 w-fit 使宽度塌缩到内容自然宽度，
  //        然后测量 header 的 getBoundingClientRect 即可得到真实窄宽度
  // 展开：先恢复保存的窗口尺寸（宽度为用户之前的展开宽度），
  //        再设置最小尺寸约束
  useEffect(() => {
    const adjustSize = async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));

      if (collapsed && headerRef.current) {
        // 折叠前保存当前窗口尺寸，以便展开时恢复
        expandedSizeRef.current = {
          width: window.innerWidth,
          height: window.innerHeight,
        };

        // w-fit 使根 div 宽度塌缩到 header 自然内容宽度
        // 此时 getBoundingClientRect().width 返回真实窄宽度（而非铺满视口的宽度）
        const rect = headerRef.current.getBoundingClientRect();
        const width = Math.round(rect.width);
        const height = Math.round(rect.height);

        console.log(`[collapse] collapsed=true, measured header: ${width}x${height}`);

        await appWindow.setMinSize(new LogicalSize(0, 0));
        await appWindow.setSize(new LogicalSize(width, height));

        console.log(`[collapse] window resized to header size: ${width}x${height}`);
      } else if (!collapsed) {
        // 展开时恢复之前保存的窗口尺寸（或回退到默认 360×500）
        const saved = expandedSizeRef.current || { width: 360, height: 500 };

        console.log(`[collapse] collapsed=false, restoring saved size: ${saved.width}x${saved.height}`);

        await appWindow.setMinSize(new LogicalSize(280, 300));
        await appWindow.setSize(new LogicalSize(saved.width, saved.height));
      }
    };

    void adjustSize();
  }, [collapsed]);

  // ── 异步回调帮助函数 ──
  // 这些回调经由 useCallback 记忆化后传递给 TodoItem 和 TodoDrawer 子组件，
  // 避免子组件因回调引用变化而无效重渲染。

  // 更新记录标题：调用 Tauri 的 updateRecord 后端命令，再刷新列表
  const handleUpdateTitle = useCallback(
    async (recordId: string, title: string) => {
      await updateRecord(recordId, { title: title || null });
      await fetchItems();
    },
    [fetchItems],
  );

  // 更新记录内容：与 handleUpdateTitle 类似，但操作的是 content 字段
  const handleUpdateContent = useCallback(
    async (recordId: string, content: string) => {
      await updateRecord(recordId, { content: content || null });
      await fetchItems();
    },
    [fetchItems],
  );

  // 更新任务状态（如 pending / completed）并刷新列表
  const handleUpdateTaskStatus = useCallback(
    async (taskId: string, status: TaskStatus) => {
      await updateTaskStatus(taskId, status);
      await fetchItems();
    },
    [fetchItems],
  );

  // 更新任务重复规则
  const handleUpdateRepeatRule = useCallback(
    async (taskId: string, repeatRule: string | null) => {
      await updateTaskRepeatRule(taskId, repeatRule);
      await fetchItems();
    },
    [fetchItems],
  );

  // ── 派生数据 ──
  // 根据 drawerRecordId 从 items 中找到对应的记录对象，
  // 找不到或 drawerRecordId 为 null 时 drawerItem 为 null
  const drawerItem = drawerRecordId
    ? items.find((i) => i.record_id === drawerRecordId) ?? null
    : null;

  // ── 顶部拖拽区域鼠标按下处理 ──
  // 调用 Tauri 的 startDragging() 让操作系统接管窗口拖拽，
  // 从而实现原生拖拽体验。仅响应左键（button === 0）。
  // 如果点击目标是按钮（button 或其子元素），则跳过拖拽，让按钮的 click 事件正常触发。
  const handleDragMouseDown = useCallback(
    async (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      // 检查点击目标是否是按钮、输入框或它们的子元素
      const target = e.target as HTMLElement;
      if (target.closest('button, input, textarea')) return;
      e.preventDefault();
      await appWindow.startDragging();
    },
    [],
  );

  // ── 右下角缩放手柄鼠标按下处理 ──
  //
  // 实现原理：
  // 1. mousedown 时记录鼠标起始位置和窗口起始尺寸
  // 2. 监听全局 mousemove 计算宽高增量，调用 appWindow.setSize() 实时调整
  // 3. mouseup 时解除监听完成缩放
  // 4. 最小值限制 MIN_W=280 / MIN_H=300 防止窗口过小
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const startW = window.innerWidth;
      const startH = window.innerHeight;
      const MIN_W = 280;
      const MIN_H = 300;

      const handleMouseMove = (ev: MouseEvent) => {
        const newW = Math.max(MIN_W, startW + ev.clientX - startX);
        const newH = Math.max(MIN_H, startH + ev.clientY - startY);
        void appWindow.setSize(new LogicalSize(Math.round(newW), Math.round(newH)));
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [],
  );

  // ── 按 folder_id 分组 ──
  const groupedByFolder = useMemo(() => {
    const map: Record<string, typeof items> = {};
    for (const item of items) {
      const key = item.folder_id ?? "__uncategorized__";
      if (!map[key]) map[key] = [];
      map[key].push(item);
    }
    return map;
  }, [items]);

  // ── 每个分类下的任务数（用于 CategoryManager） ──
  const taskCountByFolder = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of folders) {
      counts[f.id] = (groupedByFolder[f.id] || []).length;
    }
    return counts;
  }, [folders, groupedByFolder]);

  // ── 未分类的任务 ──
  const uncategorizedItems = groupedByFolder["__uncategorized__"] || [];

  // ── Render ──

  /*
   * 渲染结构（从上到下）：
   *   1. 遮罩背景（半透明毛玻璃效果，点击穿透）
   *   2. 内容容器（z-10 确保在遮罩之上）
   *      a. 错误提示条（条件渲染）
   *      b. 顶栏 / 拖拽区域（含折叠 toggle、标题、主面板按钮）
   *      c. 列表区域（loading / empty / task list 三态条件渲染）
   *      d. Drawer 侧边面板（条件渲染）
   *   3. 原生缩放拖拽手柄（右下角，z-50 保证在最上层）
   *
   * 注意：非折叠时使用 h-screen 填充窗口高度，折叠时使用 w-fit 收缩。
   */
  return (
    <div className={`relative flex flex-col overflow-hidden${collapsed ? " w-fit" : " h-screen"}`}>
      {/* ── 半透明遮罩背景 ── */}
      {/*
        使用 backdrop-blur-xl 毛玻璃效果模糊背后内容；
        pointer-events-none 使点击穿透到下方，只有内部控件才能响应交互。
        颜色使用 settings 中 todo_overlay_opacity 控制透明度。
      */}
      <div
        className="pointer-events-none absolute inset-0 backdrop-blur-xl"
        style={{ backgroundColor: `rgba(2, 6, 23, ${overlayBgOpacity})` }}
      />

      {/* ── 内容层（完全不透明，文字和控件保持清晰可读） ── */}
      {/* ref={containerRef} 用于展开时动态测量 DOM 尺寸 */}
      {/* 不设 h-screen，容器高度由子元素自然决定；折叠时列表被条件渲染卸载，高度自动塌陷 */}
      <div
        ref={containerRef}
        className={`relative z-10 flex flex-col overflow-hidden${collapsed ? "" : " flex-1"}`}
      >
        {/* ── 错误提示条 ── */}
        {/*
          当 store 中 error 不为空时渲染：
          左侧为感叹号图标，中间显示错误文本，右侧为关闭按钮。
          4 秒后自动消失（见上方 useEffect 自动定时器）。
        */}
      {error && (
        <div className="flex shrink-0 items-center gap-2 border-b border-danger/10 bg-danger/10 px-3 py-1.5">
          <svg
            className="h-3 w-3 shrink-0 text-danger"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118
                0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
          <span className="flex-1 text-[11px] text-danger">{error}</span>
          <button
            type="button"
            onClick={clearError}
            className="text-danger/60 transition hover:text-danger"
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      )}

      {/* ── 顶栏 / 拖拽区域 ── */}
      {/*
        cursor-grab / active:cursor-grabbing 提示用户可拖拽；
        select-none 防止拖拽时选中文字；
        onMouseDown 调用 Tauri startDragging() 实现原生窗口拖拽。
        ref={headerRef} 用于折叠时精确测量头部尺寸。
      */}
      <div
        ref={headerRef}
        className="flex shrink-0 cursor-grab select-none items-center gap-2 px-3 py-2 active:cursor-grabbing"
        onMouseDown={handleDragMouseDown}
      >
        {/* ── 折叠/展开切换按钮 ── */}
        {/*
          点击触发 toggleCollapse；SVG 箭头在 collapsed 时旋转 -90°
          指示"当前可以展开"；title 属性根据状态展示不同的中文提示。
        */}
        <button
          type="button"
          onClick={toggleCollapse}
          className="rounded-lg p-1 text-text0 transition hover:bg-white/10 hover:text-text"
          title={collapsed ? "展开" : "折叠"}
        >
          <svg
            className="h-4 w-4 transition-transform duration-200"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.5 8.25l-7.5 7.5-7.5-7.5"
            />
          </svg>
        </button>

        {/*
          "待办"标题文字：小号大写字母间距，保持与整体 UI 风格一致
        */}
        <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-text0">
          待办
        </span>
        {/*
          当列表展开且 item 数量 > 0 时，在标题旁显示条目计数
        */}
        {!collapsed && items.length > 0 && (
          <span className="text-[10px] text-text-muted">
            {items.length} 项
          </span>
        )}

{/* flex-1 占位空间将后续按钮推到右侧（折叠时隐藏） */}
        {!collapsed && <div className="flex-1" />}

        {/* ── 分类管理按钮 ── */}
        {!collapsed && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowCategoryManager(!showCategoryManager)}
            className="rounded-lg p-1 text-text0 transition hover:bg-white/10 hover:text-text"
            title="分类管理"
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
                d="M12 10.5v6m3-3H9m4.06-7.19l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12A2.25 2.25 0 004.5 20.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
              />
            </svg>
          </button>
          {showCategoryManager && (
            <CategoryManager
              folders={folders}
              taskCountByFolder={taskCountByFolder}
              onCreate={async (name) => {
                await createFolder(name);
                await fetchItems();
              }}
              onRename={async (id, name) => {
                await renameFolder(id, name);
                await fetchItems();
              }}
              onDelete={async (id) => {
                await deleteFolder(id);
                await fetchItems();
              }}
              onReorder={reorderFolders}
              onClose={() => setShowCategoryManager(false)}
            />
          )}
        </div>
        )}

        {/* ── "打开主面板"按钮（折叠时隐藏，仅保留折叠按钮和标题） ── */}
        {!collapsed && (
        <button
          type="button"
          onClick={() => void showMainPanel()}
          className="rounded-lg p-1 text-text0 transition hover:bg-white/10 hover:text-text"
          title="打开主面板"
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
              d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75
                20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5
                0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"
            />
          </svg>
        </button>
        )}
      </div>

      {/* ── 待办列表区域（仅在 collapsed 为 false 时渲染） ── */}
      {/*
        overflow-y-auto 支持纵向滚动；
        overscroll-contain 防止在浮窗中滚动时触发父窗口（如主面板）滚动。
      */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {/*
            三态条件渲染：
              1. loading 且 items 为空 → 旋转加载动画（首次加载）
              2. 列表为空 → 空状态提示
              3. 有数据 → TodoItem 列表
          */}
          {loading && items.length === 0 ? (
            /* ── 加载中状态：旋转圆圈动画 ── */
            /* 利用 border 模拟圆环，border-t-* 只给顶部着色实现旋转加载效果 */
            <div className="flex items-center justify-center py-12">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-secondary/30 border-t-secondary" />
            </div>
          ) : items.length === 0 ? (
            /* ── 空状态 ── */
            /* 居中显示文档图标和两行提示文字，告知用户当前没有待办事项 */
            <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-2/40">
                <svg
                  className="h-5 w-5 text-text0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12h3.75M9 15h3.75M9 18h3.75m3
                      .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424
                      48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0
                      .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0
                      00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0
                      1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095
                      4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621
                      0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125
                      1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75
                      12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0
                      3h.008v.008H6.75V18z"
                  />
                </svg>
              </div>
              <p className="text-sm text-text0">暂无待办事项</p>
              <p className="mt-1 text-xs text-text-muted">所有任务已完成</p>
            </div>
          ) : (
            /* ── 任务列表（按分类分组，可拖拽排序） ── */
            /* DndContext + SortableContext 提供拖拽排序能力 */
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={items.map((i) => i.task_id)} strategy={verticalListSortingStrategy}>
                <div className="divide-y divide-white/[3%]">
                  {/* 有分类的任务 — 按文件夹 sort_order 排列，始终显示所有分类 */}
                  {folders.map((folder) => {
                    const folderItems = groupedByFolder[folder.id] || [];
                    return (
                      <CategorySection
                        key={folder.id}
                        folderName={folder.name}
                        folderId={folder.id}
                        items={folderItems}
                        isCollapsed={collapsedFolders.has(folder.id)}
                        onToggleCollapse={() => toggleFolderCollapse(folder.id)}
                        isFading={(taskId) => fadingTaskIds.includes(taskId)}
                        onToggleComplete={completeTask}
                        onOpen={openDrawer}
                        onRemoveTask={removeTaskAction}
                      />
                    );
                  })}

                  {/* 分隔线（有分类且有未分类任务时显示） */}
                  {folders.length > 0 && (
                    <div className="border-t border-border" />
                  )}

                  {/* 未分类任务（始终显示为 droppable 区域） */}
                  <UncategorizedDropZone
                    items={uncategorizedItems}
                    isFading={(taskId) => fadingTaskIds.includes(taskId)}
                    onToggleComplete={completeTask}
                    onOpen={openDrawer}
                    onRemoveTask={removeTaskAction}
                  />
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      )}

      {/* ── Drawer 侧边面板 ── */}
      {/*
        当 drawerRecordId 不为 null 时渲染 TodoDrawer 组件。
        该组件在浮窗右侧弹出一个详情面板，用于查看和编辑单条记录的
        标题、内容、任务状态等。
        drawerItem 可能为 null（记录未找到），TodoDrawer 内部需做空处理。
      */}
      {drawerRecordId && (
        <TodoDrawer
          item={drawerItem}
          onClose={closeDrawer}
          onUpdateTitle={handleUpdateTitle}
          onUpdateContent={handleUpdateContent}
          onUpdateTaskStatus={handleUpdateTaskStatus}
          onUpdateDueAt={updateDueAt}
          onUpdateRepeatRule={handleUpdateRepeatRule}
        />
      )}

      {/* ── 原生缩放拖拽手柄（右下角） ── */}
      {/*
        absolute bottom-0 right-0 固定定位到容器右下角；
        z-50 确保手柄在所有内容之上；
        cursor-se-resize 指示 southeast 方向缩放；
        onMouseDown 触发 handleResizeMouseDown 开始缩放逻辑。
        SVG 为两条斜线组成的"缩放"图标，和 macOS 窗口缩放手势一致。
      */}
      {!collapsed && (
      <div
        className="absolute bottom-0 right-0 z-50 cursor-se-resize select-none p-1.5 text-text-muted/40 hover:text-text-muted/70 transition-colors"
        onMouseDown={handleResizeMouseDown}
      >
        <svg
          className="h-3 w-3"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
        >
          <path d="M11 3L3 11" />
          <path d="M11 7L7 11" />
        </svg>
      </div>
      )}
    </div>
  </div>
  );
}

// ── 未分类区域的 droppable 包装组件 ──
function UncategorizedDropZone({
  items,
  isFading,
  onToggleComplete,
  onOpen,
  onRemoveTask,
}: {
  items: UnfinishedTaskItem[];
  isFading: (taskId: string) => boolean;
  onToggleComplete: (taskId: string) => void;
  onOpen: (recordId: string) => void;
  onRemoveTask: (taskId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "__uncategorized__" });

  return (
    <div
      ref={setNodeRef}
      className={`${isOver ? "bg-secondary/10 ring-1 ring-secondary/30" : ""}`}
    >
      {items.length === 0 && (
        <p className="px-3 py-2 text-[11px] text-text-muted">拖拽任务到这里移除分类</p>
      )}
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
  );
}
