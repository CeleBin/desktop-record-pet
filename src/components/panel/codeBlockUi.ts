export interface CodeLanguage {
  name: string;
  aliases?: string[];
}

interface CodeBlockDomNode {
  nodeType: number;
  nodeValue: string | null;
  tagName?: string;
  childNodes?: ArrayLike<CodeBlockDomNode>;
  classList?: { contains: (name: string) => boolean };
}

/**
 * ProseMirror uses <br> nodes for hard line breaks inside code blocks. DOM
 * textContent discards those breaks, so walk the content tree explicitly.
 */
export function getCodeBlockSourceText(node: CodeBlockDomNode): string {
  if (node.nodeType === 3) return node.nodeValue ?? "";
  if (node.nodeType === 1 && node.tagName === "BR") {
    return node.classList?.contains("ProseMirror-trailingBreak") ? "" : "\n";
  }
  return Array.from(node.childNodes ?? [], getCodeBlockSourceText).join("");
}

export function filterCodeLanguages<T extends Record<string, CodeLanguage>>(
  languages: T,
  query: string,
): [keyof T & string, CodeLanguage][] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return Object.entries(languages).filter(([id, language]) => {
    if (!normalizedQuery) return true;
    return [id, language.name, ...(language.aliases ?? [])].some((candidate) =>
      candidate.toLocaleLowerCase().includes(normalizedQuery),
    );
  }) as [keyof T & string, CodeLanguage][];
}

export function getCodeLineCount(code: string): number {
  return code.split("\n").length;
}

/** Read native glyph positions; never wrap or rewrite editable code. */
export function measureCodeLines(code: HTMLElement): number[] {
  const origin = code.getBoundingClientRect().top;
  const lineHeight = parseFloat(getComputedStyle(code).lineHeight) || 20;
  const tops: number[] = [];
  let atLineStart = true;
  let nextLineTop = 0;
  const range = document.createRange();
  const measure = (node: Node, offset: number, end: number) => {
    range.setStart(node, offset);
    range.setEnd(node, end);
    const rect = range.getClientRects()[0];
    tops.push(rect ? Math.round(rect.top - origin) : (tops[tops.length - 1] ?? -lineHeight) + lineHeight);
  };
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue ?? "";
      for (let i = 0; i < text.length; i++) {
        if (atLineStart) measure(node, i, i + 1);
        atLineStart = text[i] === "\n";
        if (atLineStart) {
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const rect = range.getClientRects()[0];
          nextLineTop = (rect ? Math.round(rect.top - origin) : tops[tops.length - 1]) + lineHeight;
        }
      }
    } else if (node instanceof HTMLBRElement) {
      if (node.classList.contains("ProseMirror-trailingBreak")) return;
      range.selectNode(node);
      const rect = range.getClientRects()[0];
      if (atLineStart) {
        tops.push(rect ? Math.round(rect.top - origin) : (tops[tops.length - 1] ?? -lineHeight) + lineHeight);
      }
      nextLineTop = (rect ? Math.round(rect.top - origin) : tops[tops.length - 1]) + lineHeight;
      atLineStart = true;
    } else {
      node.childNodes.forEach(visit);
    }
  };
  visit(code);
  if (atLineStart) tops.push(nextLineTop);
  // Range rectangles start at the glyph, while gutter spans use line boxes.
  return tops.map((top) => top - tops[0]);
}

