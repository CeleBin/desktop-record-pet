import { useCallback, useEffect, useMemo, useState } from "react";

import { useColumnResize } from "../../lib/useColumnResize";
import { useRecordsStore } from "../../store/records";
import { initTagsListener, useTagsStore } from "../../store/tags";
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

type ViewMode = "all" | "notes" | "tasks";

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

  const { fetchTags: fetchTagsStore } = useTagsStore();

  // ── Resizable column widths (persisted to localStorage) ──
  const { widths, startResize, resetColumn } = useColumnResize();

  // ── Type filter (multi-select: 笔记 + 待办, both selected = all) ──
  const [selectedTypes, setSelectedTypes] = useState<Set<RecordType>>(
    () => new Set<RecordType>(["note", "task"]),
  );
  const toggleTypeFilter = useCallback((type: RecordType) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  // Derived view mode for child components (RecordList text, Navigation status section)
  const viewMode: ViewMode =
    selectedTypes.size === 1
      ? selectedTypes.has("note")
        ? "notes"
        : "tasks"
      : "all";

  // Server-side type filter: only filter when exactly one type is selected
  const typeFilter = selectedTypes.size === 1 ? Array.from(selectedTypes)[0] : undefined;

  // ── Local filter state ──
  const [activeStatus, setActiveStatus] = useState<RecordStatus | null>(null);
  const [taskStatusFilter, setTaskStatusFilter] = useState<TaskStatus | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // ── Tag filter ──
  const [activeTagIds, setActiveTagIds] = useState<string[]>([]);
  const toggleTagFilter = useCallback((tagId: string) => {
    setActiveTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId],
    );
  }, []);

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
      typeFilter: typeFilter,
      statusFilter: activeStatus ?? undefined,
      searchQuery: debouncedQuery.length > 0 ? debouncedQuery : undefined,
      tagIds: activeTagIds.length > 0 ? activeTagIds : undefined,
    });
  }, [typeFilter, activeStatus, debouncedQuery, activeTagIds, fetchRecords]);

  // Fetch tasks on mount
  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  // Fetch tags on mount + init cross-window listener
  useEffect(() => {
    void fetchTagsStore();
    initTagsListener();
  }, [fetchTagsStore]);

  // Clear conflicting status filters when view mode changes
  useEffect(() => {
    if (viewMode === "tasks") {
      setActiveStatus(null);
    } else {
      setTaskStatusFilter(null);
    }
  }, [viewMode]);

  // The selected record — enriched by selectRecord
  const selectedRecord = useMemo(
    () => records.find((r) => r.id === selectedId) ?? null,
    [records, selectedId],
  );

  // ── List items ──
  // Server-side `type_filter` handles the type filtering; client-side only
  // applies task-status filter on top for tasks view.
  const displayRecords = useMemo(() => {
    if (viewMode === "tasks" && taskStatusFilter) {
      return records.filter((r) => r.task?.task_status === taskStatusFilter);
    }
    return records;
  }, [records, viewMode, taskStatusFilter]);

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
    <div className="flex h-screen overflow-hidden bg-bg text-text">
      {/* ── Left: Navigation sidebar ── */}
      <aside
        className="shrink-0 border-r border-border bg-bg/50"
        style={{ width: widths.nav }}
      >
        <Navigation
          selectedTypes={selectedTypes}
          onToggleTypeFilter={toggleTypeFilter}
          viewMode={viewMode}
          activeStatus={activeStatus}
          taskStatusFilter={taskStatusFilter}
          searchQuery={searchQuery}
          settingsOpen={showSettings}
          onStatusChange={setActiveStatus}
          onTaskStatusFilterChange={setTaskStatusFilter}
          onSearchChange={setSearchQuery}
          onToggleSettings={() => setShowSettings((prev) => !prev)}
          activeTagIds={activeTagIds}
          onToggleTagFilter={toggleTagFilter}
        />
      </aside>

      {/* ── Resize handle: nav ↔ list ── */}
      <div
        className="col-resize-handle shrink-0"
        onPointerDown={startResize("nav")}
        onDoubleClick={() => resetColumn("nav")}
        role="separator"
        aria-orientation="vertical"
        aria-label="调整导航栏宽度"
      />

      {/* ── Middle: Record list or Settings ── */}
      <section
        className="flex shrink-0 flex-col border-r border-border bg-bg/30"
        style={{ width: widths.list }}
      >
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

      {/* ── Resize handle: list ↔ detail ── */}
      <div
        className="col-resize-handle shrink-0"
        onPointerDown={startResize("list")}
        onDoubleClick={() => resetColumn("list")}
        role="separator"
        aria-orientation="vertical"
        aria-label="调整列表宽度"
      />

      {/* ── Right: Record detail ── */}
      <section className="flex min-w-0 flex-1 flex-col bg-bg/20">
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
