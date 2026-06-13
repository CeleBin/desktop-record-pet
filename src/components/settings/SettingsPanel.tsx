import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSettingsStore } from "../../store/settings";

// ── Known setting key schema ──────────────────────────────────────────

interface SettingDef {
  label: string;
  description: string;
  type: "text" | "boolean" | "select" | "shortcut";
  options?: { label: string; value: string }[];
  category: "general" | "capture" | "ai" | "notification" | "pet" | "overlay";
  placeholder?: string;
  mask?: boolean; // mask input value
}

const SETTING_DEFS: Record<string, SettingDef> = {
  language: {
    label: "界面语言",
    description: "应用界面显示语言",
    type: "select",
    options: [
      { label: "中文", value: "zh-CN" },
      { label: "English", value: "en" },
    ],
    category: "general",
  },
  auto_ocr: {
    label: "自动 OCR",
    description: "截图后自动识别图片中的文字",
    type: "boolean",
    category: "capture",
  },
  screenshot_quality: {
    label: "截图质量",
    description: "截图图片保存质量（1-3）",
    type: "select",
    options: [
      { label: "标准", value: "2" },
      { label: "高清", value: "3" },
      { label: "压缩", value: "1" },
    ],
    category: "capture",
  },
  quick_capture_shortcut: {
    label: "笔记快捷键",
    description: "点击后按组合键设置，用于快速打开笔记/速记输入框",
    type: "shortcut",
    category: "capture",
    placeholder: "Ctrl+Shift+1",
  },
  screenshot_shortcut: {
    label: "截图快捷键",
    description: "点击后按组合键设置，用于启动截图覆盖层",
    type: "shortcut",
    category: "capture",
    placeholder: "Ctrl+Shift+2",
  },
  ai_provider: {
    label: "AI 提供商",
    description: "用于智能分析的 AI 服务",
    type: "select",
    options: [
      { label: "Claude", value: "claude" },
      { label: "OpenAI", value: "openai" },
    ],
    category: "ai",
  },
  ai_model: {
    label: "AI 模型",
    description: "使用的 AI 模型名称",
    type: "text",
    placeholder: "claude-sonnet-4-20250514",
    category: "ai",
  },
  ai_auto_analyze: {
    label: "自动分析",
    description: "新增记录后自动进行 AI 分析",
    type: "boolean",
    category: "ai",
  },
  ai_api_key: {
    label: "API 密钥",
    description: "AI 服务的 API 密钥",
    type: "text",
    mask: true,
    placeholder: "sk-…",
    category: "ai",
  },
  reminder_channel: {
    label: "提醒方式",
    description: "任务提醒的推送渠道",
    type: "select",
    options: [
      { label: "宠物气泡", value: "pet-bubble" },
      { label: "系统通知", value: "system-notification" },
    ],
    category: "notification",
  },
  pet_always_on_top: {
    label: "置顶显示",
    description: "宠物窗口始终置顶",
    type: "boolean",
    category: "pet",
  },
  pet_visible: {
    label: "启动时显示",
    description: "应用启动时自动显示宠物",
    type: "boolean",
    category: "pet",
  },

  // ── Todo-overlay settings ──

  todo_overlay_visibility_mode: {
    label: "覆盖层显示模式",
    description: "待办覆盖层显示哪些任务",
    type: "select",
    options: [
      { label: "仅未完成", value: "unfinished-only" },
      { label: "所有任务", value: "all-tasks" },
    ],
    category: "overlay",
  },
  todo_overlay_always_on_top: {
    label: "覆盖层置顶",
    description: "待办覆盖层窗口始终置顶",
    type: "boolean",
    category: "overlay",
  },
  todo_overlay_opacity: {
    label: "覆盖层透明度",
    description: "待办覆盖层背景透明度（0.0~1.0）",
    type: "select",
    options: [
      { label: "20%", value: "0.2" },
      { label: "40%", value: "0.4" },
      { label: "60%", value: "0.6" },
      { label: "80%", value: "0.8" },
      { label: "100%", value: "1.0" },
    ],
    category: "overlay",
  },
  todo_overlay_auto_collapse: {
    label: "自动折叠",
    description: "打开覆盖层时自动折叠列表",
    type: "boolean",
    category: "overlay",
  },
  todo_overlay_open_behavior: {
    label: "点击打开方式",
    description: "点击待办条目时默认打开方式",
    type: "select",
    options: [
      { label: "侧边抽屉", value: "drawer" },
      { label: "主面板", value: "main-panel" },
    ],
    category: "overlay",
  },
};

const CATEGORY_META: Record<
  string,
  { label: string; icon: string; description: string }
> = {
  general: {
    label: "通用",
    icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
    description: "语言、外观等基础设置",
  },
  capture: {
    label: "截取",
    icon: "M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5",
    description: "截图、拖放等采集行为",
  },
  ai: {
    label: "智能分析",
    icon: "M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z",
    description: "AI 提供商、模型与分析行为",
  },
  notification: {
    label: "通知",
    icon: "M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0",
    description: "提醒推送渠道与行为",
  },
  pet: {
    label: "宠物",
    icon: "M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm-.375 0h.008v.015h-.008V9.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75z",
    description: "桌面宠物的显示与行为",
  },
  overlay: {
    label: "待办覆盖层",
    icon: "M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25",
    description: "桌面待办覆盖层的显示与行为",
  },
};

// ── Toggle switch component ───────────────────────────────────────────

function Toggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className={`
        relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full
        transition-all duration-200
        ${enabled ? "bg-amber-400" : "bg-slate-700/60"}
      `}
    >
      <span
        className={`
          pointer-events-none inline-block h-3.5 w-3.5 rounded-full
          bg-white shadow-sm ring-1 ring-black/5 transition-all duration-200
          ${enabled ? "translate-x-[18px]" : "translate-x-[3px]"}
          mt-[3px]
        `}
      />
    </button>
  );
}

// ── Shortcut input component ───────────────────────────────────────────

function ShortcutInput({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (val: string) => void;
  error?: string | null;
}) {
  const [recording, setRecording] = useState(false);
  const [pendingMods, setPendingMods] = useState<string[]>([]);

  // Global keydown capture while recording
  useEffect(() => {
    if (!recording) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setRecording(false);
        setPendingMods([]);
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      const mods: string[] = [];
      if (e.ctrlKey) mods.push("Ctrl");
      if (e.shiftKey) mods.push("Shift");
      if (e.altKey) mods.push("Alt");
      if (e.metaKey) mods.push("Super");

      const isModifier = ["Control", "Shift", "Alt", "Meta"].includes(e.key);

      if (!isModifier) {
        const keyName = e.key === " " ? "Space" : e.key;
        const combo = [...mods, keyName].join("+");
        setRecording(false);
        setPendingMods([]);
        onChange(combo);
      } else {
        setPendingMods(mods);
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [recording, onChange]);

  // Sync pending mods when entering recording
  useEffect(() => {
    if (recording) {
      setPendingMods([]);
    }
  }, [recording]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setRecording(true)}
        className={`
          inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5
          text-xs font-mono transition-all min-w-[80px]
          ${
            recording
              ? "border-amber-400/50 bg-amber-400/10 text-amber-300 ring-2 ring-amber-400/20"
              : "border-white/10 bg-slate-800/80 text-slate-200 hover:border-white/20"
          }
          ${error ? "border-rose-400/50 ring-1 ring-rose-400/20" : ""}
        `}
      >
        {recording ? (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
            {pendingMods.length > 0
              ? pendingMods.join("+") + "+…"
              : "按下快捷键…"}
          </span>
        ) : value ? (
          <span className="flex items-center gap-0.5">
            {value.split("+").map((part, i) => (
              <span key={i} className="flex items-center gap-0.5">
                {i > 0 && <span className="text-slate-600 select-none">+</span>}
                <kbd className="rounded bg-slate-700/60 px-1 py-0.5 text-[10px] font-medium text-slate-300">
                  {part}
                </kbd>
              </span>
            ))}
          </span>
        ) : (
          <span className="text-slate-500">未设置</span>
        )}
      </button>

      {error && (
        <div className="pointer-events-none mt-1.5 w-56 text-[10px] leading-relaxed text-rose-400">
          <div className="rounded-lg border border-rose-400/10 bg-rose-400/5 px-2.5 py-1.5">
            {error}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Setting row ───────────────────────────────────────────────────────

function SettingRow({
  def,
  value,
  error,
  onChange,
}: {
  def: SettingDef;
  value: string;
  error?: string | null;
  onChange: (val: string) => void;
}) {
  const [showMasked, setShowMasked] = useState(false);
  const [localText, setLocalText] = useState(value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const isDirty = localText !== (value ?? "");

  useEffect(() => {
    setLocalText(value ?? "");
  }, [value]);

  const commitText = useCallback(() => {
    if (isDirty) {
      onChange(localText);
    }
  }, [isDirty, localText, onChange]);

  return (
    <div className="group flex items-center justify-between gap-4 rounded-xl px-4 py-3 transition hover:bg-white/[3%]">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-200">{def.label}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-slate-500">
          {def.description}
        </p>
      </div>

      <div className="shrink-0">
        {def.type === "boolean" ? (
          <Toggle
            enabled={value === "true"}
            onChange={(v) => onChange(v ? "true" : "false")}
          />
        ) : def.type === "select" && def.options ? (
          <select
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className="appearance-none rounded-lg border border-white/10 bg-slate-800/80
              px-3 py-1.5 text-xs text-slate-200 outline-none transition
              hover:border-white/20 focus:border-amber-400/40 focus:ring-2 focus:ring-amber-400/20
              cursor-pointer"
          >
            {(def.options ?? []).map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : def.type === "shortcut" ? (
          <ShortcutInput
            value={value}
            onChange={onChange}
            error={error}
          />
        ) : (
          <div className="relative">
            <input
              ref={inputRef}
              type={def.mask && !showMasked ? "password" : "text"}
              value={localText}
              onChange={(e) => setLocalText(e.target.value)}
              onBlur={() => commitText()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  inputRef.current?.blur();
                }
                if (e.key === "Escape") {
                  setLocalText(value ?? "");
                  inputRef.current?.blur();
                }
              }}
              placeholder={def.placeholder ?? ""}
              className="w-48 rounded-lg border border-white/10 bg-slate-800/80
                px-3 py-1.5 text-xs text-slate-200 outline-none transition
                placeholder:text-slate-600
                hover:border-white/20 focus:border-amber-400/40 focus:ring-2 focus:ring-amber-400/20"
            />
            {def.mask && value && (
              <button
                type="button"
                onClick={() => setShowMasked(!showMasked)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500
                  hover:text-slate-300 transition"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  {showMasked ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  )}
                </svg>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Settings Panel ───────────────────────────────────────────────

interface SettingsPanelProps {
  onClose?: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const {
    settings,
    loading,
    error,
    shortcutErrors,
    loadSettings,
    setSetting,
    setShortcut,
    resetSettings,
    clearShortcutError,
  } = useSettingsStore();

  const [resetting, setResetting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Load settings on mount
  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // Auto-dismiss success message
  useEffect(() => {
    if (successMsg) {
      const timer = setTimeout(() => setSuccessMsg(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [successMsg]);

  const handleChange = useCallback(
    async (key: string, value: string) => {
      const def = SETTING_DEFS[key];
      if (def?.type === "shortcut") {
        clearShortcutError(key);
        const ok = await setShortcut(key, value);
        if (ok) {
          setSuccessMsg("快捷键已保存");
        }
      } else {
        await setSetting(key, value);
        setSuccessMsg("已保存");
      }
    },
    [setSetting, setShortcut, clearShortcutError],
  );

  const handleReset = useCallback(async () => {
    setResetting(true);
    try {
      await resetSettings();
      setSuccessMsg("已重置为默认值");
    } finally {
      setResetting(false);
    }
  }, [resetSettings]);

  // Group settings by category
  const categories = useMemo(() => {
    const grouped: Record<string, { def: SettingDef; key: string }[]> = {};
    for (const [key, def] of Object.entries(SETTING_DEFS)) {
      if (!grouped[def.category]) grouped[def.category] = [];
      grouped[def.category].push({ def, key });
    }
    return grouped;
  }, []);

  const categoryOrder = [
    "general",
    "capture",
    "ai",
    "notification",
    "pet",
    "overlay",
  ] as const;

  // ── Render ──

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-white/5 px-5 py-4">
        <div className="flex items-center gap-2">
          <svg
            className="h-4 w-4 text-amber-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
            设置
          </span>
          <span className="text-slate-600">·</span>
          <span className="text-[10px] text-slate-500">
            管理应用偏好
          </span>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="ml-auto rounded-lg p-1 text-slate-500 transition hover:bg-white/10 hover:text-slate-200"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="h-8 shrink-0 border-b border-white/[3%] px-5 flex items-center">
        {loading && (
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-amber-400/30 border-t-amber-400" />
            加载中…
          </div>
        )}
        {error && (
          <div className="flex items-center gap-1.5 text-[11px] text-rose-400">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            {error}
          </div>
        )}
        {successMsg && (
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-400">
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {successMsg}
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {!loading && Object.keys(settings).length === 0 && !error ? (
          <div className="flex h-full items-center justify-center px-6">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800/50">
                <svg className="h-6 w-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                </svg>
              </div>
              <p className="text-sm text-slate-500">暂无可用设置</p>
              <p className="mt-1 text-xs text-slate-600">
                后端服务可能尚未初始化
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-white/[4%]">
            {categoryOrder.map((catKey) => {
              const entries = categories[catKey];
              if (!entries || entries.length === 0) return null;

              const meta = CATEGORY_META[catKey];
              const catSettings = entries.filter(({ key }) =>
                Object.prototype.hasOwnProperty.call(settings, key),
              );

              // Show category even if no settings loaded yet (show defaults)
              return (
                <section key={catKey} className="px-5 py-5">
                  {/* Category header */}
                  <div className="mb-3 flex items-center gap-2.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-400/10">
                      <svg
                        className="h-4 w-4 text-amber-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d={meta.icon}
                        />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-200">
                        {meta.label}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {meta.description}
                      </p>
                    </div>
                  </div>

                  {/* Setting rows */}
                  <div className="-mx-2 rounded-xl border border-white/[4%] bg-slate-900/40">
                    {entries.map(({ def, key }) => (
                      <SettingRow
                        key={key}
                        def={def}
                        value={settings[key] ?? ""}
                        error={shortcutErrors[key]}
                        onChange={(val) => void handleChange(key, val)}
                      />
                    ))}
                  </div>

                  {/* Unknown settings from backend */}
                  {catSettings.filter(
                    ({ key }) => !SETTING_DEFS[key],
                  ).length > 0 && (
                    <div className="mt-3 rounded-xl border border-white/[4%] bg-slate-900/20 p-3">
                      <p className="mb-1 text-[11px] font-medium text-slate-500">
                        其他设置
                      </p>
                      {catSettings
                        .filter(({ key }) => !SETTING_DEFS[key])
                        .map(({ key }) => (
                          <SettingRow
                            key={key}
                            def={{
                              label: key,
                              description: "",
                              type: "text",
                              category: catKey as SettingDef["category"],
                            }}
                            value={settings[key] ?? ""}
                            onChange={(val) => void handleChange(key, val)}
                          />
                        ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}

        {/* Bottom padding */}
        <div className="h-4" />
      </div>

      {/* Footer action bar */}
      <div className="shrink-0 border-t border-white/5 px-5 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleReset()}
            disabled={resetting}
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5
              text-xs font-medium text-slate-400 transition
              hover:bg-rose-400/10 hover:text-rose-300
              disabled:opacity-50"
          >
            {resetting ? (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border border-rose-400/30 border-t-rose-400" />
            ) : (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
              </svg>
            )}
            重置
          </button>

          <div className="flex-1" />

          <p className="text-[10px] text-slate-600">
            {Object.keys(settings).length} 项设置
          </p>
        </div>
      </div>
    </div>
  );
}
