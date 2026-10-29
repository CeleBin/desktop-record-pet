# Code block height limit design

Date: 2026-10-29

## Goal

Keep long code blocks from taking over the note view while preserving access to all code.

## User-facing behavior

- The code content area has a default maximum height of 500 CSS pixels. The language toolbar is outside this limit and stays visible.
- When the code content exceeds the limit, the content area scrolls vertically within the code block and the toolbar shows an expand control.
- Expanding removes the height cap and the inner vertical scrollbar. The control changes to collapse; collapsing restores the 500px cap.
- Short code blocks do not show an expand/collapse control.
- The line-number gutter follows the code content's vertical scroll position.
- Expanded/collapsed state is presentation-only, held for the current editor view, and does not change Markdown serialization or note data.

## Implementation boundary

Use the existing custom BlockNote code-block node view in `src/components/panel/MarkdownEditor.tsx` and its styles in `src/styles.css`. Keep the existing toolbar, syntax highlighting, wrapping, copying, and Markdown format. Detect overflow as code content is edited, hydrated, or resized, so the control appears and disappears when needed. Keep the ProseMirror `code` element as `contentDOM` and do not introduce a persisted block property.

## Acceptance criteria

1. A code block shorter than 500px renders without a vertical scrollbar or expand/collapse control.
2. A code block taller than 500px shows an internal vertical scrollbar and an expand control while its language toolbar stays visible.
3. Expanding and collapsing toggles the cap without altering code or serialized Markdown.
4. Line numbers remain aligned with visible code lines while scrolling.
5. Existing code-block actions remain usable in both states.

## Validation

Run the frontend production build and inspect the editor behavior with short and long code blocks, including content edits and vertical scrolling. Automated test changes are out of scope for this request.
