# Code block height limit design

Date: 2026-10-29

## Goal

Keep long code blocks from taking over the note view while preserving access to all code.

## User-facing behavior

- In both the WYSIWYG editor and read-only note view, the rendered code content area, including wrapped lines, has a default maximum height of 500 CSS pixels. The editor toolbar or read-view expand control stays outside this limit and visible.
- When the code content exceeds the limit, the content area scrolls vertically within the code block and the toolbar shows an expand control.
- Expanding removes the height cap and the inner vertical scrollbar. The control changes to collapse; collapsing restores the 500px cap.
- Short code blocks do not show an expand/collapse control.
- If an expanded block becomes short enough to fit within the cap, it returns to the collapsed state and hides the control. If it grows beyond the cap later, it is collapsed and scrollable again.
- The line-number gutter follows the code content's vertical scroll position.
- Expanded/collapsed state is presentation-only, held for the current editor view, and does not change Markdown serialization or note data.

## Implementation boundary

Use the existing custom BlockNote code-block node view in `src/components/panel/MarkdownEditor.tsx` and add the same behavior to the ReactMarkdown read-only renderer in `src/components/panel/RecordDetail.tsx`, with styles in `src/styles.css`. Keep the existing editor toolbar, syntax highlighting, wrapping, copying, and Markdown format. Detect overflow as code content is edited, hydrated, or resized, so the control appears and disappears when needed. Keep the ProseMirror `code` element as `contentDOM` and do not introduce a persisted block property.

## Acceptance criteria

1. A code block shorter than 500px renders without a vertical scrollbar or expand/collapse control in both editor and read-only views.
2. A code block taller than 500px shows an internal vertical scrollbar and an expand control while the editor toolbar or read-view control stays visible.
3. Expanding and collapsing toggles the cap without altering code or serialized Markdown.
4. Line numbers remain aligned with visible code lines while scrolling.
5. Shrinking an expanded block below the cap hides the control and resets it to collapsed; growing it beyond the cap later displays the collapsed, scrollable state.
6. Existing code-block actions remain usable in both states.

## Validation

Run the frontend production build and inspect the editor behavior with short and long code blocks, including content edits and vertical scrolling. Automated test changes are out of scope for this request.
