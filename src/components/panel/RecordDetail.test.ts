import { describe, expect, it } from "vitest";
import {
  clearDocumentPendingSaves,
  createDocumentWriteQueue,
  getDocumentSaveStatus,
  getTocHeadingSelector,
  saveDocumentWithLatestMarkdown,
  getDefaultDocumentEditorMode,
  shouldFlushRichEditorForRecord,
  shouldMountRichEditorForRecord,
  getRecordDetailInstanceKey,
} from "./RecordDetail";

describe("document workspace save status", () => {
  it("opens every selected document in WYSIWYG mode", () => {
    expect(getDefaultDocumentEditorMode()).toBe("wysiwyg");
  });
  it("shows unsaved changes whenever either editable document field differs from its persisted value", () => {
    expect(getDocumentSaveStatus({
      titleDraft: "Revised title",
      savedTitle: "Original title",
      contentDraft: "Saved body",
      savedContent: "Saved body",
    })).toBe("有未保存更改");
  });

  it("clears both pending save channels when a document edit is cancelled", () => {
    expect(clearDocumentPendingSaves()).toEqual({ content: null, title: null });
  });

  it("prefers rich heading blocks for WYSIWYG TOC navigation", () => {
    expect(getTocHeadingSelector(2)).toBe('[data-content-type="heading"]');
    expect(getTocHeadingSelector(0)).toBe("h1, h2, h3");
  });

  it("awaits the header flush before persisting its latest markdown", async () => {
    const events: string[] = [];

    await saveDocumentWithLatestMarkdown(
      async () => {
        events.push("flush");
        return "# latest header save";
      },
      async (markdown) => {
        events.push(`persist:${markdown}`);
      },
    );

    expect(events).toEqual(["flush", "persist:# latest header save"]);
  });

  it("serializes writes and skips a stale session after cancellation", async () => {
    const queue = createDocumentWriteQueue();
    const events: string[] = [];
    const first = queue.beginSession();
    const firstWrite = queue.enqueue(first, async () => { events.push("first"); });
    queue.invalidate();
    const revert = queue.beginSession();
    const revertWrite = queue.enqueue(revert, async () => { events.push("revert"); });

    await Promise.all([firstWrite, revertWrite]);
    expect(events).toEqual(["revert"]);
  });

  it("never flushes a newly mounted rich editor into the previously selected record", () => {
    expect(shouldFlushRichEditorForRecord("old-record", "old-record")).toBe(true);
    expect(shouldFlushRichEditorForRecord("new-record", "old-record")).toBe(false);
    expect(shouldFlushRichEditorForRecord(null, "old-record")).toBe(false);
  });

  it("waits for the current record draft before mounting its rich editor", () => {
    expect(shouldMountRichEditorForRecord("new-record", "new-record")).toBe(true);
    expect(shouldMountRichEditorForRecord("old-record", "new-record")).toBe(false);
    expect(shouldMountRichEditorForRecord(null, "new-record")).toBe(false);
  });

  it("uses a new detail instance whenever the selected record changes", () => {
    expect(getRecordDetailInstanceKey("record-a")).toBe("record-a");
    expect(getRecordDetailInstanceKey("record-b")).not.toBe(getRecordDetailInstanceKey("record-a"));
  });
});
