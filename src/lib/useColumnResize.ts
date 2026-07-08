import { useCallback, useEffect, useRef, useState } from "react";

// ── Layout contract ───────────────────────────────────────────────────
// MainPanel has 3 columns: nav (left aside) | list (middle section) | detail (right, flex-1).
// Only nav & list widths are persisted; detail always takes the remainder.

export type ColumnId = "nav" | "list";

export interface PanelWidths {
  nav: number;
  list: number;
}

const STORAGE_KEY = "drp-panel-widths";

const DEFAULT_WIDTHS: PanelWidths = { nav: 200, list: 360 };

const MIN_WIDTHS: PanelWidths = { nav: 150, list: 150 };
const MAX_WIDTHS: PanelWidths = { nav: 320, list: 560 };

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function clampWidth(col: ColumnId, v: number): number {
  return clamp(v, MIN_WIDTHS[col], MAX_WIDTHS[col]);
}

function loadWidths(): PanelWidths {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PanelWidths>;
      return {
        nav: clampWidth("nav", parsed.nav ?? DEFAULT_WIDTHS.nav),
        list: clampWidth("list", parsed.list ?? DEFAULT_WIDTHS.list),
      };
    }
  } catch {
    // ignore parse / quota errors — fall back to defaults
  }
  return { ...DEFAULT_WIDTHS };
}

interface DragState {
  col: ColumnId;
  startX: number;
  startWidth: number;
}

/**
 * Column resize controller for MainPanel.
 *
 * - widths: current pixel widths for nav & list columns
 * - startResize(col): pointerdown handler to attach on a resize handle
 * - resetColumn(col): restore a single column to its default width (double-click)
 *
 * Drag listeners are attached to `window` so a fast pointer move never escapes.
 * Text selection + cursor are globally locked during drag.
 */
export function useColumnResize() {
  const [widths, setWidths] = useState<PanelWidths>(loadWidths);
  const dragRef = useRef<DragState | null>(null);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = e.clientX - drag.startX;
    const next = clampWidth(drag.col, drag.startWidth + delta);
    setWidths((w) => (w[drag.col] === next ? w : { ...w, [drag.col]: next }));
  }, []);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
  }, [handlePointerMove]);

  const startResize = useCallback(
    (col: ColumnId) => (e: React.PointerEvent) => {
      // Only respond to primary button; ignore right-click / middle-click.
      if (e.button !== 0) return;
      e.preventDefault();
      const startWidth = widths[col];
      dragRef.current = { col, startX: e.clientX, startWidth };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
    },
    [widths, handlePointerMove, handlePointerUp],
  );

  const resetColumn = useCallback((col: ColumnId) => {
    setWidths((w) =>
      w[col] === DEFAULT_WIDTHS[col]
        ? w
        : { ...w, [col]: DEFAULT_WIDTHS[col] },
    );
  }, []);

  // Persist on change. Write is cheap (only fires when widths actually changes).
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
    } catch {
      // ignore quota errors
    }
  }, [widths]);

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

  return { widths, startResize, resetColumn };
}
