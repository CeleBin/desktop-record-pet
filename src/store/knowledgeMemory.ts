import { create } from "zustand";

import { getKnowledgeMemoryDetail, listKnowledgeMemory } from "../lib/tauri";
import type { KnowledgeMemoryDetail, KnowledgeMemoryItem } from "../types";

export type KnowledgeMemoryStatusFilter = "all" | "candidate" | "understanding" | "rejected";

interface KnowledgeMemoryState {
  items: KnowledgeMemoryItem[];
  selectedTopicId: string | null;
  selectedDetail: KnowledgeMemoryDetail | null;
  statusFilter: KnowledgeMemoryStatusFilter;
  loading: boolean;
  error: string | null;
  hasLoaded: boolean;
  load: () => Promise<void>;
  selectTopic: (topicId: string) => Promise<void>;
  setStatusFilter: (filter: KnowledgeMemoryStatusFilter) => void;
}

export const useKnowledgeMemoryStore = create<KnowledgeMemoryState>((set) => ({
  items: [],
  selectedTopicId: null,
  selectedDetail: null,
  statusFilter: "all",
  loading: false,
  error: null,
  hasLoaded: false,
  async load() {
    set({ loading: true, error: null });
    try {
      const items = await listKnowledgeMemory();
      set((state) => ({
        items,
        hasLoaded: true,
        selectedTopicId: items.some((item) => item.id === state.selectedTopicId)
          ? state.selectedTopicId
          : items[0]?.id ?? null,
      }));
    } catch (cause) {
      set({ error: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      set({ loading: false });
    }
  },
  async selectTopic(topicId) {
    set({ selectedTopicId: topicId, selectedDetail: null, error: null });
    try {
      const selectedDetail = await getKnowledgeMemoryDetail(topicId);
      set({ selectedDetail });
    } catch (cause) {
      set({ error: cause instanceof Error ? cause.message : String(cause) });
    }
  },
  setStatusFilter(statusFilter) {
    set({ statusFilter });
  },
}));
