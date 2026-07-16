import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import { listRecords, runAiTask, showMainPanel } from "../../lib/tauri";
import { useSettingsStore } from "../../store/settings";
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
  const settings = useSettingsStore((state) => state.settings);
  const [bubble, setBubble] = useState<string | null>(null);
  const mealShownRef = useRef<string | null>(null);

  useEffect(() => {
    const maybeStartProactiveChat = async () => {
      if (settings.pet_proactive_ai_enabled !== "true" || bubble) return;
      const now = Date.now();
      const minInterval = Number(settings.pet_proactive_min_interval_minutes ?? "120") * 60_000;
      const last = Number(localStorage.getItem("pet-proactive-ai-at") ?? "0");
      if (now - last < minInterval) return;
      try {
        const records = await listRecords({ limit: 1 });
        const run = await runAiTask({ taskType: "pet_chat", payload: {
          content: "请根据用户允许的上下文，用一句简短、不施压的方式主动问候或邀请交流。",
          retainedRecordIds: records.map((record) => record.id),
          persona: settings.pet_persona ?? "gentle-companion",
          customPrompt: settings.pet_custom_prompt || null,
        }});
        const result = run.result_json ? JSON.parse(run.result_json) as { reply?: string } : null;
        if (result?.reply) {
          localStorage.setItem("pet-proactive-ai-at", String(now));
          setBubble(result.reply);
        }
      } catch {
        // A proactive invitation is optional; model failures must stay silent.
      }
    };
    const timer = window.setInterval(() => void maybeStartProactiveChat(), 60_000);
    void maybeStartProactiveChat();
    return () => window.clearInterval(timer);
  }, [bubble, settings.pet_custom_prompt, settings.pet_persona, settings.pet_proactive_ai_enabled, settings.pet_proactive_min_interval_minutes]);

  useEffect(() => {
    const checkMealCompanion = () => {
      if (settings.pet_meal_companion_enabled !== "true") return;
      const now = new Date();
      const hour = now.getHours();
      const minute = now.getMinutes();
      const quiet = settings.pet_quiet_hours ?? "22:00-08:00";
      const [start, end] = quiet.split("-");
      const current = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      const inQuietHours = start && end && (start < end ? current >= start && current < end : current >= start || current < end);
      if (inQuietHours) return;
      const meal = hour === 12 && minute < 30 ? "午饭时间到啦，先照顾好自己再继续吧。" : hour === 18 && minute < 30 ? "晚饭时间到啦，今天辛苦了。" : null;
      const key = `${now.toDateString()}-${hour}`;
      if (meal && mealShownRef.current !== key) {
        mealShownRef.current = key;
        setBubble(meal);
      }
    };
    checkMealCompanion();
    const timer = window.setInterval(checkMealCompanion, 60_000);
    return () => window.clearInterval(timer);
  }, [settings.pet_meal_companion_enabled, settings.pet_quiet_hours]);

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
              ? `radial-gradient(circle, var(--pet-glow) 0%, color-mix(in srgb, var(--secondary) 20%, transparent) 70%, transparent 100%)`
              : `radial-gradient(circle, color-mix(in srgb, var(--pet-glow) 70%, transparent) 0%, color-mix(in srgb, var(--secondary) 30%, transparent) 70%, transparent 100%)`,
        }}
      />

      {/* ── Pet body ── */}
      <div
        className="relative flex h-[72px] w-[72px] items-center justify-center rounded-full transition-all duration-[2000ms] ease-in-out"
        style={{
          background:
            "radial-gradient(circle at 40% 35%, var(--pet-from) 0%, color-mix(in srgb, var(--primary) 70%, transparent) 40%, var(--pet-to) 100%)",
          boxShadow:
            currentPose === "blink"
              ? `0 0 20px color-mix(in srgb, var(--pet-glow) 40%, transparent), inset 0 -2px 8px rgba(0,0,0,0.3)`
              : `0 0 30px color-mix(in srgb, var(--pet-glow) 25%, transparent), inset 0 -2px 8px rgba(0,0,0,0.3)`,
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
        <div className="whitespace-nowrap rounded-full border border-border bg-surface/80 px-2.5 py-1 text-[9px] text-text-muted backdrop-blur-sm">
          click to open · drag to move
        </div>
      </div>

      {bubble && (
        <div className="absolute -top-24 left-1/2 z-40 w-52 -translate-x-1/2 rounded-2xl border border-primary/25 bg-surface/95 p-3 text-xs leading-5 text-text shadow-xl backdrop-blur" onMouseDown={(event) => event.stopPropagation()} onMouseUp={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => setBubble(null)} className="absolute right-2 top-1 text-text-muted hover:text-text">×</button>
          <p className="pr-3">{bubble}</p>
          <button type="button" onClick={() => { setBubble(null); void showMainPanel(); }} className="mt-2 rounded-full bg-primary/15 px-2.5 py-1 text-[10px] text-primary hover:bg-primary/25">聊聊</button>
        </div>
      )}

      {/* ── Context menu ── */}
      {menuOpen && (
        <PetMenu
          onClose={handleCloseMenu}
          onOpenPanel={() => {
            handleCloseMenu();
            void showMainPanel();
          }}
          onOpenChat={() => {
            handleCloseMenu();
            localStorage.setItem("open-pet-chat", "true");
            void showMainPanel();
          }}
        />
      )}
    </div>
  );
}
