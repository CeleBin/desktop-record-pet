import { useCallback, useEffect, useMemo, useState } from "react";

import { useColumnResize } from "../../lib/useColumnResize";
import { useRecordsStore } from "../../store/records";
import { initTagsListener, useTagsStore } from "../../store/tags";
import { useTasksStore } from "../../store/tasks";
import type {
  RecordType,
  TaskStatus,
  UpdateRecordRequest,
} from "../../types";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { Navigation } from "./Navigation";
import { KnowledgeMemoryPanel } from "./KnowledgeMemoryPanel";
import { PetLearningPanel } from "./PetLearningPanel";
import { PetChatPanel } from "./PetChatPanel";
import { getRecordDetailInstanceKey, RecordDetail } from "./RecordDetail";
import { RecordList } from "./RecordList";
import { SettingsPanel } from "../settings/SettingsPanel";
import { useLearningCoachStore } from "../../store/learningCoach";
import { useSettingsStore } from "../../store/settings";

type ViewMode = "notes" | "tasks";
type ContentMode = "records" | "memory" | "settings" | "chat";

export function MainPanel() {
  const activeLearningSession = useLearningCoachStore((state) => state.activeSession);
  const closeLearningSession = useLearningCoachStore((state) => state.closeSession);
  const productMode = useSettingsStore((state) => state.settings.product_mode);
  const growthPreviewEnabled = productMode === "growth-preview";
  const {
    records,
    selectedId,
    loading: recordsLoading,
    fetchRecords,
    selectRecord,
    updateRecord,
    deleteRecord,
    reorderRecords,
  } = useRecordsStore();

  const { convertRecordToTask, updateStatus, fetchTasks } = useTasksStore();

  const { fetchTags: fetchTagsStore } = useTagsStore();

  // ── Resizable column widths (persisted to localStorage) ──
  const { widths, startResize, resetColumn } = useColumnResize();

  // ── Type filter (single-select: 笔记 OR 待办, never both) ──
  const [selectedType, setSelectedType] = useState<RecordType>("note");

  // Derived view mode for child components (RecordList text, Navigation status section)
  const viewMode: ViewMode = selectedType === "note" ? "notes" : "tasks";

  // Server-side type filter: always filter to the single selected type
  const typeFilter = selectedType;

  // ── Local filter state ──
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
  const [contentMode, setContentMode] = useState<ContentMode>(() => {
    const openChat = localStorage.getItem("open-pet-chat") === "true";
    localStorage.removeItem("open-pet-chat");
    return openChat ? "chat" : "records";
  });

  useEffect(() => {
    if (growthPreviewEnabled) return;
    closeLearningSession();
    setContentMode((current) => current === "memory" ? "records" : current);
  }, [closeLearningSession, growthPreviewEnabled]);

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
      searchQuery: debouncedQuery.length > 0 ? debouncedQuery : undefined,
      tagIds: activeTagIds.length > 0 ? activeTagIds : undefined,
      viewKey: viewMode,
    });
  }, [typeFilter, debouncedQuery, activeTagIds, viewMode, fetchRecords]);

  // Fetch tasks on mount
  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  // Fetch tags on mount + init cross-window listener
  useEffect(() => {
    void fetchTagsStore();
    initTagsListener();
  }, [fetchTagsStore]);

  // Clear task status filter when leaving tasks view
  useEffect(() => {
    if (viewMode !== "tasks") {
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

  // ── Delete confirmation dialog ──
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // Title preview for the delete-confirm dialog（沿用原有截断逻辑）
  const pendingDeletePreview = useMemo(() => {
    if (!pendingDeleteId) return "";
    const record = records.find((r) => r.id === pendingDeleteId);
    const title =
      record?.title?.trim() ||
      record?.content?.trim().split("\n")[0] ||
      "此记录";
    return title.length > 40 ? `${title.slice(0, 40)}…` : title;
  }, [pendingDeleteId, records]);

  const handleDelete = useCallback(
    (id: string) => {
      setPendingDeleteId(id);
    },
    [],
  );

  const handleReorder = useCallback(
    (activeId: string, overId: string) => {
      reorderRecords(viewMode, activeId, overId);
    },
    [viewMode, reorderRecords],
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
          selectedType={selectedType}
          onSelectType={setSelectedType}
          viewMode={viewMode}
          taskStatusFilter={taskStatusFilter}
          searchQuery={searchQuery}
          settingsOpen={contentMode === "settings"}
          memoryOpen={contentMode === "memory"}
          chatOpen={contentMode === "chat"}
          growthPreviewEnabled={growthPreviewEnabled}
          onTaskStatusFilterChange={setTaskStatusFilter}
          onSearchChange={setSearchQuery}
          onToggleSettings={() => setContentMode((current) => current === "settings" ? "records" : "settings")}
          onToggleMemory={() => {
            closeLearningSession();
            setContentMode((current) => current === "memory" ? "records" : "memory");
          }}
          onToggleChat={() => setContentMode((current) => current === "chat" ? "records" : "chat")}
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
        {contentMode === "chat" ? (
          <div className="flex h-full items-center justify-center text-sm text-text-muted">对话正在右侧展开</div>
        ) : contentMode === "settings" ? (
          <SettingsPanel onClose={() => setContentMode("records")} />
        ) : contentMode === "memory" && growthPreviewEnabled ? (
          <KnowledgeMemoryPanel mode="list" />
        ) : (
          <RecordList
            records={displayRecords}
            selectedId={selectedId}
            loading={recordsLoading}
            viewMode={viewMode}
            onSelect={handleSelect}
            onDelete={handleDelete}
            onReorder={handleReorder}
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
        {contentMode === "chat" ? (
          <PetChatPanel />
        ) : contentMode === "memory" && growthPreviewEnabled ? (
          <KnowledgeMemoryPanel mode="detail" />
        ) : activeLearningSession && growthPreviewEnabled ? (
          <PetLearningPanel
            onBackToRecord={() => {
              if (selectedRecord?.id) {
                void selectRecord(selectedRecord.id);
              }
            }}
          />
        ) : (
          <RecordDetail
            key={getRecordDetailInstanceKey(selectedRecord?.id ?? null)}
            record={selectedRecord}
            loading={recordsLoading}
            onUpdate={handleUpdate}
            onConvertToTask={handleConvertToTask}
            onUpdateTaskStatus={handleUpdateTaskStatus}
            onDelete={handleDelete}
            growthPreviewEnabled={growthPreviewEnabled}
          />
        )}
      </section>

      {/* ── Delete confirm dialog ── */}
      <ConfirmDialog
        open={pendingDeleteId !== null}
        message={`确定要删除「${pendingDeletePreview}」吗？\n此操作不可撤销，关联的附件、标签关联和 AI 结果都会一并删除。`}
        confirmLabel="确认删除"
        onConfirm={() => {
          if (pendingDeleteId) void deleteRecord(pendingDeleteId);
          setPendingDeleteId(null);
        }}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
}
