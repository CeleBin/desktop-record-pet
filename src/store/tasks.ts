import { create } from "zustand";

import {
  convertRecordToTask as convertRecordToTaskCommand,
  listTasks,
  updateTaskStatus as updateTaskStatusCommand,
} from "../lib/tauri";
import type { TaskFilter, TaskItem, TaskStatus } from "../types";

interface TasksState {
  tasks: TaskItem[];
  filter: TaskFilter;
  loading: boolean;
  error: string | null;
  fetchTasks: (filter?: TaskFilter) => Promise<void>;
  convertRecordToTask: (recordId: string) => Promise<TaskItem | null>;
  updateStatus: (taskId: string, status: TaskStatus) => Promise<void>;
  setFilter: (filter: TaskFilter) => void;
  clearError: () => void;
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  filter: {},
  loading: false,
  error: null,
  async fetchTasks(filter) {
    const nextFilter = filter ?? get().filter;
    set({ loading: true, error: null, filter: nextFilter });
    try {
      const tasks = await listTasks(nextFilter);
      set({ tasks, loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
  async convertRecordToTask(recordId) {
    set({ loading: true, error: null });
    try {
      const task = await convertRecordToTaskCommand(recordId);
      set((state) => ({
        tasks: [task, ...state.tasks.filter((item) => item.id !== task.id)],
        loading: false,
      }));
      return task;
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  },
  async updateStatus(taskId, status) {
    set({ loading: true, error: null });
    try {
      const updated = await updateTaskStatusCommand(taskId, status);
      set((state) => ({
        tasks: state.tasks.map((task) => (task.id === taskId ? updated : task)),
        loading: false,
      }));
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
  setFilter(filter) {
    set({ filter });
  },
  clearError() {
    if (get().error) {
      set({ error: null });
    }
  },
}));
