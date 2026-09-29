import type { FolderItem } from "../types";

export interface NoteFolderNode extends FolderItem {
  children: NoteFolderNode[];
}

function compareFolders(left: FolderItem, right: FolderItem): number {
  return (
    left.sort_order - right.sort_order
    || left.created_at.localeCompare(right.created_at)
    || left.id.localeCompare(right.id)
  );
}

/** Build a stable, nested tree from the flat note-folder response. */
export function buildNoteFolderTree(folders: FolderItem[]): NoteFolderNode[] {
  const nodes = new Map<string, NoteFolderNode>();
  for (const folder of folders) {
    if (folder.scope !== "note") continue;
    nodes.set(folder.id, { ...folder, children: [] });
  }

  const roots: NoteFolderNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }

  const sortTree = (items: NoteFolderNode[]) => {
    items.sort(compareFolders);
    for (const item of items) sortTree(item.children);
  };
  sortTree(roots);
  return roots;
}

/** Flatten folders in the same depth-first order used by the tree view. */
export function flattenNoteFolderTree(folders: FolderItem[]): NoteFolderNode[] {
  const result: NoteFolderNode[] = [];
  const visit = (items: NoteFolderNode[]) => {
    for (const item of items) {
      result.push(item);
      visit(item.children);
    }
  };
  visit(buildNoteFolderTree(folders));
  return result;
}

/** Return all descendants of a folder, ordered for display. */
export function getNoteFolderDescendantIds(folders: FolderItem[], folderId: string): string[] {
  const node = flattenNoteFolderTree(folders).find((item) => item.id === folderId);
  if (!node) return [];
  const result: string[] = [];
  const visit = (items: NoteFolderNode[]) => {
    for (const item of items) {
      result.push(item.id);
      visit(item.children);
    }
  };
  visit(node.children);
  return result;
}

/** Return folder names from the root to the requested folder. */
export function getNoteFolderPath(folders: FolderItem[], folderId: string): string[] {
  const byId = new Map(folders.filter((folder) => folder.scope === "note").map((folder) => [folder.id, folder]));
  const path: string[] = [];
  const visited = new Set<string>();
  let current = byId.get(folderId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}
