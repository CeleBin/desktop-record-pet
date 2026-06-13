import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import { showMainPanel } from "../../lib/tauri";
import { PetMenu } from "./PetMenu";

const appWindow = getCurrentWebviewWindow();

type IdlePose = "idle" | "blink" | "look-left" | "look-right";

const POSE_SEQUENCE: { pose: IdlePose; duration: number }[] = [
  { pose: "idle", duration: 2200 },
  { pose: "blink", duration: 160 },
  { pose: "idle", duration: 1400 },
  { pose: "blink", duration: 160 },
  { pose: "idle", duration: 3000 },
  { pose: "look-left", duration: 600 },
  { pose: "idle", duration: 1800 },
  { pose: "look-right", duration: 600 },
  { pose: "idle", duration: 2000 },
  { pose: "blink", duration: 160 },
];

export function PetShell() {
  const [poseIndex, setPoseIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const dragActive = useRef(false);

  // ── Idle animation loop ──
  useEffect(() => {
    const step = POSE_SEQUENCE[poseIndex % POSE_SEQUENCE.length];
    const timer = setTimeout(() => {
      setPoseIndex((i) => i + 1);
    }, step.duration);
    return () => clearTimeout(timer);
  }, [poseIndex]);

  const currentPose = POSE_SEQUENCE[poseIndex % POSE_SEQUENCE.length].pose;

  // ── Drag handling: start drag on mousedown after a tiny threshold ──
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragStart.current = { x: e.screenX, y: e.screenY };
    dragActive.current = false;
    setDragging(false);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragStart.current || dragActive.current) return;
    const dx = Math.abs(e.screenX - dragStart.current.x);
    const dy = Math.abs(e.screenY - dragStart.current.y);
    if (dx > 4 || dy > 4) {
      dragActive.current = true;
      setDragging(true);
      dragStart.current = null;
      void appWindow.startDragging();
    }
  }, []);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;

    if (dragActive.current) {
      // Was a drag, just clean up
      dragActive.current = false;
      setDragging(false);
      return;
    }

    // dragStart still set = no significant movement = click
    if (dragStart.current) {
      dragStart.current = null;
      void showMainPanel();
      return;
    }

    setDragging(false);
  }, []);

  // ── Context menu ──
  const handleMouseLeave = useCallback(() => {
    // Cancel any pending click when mouse leaves the element
    dragStart.current = null;
    dragActive.current = false;
    setDragging(false);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setMenuOpen(true);
  }, []);

  const handleCloseMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

  // ── Eye rendering based on pose ──
  const eyeOffset = currentPose === "look-left" ? "-2px" : currentPose === "look-right" ? "2px" : "0px";

  return (
    <div
      className="relative flex h-screen w-screen select-none items-center justify-center overflow-hidden"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onContextMenu={handleContextMenu}
    >
      {/* ── Glow aura ── */}
      <div
        className="pointer-events-none absolute h-20 w-20 rounded-full opacity-30 blur-2xl transition-all duration-1000"
        style={{
          background:
            currentPose === "idle"
              ? "radial-gradient(circle, rgba(245,158,11,0.5) 0%, rgba(52,211,153,0.2) 70%, transparent 100%)"
              : "radial-gradient(circle, rgba(245,158,11,0.7) 0%, rgba(52,211,153,0.3) 70%, transparent 100%)",
        }}
      />

      {/* ── Pet body ── */}
      <div
        className="relative flex h-[72px] w-[72px] items-center justify-center rounded-full transition-all duration-[2000ms] ease-in-out"
        style={{
          background:
            "radial-gradient(circle at 40% 35%, rgba(251,191,36,0.9) 0%, rgba(217,119,6,0.7) 40%, rgba(180,83,9,0.4) 100%)",
          boxShadow:
            currentPose === "blink"
              ? "0 0 20px rgba(245,158,11,0.4), inset 0 -2px 8px rgba(0,0,0,0.3)"
              : "0 0 30px rgba(245,158,11,0.25), inset 0 -2px 8px rgba(0,0,0,0.3)",
          transform: dragging ? "scale(0.92)" : "scale(1)",
        }}
      >
        {/* Highlight sheen */}
        <div className="absolute left-[14px] top-[12px] h-[18px] w-[24px] rounded-full bg-white/20 blur-sm" />

        {/* ── Eyes ── */}
        <div className="mt-3 flex gap-3.5">
          <span
            className="block h-[5px] w-[5px] rounded-full bg-amber-50 transition-all duration-500"
            style={{
              transform: `translateX(${eyeOffset})`,
              opacity: currentPose === "blink" ? 0 : 1,
            }}
          />
          <span
            className="block h-[5px] w-[5px] rounded-full bg-amber-50 transition-all duration-500"
            style={{
              transform: `translateX(${eyeOffset})`,
              opacity: currentPose === "blink" ? 0 : 1,
            }}
          />
        </div>
      </div>

      {/* ── Floor shadow ── */}
      <div
        className="pointer-events-none absolute bottom-3 h-1.5 w-10 rounded-full bg-black/20 blur-sm transition-all duration-1000"
        style={{
          transform: dragging ? "scaleX(0.7)" : "scaleX(1)",
          opacity: dragging ? 0.4 : 0.6,
        }}
      />

      {/* ── Idle bubble hint ── */}
      <div className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 opacity-0 transition-opacity duration-700 group-hover:opacity-100">
        <div className="whitespace-nowrap rounded-full border border-white/[8%] bg-slate-900/80 px-2.5 py-1 text-[9px] text-slate-400 backdrop-blur-sm">
          click to open · drag to move
        </div>
      </div>

      {/* ── Context menu ── */}
      {menuOpen && (
        <PetMenu
          onClose={handleCloseMenu}
          onOpenPanel={() => {
            handleCloseMenu();
            void showMainPanel();
          }}
        />
      )}
    </div>
  );
}
