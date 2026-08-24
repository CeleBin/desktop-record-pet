import { create } from "zustand";
import { arrayMove } from "@dnd-kit/sortable";

import {
  createRecord as createRecordCommand,
  deleteRecord as deleteRecordCommand,
  getRecordDetail,
  listRecords,
  reorderRecords as reorderRecordsCommand,
  updateRecord as updateRecordCommand,
} from "../lib/tauri";
import type {
  CreateRecordRequest,
  RecordFilter,
  RecordWithRelations,
  UpdateRecordRequest,
} from "../types";

function mergeFetchedRecord(
  incoming: RecordWithRelations,
  existing?: RecordWithRelations,
): RecordWithRelations {
  if (!existing) {
    return incoming;
  }

  return {
    ...existing,
    ...incoming,
    task: incoming.task ?? existing.task ?? null,
    attachments: incoming.attachments?.length
      ? incoming.attachments
      : (existing.attachments ?? []),
    attachment_links: incoming.attachment_links?.length
      ? incoming.attachment_links
      : (existing.attachment_links ?? []),
    ai_results: incoming.ai_results?.length
      ? incoming.ai_results
      : (existing.ai_results ?? []),
    knowledge_topics: incoming.knowledge_topics?.length
      ? incoming.knowledge_topics
      : (existing.knowledge_topics ?? []),
    tags: incoming.tags?.length
      ? incoming.tags
      : (existing.tags ?? []),
  };
}

interface RecordsState {
  records: RecordWithRelations[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  fetchRecords: (filter?: RecordFilter) => Promise<void>;
  createRecord: (request: CreateRecordRequest) => Promise<void>;
  selectRecord: (id: string | null) => Promise<void>;
  updateRecord: (id: string, update: UpdateRecordRequest) => Promise<void>;
  deleteRecord: (id: string) => Promise<void>;
  reorderRecords: (viewKey: string, activeId: string, overId: string) => void;
  hydrateRecord: (record: RecordWithRelations) => void;
  clearError: () => void;
}

export const useRecordsStore = create<RecordsState>((set, get) => ({
  records: [],
  selectedId: null,
  loading: false,
  error: null,
  async fetchRecords(filter) {
    set({ loading: true, error: null });
    try {
      const records = await listRecords(filter);
      set((state) => {
        const existingById = new Map(state.records.map((record) => [record.id, record]));
        return {
          records: records.map((record) => mergeFetchedRecord(record, existingById.get(record.id))),
          loading: false,
        };
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
  async createRecord(request) {
    set({ loading: true, error: null });
    try {
      const created = await createRecordCommand(request);
      const hydrated: RecordWithRelations = {
        ...created,
        attachments: [],
        attachment_links: [],
        ai_results: [],
        task: null,
        tags: [],
      };
      set((state) => ({
        records: [hydrated, ...state.records],
        selectedId: created.id,
        loading: false,
      }));
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
  async selectRecord(id) {
    if (!id) {
      set({ selectedId: null });
      return;
    }

    set({ loading: true, error: null, selectedId: id });
    try {
      const detail = await getRecordDetail(id);
      set((state) => ({
        records: state.records.some((record) => record.id === detail.id)
          ? state.records.map((record) => (record.id === detail.id ? detail : record))
          : [detail, ...state.records],
        loading: false,
      }));
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
  async updateRecord(id, update) {
    set({ error: null });
    try {
      const updated = await updateRecordCommand(id, update);
      set((state) => ({
        records: state.records.map((record) =>
          record.id === id ? { ...record, ...updated } : record,
        ),
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
  async deleteRecord(id) {
    set({ loading: true, error: null });
    try {
      await deleteRecordCommand(id);
      set((state) => ({
        records: state.records.filter((record) => record.id !== id),
        selectedId: state.selectedId === id ? null : state.selectedId,
        loading: false,
      }));
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
  hydrateRecord(record) {
    set((state) => ({
      records: state.records.some((item) => item.id === record.id)
        ? state.records.map((item) => (item.id === record.id ? record : item))
        : [record, ...state.records],
    }));
  },
  /**
   * 拖拽排序——在指定视图（notes / tasks）内交换两条记录的位置。
   *
   * 策略（与 todoOverlay.reorderItems 一致）：
   * 1. arrayMove 在本地数组中把 activeId 移到 overId 的位置
   * 2. 乐观更新 UI
   * 3. 赋予递增 sort_order（0, 1, 2, ...）后异步调用后端 reorderRecords
   * 4. 失败则回滚到旧数组并设置 error
   */
  reorderRecords(viewKey, activeId, overId) {
    const { records } = get();
    if (activeId === overId) return;

    const oldRecords = [...records];
    const activeIndex = records.findIndex((r) => r.id === activeId);
    const overIndex = records.findIndex((r) => r.id === overId);
    if (activeIndex === -1 || overIndex === -1) return;

    const reordered = arrayMove(records, activeIndex, overIndex);
    set({ records: reordered });

    const orderPayload = reordered.map((item, index) => ({
      record_id: item.id,
      sort_order: index,
    }));
    reorderRecordsCommand(viewKey, orderPayload).catch((error) => {
      set({
        records: oldRecords,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  },
  clearError() {
    if (get().error) {
      set({ error: null });
    }
  },
}));
