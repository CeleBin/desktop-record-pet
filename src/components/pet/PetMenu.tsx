import { useEffect, useRef } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import { showWindow } from "../../lib/tauri";

const appWindow = getCurrentWebviewWindow();

interface PetMenuProps {
  onClose: () => void;
  onOpenPanel: () => void;
  onOpenChat: () => void;
}

export function PetMenu({ onClose, onOpenPanel, onOpenChat }: PetMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Close on Escape
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    // Delay listener to avoid the right-click itself triggering close
    const tick = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
    }, 0);

    return () => {
      clearTimeout(tick);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const handleHide = async () => {
    onClose();
    await appWindow.hide();
  };

  return (
    <div
      ref={menuRef}
      className="absolute inset-0 z-50 flex flex-col overflow-hidden rounded-2xl border border-border bg-surface/95 shadow-2xl shadow-black/60 backdrop-blur-2xl"
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
    >
      {/* Open panel */}
      <button
        type="button"
        onClick={onOpenPanel}
        className="flex w-full flex-1 items-center gap-2.5 px-3.5 py-2.5 text-xs text-text transition hover:bg-white/[6%]"
      >
        <svg className="h-3.5 w-3.5 text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
        </svg>
        Open Panel
      </button>

      {/* Todo overlay */}
      <button
        type="button"
        onClick={onOpenChat}
        className="flex w-full flex-1 items-center gap-2.5 px-3.5 py-2.5 text-xs text-text transition hover:bg-white/[6%]"
      >
        <span className="text-secondary">✦</span>
        和搭子聊聊
      </button>

      {/* Todo overlay */}
      <button
        type="button"
        onClick={() => {
          onClose();
          void showWindow("todo-overlay");
        }}
        className="flex w-full flex-1 items-center gap-2.5 px-3.5 py-2.5 text-xs text-text transition hover:bg-white/[6%]"
      >
        <svg className="h-3.5 w-3.5 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
        </svg>
        Todo Overlay
      </button>

      {/* Separator */}
      <div className="mx-3 h-px bg-white/[6%]" />

      {/* Hide */}
      <button
        type="button"
        onClick={handleHide}
        className="flex w-full flex-1 items-center gap-2.5 px-3.5 py-2.5 text-xs text-text-muted transition hover:bg-white/[6%] hover:text-text"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
        </svg>
        Hide Pet
      </button>

      {/* Separator */}
      <div className="mx-3 h-px bg-white/[6%]" />

      {/* Quit */}
      <button
        type="button"
        onClick={() => {
          onClose();
          void appWindow.close();
        }}
        className="flex w-full flex-1 items-center gap-2.5 px-3.5 py-2.5 text-xs text-danger transition hover:bg-danger/10"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
        </svg>
        Quit
      </button>
    </div>
  );
}
