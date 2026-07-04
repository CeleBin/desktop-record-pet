import { create } from "zustand";

import {
  createRecord as createRecordCommand,
  deleteRecord as deleteRecordCommand,
  getRecordDetail,
  listRecords,
  updateRecord as updateRecordCommand,
} from "../lib/tauri";
import type {
  CreateRecordRequest,
  RecordFilter,
  RecordWithRelations,
  UpdateRecordRequest,
} from "../types";

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
      set({ records, loading: false });
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
    set({ loading: true, error: null });
    try {
      const updated = await updateRecordCommand(id, update);
      set((state) => ({
        records: state.records.map((record) =>
          record.id === id ? { ...record, ...updated } : record,
        ),
        loading: false,
      }));
    } catch (error) {
      set({
        loading: false,
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
  clearError() {
    if (get().error) {
      set({ error: null });
    }
  },
}));
