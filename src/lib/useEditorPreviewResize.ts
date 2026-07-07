import { useCallback, useEffect, useRef, useState } from "react";

// ── Layout contract ───────────────────────────────────────────────────
// RecordDetail's edit view splits into editor (textarea) | preview (Markdown).
// Both share the RecordDetail's inner width. The split is expressed as a
// ratio (0..1) rather than pixels so that when RecordDetail itself resizes
// (e.g. nav column widens), editor & preview shrink PROPORTIONALLY —
// preserving the user-set ratio instead of one side absorbing all the delta.

const STORAGE_KEY = "drp-editor-ratio";

const DEFAULT_RATIO = 0.5;
const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;

function clampRatio(v: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, v));
}

function loadRatio(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = Number(JSON.parse(raw));
      if (Number.isFinite(parsed)) return clampRatio(parsed);
    }
  } catch {
    // ignore parse / quota errors — fall back to default
  }
  return DEFAULT_RATIO;
}

interface DragState {
  startX: number;
  startRatio: number;
  containerWidth: number;
}

/**
 * Ratio-based resize controller for the editor ↔ preview split inside
 * RecordDetail's edit view.
 *
 * - ratio: editor's share of the container width (0..1); preview gets 1-ratio
 * - startResize: pointerdown handler for the handle between editor & preview
 * - resetRatio: restore 50/50 split (double-click on the handle)
 *
 * Why ratio (not pixels): when the nav column or list column resizes,
 * RecordDetail's width changes. With a ratio, both editor and preview
 * shrink/grow proportionally — at 70/30, a 200px loss becomes -140/-60,
 * not -200/-0. This keeps the user's chosen split stable across layout
 * changes.
 *
 * The container width is measured on pointerdown from the handle's parent
 * element, so no ResizeObserver is needed.
 */
export function useEditorPreviewResize() {
  const [ratio, setRatio] = useState(loadRatio);
  const dragRef = useRef<DragState | null>(null);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.containerWidth <= 0) return;
    const delta = e.clientX - drag.startX;
    const next = clampRatio(drag.startRatio + delta / drag.containerWidth);
    setRatio((r) => (r === next ? r : next));
  }, []);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
  }, [handlePointerMove]);

  const startResize = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      // Measure the flex container (handle's parent) to convert pixel delta
      // into a ratio delta. Measuring on pointerdown avoids stale widths if
      // the container resizes mid-drag (it won't during a drag, but be safe).
      const container = e.currentTarget.parentElement;
      const containerWidth = container?.getBoundingClientRect().width ?? 0;
      dragRef.current = { startX: e.clientX, startRatio: ratio, containerWidth };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [ratio, handlePointerMove, handlePointerUp],
  );

  const resetRatio = useCallback(() => {
    setRatio((r) => (r === DEFAULT_RATIO ? r : DEFAULT_RATIO));
  }, []);

  // Persist on change.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ratio));
    } catch {
      // ignore quota errors
    }
  }, [ratio]);

  // Cleanup dangling listeners if unmounted mid-drag.
  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [handlePointerMove, handlePointerUp]);

  return { ratio, startResize, resetRatio };
}
