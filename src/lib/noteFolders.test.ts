import { describe, expect, it } from "vitest";

import { buildNoteFolderTree, flattenNoteFolderTree, getNoteFolderDescendantIds, getNoteFolderPath } from "./noteFolders";
import type { FolderItem } from "../types";

const folder = (id: string, name: string, parentId: string | null, sort_order: number): FolderItem => ({
  id,
  name,
  parentId,
  scope: "note",
  sort_order,
  created_at: `2026-01-01T00:00:0${sort_order}Z`,
  updated_at: `2026-01-01T00:00:0${sort_order}Z`,
});

describe("note folder tree helpers", () => {
  it("builds nested trees and sorts each sibling group", () => {
    const folders = [
      folder("child-b", "B", "root", 2),
      folder("root", "Root", null, 1),
      folder("child-a", "A", "root", 1),
      folder("other", "Other", null, 0),
    ];

    const tree = buildNoteFolderTree(folders);
    expect(tree.map((item) => item.id)).toEqual(["other", "root"]);
    expect(tree[1].children.map((item) => item.id)).toEqual(["child-a", "child-b"]);
  });

  it("flattens a tree in display order and returns descendants only", () => {
    const folders = [
      folder("root", "Root", null, 0),
      folder("child", "Child", "root", 0),
      folder("grandchild", "Grandchild", "child", 0),
      folder("other", "Other", null, 1),
    ];

    expect(flattenNoteFolderTree(folders).map((item) => item.id)).toEqual([
      "root",
      "child",
      "grandchild",
      "other",
    ]);
    expect(getNoteFolderDescendantIds(folders, "root")).toEqual([
      "child",
      "grandchild",
    ]);
  });

  it("returns a root-to-leaf breadcrumb for a nested folder", () => {
    const folders = [
      folder("root", "Root", null, 0),
      folder("child", "Child", "root", 0),
      folder("leaf", "Leaf", "child", 0),
    ];
    expect(getNoteFolderPath(folders, "leaf")).toEqual(["Root", "Child", "Leaf"]);
  });
});
