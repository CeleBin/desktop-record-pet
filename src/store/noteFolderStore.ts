import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { arrayMove } from "@dnd-kit/sortable";

import {
  createNoteFolder as createNoteFolderCommand,
  deleteNoteFolder as deleteNoteFolderCommand,
  listNoteFolders,
  moveNoteFolder as moveNoteFolderCommand,
  moveNoteToFolder as moveNoteToFolderCommand,
  renameNoteFolder as renameNoteFolderCommand,
  reorderNoteFolders as reorderNoteFoldersCommand,
} from "../lib/tauri";
import type { FolderItem } from "../types";

const INCLUDE_DESCENDANTS_KEY = "drp-note-folder-include-descendants";

function readIncludeDescendants(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(INCLUDE_DESCENDANTS_KEY) === "true";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface NoteFolderState {
  folders: FolderItem[];
  loading: boolean;
  error: string | null;
  includeDescendants: boolean;
  selectedFolderId: string | null;
  noteFolderView: "all" | "unfiled" | "folder";
  fetchFolders: () => Promise<void>;
  createFolder: (name: string, parentId?: string | null) => Promise<FolderItem | null>;
  renameFolder: (id: string, name: string) => Promise<FolderItem | null>;
  moveFolder: (id: string, parentId: string | null) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  moveNote: (recordId: string, folderId: string | null) => Promise<void>;
  reorderFolders: (activeId: string, overId: string) => void;
  setIncludeDescendants: (value: boolean) => void;
  selectAll: () => void;
  selectUnfiled: () => void;
  selectFolder: (id: string) => void;
  clearError: () => void;
}

export const useNoteFolderStore = create<NoteFolderState>((set, get) => ({
  folders: [],
  loading: false,
  error: null,
  includeDescendants: readIncludeDescendants(),
  selectedFolderId: null,
  noteFolderView: "all",

  async fetchFolders() {
    set({ loading: true, error: null });
    try {
      const folders = await listNoteFolders();
      const selected = get().selectedFolderId;
      set({
        folders,
        loading: false,
        selectedFolderId: selected && folders.some((folder) => folder.id === selected) ? selected : null,
        noteFolderView: selected && folders.some((folder) => folder.id === selected)
          ? get().noteFolderView
          : get().noteFolderView === "folder" ? "all" : get().noteFolderView,
      });
    } catch (error) {
      set({ loading: false, error: errorMessage(error) });
    }
  },

  async createFolder(name, parentId = null) {
    set({ loading: true, error: null });
    try {
      const folder = await createNoteFolderCommand(name, parentId);
      set((state) => ({ folders: [...state.folders, folder], loading: false }));
      return folder;
    } catch (error) {
      set({ loading: false, error: errorMessage(error) });
      return null;
    }
  },

  async renameFolder(id, name) {
    set({ loading: true, error: null });
    try {
      const updated = await renameNoteFolderCommand(id, name);
      set((state) => ({
        folders: state.folders.map((folder) => (folder.id === id ? updated : folder)),
        loading: false,
      }));
      return updated;
    } catch (error) {
      set({ loading: false, error: errorMessage(error) });
      return null;
    }
  },

  async moveFolder(id, parentId) {
    set({ loading: true, error: null });
    try {
      await moveNoteFolderCommand(id, parentId);
      await get().fetchFolders();
    } catch (error) {
      set({ loading: false, error: errorMessage(error) });
    }
  },

  async deleteFolder(id) {
    set({ loading: true, error: null });
    try {
      await deleteNoteFolderCommand(id);
      const state = get();
      set({
        folders: state.folders.filter((folder) => folder.id !== id),
        selectedFolderId: state.selectedFolderId === id ? null : state.selectedFolderId,
        noteFolderView: state.selectedFolderId === id ? "all" : state.noteFolderView,
        loading: false,
      });
      // The backend promotes children, so refresh their parent IDs and order.
      await get().fetchFolders();
    } catch (error) {
      set({ loading: false, error: errorMessage(error) });
    }
  },

  async moveNote(recordId, folderId) {
    set({ loading: true, error: null });
    try {
      await moveNoteToFolderCommand(recordId, folderId);
      set({ loading: false });
    } catch (error) {
      set({ loading: false, error: errorMessage(error) });
    }
  },

  reorderFolders(activeId, overId) {
    const current = get().folders;
    const active = current.find((folder) => folder.id === activeId);
    const over = current.find((folder) => folder.id === overId);
    if (!active || !over || active.parentId !== over.parentId || activeId === overId) return;

    const siblingIds = current
      .filter((folder) => folder.parentId === active.parentId)
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((folder) => folder.id);
    const oldIndex = siblingIds.indexOf(activeId);
    const newIndex = siblingIds.indexOf(overId);
    if (oldIndex === -1 || newIndex === -1) return;
    const reorderedIds = arrayMove(siblingIds, oldIndex, newIndex);
    const oldFolders = [...current];
    const updated = current.map((folder) => {
      const index = reorderedIds.indexOf(folder.id);
      return index === -1 ? folder : { ...folder, sort_order: index };
    });
    set({ folders: updated, error: null });
    reorderNoteFoldersCommand(
      updated
        .filter((folder) => folder.parentId === active.parentId)
        .map((folder) => ({ id: folder.id, sort_order: folder.sort_order })),
    ).catch((error) => set({ folders: oldFolders, error: errorMessage(error) }));
  },

  setIncludeDescendants(value) {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(INCLUDE_DESCENDANTS_KEY, String(value));
    }
    set({ includeDescendants: value });
  },

  selectAll() {
    set({ selectedFolderId: null, noteFolderView: "all" });
  },

  selectUnfiled() {
    set({ selectedFolderId: null, noteFolderView: "unfiled" });
  },

  selectFolder(id) {
    set({ selectedFolderId: id, noteFolderView: "folder" });
  },

  clearError() {
    if (get().error) set({ error: null });
  },
}));

let listenerInitialized = false;

export function initNoteFoldersListener(): void {
  if (listenerInitialized) return;
  listenerInitialized = true;
  listen<unknown>("data-changed", () => {
    void useNoteFolderStore.getState().fetchFolders();
  }).catch(console.error);
}
