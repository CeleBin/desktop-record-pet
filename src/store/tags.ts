import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";

import {
  createTag as createTagCommand,
  deleteTag as deleteTagCommand,
  listTags as listTagsCommand,
  updateTag as updateTagCommand,
} from "../lib/tauri";
import type { Tag } from "../types";

interface TagsState {
  tags: Tag[];
  loading: boolean;
  error: string | null;
  fetchTags: () => Promise<void>;
  createTag: (name: string, color: string | null) => Promise<Tag>;
  updateTag: (id: string, name?: string, color?: string | null) => Promise<void>;
  deleteTag: (id: string) => Promise<void>;
  clearError: () => void;
}

export const useTagsStore = create<TagsState>((set, get) => ({
  tags: [],
  loading: false,
  error: null,

  async fetchTags() {
    set({ loading: true, error: null });
    try {
      const tags = await listTagsCommand();
      set({ tags, loading: false });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  async createTag(name, color) {
    set({ loading: true, error: null });
    try {
      const tag = await createTagCommand(name, color);
      set((state) => ({
        tags: [...state.tags, tag],
        loading: false,
      }));
      return tag;
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },

  async updateTag(id, name, color) {
    // Optimistic update
    set((state) => ({
      tags: state.tags.map((t) =>
        t.id === id
          ? {
              ...t,
              ...(name !== undefined ? { name } : {}),
              ...(color !== undefined ? { color } : {}),
            }
          : t,
      ),
    }));
    try {
      const updated = await updateTagCommand(id, name, color);
      set((state) => ({
        tags: state.tags.map((t) => (t.id === id ? updated : t)),
      }));
    } catch (error) {
      // Refetch on error to restore state
      void get().fetchTags();
      set({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  async deleteTag(id) {
    const previous = get().tags;
    set((state) => ({
      tags: state.tags.filter((t) => t.id !== id),
    }));
    try {
      await deleteTagCommand(id);
    } catch (error) {
      set({
        tags: previous,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  clearError() {
    if (get().error) {
      set({ error: null });
    }
  },
}));

// ── Cross-window sync listener ──────────────────────────────────────

let listenerInitialized = false;

export function initTagsListener(): void {
  if (listenerInitialized) return;
  listenerInitialized = true;
  listen<unknown>("data-changed", () => {
    useTagsStore.getState().fetchTags();
  }).catch(console.error);
}
