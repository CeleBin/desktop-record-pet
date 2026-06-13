import { create } from "zustand";

import {
  listUnfinishedTasks,
  removeTask as removeTaskCommand,
  updateTaskStatus,
} from "../lib/tauri";
import type { UnfinishedTaskItem } from "../types";

interface TodoOverlayState {
  /** Unfinished tasks fetched from backend */
  items: UnfinishedTaskItem[];
  /** Whether the overlay panel is collapsed */
  collapsed: boolean;
  /** Record id opened in the side drawer, or null when drawer is closed */
  drawerRecordId: string | null;
  /** Task ids currently in 2-second fade-out animation */
  fadingTaskIds: string[];
  /** Whether a backend operation is in flight */
  loading: boolean;
  /** Last error message, or null */
  error: string | null;

  /** Fetch unfinished tasks from backend */
  fetchItems: () => Promise<void>;
  /** Mark a task as done — fades for 2 s then removes from list */
  completeTask: (taskId: string) => Promise<void>;
  /** Remove a task row (keeps the linked record) */
  removeTask: (taskId: string) => Promise<void>;
  /** Open the side drawer for a given record */
  openDrawer: (recordId: string) => void;
  /** Close the side drawer */
  closeDrawer: () => void;
  /** Toggle collapsed / expanded state */
  toggleCollapse: () => void;
  /** Clear the error field */
  clearError: () => void;
}

export const useTodoOverlayStore = create<TodoOverlayState>((set, get) => ({
  items: [],
  collapsed: false,
  drawerRecordId: null,
  fadingTaskIds: [],
  loading: false,
  error: null,

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

  async completeTask(taskId) {
    set({ loading: true, error: null });
    try {
      await updateTaskStatus(taskId, "done");
      // Enqueue the fade animation
      set((state) => ({
        fadingTaskIds: [...state.fadingTaskIds, taskId],
        loading: false,
      }));
      // Remove from visible list and fade set after 2 s
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

  openDrawer(recordId) {
    set({ drawerRecordId: recordId });
  },

  closeDrawer() {
    set({ drawerRecordId: null });
  },

  toggleCollapse() {
    set((state) => ({ collapsed: !state.collapsed }));
  },

  clearError() {
    if (get().error) {
      set({ error: null });
    }
  },
}));
