import { useCallback, useEffect, useRef, useState } from "react";

// ── Layout contract ───────────────────────────────────────────────────
// RecordDetail's edit view splits into editor (textarea) | preview (Markdown).
// This hook synchronizes the two panes' scroll positions proportionally:
// when the user scrolls one pane, the other scrolls by the same *fraction*
// of its scrollable range so that corresponding content stays aligned.
//
// Why proportional (not line-mapped): the editor is raw Markdown while the
// preview is rendered HTML — there is no 1:1 line correspondence. Mapping by
// scroll fraction keeps the two panes visually anchored at the same relative
// depth in the document, which is the most useful approximation.

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
export function useEditorPreviewSyncScroll(enabled: boolean) {
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
      const ratio = editor.scrollTop / maxE;
      lockRef.current = true;
      preview.scrollTop = ratio * maxP;
      requestAnimationFrame(() => {
        lockRef.current = false;
      });
    };

    const syncFromPreview = () => {
      if (lockRef.current) return;
      const maxE = editor.scrollHeight - editor.clientHeight;
      const maxP = preview.scrollHeight - preview.clientHeight;
      if (maxE <= 0 || maxP <= 0) return;
      const ratio = preview.scrollTop / maxP;
      lockRef.current = true;
      editor.scrollTop = ratio * maxE;
      requestAnimationFrame(() => {
        lockRef.current = false;
      });
    };

    editor.addEventListener("scroll", syncFromEditor, { passive: true });
    preview.addEventListener("scroll", syncFromPreview, { passive: true });
    return () => {
      editor.removeEventListener("scroll", syncFromEditor);
      preview.removeEventListener("scroll", syncFromPreview);
      // Defensive: clear lock on teardown in case a rAF unlock is pending.
      lockRef.current = false;
    };
  }, [syncScroll, enabled]);

  return { syncScroll, toggle, setSyncScroll, editorRef, previewRef };
}
