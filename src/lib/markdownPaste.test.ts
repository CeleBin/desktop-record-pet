import { describe, expect, it } from "vitest";
import { markdownToHTML } from "@blocknote/core";
import { normalizeMarkdownLineEndings, shouldPasteMarkdown } from "./markdownPaste";

describe("markdown clipboard detection", () => {
  it("recognizes a complete Markdown document even when the clipboard also has HTML", () => {
    const markdown = [
      "# 术语注入丢失问题记录",
      "",
      "> 日期：2026-09-28",
      "> 状态：**未修复**",
      "",
      "## 背景",
      "",
      "```text",
      "POST /translate",
      "```",
    ].join("\n");

    expect(shouldPasteMarkdown(["text/html", "text/plain"], markdown)).toBe(true);
  });

  it("recognizes Markdown list syntax that the editor's narrow detector misses", () => {
    expect(shouldPasteMarkdown(["text/plain"], "+ one item\n+ another item")).toBe(true);
  });

  it("does not replace ordinary rich-text paste with Markdown parsing", () => {
    expect(shouldPasteMarkdown(["text/html", "text/plain"], "ordinary paragraph\nwith two lines")).toBe(false);
  });

  it("trusts the explicit text/markdown clipboard format", () => {
    expect(shouldPasteMarkdown(["text/markdown"], "ordinary paragraph")).toBe(true);
  });

  it("normalizes Windows line endings before parsing fenced code blocks", () => {
    const markdown = ["before", "```ts", "const x = 1;", "```", "after"].join("\r\n");
    const html = markdownToHTML(normalizeMarkdownLineEndings(markdown));

    expect(html).toContain("<pre><code data-language=\"ts\">const x = 1;</code></pre>");
    expect(html).not.toContain("```");
  });
});
