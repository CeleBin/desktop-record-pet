import { useMemo, useState } from "react";

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

function FolderNode({
  node,
  depth,
  selectedFolderId,
  onSelectFolder,
  onCreateFolder,
  onRenameFolder,
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
  onCreateFolder: (name: string, parentId: string | null) => void;
  onRenameFolder: (id: string, name: string) => void;
  onRequestDelete: (node: NoteFolderNode) => void;
  onMoveFolder: (id: string, parentId: string | null) => void;
  collapsed: boolean;
  onToggleCollapsed: (id: string) => void;
  isCollapsed: (id: string) => boolean;
}) {
  const selected = selectedFolderId === node.id;
  const askCreate = () => {
    const name = window.prompt("新建子文件夹", "");
    if (name?.trim()) onCreateFolder(name.trim(), node.id);
  };
  const askRename = () => {
    const name = window.prompt("重命名文件夹", node.name);
    if (name?.trim() && name.trim() !== node.name) onRenameFolder(node.id, name.trim());
  };
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
              onCreateFolder={onCreateFolder}
              onRenameFolder={onRenameFolder}
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
  const [isDraggingFolder, setIsDraggingFolder] = useState(false);
  const tree = useMemo(() => buildNoteFolderTree(folders), [folders]);
  const askCreateRoot = () => {
    const name = window.prompt("新建文件夹", "");
    if (name?.trim()) onCreateFolder(name.trim(), null);
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
              onCreateFolder={onCreateFolder}
              onRenameFolder={onRenameFolder}
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
    </section>
  );
}
