import { useCallback, useEffect, useMemo, useState } from "react";

import { useRecordsStore } from "../../store/records";
import { useTasksStore } from "../../store/tasks";
import type {
  RecordStatus,
  RecordType,
  TaskStatus,
  UpdateRecordRequest,
} from "../../types";
import { Navigation } from "./Navigation";
import { RecordDetail } from "./RecordDetail";
import { RecordList } from "./RecordList";
import { SettingsPanel } from "../settings/SettingsPanel";

type ViewMode = "records" | "tasks";

export function MainPanel() {
  const {
    records,
    selectedId,
    loading: recordsLoading,
    fetchRecords,
    selectRecord,
    updateRecord,
    deleteRecord,
  } = useRecordsStore();

  const { convertRecordToTask, updateStatus, fetchTasks } = useTasksStore();

  // ── View mode ──
  const [viewMode, setViewMode] = useState<ViewMode>("records");

  // ── Local filter state ──
  const [activeType, setActiveType] = useState<RecordType | null>(null);
  const [activeStatus, setActiveStatus] = useState<RecordStatus | null>(null);
  const [taskStatusFilter, setTaskStatusFilter] = useState<TaskStatus | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // ── Settings panel ──
  const [showSettings, setShowSettings] = useState(false);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 280);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch records when filters change
  useEffect(() => {
    void fetchRecords({
      type_filter: activeType ?? undefined,
      status_filter: activeStatus ?? undefined,
      search_query: debouncedQuery.length > 0 ? debouncedQuery : undefined,
    });
  }, [activeType, activeStatus, debouncedQuery, fetchRecords]);

  // Fetch tasks on mount
  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  // Reset filters when switching view modes
  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    if (mode === "tasks") {
      // Clear record-level filters when entering task mode
      setActiveType(null);
      setActiveStatus(null);
    } else {
      // Clear task filter when entering record mode
      setTaskStatusFilter(null);
    }
  }, []);

  // The selected record — enriched by selectRecord
  const selectedRecord = useMemo(
    () => records.find((r) => r.id === selectedId) ?? null,
    [records, selectedId],
  );

  // ── List items ──
  // In "tasks" view mode, client-side filter to show only records that have a task
  const displayRecords = useMemo(() => {
    if (viewMode === "tasks") {
      let filtered = records.filter((r) => r.task != null);
      if (taskStatusFilter) {
        filtered = filtered.filter(
          (r) => r.task!.task_status === taskStatusFilter,
        );
      }
      // Apply search query on top
      if (debouncedQuery.length > 0) {
        const q = debouncedQuery.toLowerCase();
        filtered = filtered.filter(
          (r) =>
            (r.title ?? "").toLowerCase().includes(q) ||
            (r.content ?? "").toLowerCase().includes(q),
        );
      }
      return filtered;
    }
    return records;
  }, [records, viewMode, taskStatusFilter, debouncedQuery]);

  const handleSelect = useCallback(
    (id: string) => {
      void selectRecord(id);
    },
    [selectRecord],
  );

  const handleDelete = useCallback(
    (id: string) => {
      void deleteRecord(id);
    },
    [deleteRecord],
  );

  const handleUpdate = useCallback(
    async (id: string, update: UpdateRecordRequest) => {
      await updateRecord(id, update);
    },
    [updateRecord],
  );

  const handleConvertToTask = useCallback(
    async (recordId: string) => {
      const task = await convertRecordToTask(recordId);
      if (task) {
        // Re-fetch the detail to get updated relations
        await selectRecord(recordId);
        await fetchTasks();
      }
    },
    [convertRecordToTask, selectRecord, fetchTasks],
  );

  const handleUpdateTaskStatus = useCallback(
    async (taskId: string, status: TaskStatus, recordId: string) => {
      await updateStatus(taskId, status);
      // Re-fetch detail to reflect updated status
      await selectRecord(recordId);
    },
    [updateStatus, selectRecord],
  );

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* ── Left: Navigation sidebar ── */}
      <aside className="w-[200px] shrink-0 border-r border-white/[5%] bg-slate-950/50">
        <Navigation
          viewMode={viewMode}
          activeType={activeType}
          activeStatus={activeStatus}
          taskStatusFilter={taskStatusFilter}
          searchQuery={searchQuery}
          settingsOpen={showSettings}
          onViewModeChange={handleViewModeChange}
          onTypeChange={setActiveType}
          onStatusChange={setActiveStatus}
          onTaskStatusFilterChange={setTaskStatusFilter}
          onSearchChange={setSearchQuery}
          onToggleSettings={() => setShowSettings((prev) => !prev)}
        />
      </aside>

      {/* ── Middle: Record list or Settings ── */}
      <section className="flex w-[360px] shrink-0 flex-col border-r border-white/[5%] bg-slate-950/30">
        {showSettings ? (
          <SettingsPanel onClose={() => setShowSettings(false)} />
        ) : (
          <RecordList
            records={displayRecords}
            selectedId={selectedId}
            loading={recordsLoading}
            viewMode={viewMode}
            onSelect={handleSelect}
            onDelete={handleDelete}
          />
        )}
      </section>

      {/* ── Right: Record detail ── */}
      <section className="flex min-w-0 flex-1 flex-col bg-slate-950/20">
        <RecordDetail
          record={selectedRecord}
          loading={recordsLoading}
          onUpdate={handleUpdate}
          onConvertToTask={handleConvertToTask}
          onUpdateTaskStatus={handleUpdateTaskStatus}
          onDelete={handleDelete}
        />
      </section>
    </div>
  );
}
