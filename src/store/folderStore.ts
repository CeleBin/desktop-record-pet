/**
 * 分类（文件夹）状态管理（Zustand Store）
 *
 * 负责管理待办分类的 CRUD 操作和排序：
 * - 从 Tauri 后端获取分类列表
 * - 创建/重命名/删除分类
 * - 移动任务到指定分类
 * - 拖拽排序分类
 */

import { create } from "zustand";
import { arrayMove } from "@dnd-kit/sortable";

import {
  listFolders,
  createFolder as createFolderCmd,
  renameFolder as renameFolderCmd,
  deleteFolder as deleteFolderCmd,
  moveTaskToFolder,
  reorderFolders as reorderFoldersCmd,
} from "../lib/tauri";
import type { FolderItem } from "../types";

interface FolderStore {
  folders: FolderItem[];
  loading: boolean;
  error: string | null;

  fetchFolders: () => Promise<void>;
  createFolder: (name: string) => Promise<void>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  moveTask: (taskId: string, folderId: string | null) => Promise<void>;
  reorderFolders: (activeId: string, overId: string) => void;
  clearError: () => void;
}

export const useFolderStore = create<FolderStore>((set, get) => ({
  folders: [],
  loading: false,
  error: null,

  async fetchFolders() {
    set({ loading: true, error: null });
    try {
      const folders = await listFolders();
      set({ folders, loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  async createFolder(name) {
    set({ loading: true, error: null });
    try {
      const folder = await createFolderCmd(name);
      set((state) => ({
        folders: [...state.folders, folder],
        loading: false,
      }));
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  async renameFolder(id, name) {
    set({ loading: true, error: null });
    try {
      const updated = await renameFolderCmd(id, name);
      set((state) => ({
        folders: state.folders.map((f) => (f.id === id ? updated : f)),
        loading: false,
      }));
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  async deleteFolder(id) {
    set({ loading: true, error: null });
    try {
      await deleteFolderCmd(id);
      set((state) => ({
        folders: state.folders.filter((f) => f.id !== id),
        loading: false,
      }));
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  async moveTask(taskId, folderId) {
    set({ loading: true, error: null });
    try {
      await moveTaskToFolder(taskId, folderId);
      set({ loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  reorderFolders(activeId, overId) {
    const { folders } = get();
    const oldFolders = [...folders];
    const activeIndex = folders.findIndex((f) => f.id === activeId);
    const overIndex = folders.findIndex((f) => f.id === overId);
    if (activeIndex === -1 || overIndex === -1) return;

    const reordered = arrayMove(folders, activeIndex, overIndex);
    const updated = reordered.map((f, i) => ({ ...f, sort_order: i }));
    set({ folders: updated });

    const orderPayload = updated.map((f) => ({ id: f.id, sort_order: f.sort_order }));
    reorderFoldersCmd(orderPayload).catch((error) => {
      set({
        folders: oldFolders,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  },

  clearError() {
    if (get().error) set({ error: null });
  },
}));
