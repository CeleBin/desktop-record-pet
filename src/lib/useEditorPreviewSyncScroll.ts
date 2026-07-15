import { useCallback, useEffect, useRef, useState } from "react";
import { mapAnchorScrollTop, mapSegmentScrollTop } from "./editorPreviewScrollAnchors";

// ── Layout contract ───────────────────────────────────────────────────
// RecordDetail's edit view splits into editor (textarea) | preview (Markdown).
// This hook synchronizes the two panes by matching Markdown heading anchors.
// Between two headings it maps local progress, so different rendered heights
// (images, lists, typography) do not accumulate into whole-document drift.

const STORAGE_KEY = "drp-sync-scroll";

function loadSyncScroll(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw != null) return JSON.parse(raw) === true;
  } catch {
    // ignore parse / quota errors — fall back to default (off)
  }
  return false;
}

/**
 * Proportional scroll-sync controller for the editor ↔ preview split inside
 * RecordDetail's edit view.
 *
 * - syncScroll: whether sync is currently enabled (toggled by a button)
 * - toggle: flip the preference
 * - editorRef / previewRef: attach to the textarea and the scrollable
 *   preview container respectively
 *
 * `enabled` gates listener attachment: callers should pass `editing && showPreview`
 * so listeners only bind when both panes are actually mounted. When sync is
 * on but the preview is hidden, the effect no-ops; once the preview returns,
 * the effect re-runs and re-binds.
 *
 * Feedback-loop guard: scrolling pane A programmatically sets pane B's
 * scrollTop, which fires B's scroll event. A `lockRef` flag suppresses the
 * handler for one frame (released via requestAnimationFrame) so B's event
 * does not bounce back to A. rAF (rather than "reset on B's event") is used
 * because if B is already at its scroll limit the browser may not fire a
 * scroll event at all, which would leave the lock stuck.
 */
interface ScrollAnchors {
  editor: readonly number[];
  preview: readonly number[];
}

const EMPTY_ANCHORS: ScrollAnchors = { editor: [], preview: [] };

export function useEditorPreviewSyncScroll(enabled: boolean, anchors: ScrollAnchors = EMPTY_ANCHORS) {
  const [syncScroll, setSyncScrollState] = useState(loadSyncScroll);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const lockRef = useRef(false);

  const toggle = useCallback(() => {
    setSyncScrollState((prev) => !prev);
  }, []);

  const setSyncScroll = useCallback((next: boolean) => {
    setSyncScrollState(next);
  }, []);

  const applyScroll = useCallback((target: HTMLElement, nextScrollTop: number) => {
    lockRef.current = true;
    target.scrollTop = nextScrollTop;
    requestAnimationFrame(() => {
      lockRef.current = false;
    });
  }, []);

  /** Move both panes to one matching content heading for a TOC jump. */
  const scrollToHeading = useCallback((headingIndex: number): boolean => {
    const editor = editorRef.current;
    const preview = previewRef.current;
    if (!editor || !preview) return false;

    const editorTop = mapAnchorScrollTop(
      headingIndex,
      anchors.preview,
      anchors.editor,
      editor.scrollHeight - editor.clientHeight,
    );
    const previewTop = mapAnchorScrollTop(
      headingIndex,
      anchors.editor,
      anchors.preview,
      preview.scrollHeight - preview.clientHeight,
    );
    if (editorTop == null || previewTop == null) return false;

    lockRef.current = true;
    editor.scrollTop = editorTop;
    preview.scrollTop = previewTop;
    requestAnimationFrame(() => {
      lockRef.current = false;
    });
    return true;
  }, [anchors]);

  // Persist preference so it survives reloads / window reopen.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(syncScroll));
    } catch {
      // ignore quota errors
    }
  }, [syncScroll]);

  useEffect(() => {
    if (!syncScroll || !enabled) return;
    const editor = editorRef.current;
    const preview = previewRef.current;
    if (!editor || !preview) return;

    const syncFromEditor = () => {
      if (lockRef.current) return;
      const maxE = editor.scrollHeight - editor.clientHeight;
      const maxP = preview.scrollHeight - preview.clientHeight;
      // If either pane can't scroll, nothing to sync. Still release any
      // stale lock on the next frame for safety.
      if (maxE <= 0 || maxP <= 0) return;
      const mapped = mapSegmentScrollTop(editor.scrollTop, anchors.editor, anchors.preview, maxP, maxE);
      applyScroll(preview, mapped ?? (editor.scrollTop / maxE) * maxP);
    };

    const syncFromPreview = () => {
      if (lockRef.current) return;
      const maxE = editor.scrollHeight - editor.clientHeight;
      const maxP = preview.scrollHeight - preview.clientHeight;
      if (maxE <= 0 || maxP <= 0) return;
      const mapped = mapSegmentScrollTop(preview.scrollTop, anchors.preview, anchors.editor, maxE, maxP);
      applyScroll(editor, mapped ?? (preview.scrollTop / maxP) * maxE);
    };

    editor.addEventListener("scroll", syncFromEditor, { passive: true });
    preview.addEventListener("scroll", syncFromPreview, { passive: true });
    return () => {
      editor.removeEventListener("scroll", syncFromEditor);
      preview.removeEventListener("scroll", syncFromPreview);
      // Defensive: clear lock on teardown in case a rAF unlock is pending.
      lockRef.current = false;
    };
  }, [syncScroll, enabled, anchors, applyScroll]);

  return { syncScroll, toggle, setSyncScroll, editorRef, previewRef, scrollToHeading };
}
