import { useCallback, useEffect, useRef, useState } from "react";

// ── Layout contract ───────────────────────────────────────────────────
// RecordDetail has a right-side TOC rail (rendered from Markdown headings).
// Its width is a single pixel value persisted to localStorage.
// Default 180px; clamped to [120, 360]; double-click resets to default.

const STORAGE_KEY = "drp-toc-width";

const DEFAULT_WIDTH = 180;
const MIN_WIDTH = 120;
const MAX_WIDTH = 360;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function loadWidth(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = Number(raw);
      if (!Number.isNaN(parsed)) {
        return clamp(parsed, MIN_WIDTH, MAX_WIDTH);
      }
    }
  } catch {
    // ignore parse / quota errors — fall back to default
  }
  return DEFAULT_WIDTH;
}

interface DragState {
  startX: number;
  startWidth: number;
}

/**
 * Single-column resize controller for the RecordDetail TOC rail.
 *
 * - width: current pixel width
 * - startResize: pointerdown handler to attach on the resize handle
 * - resetWidth: restore default width (double-click)
 *
 * Drag listeners are attached to `window` so a fast pointer move never escapes.
 * Text selection + cursor are globally locked during drag.
 *
 * Direction: TOC sits on the right edge; its handle is on TOC's left boundary.
 * Dragging the handle rightward shrinks TOC (content area flex-1 absorbs the
 * freed space); dragging leftward widens TOC. This is the mirror of nav/list
 * handles, which sit on their column's right boundary.
 */
export function useTocResize() {
  const [width, setWidth] = useState<number>(loadWidth);
  const dragRef = useRef<DragState | null>(null);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    // TOC sits on the right edge; its handle is on TOC's left boundary.
    // Dragging the handle rightward (delta > 0) must shrink TOC, so subtract.
    const delta = drag.startX - e.clientX;
    const next = clamp(drag.startWidth + delta, MIN_WIDTH, MAX_WIDTH);
    setWidth((w) => (w === next ? w : next));
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
      // Only respond to primary button; ignore right-click / middle-click.
      if (e.button !== 0) return;
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startWidth: width };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [width, handlePointerMove, handlePointerUp],
  );

  const resetWidth = useCallback(() => {
    setWidth((w) => (w === DEFAULT_WIDTH ? w : DEFAULT_WIDTH));
  }, []);

  // Persist on change.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(width));
    } catch {
      // ignore quota errors
    }
  }, [width]);

  // Cleanup any dangling listeners if the component unmounts mid-drag.
  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      // Best-effort body style reset; React unmount during drag is rare.
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [handlePointerMove, handlePointerUp]);

  return { width, startResize, resetWidth };
}
