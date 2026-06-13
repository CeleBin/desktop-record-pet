import { useCallback, useEffect, useRef, useState } from "react";

import { emit } from "@tauri-apps/api/event";

import { captureScreenshot, hideWindow, showWindow } from "../../lib/tauri";

const OVERLAY_LABEL = "screenshot-overlay";

interface Selection {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_SELECTION = 4;

export function ScreenshotOverlay() {
  const [isDragging, setIsDragging] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [capturing, setCapturing] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Focus the overlay so keyboard events work immediately
  useEffect(() => {
    requestAnimationFrame(() => overlayRef.current?.focus());
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only respond to left button
    if (e.button !== 0) return;
    const x = e.clientX;
    const y = e.clientY;
    setStart({ x, y });
    setSelection({ x, y, width: 0, height: 0 });
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging || !start) return;
      const currentX = e.clientX;
      const currentY = e.clientY;
      const x = Math.min(start.x, currentX);
      const y = Math.min(start.y, currentY);
      const width = Math.abs(currentX - start.x);
      const height = Math.abs(currentY - start.y);
      setSelection({ x, y, width, height });
    },
    [isDragging, start],
  );

  const doCapture = useCallback(async (sel: Selection) => {
    if (capturing) return;
    setCapturing(true);

    try {
      // Clamp minimum size so xcap doesn't reject the region
      const w = Math.max(sel.width, MIN_SELECTION);
      const h = Math.max(sel.height, MIN_SELECTION);

      const path = await captureScreenshot(sel.x, sel.y, w, h);

      // Notify the supplement box which screenshot to attach
      await emit("screenshot:captured", { path });

      // Hide overlay, show supplement box
      await hideWindow(OVERLAY_LABEL);
      await showWindow("supplement-box");
    } catch (err) {
      console.error("capture failed", err);
      setCapturing(false);
    }
  }, [capturing]);

  const cancelCapture = useCallback(() => {
    setSelection(null);
    setStart(null);
    setIsDragging(false);
    setCapturing(false);
    void hideWindow(OVERLAY_LABEL);
  }, []);

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      setIsDragging(false);
      // Auto-confirm on mouse release if a valid region exists
      if (selection && selection.width >= MIN_SELECTION && selection.height >= MIN_SELECTION) {
        void doCapture(selection);
      }
    },
    [selection, doCapture],
  );

  // Keyboard support
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cancelCapture();
        return;
      }
      if (e.key === "Enter" && selection) {
        doCapture(selection);
      }
    };

    el.addEventListener("keydown", onKeyDown);
    return () => el.removeEventListener("keydown", onKeyDown);
  }, [selection, cancelCapture, doCapture]);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 cursor-crosshair select-none"
      tabIndex={-1}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Dimmed overlay -- the box-shadow creates a "cutout" effect */}
      {selection && selection.width > 0 && selection.height > 0 && (
        <>
          {/* Selection highlight */}
          <div
            className="absolute border-2 border-sky-400 bg-white/5"
            style={{
              left: selection.x,
              top: selection.y,
              width: selection.width,
              height: selection.height,
              boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.55)",
            }}
          >
            {/* Dimension label */}
            <div className="absolute -top-7 left-0 rounded bg-sky-500 px-2 py-0.5 text-xs font-medium text-white whitespace-nowrap">
              {selection.width} &times; {selection.height}
            </div>
          </div>
        </>
      )}

      {/* Instruction hint -- shown before any selection */}
      {!selection && !isDragging && (
        <div className="pointer-events-none fixed bottom-8 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-slate-950/80 px-5 py-2 text-xs text-slate-300 backdrop-blur">
          拖拽选择截图区域 / Enter 确认 / Esc 取消
        </div>
      )}

      {capturing && (
        <div className="pointer-events-none fixed inset-0 flex items-center justify-center">
          <div className="rounded-2xl border border-sky-400/20 bg-slate-950/90 px-6 py-3 text-sm text-sky-300 backdrop-blur">
            正在截图…
          </div>
        </div>
      )}
    </div>
  );
}