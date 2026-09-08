import { describe, expect, it } from "vitest";
import {
  filterCodeLanguages,
  getCodeBlockSourceText,
  getCodeLineCount,
} from "./codeBlockUi";

const languages = {
  text: { name: "纯文本", aliases: ["plaintext", "txt"] },
  json: { name: "JSON" },
  javascript: { name: "JavaScript", aliases: ["js"] },
  python: { name: "Python", aliases: ["py"] },
};

describe("code block toolbar", () => {
  it("filters languages by display name, id, and aliases", () => {
    expect(filterCodeLanguages(languages, "script").map(([id]) => id)).toEqual([
      "javascript",
    ]);
    expect(filterCodeLanguages(languages, "py").map(([id]) => id)).toEqual([
      "python",
    ]);
  });

  it("keeps every language visible for an empty search", () => {
    expect(filterCodeLanguages(languages, "")).toHaveLength(4);
  });

  it("returns one line for empty code and counts trailing lines", () => {
    expect(getCodeLineCount("")).toBe(1);
    expect(getCodeLineCount("const a = 1;\n")).toBe(2);
  });

  it("preserves ProseMirror hard breaks when reading code block content", () => {
    const text = (value: string) => ({ nodeType: 3, nodeValue: value, childNodes: [] });
    const br = { nodeType: 1, nodeValue: null, tagName: "BR", childNodes: [] };
    const root = {
      nodeType: 1,
      nodeValue: null,
      tagName: "CODE",
      childNodes: [text("first"), br, text("second")],
    };

    expect(getCodeBlockSourceText(root)).toBe("first\nsecond");
  });

  it("does not copy the editor's synthetic trailing break as a source newline", () => {
    const placeholder = {
      nodeType: 1, nodeValue: null, tagName: "BR",
      classList: { contains: (name: string) => name === "ProseMirror-trailingBreak" },
    };
    expect(getCodeBlockSourceText({
      nodeType: 1, nodeValue: null,
      childNodes: [{ nodeType: 3, nodeValue: "hello\n" }, placeholder],
    })).toBe("hello\n");
    expect(getCodeBlockSourceText(placeholder)).toBe("");
  });
});
