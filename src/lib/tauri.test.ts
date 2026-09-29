import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import {
  createNoteFolder,
  deleteNoteFolder,
  listNoteFolders,
  moveNoteFolder,
  moveNoteToFolder,
  renameNoteFolder,
  reorderNoteFolders,
} from "./tauri";

describe("note folder Tauri API", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it("lists note folders with the note-specific command", async () => {
    await listNoteFolders();
    expect(invokeMock).toHaveBeenCalledWith("list_note_folders");
  });

  it("passes parent id when creating and moving a note folder", async () => {
    await createNoteFolder("Ideas", "parent-1");
    expect(invokeMock).toHaveBeenLastCalledWith("create_note_folder", {
      name: "Ideas",
      parentId: "parent-1",
    });

    await moveNoteFolder("folder-1", null);
    expect(invokeMock).toHaveBeenLastCalledWith("move_note_folder", {
      id: "folder-1",
      parentId: null,
    });
  });

  it("uses note-specific rename, delete, reorder, and record move commands", async () => {
    await renameNoteFolder("folder-1", "Renamed");
    expect(invokeMock).toHaveBeenLastCalledWith("rename_note_folder", {
      id: "folder-1",
      name: "Renamed",
    });

    await deleteNoteFolder("folder-1");
    expect(invokeMock).toHaveBeenLastCalledWith("delete_note_folder", { id: "folder-1" });

    await reorderNoteFolders([{ id: "folder-1", sort_order: 0 }]);
    expect(invokeMock).toHaveBeenLastCalledWith("reorder_note_folders", {
      order: [{ id: "folder-1", sort_order: 0 }],
    });

    await moveNoteToFolder("record-1", "folder-1");
    expect(invokeMock).toHaveBeenLastCalledWith("move_note_to_folder", {
      recordId: "record-1",
      folderId: "folder-1",
    });
  });
});
