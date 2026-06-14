/**
 * Todo 叠加层状态管理（Zustand Store）
 *
 * 负责管理桌面悬浮的 Todo 待办事项面板的全部状态，包括：
 * - 从 Tauri 后端获取未完成任务列表
 * - 完成任务（含淡出动画效果）
 * - 删除任务
 * - 侧边抽屉的打开/关闭
 * - 面板折叠/展开
 */

import { create } from "zustand";

import {
  listUnfinishedTasks,     // 列出所有未完成的任务
  removeTask as removeTaskCommand, // 删除指定任务（不删除关联的记录）
  updateTaskStatus,        // 更新任务状态（用于标记为完成）
} from "../lib/tauri";
import type { UnfinishedTaskItem } from "../types";

/** Todo 叠加层的完整状态与操作接口 */
interface TodoOverlayState {
  // ────────────────────────────── 状态字段 ──────────────────────────────

  /**
   * 从后端获取的未完成任务列表。
   * 由 `fetchItems()` 填充，在完成任务（2秒淡出后）或删除任务时移除对应项。
   */
  items: UnfinishedTaskItem[];

  /**
   * 面板是否处于折叠（收起）状态。
   * 为 `true` 时只显示标题栏，内容区域隐藏；为 `false` 时展开显示全部任务。
   */
  collapsed: boolean;

  /**
   * 当前在侧边抽屉中打开的记录 ID。
   * 当用户点击某个任务时，将该任务关联的 recordId 赋值于此，抽屉随之打开。
   * 为 `null` 表示抽屉关闭。
   */
  drawerRecordId: string | null;

  /**
   * 正在执行淡出动画的任务 ID 集合。
   * 当用户点击"完成"时，任务先加入此集合触发 CSS 淡出过渡，
   * 2 秒后自动从集合中移除并从 `items` 列表中删除。
   */
  fadingTaskIds: string[];

  /**
   * 是否正在执行后端操作（加载中）。
   * 在发起请求前设为 `true`，请求完成（无论成败）后设回 `false`。
   */
  loading: boolean;

  /**
   * 上一次后端操作产生的错误信息，无错误时为 `null`。
   * 每次发起新操作前会被重置为 `null`。
   */
  error: string | null;

  // ────────────────────────────── 操作方法 ──────────────────────────────

  /**
   * 从 Tauri 后端获取所有未完成的任务。
   *
   * 调用 `listUnfinishedTasks()` API 获取数据，成功后存入 `items`。
   * 任何异常将被捕获并写入 `error` 字段。
   */
  fetchItems: () => Promise<void>;

  /**
   * 将指定任务标记为"已完成"。
   *
   * 流程：
   * 1. 调用 `updateTaskStatus(taskId, "done")` 通知后端更新状态
   * 2. 将任务 ID 加入 `fadingTaskIds`，触发 UI 层的淡出动画
   * 3. 启动 2 秒定时器，到期后从 `items` 和 `fadingTaskIds` 中同时移除
   *
   * 这样设计是为了给用户一个视觉反馈——任务不会瞬间消失，而是先淡出再移除。
   */
  completeTask: (taskId: string) => Promise<void>;

  /**
   * 从后端删除指定任务（保留其关联的录像记录）。
   *
   * 调用 `removeTask()` API 删除任务行，成功后立即将任务从 `items` 列表
   * 和 `fadingTaskIds`（如果正在淡出）中移除，没有动画过渡。
   */
  removeTask: (taskId: string) => Promise<void>;

  /**
   * 打开侧边抽屉，显示指定记录 ID 对应的详情。
   *
   * @param recordId - 要展示的记录 ID
   */
  openDrawer: (recordId: string) => void;

  /** 关闭侧边抽屉，将 `drawerRecordId` 重置为 `null`。 */
  closeDrawer: () => void;

  /**
   * 切换面板的折叠/展开状态。
   * 内部将 `collapsed` 取反。配合 CSS 过渡实现平滑折叠动画。
   */
  toggleCollapse: () => void;

  /** 清除错误信息（仅在当前存在错误时执行）。 */
  clearError: () => void;
}

/**
 * Todo 叠加层 Zustand Store。
 *
 * 使用 `create<TodoOverlayState>` 创建，所有状态和操作方法集中定义于此。
 * 消费方通过在组件中调用 `useTodoOverlayStore(selector)` 获取所需状态。
 */
export const useTodoOverlayStore = create<TodoOverlayState>((set, get) => ({
  // ── 初始状态 ──
  items: [],                  // 初始为空，首次渲染后由 fetchItems() 填充
  collapsed: false,           // 默认展开
  drawerRecordId: null,       // 默认关闭抽屉
  fadingTaskIds: [],          // 默认无任务处于淡出动画中
  loading: false,             // 默认非加载状态
  error: null,                // 默认无错误

  // ─────────────────────── fetchItems ───────────────────────

  /**
   * 从 Tauri 后端获取未完成任务列表。
   * 调用 `listUnfinishedTasks()` 命令，成功后将返回的数组赋值给 `items`。
   * 失败时捕获异常并将错误消息写入 `error` 字段。
   */
  async fetchItems() {
    set({ loading: true, error: null });
    try {
      const items = await listUnfinishedTasks();
      set({ items, loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  // ─────────────────────── completeTask ───────────────────────

  /**
   * 完成任务——两步走策略：先淡出、再移除。
   *
   * 详细时序：
   * 1. 设置 loading = true，发起后端请求 `updateTaskStatus(taskId, "done")`
   * 2. 后端返回成功后，将 taskId 推入 `fadingTaskIds`，loading 恢复 false
   * 3. 前端 CSS 检测到 `fadingTaskIds` 包含该 ID，触发该行的 opacity 过渡动画
   * 4. 2 秒后定时器回调执行：从 `items` 中删除该任务，从 `fadingTaskIds` 中移除 ID
   *
   * 如果在第 1 步请求失败，则不触发淡出，直接设置 error 信息。
   */
  async completeTask(taskId) {
    set({ loading: true, error: null });
    try {
      await updateTaskStatus(taskId, "done");
      // 将任务 ID 加入淡出集合，触发 UI 层的淡出动画
      set((state) => ({
        fadingTaskIds: [...state.fadingTaskIds, taskId],
        loading: false,
      }));
      // 2 秒后从列表和淡出集合中同时移除
      setTimeout(() => {
        set((state) => ({
          items: state.items.filter((item) => item.task_id !== taskId),
          fadingTaskIds: state.fadingTaskIds.filter((id) => id !== taskId),
        }));
      }, 2000);
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  // ─────────────────────── removeTask ───────────────────────

  /**
   * 删除任务——立即移除，无动画。
   *
   * 调用 `removeTask(taskId)` 后端命令删除该任务行，
   * 成功后直接从 `items` 中过滤掉该任务（此时可能也正在淡出，
   * 因此同时清理 `fadingTaskIds` 中对应的 ID）。
   * 与 `completeTask` 不同，这里没有淡出延迟——删除是即时生效的。
   */
  async removeTask(taskId) {
    set({ loading: true, error: null });
    try {
      await removeTaskCommand(taskId);
      set((state) => ({
        items: state.items.filter((item) => item.task_id !== taskId),
        fadingTaskIds: state.fadingTaskIds.filter((id) => id !== taskId),
        loading: false,
      }));
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  // ─────────────────────── openDrawer ───────────────────────

  /**
   * 打开侧边抽屉并加载指定记录。
   * 将 `drawerRecordId` 设为传入的 `recordId`，
   * 组件中监听该字段变化的逻辑会触发对应记录的详情加载。
   */
  openDrawer(recordId) {
    set({ drawerRecordId: recordId });
  },

  // ─────────────────────── closeDrawer ───────────────────────

  /**
   * 关闭侧边抽屉。
   * 将 `drawerRecordId` 重置为 `null`，组件据此隐藏抽屉面板。
   */
  closeDrawer() {
    set({ drawerRecordId: null });
  },

  // ─────────────────────── toggleCollapse ───────────────────────

  /**
   * 切换面板的折叠/展开状态。
   * 将 `collapsed` 布尔值取反，配合 CSS transition 实现折叠动画。
   */
  toggleCollapse() {
    set((state) => ({ collapsed: !state.collapsed }));
  },

  // ─────────────────────── clearError ───────────────────────

  /**
   * 清除当前错误信息。
   * 仅在 `error` 当前不为 `null` 时执行 set，避免不必要的重渲染。
   */
  clearError() {
    if (get().error) {
      set({ error: null });
    }
  },
}));
