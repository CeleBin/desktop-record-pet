import { useCallback, useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import { useColumnResize } from "../../lib/useColumnResize";
import { getNoteFolderPath } from "../../lib/noteFolders";
import { updateTaskDueAt, updateTaskPriority, updateTaskRepeatRule } from "../../lib/tauri";
import { useRecordsStore } from "../../store/records";
import { initTagsListener, useTagsStore } from "../../store/tags";
import { initNoteFoldersListener, useNoteFolderStore } from "../../store/noteFolderStore";
import { useTasksStore } from "../../store/tasks";
import type {
  RecordType,
  RecordFilter,
  TaskPriority,
  TaskStatus,
  UpdateRecordRequest,
} from "../../types";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { Navigation } from "./Navigation";
import { KnowledgeMemoryPanel } from "./KnowledgeMemoryPanel";
import { PetLearningPanel } from "./PetLearningPanel";
import { PetChatPanel } from "./PetChatPanel";
import { PetChatHistoryPanel } from "./PetChatHistoryPanel";
import { KnowledgeGraphPanel } from "./KnowledgeGraphPanel";
import { getRecordDetailInstanceKey, RecordDetail } from "./RecordDetail";
import { RecordList } from "./RecordList";
import { NoteFolderPicker } from "./NoteFolderPicker";
import { SettingsPanel } from "../settings/SettingsPanel";
import { useLearningCoachStore } from "../../store/learningCoach";
import { useSettingsStore } from "../../store/settings";

type ViewMode = "notes" | "tasks";
type ContentMode = "records" | "memory" | "settings" | "chat" | "graph";

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
    createRecord,
    selectRecord,
    updateRecord,
    deleteRecord,
    reorderRecords,
  } = useRecordsStore();

  const { convertRecordToTask, updateStatus, fetchTasks } = useTasksStore();

  const { fetchTags: fetchTagsStore } = useTagsStore();
  const noteFolders = useNoteFolderStore((state) => state.folders);
  const noteFolderError = useNoteFolderStore((state) => state.error);
  const noteFolderView = useNoteFolderStore((state) => state.noteFolderView);
  const selectedNoteFolderId = useNoteFolderStore((state) => state.selectedFolderId);
  const includeNoteDescendants = useNoteFolderStore((state) => state.includeDescendants);
  const fetchNoteFolders = useNoteFolderStore((state) => state.fetchFolders);
  const createNoteFolder = useNoteFolderStore((state) => state.createFolder);
  const renameNoteFolder = useNoteFolderStore((state) => state.renameFolder);
  const deleteNoteFolder = useNoteFolderStore((state) => state.deleteFolder);
  const moveNoteFolder = useNoteFolderStore((state) => state.moveFolder);
  const moveNote = useNoteFolderStore((state) => state.moveNote);
  const selectAllNotes = useNoteFolderStore((state) => state.selectAll);
  const selectUnfiledNotes = useNoteFolderStore((state) => state.selectUnfiled);
  const selectNoteFolder = useNoteFolderStore((state) => state.selectFolder);
  const setIncludeNoteDescendants = useNoteFolderStore((state) => state.setIncludeDescendants);
  // ── Resizable column widths (persisted to localStorage) ──
  const { widths, startResize, resetColumn } = useColumnResize();

  // ── Type filter (single-select: 笔记 OR 待办, never both) ──
  const [selectedType, setSelectedType] = useState<RecordType>("note");

  // Derived view mode for child components (RecordList text, Navigation status section)
  const viewMode: ViewMode = selectedType === "note" ? "notes" : "tasks";

  // Server-side type filter: always filter to the single selected type
  const typeFilter = selectedType;

  // ── Local filter state ──
  const [taskFilter, setTaskFilter] = useState<TaskPriority | "done" | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // ── Tag filter ──
  const [activeTagIds, setActiveTagIds] = useState<string[]>([]);
  const [newNoteFolderPickerOpen, setNewNoteFolderPickerOpen] = useState(false);
  const [newNoteFolderId, setNewNoteFolderId] = useState<string | null | undefined>(undefined);
  const [movingNoteRecordId, setMovingNoteRecordId] = useState<string | null>(null);
  const [movingNoteFolderId, setMovingNoteFolderId] = useState<string | null>(null);
  const toggleTagFilter = useCallback((tagId: string) => {
    setActiveTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId],
    );
  }, []);

  const notePath = useMemo(() => {
    if (noteFolderView === "folder" && selectedNoteFolderId) {
      return getNoteFolderPath(noteFolders, selectedNoteFolderId);
    }
    return [noteFolderView === "unfiled" ? "未归类" : "全部笔记"];
  }, [noteFolderView, noteFolders, selectedNoteFolderId]);
  const recordFilter = useMemo<RecordFilter>(() => ({
    typeFilter,
    statusFilter: selectedType === "note" ? "active" : undefined,
    searchQuery: debouncedQuery.length > 0 ? debouncedQuery : undefined,
    tagIds: activeTagIds.length > 0 ? activeTagIds : undefined,
    viewKey: viewMode,
    noteFolderMode: selectedType === "note" ? noteFolderView : undefined,
    folderId: selectedType === "note" && noteFolderView === "folder" ? selectedNoteFolderId ?? undefined : undefined,
    includeDescendants: selectedType === "note" && noteFolderView === "folder" ? includeNoteDescendants : undefined,
  }), [activeTagIds, debouncedQuery, includeNoteDescendants, noteFolderView, selectedNoteFolderId, selectedType, typeFilter, viewMode]);

  // ── Settings panel ──
  const [contentMode, setContentMode] = useState<ContentMode>(() => {
    const openChat = localStorage.getItem("open-pet-chat") === "true";
    localStorage.removeItem("open-pet-chat");
    return openChat ? "chat" : "records";
  });
  const [graphReturnNodeId, setGraphReturnNodeId] = useState<string | null>(null);

  useEffect(() => {
    const unlistenPromise = listen("open-pet-chat", () => setContentMode("chat"));
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

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
    void fetchRecords(recordFilter);
  }, [fetchRecords, recordFilter]);

  useEffect(() => {
    const unlistenPromise = listen("data-changed", () => {
      void fetchRecords(recordFilter);
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [fetchRecords, recordFilter]);

  // Fetch tasks on mount
  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  // Fetch tags on mount + init cross-window listener
  useEffect(() => {
    void fetchTagsStore();
    initTagsListener();
  }, [fetchTagsStore]);

  useEffect(() => {
    void fetchNoteFolders();
    initNoteFoldersListener();
  }, [fetchNoteFolders]);

  // Clear task status filter when leaving tasks view
  useEffect(() => {
    if (viewMode !== "tasks") {
      setTaskFilter(null);
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
    if (viewMode === "tasks" && taskFilter) {
      return records.filter((r) => taskFilter === "done"
        ? r.task?.task_status === "done"
        : r.task?.task_status !== "done" && r.task?.priority === taskFilter);
    }
    return records;
  }, [records, viewMode, taskFilter]);

  const handleSelect = useCallback(
    (id: string) => {
      setGraphReturnNodeId(null);
      void selectRecord(id);
    },
    [selectRecord],
  );

  const handleCreateNote = useCallback(() => {
    if (noteFolderView === "folder" && selectedNoteFolderId) {
      void createRecord({
        type: "note",
        title: null,
        content: null,
        source: "quick-text",
        folderId: selectedNoteFolderId,
      });
      return;
    }
    if (noteFolderView === "unfiled") {
      void createRecord({
        type: "note",
        title: null,
        content: null,
        source: "quick-text",
        folderId: null,
      });
      return;
    }
    setNewNoteFolderId(undefined);
    setNewNoteFolderPickerOpen(true);
  }, [createRecord, noteFolderView, selectedNoteFolderId]);

  const handleConfirmNewNote = useCallback(async () => {
    setNewNoteFolderPickerOpen(false);
    await createRecord({
      type: "note",
      title: null,
      content: null,
      source: "quick-text",
      folderId: newNoteFolderId ?? null,
    });
  }, [createRecord, newNoteFolderId]);

  const handleOpenMoveNote = useCallback((recordId: string) => {
    const record = records.find((item) => item.id === recordId);
    if (!record) return;
    setMovingNoteRecordId(recordId);
    setMovingNoteFolderId(record.folderId ?? null);
  }, [records]);

  const handleConfirmMoveNote = useCallback(async () => {
    if (!movingNoteRecordId) return;
    const recordId = movingNoteRecordId;
    setMovingNoteRecordId(null);
    await moveNote(recordId, movingNoteFolderId);
    await fetchRecords(recordFilter);
  }, [fetchRecords, moveNote, movingNoteFolderId, movingNoteRecordId, recordFilter]);

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

  const handleUpdateTaskPriority = useCallback(
    async (taskId: string, priority: TaskPriority, recordId: string) => {
      await updateTaskPriority(taskId, priority);
      await selectRecord(recordId);
    },
    [selectRecord],
  );

  const handleUpdateDueAt = useCallback(
    async (recordId: string, taskId: string, dueAt: string | null) => {
      await updateTaskDueAt(taskId, dueAt);
      // Re-fetch detail to reflect updated due date
      await selectRecord(recordId);
    },
    [selectRecord],
  );

  const handleUpdateRepeatRule = useCallback(
    async (taskId: string, repeatRule: string | null) => {
      await updateTaskRepeatRule(taskId, repeatRule);
      // Re-fetch tasks to reflect the updated repeat rule
      await fetchTasks();
    },
    [fetchTasks],
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
          taskFilter={taskFilter}
          searchQuery={searchQuery}
          settingsOpen={contentMode === "settings"}
          memoryOpen={contentMode === "memory"}
          graphOpen={contentMode === "graph"}
          chatOpen={contentMode === "chat"}
          growthPreviewEnabled={growthPreviewEnabled}
          onTaskFilterChange={setTaskFilter}
          onSearchChange={setSearchQuery}
          onToggleSettings={() => setContentMode((current) => current === "settings" ? "records" : "settings")}
          onToggleMemory={() => {
            closeLearningSession();
            setContentMode((current) => current === "memory" ? "records" : "memory");
          }}
          onToggleGraph={() => setContentMode((current) => current === "graph" ? "records" : "graph")}
          onToggleChat={() => setContentMode((current) => current === "chat" ? "records" : "chat")}
          activeTagIds={activeTagIds}
          onToggleTagFilter={toggleTagFilter}
          noteFolders={noteFolders}
          noteFolderView={noteFolderView}
          selectedNoteFolderId={selectedNoteFolderId}
          onSelectAllNotes={selectAllNotes}
          onSelectUnfiledNotes={selectUnfiledNotes}
          onSelectNoteFolder={selectNoteFolder}
          onCreateNoteFolder={(name, parentId) => { void createNoteFolder(name, parentId); }}
          onRenameNoteFolder={(id, name) => { void renameNoteFolder(id, name); }}
          onDeleteNoteFolder={(id) => { void deleteNoteFolder(id); }}
          onMoveNoteFolder={(id, parentId) => { void moveNoteFolder(id, parentId); }}
          noteFolderError={noteFolderError}
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
        className={`${contentMode === "graph" ? "hidden" : "flex"} shrink-0 flex-col border-r border-border bg-bg/30`}
        style={{ width: widths.list }}
      >
        {contentMode === "chat" ? (
          <PetChatHistoryPanel />
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
            onCreateNote={handleCreateNote}
            onMoveNote={handleOpenMoveNote}
            notePath={notePath}
            includeDescendants={includeNoteDescendants}
            onSetIncludeDescendants={setIncludeNoteDescendants}
          />
        )}
      </section>

      {/* ── Resize handle: list ↔ detail ── */}
      <div
        className={`${contentMode === "graph" ? "hidden" : "col-resize-handle"} shrink-0`}
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
        ) : contentMode === "graph" ? (
          <KnowledgeGraphPanel initialNodeId={graphReturnNodeId} onOpenRecord={(recordId, nodeId) => { setGraphReturnNodeId(nodeId); setContentMode("records"); void selectRecord(recordId); }} />
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
            onUpdateTaskPriority={handleUpdateTaskPriority}
            onUpdateDueAt={handleUpdateDueAt}
            onUpdateRepeatRule={handleUpdateRepeatRule}
            onDelete={handleDelete}
            onBackToGraph={() => setContentMode("graph")}
            graphReturnLabel={graphReturnNodeId ? "返回知识图谱" : "查看知识图谱"}
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

      {movingNoteRecordId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="move-note-dialog-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMovingNoteRecordId(null);
          }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-surface/95 p-4 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 id="move-note-dialog-title" className="text-sm font-semibold text-text">移动笔记</h2>
                <p className="mt-1 text-xs text-text-muted">选择目标文件夹，也可以移回未归类。</p>
              </div>
              <button type="button" onClick={() => setMovingNoteRecordId(null)} className="rounded-lg px-2 py-1 text-text-muted transition hover:bg-white/5 hover:text-text" aria-label="关闭">×</button>
            </div>
            <div className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-border/70 bg-white/[2%] p-1">
              <NoteFolderPicker
                folders={noteFolders}
                value={movingNoteFolderId}
                onChange={setMovingNoteFolderId}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setMovingNoteRecordId(null)} className="rounded-lg px-3 py-2 text-xs text-text-muted transition hover:bg-white/5 hover:text-text">取消</button>
              <button type="button" onClick={() => void handleConfirmMoveNote()} className="rounded-lg bg-secondary/15 px-3 py-2 text-xs font-medium text-secondary transition hover:bg-secondary/25">移动</button>
            </div>
          </div>
        </div>
      )}

      {newNoteFolderPickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-note-dialog-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setNewNoteFolderPickerOpen(false);
          }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-border bg-surface/95 p-4 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <div>
                <h2 id="new-note-dialog-title" className="text-sm font-semibold text-text">新建笔记</h2>
                <p className="mt-1 text-xs text-text-muted">选择存放位置，也可以暂不归类。</p>
              </div>
              <button type="button" onClick={() => setNewNoteFolderPickerOpen(false)} className="rounded-lg px-2 py-1 text-text-muted transition hover:bg-white/5 hover:text-text" aria-label="关闭">×</button>
            </div>
            <div className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-border/70 bg-white/[2%] p-1">
              <NoteFolderPicker
                folders={noteFolders}
                value={newNoteFolderId}
                onChange={setNewNoteFolderId}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setNewNoteFolderPickerOpen(false)} className="rounded-lg px-3 py-2 text-xs text-text-muted transition hover:bg-white/5 hover:text-text">取消</button>
              <button type="button" onClick={() => void handleConfirmNewNote()} className="rounded-lg bg-secondary/15 px-3 py-2 text-xs font-medium text-secondary transition hover:bg-secondary/25">创建笔记</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
