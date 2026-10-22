import { useEffect, useMemo, useRef, useState } from "react";

import { buildNoteFolderTree, type NoteFolderNode } from "../../lib/noteFolders";
import type { FolderItem } from "../../types";
import { ConfirmDialog } from "../common/ConfirmDialog";

interface NoteFolderTreeProps {
  folders: FolderItem[];
  selectedFolderId: string | null;
  view: "root" | "all" | "folder";
  onToggleAll: () => void;
  onSelectFolder: (id: string) => void;
  onCreateFolder: (name: string, parentId: string | null) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onMoveFolder: (id: string, parentId: string | null) => void;
  error?: string | null;
}

type FolderNameDialogState =
  | { mode: "create"; parentId: string | null }
  | { mode: "rename"; folderId: string; currentName: string };

function FolderNameDialog({
  dialog,
  onCancel,
  onSubmit,
}: {
  dialog: FolderNameDialogState | null;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!dialog) return;
    const initialName = dialog.mode === "rename" ? dialog.currentName : "";
    setName(initialName);
    inputRef.current?.focus();
    if (initialName) inputRef.current?.select();
  }, [dialog]);

  useEffect(() => {
    if (!dialog) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dialog, onCancel]);

  if (!dialog) return null;

  const title = dialog.mode === "rename"
    ? "重命名文件夹"
    : dialog.parentId
      ? "新建子文件夹"
      : "新建文件夹";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/20 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-name-dialog-title"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmedName = name.trim();
          if (trimmedName) onSubmit(trimmedName);
        }}
        className="w-full max-w-sm rounded-2xl border border-border bg-surface/95 p-4 shadow-2xl backdrop-blur-xl"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 id="folder-name-dialog-title" className="text-sm font-semibold text-text">{title}</h2>
            <p className="mt-1 text-xs text-text-muted">输入文件夹名称。</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-2 py-1 text-text-muted transition hover:bg-white/5 hover:text-text"
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <input
          ref={inputRef}
          aria-label="文件夹名称"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="文件夹名称"
          className="mt-3 w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-xs text-text outline-none transition focus:border-secondary/50"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-2 text-xs text-text-muted transition hover:bg-white/5 hover:text-text"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className="rounded-lg bg-secondary/15 px-3 py-2 text-xs font-medium text-secondary transition hover:bg-secondary/25 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {dialog.mode === "rename" ? "保存" : "创建"}
          </button>
        </div>
      </form>
    </div>
  );
}

function FolderNode({
  node,
  depth,
  selectedFolderId,
  onSelectFolder,
  onRequestCreateFolder,
  onRequestRenameFolder,
  onRequestDelete,
  onMoveFolder,
  collapsed,
  onToggleCollapsed,
  isCollapsed,
}: {
  node: NoteFolderNode;
  depth: number;
  selectedFolderId: string | null;
  onSelectFolder: (id: string) => void;
  onRequestCreateFolder: (parentId: string | null) => void;
  onRequestRenameFolder: (node: NoteFolderNode) => void;
  onRequestDelete: (node: NoteFolderNode) => void;
  onMoveFolder: (id: string, parentId: string | null) => void;
  collapsed: boolean;
  onToggleCollapsed: (id: string) => void;
  isCollapsed: (id: string) => boolean;
}) {
  const selected = selectedFolderId === node.id;
  const askCreate = () => onRequestCreateFolder(node.id);
  const askRename = () => onRequestRenameFolder(node);
  const askDelete = () => {
    onRequestDelete(node);
  };

  return (
    <li>
      <div
        className={`group relative flex items-center gap-0 rounded-md border-l-2 transition ${selected ? "border-l-secondary/65 bg-secondary/5 text-text" : "border-l-transparent text-text-muted hover:bg-white/5 hover:text-text"}`}
        style={{ paddingLeft: `${depth * 10}px` }}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/note-folder-id", node.id);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const activeId = event.dataTransfer.getData("text/note-folder-id");
          if (activeId && activeId !== node.id) onMoveFolder(activeId, node.id);
        }}
      >
        {node.children.length > 0 ? (
          <button
            type="button"
            onClick={() => onToggleCollapsed(node.id)}
            className={`${depth === 0 ? "-ml-4 w-4" : "w-3"} shrink-0 rounded text-[10px] text-text0 hover:text-text`}
            aria-label={collapsed ? "展开子文件夹" : "折叠子文件夹"}
            aria-expanded={!collapsed}
          >
            {collapsed ? "▸" : "▾"}
          </button>
        ) : <span className={`${depth === 0 ? "-ml-4 w-4" : "w-3"} shrink-0`} />}
        <button
          type="button"
          onClick={() => onSelectFolder(node.id)}
          className="min-w-0 flex-1 truncate px-1 py-1 text-left text-sm group-hover:pr-14 group-focus-within:pr-14"
          aria-current={selected ? "page" : undefined}
        >
          {node.name}
        </button>
        <div className="pointer-events-none absolute right-1 top-1/2 flex -translate-y-1/2 items-center opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-70 group-focus-within:pointer-events-auto group-focus-within:opacity-70">
          <button type="button" onClick={askCreate} className="rounded px-1 text-xs hover:!opacity-100" title="新建子文件夹">＋</button>
          <button type="button" onClick={askRename} className="rounded px-1 text-xs hover:!opacity-100" title="重命名">···</button>
          <button type="button" onClick={askDelete} className="rounded px-1 text-xs text-danger hover:!opacity-100" title="删除">×</button>
        </div>
      </div>
      {node.children.length > 0 && !collapsed && (
        <ul className="space-y-0.5">
          {node.children.map((child) => (
            <FolderNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedFolderId={selectedFolderId}
              onSelectFolder={onSelectFolder}
              onRequestCreateFolder={onRequestCreateFolder}
              onRequestRenameFolder={onRequestRenameFolder}
              onRequestDelete={onRequestDelete}
              onMoveFolder={onMoveFolder}
              collapsed={isCollapsed(child.id)}
              onToggleCollapsed={onToggleCollapsed}
              isCollapsed={isCollapsed}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function NoteFolderTree({
  folders,
  selectedFolderId,
  view,
  onToggleAll,
  onSelectFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveFolder,
  error,
}: NoteFolderTreeProps) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [pendingDelete, setPendingDelete] = useState<NoteFolderNode | null>(null);
  const [folderDialog, setFolderDialog] = useState<FolderNameDialogState | null>(null);
  const [isDraggingFolder, setIsDraggingFolder] = useState(false);
  const tree = useMemo(() => buildNoteFolderTree(folders), [folders]);
  const askCreateRoot = () => {
    setFolderDialog({ mode: "create", parentId: null });
  };

  return (
    <section
      aria-label="笔记文件夹"
      className="space-y-1"
      onDragStart={() => setIsDraggingFolder(true)}
      onDragEnd={() => setIsDraggingFolder(false)}
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-text-muted">文件夹</p>
        <button type="button" onClick={askCreateRoot} className="rounded px-1.5 py-0.5 text-[11px] text-text-muted transition hover:bg-white/5 hover:text-text" title="新建文件夹">＋</button>
      </div>
      {error && <p className="rounded-lg bg-danger/10 px-2 py-1 text-[10px] text-danger" role="alert">{error}</p>}
      {isDraggingFolder && (
        <div
          className="rounded border border-dashed border-secondary/35 px-2 py-1 text-[10px] text-secondary"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const activeId = event.dataTransfer.getData("text/note-folder-id");
            if (activeId) onMoveFolder(activeId, null);
            setIsDraggingFolder(false);
          }}
        >
          拖到这里移至根目录
        </div>
      )}
      <div className="border-b border-border/70">
        <button
          type="button"
          onClick={onToggleAll}
          aria-pressed={view === "all"}
          className={`w-full border-b-2 px-1 py-1.5 text-center text-[11px] transition-colors ${view === "all" ? "border-secondary/65 text-secondary" : "border-transparent text-text-muted hover:text-text"}`}
        >
          全部笔记
        </button>
      </div>
      {tree.length > 0 && (
        <ul className="space-y-0.5" aria-label="文件夹路径">
          {tree.map((node) => (
            <FolderNode
              key={node.id}
              node={node}
              depth={0}
              selectedFolderId={selectedFolderId}
              onSelectFolder={onSelectFolder}
              onRequestCreateFolder={(parentId) => setFolderDialog({ mode: "create", parentId })}
              onRequestRenameFolder={(node) => setFolderDialog({ mode: "rename", folderId: node.id, currentName: node.name })}
              onRequestDelete={setPendingDelete}
              onMoveFolder={onMoveFolder}
              collapsed={collapsedIds.has(node.id)}
              onToggleCollapsed={(id) => setCollapsedIds((current) => {
                const next = new Set(current);
                if (next.has(id)) next.delete(id); else next.add(id);
                return next;
              })}
              isCollapsed={(id) => collapsedIds.has(id)}
            />
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除文件夹"
        message={`删除文件夹「${pendingDelete?.name ?? ""}」？其中的笔记和子文件夹会移动到上一级。`}
        confirmLabel="删除"
        onConfirm={() => {
          if (!pendingDelete) return;
          onDeleteFolder(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
      <FolderNameDialog
        dialog={folderDialog}
        onCancel={() => setFolderDialog(null)}
        onSubmit={(name) => {
          if (!folderDialog) return;
          if (folderDialog.mode === "create") {
            onCreateFolder(name, folderDialog.parentId);
          } else if (name !== folderDialog.currentName) {
            onRenameFolder(folderDialog.folderId, name);
          }
          setFolderDialog(null);
        }}
      />
    </section>
  );
}
