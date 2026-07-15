import { describe, expect, it } from "vitest";
import { extractMarkdownToc } from "./markdownToc";

describe("extractMarkdownToc", () => {
  it("ignores hash-prefixed lines in fenced code and preserves rendered heading text", () => {
    expect(extractMarkdownToc("# R&amp;D\n\n```md\n# not a heading\n```\n\n## [Release](./release)"))
      .toEqual([
        { level: 1, text: "R&D", index: 0, start: 0 },
        { level: 2, text: "Release", index: 1, start: 38 },
      ]);
  });
});
