const MARKDOWN_PATTERNS: RegExp[] = [
  /(?:^|\r?\n) {0,3}#{1,6}\s+\S/,
  /(?:^|\r?\n) {0,3}>\s*\S/,
  /(?:^|\r?\n)\s*[-+*]\s+\S/,
  /(?:^|\r?\n)\s*\d+[.)]\s+\S/,
  /(?:^|\r?\n)\s*(?:```|~~~)/,
  /(?:^|\r?\n) {0,3}(?:\*{3,}|-{3,}|_{3,})\s*(?:\r?\n|$)/,
  /(?:^|\r?\n)\s*\|[^\r\n]+\|\s*(?:\r?\n|$)/,
  /!\[[^\]]*\]\([^\)]+\)/,
  /\[[^\]]+\]\([^\)]+\)/,
  /(\*\*|__|~~)\S[\s\S]*?\S\1/,
  /(?:^|\s)`[^`\r\n]+`(?:$|\s|[.,;:!?])/,
];

/**
 * BlockNote's Markdown fence parser expects LF line endings. Clipboard data
 * and persisted Windows files commonly use CRLF, so normalize only at the
 * parser boundary and keep the rest of the editor's text handling unchanged.
 */
export function normalizeMarkdownLineEndings(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n");
}

/**
 * Decides whether a clipboard's plain text should override an accompanying
 * HTML representation and be pasted through BlockNote's Markdown parser.
 *
 * BlockNote has a similar internal heuristic, but it intentionally only
 * covers a small subset of Markdown. Keeping this boundary in application
 * code lets us support common Markdown documents (including one-item lists)
 * without treating ordinary web paragraphs as Markdown.
 */
export function shouldPasteMarkdown(
  clipboardTypes: readonly string[],
  plainText: string,
): boolean {
  if (!plainText.trim()) return false;
  if (clipboardTypes.some((type) => type.toLowerCase() === "text/markdown")) {
    return true;
  }
  return MARKDOWN_PATTERNS.some((pattern) => pattern.test(plainText));
}
