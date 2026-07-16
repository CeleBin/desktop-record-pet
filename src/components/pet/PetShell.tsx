import { useCallback, useEffect, useRef, useState } from "react";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import { listRecords, runAiTask, showMainPanel } from "../../lib/tauri";
import { createProactivePetChatRequest } from "../../lib/petProactive";
import { getPetWindowSize } from "../../lib/petWindowSize";
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
    const rootBackground = document.documentElement.style.background;
    const bodyBackground = document.body.style.background;
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    return () => {
      document.documentElement.style.background = rootBackground;
      document.body.style.background = bodyBackground;
    };
  }, []);

  useEffect(() => {
    const size = getPetWindowSize({ bubbleVisible: Boolean(bubble), menuOpen });
    void appWindow.setSize(new LogicalSize(size.width, size.height)).catch(() => {
      // Keep the pet usable if a platform declines a transparent-window resize.
    });
  }, [bubble, menuOpen]);

  const startProactiveChat = useCallback(async (manual: boolean) => {
    if (!manual && (settings.pet_proactive_ai_enabled !== "true" || bubble)) return;
    if (manual) setBubble("汪，我想想怎么和你开场…");
    const now = Date.now();
    const minInterval = Number(settings.pet_proactive_min_interval_minutes ?? "120") * 60_000;
    const last = Number(localStorage.getItem("pet-proactive-ai-at") ?? "0");
    if (!manual && now - last < minInterval) return;
    try {
      const records = await listRecords({ limit: 1 });
      const run = await runAiTask(createProactivePetChatRequest(
        records.map((record) => record.id),
        settings.pet_persona ?? "gentle-companion",
        settings.pet_custom_prompt || null,
      ));
      const result = run.result_json ? JSON.parse(run.result_json) as { reply?: string } : null;
      if (result?.reply) {
        localStorage.setItem("pet-proactive-ai-at", String(now));
        setBubble(result.reply);
      } else if (manual) {
        setBubble("这次没能想好开场白，稍后再试一次吧。");
      }
    } catch {
      if (manual) setBubble("这次没能想好开场白，稍后再试一次吧。");
      // A scheduled invitation is optional; model failures must stay silent.
    }
  }, [bubble, settings.pet_custom_prompt, settings.pet_persona, settings.pet_proactive_ai_enabled, settings.pet_proactive_min_interval_minutes]);

  useEffect(() => {
    const maybeStartProactiveChat = () => {
      void startProactiveChat(false);
    };
    const timer = window.setInterval(maybeStartProactiveChat, 60_000);
    maybeStartProactiveChat();
    return () => window.clearInterval(timer);
  }, [startProactiveChat]);

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
      className="relative flex h-screen w-screen select-none items-end justify-center overflow-hidden pb-2"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onContextMenu={handleContextMenu}
    >
      <img
        src="/assets/pixel-dog.png"
        alt="像素小狗桌宠"
        draggable={false}
        className="h-28 w-24 object-contain [image-rendering:pixelated] transition-transform duration-300"
        style={{
          transform: `translateX(${eyeOffset}) scale(${dragging ? 0.92 : 1})`,
          opacity: currentPose === "blink" ? 0.86 : 1,
        }}
      />

      {/* ── Idle bubble hint ── */}
      <div className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 opacity-0 transition-opacity duration-700 group-hover:opacity-100">
        <div className="whitespace-nowrap rounded-full border border-border bg-surface/80 px-2.5 py-1 text-[9px] text-text-muted backdrop-blur-sm">
          click to open · drag to move
        </div>
      </div>

      {bubble && (
        <div className="absolute bottom-28 left-1/2 z-40 w-52 -translate-x-1/2 rounded-2xl border border-primary/25 bg-surface/95 p-3 text-xs leading-5 text-text shadow-xl backdrop-blur" onMouseDown={(event) => event.stopPropagation()} onMouseUp={(event) => event.stopPropagation()}>
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
          onManualCompanionInvite={() => {
            handleCloseMenu();
            void startProactiveChat(true);
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
