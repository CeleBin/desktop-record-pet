import { describe, expect, it } from "vitest";
import { contentPreview } from "./RecordItemContent";

describe("record item attachment display", () => {
  it("does not use attachments to build a record preview", () => {
    expect(
      contentPreview({
        id: "record-1",
        type: "note",
        title: "",
        content: "",
        created_at: "2026-09-07T00:00:00.000Z",
        attachments: [{ id: "attachment-1" }],
        tags: [],
      } as never),
    ).toBe("无标题");
  });
});
