import { describe, expect, it } from "vitest";
import type { PartialBlock } from "@blocknote/core";
import {
  BLANK_LINE_MARKER,
  encodeEmptyParagraphBlocks,
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

describe("blank line preservation", () => {
  it("marks blank lines with a zero-width space", () => {
    expect(BLANK_LINE_MARKER).toBe("\u200b");
  });

  it("encodes an empty paragraph block as a zero-width space", () => {
    const encoded = encodeEmptyParagraphBlocks([{ type: "paragraph" }]);
    expect(encoded).toHaveLength(1);
    expect(encoded[0].content).toBe(BLANK_LINE_MARKER);
  });

  it("passes a paragraph with content through unchanged", () => {
    const block: PartialBlock = { type: "paragraph", content: "hello" };
    const encoded = encodeEmptyParagraphBlocks([block]);
    expect(encoded[0]).toBe(block);
  });

  it("passes non-paragraph blocks through unchanged", () => {
    const block: PartialBlock = { type: "heading", content: "Title" };
    const encoded = encodeEmptyParagraphBlocks([block]);
    expect(encoded[0]).toBe(block);
  });

  it("recurses into nested children", () => {
    const inner: PartialBlock = { type: "paragraph" };
    const block: PartialBlock = {
      type: "quote",
      children: [inner, { type: "paragraph", content: "kept" }],
    };
    const encoded = encodeEmptyParagraphBlocks([block]);
    const encodedInner = (encoded[0] as { children: { content?: unknown }[] })
      .children[0];
    expect(encodedInner).not.toBe(inner);
    expect(encodedInner.content).toBe(BLANK_LINE_MARKER);
  });

  it("does not mutate the input blocks", () => {
    const block: PartialBlock = { type: "paragraph" };
    const input: PartialBlock[] = [block];
    const snapshot = JSON.stringify(input);
    encodeEmptyParagraphBlocks(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
