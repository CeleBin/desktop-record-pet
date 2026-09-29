import { useMemo, useState } from "react";

import { buildNoteFolderTree, type NoteFolderNode } from "../../lib/noteFolders";
import type { FolderItem } from "../../types";

interface NoteFolderTreeProps {
  folders: FolderItem[];
  selectedFolderId: string | null;
  view: "all" | "unfiled" | "folder";
  onSelectAll: () => void;
  onSelectUnfiled: () => void;
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
  onDeleteFolder,
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
  onDeleteFolder: (id: string) => void;
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
    if (window.confirm(`删除文件夹「${node.name}」？其中的笔记和子文件夹会移动到上一级。`)) {
      onDeleteFolder(node.id);
    }
  };

  return (
    <li>
      <div
        className={`group flex items-center gap-1 rounded-lg transition ${selected ? "bg-secondary/15 text-secondary" : "text-text-muted hover:bg-white/5 hover:text-text"}`}
        style={{ paddingLeft: `${depth * 14}px` }}
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
            className="w-4 shrink-0 rounded text-[10px] text-text0 hover:text-text"
            aria-label={collapsed ? "展开子文件夹" : "折叠子文件夹"}
          >
            {collapsed ? "▸" : "▾"}
          </button>
        ) : <span className="w-4 shrink-0" />}
        <button
          type="button"
          onClick={() => onSelectFolder(node.id)}
          className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-xs"
          aria-current={selected ? "page" : undefined}
        >
          {node.name}
        </button>
        <button type="button" onClick={askCreate} className="rounded px-1 text-xs opacity-0 transition group-hover:opacity-70 hover:!opacity-100" title="新建子文件夹">＋</button>
        <button type="button" onClick={askRename} className="rounded px-1 text-xs opacity-0 transition group-hover:opacity-70 hover:!opacity-100" title="重命名">···</button>
        <button type="button" onClick={askDelete} className="rounded px-1 text-xs text-danger opacity-0 transition group-hover:opacity-70 hover:!opacity-100" title="删除">×</button>
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
              onDeleteFolder={onDeleteFolder}
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
  onSelectAll,
  onSelectUnfiled,
  onSelectFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveFolder,
  error,
}: NoteFolderTreeProps) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => buildNoteFolderTree(folders), [folders]);
  const askCreateRoot = () => {
    const name = window.prompt("新建文件夹", "");
    if (name?.trim()) onCreateFolder(name.trim(), null);
  };

  return (
    <section aria-label="笔记文件夹" className="space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-text0">文件夹</p>
        <button type="button" onClick={askCreateRoot} className="rounded px-1.5 py-0.5 text-xs text-text-muted transition hover:bg-white/5 hover:text-text" title="新建文件夹">＋</button>
      </div>
      {error && <p className="rounded-lg bg-danger/10 px-2 py-1 text-[10px] text-danger" role="alert">{error}</p>}
      <div
        className="rounded-lg border border-dashed border-border/60 px-2 py-1 text-[10px] text-text0 transition hover:border-secondary/40 hover:text-secondary"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const activeId = event.dataTransfer.getData("text/note-folder-id");
          if (activeId) onMoveFolder(activeId, null);
        }}
      >
        拖到这里移至根目录
      </div>
      <button
        type="button"
        onClick={onSelectAll}
        className={`flex w-full items-center rounded-lg px-2 py-1.5 text-left text-xs transition ${view === "all" ? "bg-secondary/15 text-secondary" : "text-text-muted hover:bg-white/5 hover:text-text"}`}
      >
        <span className="mr-1.5 text-[10px]" aria-hidden="true">◎</span>
        全部笔记
      </button>
      <button
        type="button"
        onClick={onSelectUnfiled}
        className={`flex w-full items-center rounded-lg px-2 py-1.5 text-left text-xs transition ${view === "unfiled" ? "bg-secondary/15 text-secondary" : "text-text-muted hover:bg-white/5 hover:text-text"}`}
      >
        <span className="mr-1.5 text-[10px]" aria-hidden="true">○</span>
        未归类
      </button>
      {tree.length > 0 && (
        <ul className="space-y-0.5">
          {tree.map((node) => (
            <FolderNode
              key={node.id}
              node={node}
              depth={0}
              selectedFolderId={selectedFolderId}
              onSelectFolder={onSelectFolder}
              onCreateFolder={onCreateFolder}
              onRenameFolder={onRenameFolder}
              onDeleteFolder={onDeleteFolder}
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
    </section>
  );
}
