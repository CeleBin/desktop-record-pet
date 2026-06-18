import { useState } from "react";
import type { FolderItem } from "../../types";

interface CategoryManagerProps {
  folders: FolderItem[];
  /** 返回每个分类下的任务数 */
  taskCountByFolder: Record<string, number>;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}

export function CategoryManager({
  folders,
  taskCountByFolder,
  onCreate,
  onRename,
  onDelete,
  onClose,
}: CategoryManagerProps) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await onCreate(newName.trim());
    setNewName("");
  };

  const handleRename = async (id: string) => {
    if (!editingName.trim()) {
      setEditingId(null);
      return;
    }
    await onRename(id, editingName.trim());
    setEditingId(null);
    setEditingName("");
  };

  const startEdit = (f: FolderItem) => {
    setEditingId(f.id);
    setEditingName(f.name);
  };

  const handleDelete = (id: string) => {
    const count = taskCountByFolder[id] || 0;
    if (count > 0) {
      setDeletingId(id);
    } else {
      void onDelete(id);
    }
  };

  const confirmDelete = async () => {
    if (deletingId) {
      await onDelete(deletingId);
      setDeletingId(null);
    }
  };

  return (
    <>
      {/* 遮罩 */}
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
        onMouseDown={(e) => e.stopPropagation()}
      />

      {/* 浮层 */}
      <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-xl border border-white/[6%] bg-slate-900/95 p-3 shadow-2xl backdrop-blur-xl">
        <h3 className="mb-2 text-[10px] font-medium uppercase tracking-[0.15em] text-slate-500">
          分类管理
        </h3>

        {/* 分类列表 */}
        <div className="max-h-48 overflow-y-auto">
          {folders.length === 0 ? (
            <p className="py-3 text-center text-[11px] text-slate-600">
              暂无分类
            </p>
          ) : (
            folders.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 hover:bg-white/[4%]"
              >
                {editingId === f.id ? (
                  <>
                    <input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleRename(f.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="min-w-0 flex-1 rounded bg-white/5 px-2 py-0.5 text-[12px] text-slate-200 outline-none ring-1 ring-emerald-400/50"
                      autoFocus
                    />
                    <button
                      onClick={() => void handleRename(f.id)}
                      className="text-[10px] text-emerald-400"
                    >
                      确定
                    </button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-slate-300">
                      {f.name}
                    </span>
                    <span className="text-[10px] text-slate-600">
                      {taskCountByFolder[f.id] || 0}
                    </span>
                    <button
                      onClick={() => startEdit(f)}
                      className="p-0.5 text-slate-600 hover:text-slate-300"
                    >
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
                        />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(f.id)}
                      className="p-0.5 text-slate-600 hover:text-rose-400"
                    >
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                        />
                      </svg>
                    </button>
                  </>
                )}
              </div>
            ))
          )}
        </div>

        {/* 新建分类 */}
        <div className="mt-2 flex items-center gap-1.5">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
            }}
            placeholder="新建分类..."
            className="min-w-0 flex-1 rounded-lg bg-white/5 px-2.5 py-1.5 text-[12px] text-slate-200 outline-none placeholder:text-slate-600"
          />
          <button
            onClick={() => void handleCreate()}
            disabled={!newName.trim()}
            className="rounded-lg px-2.5 py-1.5 text-[12px] text-emerald-400 transition hover:bg-emerald-400/10 disabled:cursor-not-allowed disabled:opacity-30"
          >
            创建
          </button>
        </div>
      </div>

      {/* 删除确认对话框 */}
      {deletingId && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/50"
            onClick={() => setDeletingId(null)}
            onMouseDown={(e) => e.stopPropagation()}
          />
          <div className="fixed inset-0 z-[60] flex items-center justify-center">
            <div className="w-64 rounded-xl border border-white/[8%] bg-slate-900 p-4 shadow-2xl">
              <p className="text-[12px] text-slate-300">
                分类「
                {folders.find((f) => f.id === deletingId)?.name}
                」下有 {taskCountByFolder[deletingId] || 0}{" "}
                个待办，是否一起删除？此操作不可撤销。
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => setDeletingId(null)}
                  className="rounded-lg px-3 py-1.5 text-[11px] text-slate-400 transition hover:bg-white/5"
                >
                  取消
                </button>
                <button
                  onClick={() => void confirmDelete()}
                  className="rounded-lg bg-rose-500/20 px-3 py-1.5 text-[11px] text-rose-400 transition hover:bg-rose-500/30"
                >
                  确认删除
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
