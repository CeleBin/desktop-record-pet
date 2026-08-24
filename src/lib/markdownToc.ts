import { toString } from "mdast-util-to-string";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { unified } from "unified";
import type { Content, Root } from "mdast";

export interface TocEntry {
  level: number;
  text: string;
  index: number;
  start: number;
}

function collectHeadings(node: Root | Content, toc: TocEntry[]): void {
  if (node.type === "heading" && node.depth <= 3 && node.position?.start.offset != null) {
    const text = toString(node).trim();
    if (text) toc.push({ level: node.depth, text, index: toc.length, start: node.position.start.offset });
  }
  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) collectHeadings(child as Content, toc);
  }
}

/** Extract the same rendered h1–h3 headings used by the Markdown preview. */
export function extractMarkdownToc(markdown: string): TocEntry[] {
  if (!markdown) return [];
  const toc: TocEntry[] = [];
  collectHeadings(unified().use(remarkParse).use(remarkGfm).parse(markdown), toc);
  return toc;
}
