import { describe, expect, it } from "vitest";
import { mapAnchorScrollTop, mapSegmentScrollTop } from "./editorPreviewScrollAnchors";

describe("editor/preview content anchors", () => {
  it("maps the final TOC heading to its editor anchor instead of document-end ratio", () => {
    const editorAnchors = [0, 180, 720];
    const previewAnchors = [0, 400, 1_600];

    expect(mapAnchorScrollTop(2, previewAnchors, editorAnchors, 900)).toBe(720);
  });

  it("maps local progress within matching heading segments", () => {
    const editorAnchors = [0, 180, 720];
    const previewAnchors = [0, 400, 1_600];

    expect(mapSegmentScrollTop(1_000, previewAnchors, editorAnchors, 900)).toBe(450);
  });

  it("maps the content before the first heading from each pane's top", () => {
    expect(mapSegmentScrollTop(50, [300, 900], [300, 1_200], 1_500)).toBe(50);
  });
});
