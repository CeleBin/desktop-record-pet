import { useEffect, useState } from "react";

import { countPetChatSessions, deletePetChatSessions, listPetChatSessions, updatePetChatSessionTitle } from "../../lib/tauri";
import { ConfirmDialog } from "../common/ConfirmDialog";

export const PET_CHAT_OPEN_SESSION_EVENT = "desktop-record-pet:open-chat-session";
export const PET_CHAT_NEW_SESSION_EVENT = "desktop-record-pet:new-chat-session";
export const PET_CHAT_HISTORY_REFRESH_EVENT = "desktop-record-pet:refresh-chat-history";

type Session = { id: string; title: string | null; updated_at: string };

export function PetChatHistoryPanel() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Session[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const refresh = () => {
    void Promise.all([listPetChatSessions(), countPetChatSessions()])
      .then(([next, count]) => { setSessions(next); setTotalCount(count); })
      .catch(() => { setSessions([]); setTotalCount(0); });
  };

  useEffect(() => {
    refresh();
    window.addEventListener(PET_CHAT_HISTORY_REFRESH_EVENT, refresh);
    return () => window.removeEventListener(PET_CHAT_HISTORY_REFRESH_EVENT, refresh);
  }, []);

  const saveTitle = async (sessionId: string) => {
    const title = editingTitle.trim();
    if (!title) return;
    await updatePetChatSessionTitle(sessionId, title);
    setEditingId(null);
    refresh();
  };

  const removeSession = async () => {
    if (!pendingDelete.length) return;
    await deletePetChatSessions(pendingDelete.map((session) => session.id));
    setPendingDelete([]);
    setSelectedIds([]);
    refresh();
    window.dispatchEvent(new Event(PET_CHAT_HISTORY_REFRESH_EVENT));
  };

  const toggleSelected = (sessionId: string) => {
    setSelectedIds((current) => current.includes(sessionId) ? current.filter((id) => id !== sessionId) : [...current, sessionId]);
  };
  const selectAll = () => setSelectedIds(selectedIds.length === sessions.length ? [] : sessions.map((session) => session.id));
  const openSession = (sessionId: string) => window.dispatchEvent(new CustomEvent(PET_CHAT_OPEN_SESSION_EVENT, { detail: sessionId }));

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg/30 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-text">对话历史</span>
        <div className="flex items-center gap-2"><span className="text-[10px] text-text0">共 {totalCount} 条</span><button type="button" onClick={() => { setSelectMode((mode) => !mode); setSelectedIds([]); }} className="text-[10px] text-text-muted hover:text-primary">{selectMode ? "完成" : "多选"}</button></div>
      </div>
      <button type="button" onClick={() => window.dispatchEvent(new Event(PET_CHAT_NEW_SESSION_EVENT))} className="mb-3 rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-left text-xs text-primary transition hover:bg-primary/15">＋ 新对话</button>
      {selectMode && sessions.length > 0 && <div className="mb-2 flex items-center justify-between px-1 text-[11px] text-text-muted"><button type="button" onClick={selectAll} className="hover:text-primary">{selectedIds.length === sessions.length ? "取消全选" : "全选"}</button>{selectedIds.length > 0 && <button type="button" onClick={() => setPendingDelete(sessions.filter((session) => selectedIds.includes(session.id)))} className="text-danger hover:text-danger/80">删除已选（{selectedIds.length}）</button>}</div>}
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {sessions.length ? sessions.map((session) => {
          const isEditing = editingId === session.id && !selectMode;
          const isSelected = selectedIds.includes(session.id);
          return <div key={session.id} className={`group rounded-xl px-2 py-2 transition hover:bg-primary/10 ${isSelected ? "bg-primary/10" : ""}`}>
            <div className="flex items-center gap-1">
              {selectMode && <input type="checkbox" checked={isSelected} onChange={() => { toggleSelected(session.id); openSession(session.id); }} className="shrink-0" aria-label={`选择${session.title || "未命名对话"}`} />}
              {isEditing ? <><input autoFocus value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveTitle(session.id); if (event.key === "Escape") setEditingId(null); }} className="min-w-0 flex-1 rounded border border-border bg-surface-2 px-2 py-1 text-[11px] text-text outline-none focus:border-primary/50" /><button type="button" onClick={() => void saveTitle(session.id)} className="rounded bg-primary/15 px-2 py-1 text-[10px] text-primary">保存</button><button type="button" onClick={() => setEditingId(null)} className="rounded px-1 py-1 text-[10px] text-text0 hover:text-text">取消</button></> : <button type="button" onClick={() => selectMode ? (toggleSelected(session.id), openSession(session.id)) : openSession(session.id)} className="min-w-0 flex-1 text-left text-text-muted"><span className="block truncate text-xs">{session.title || "未命名对话"}</span><span className="mt-1 block text-[10px] text-text0">{new Date(session.updated_at).toLocaleString()}</span></button>}
              {!selectMode && !isEditing && <div className="flex shrink-0 gap-0.5 opacity-0 transition group-hover:opacity-100"><button type="button" aria-label="编辑标题" onClick={() => { setEditingId(session.id); setEditingTitle(session.title?.trim() || "未命名对话"); }} className="rounded p-1 text-text0 hover:bg-white/10 hover:text-text">✎</button><button type="button" aria-label="删除对话" onClick={() => setPendingDelete([session])} className="rounded p-1 text-text0 hover:bg-danger/10 hover:text-danger">×</button></div>}
            </div>
          </div>;
        }) : <p className="px-2 py-3 text-xs leading-5 text-text0">还没有历史对话</p>}
      </div>
      <ConfirmDialog open={pendingDelete.length > 0} title="删除对话" message={pendingDelete.length === 1 ? `确定删除“${pendingDelete[0].title || "未命名对话"}”吗？\n对话中的所有消息都会被删除，且无法恢复。` : `确定删除选中的 ${pendingDelete.length} 个对话吗？\n对话中的所有消息都会被删除，且无法恢复。`} confirmLabel="删除" onConfirm={() => void removeSession()} onCancel={() => setPendingDelete([])} />
    </div>
  );
}
