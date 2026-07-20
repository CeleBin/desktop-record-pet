import { describe, expect, it } from "vitest";
import {
  isDocumentCancelKey,
  saveLatestDocument,
  shouldApplySerializedRevision,
  shouldSerializeDocumentChange,
} from "./MarkdownEditor";

describe("rich document keyboard controls", () => {
  it("reserves Escape for cancelling the document workspace", () => {
    expect(isDocumentCancelKey("Escape")).toBe(true);
    expect(isDocumentCancelKey("Enter")).toBe(false);
  });

  it("flushes markdown before passing it to the save callback", async () => {
    const events: string[] = [];

    await saveLatestDocument(
      async () => {
        events.push("flush");
        return "# latest";
      },
      async (markdown) => {
        events.push(`save:${markdown}`);
      },
    );

    expect(events).toEqual(["flush", "save:# latest"]);
  });

  it("rejects a serialization result once a newer editor revision exists", () => {
    expect(shouldApplySerializedRevision(2, 3)).toBe(false);
    expect(shouldApplySerializedRevision(3, 3)).toBe(true);
  });

  it("never serializes BlockNote's temporary empty document during hydration", () => {
    expect(shouldSerializeDocumentChange(true)).toBe(false);
    expect(shouldSerializeDocumentChange(false)).toBe(true);
  });
});
