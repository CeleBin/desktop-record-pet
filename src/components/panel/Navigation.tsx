import { useEffect, useRef, useState } from "react";

import type { RecordType, Tag, TaskPriority } from "../../types";
import { useTagsStore } from "../../store/tags";
import { useSettingsStore } from "../../store/settings";
import { ConfirmDialog } from "../common/ConfirmDialog";

type ViewMode = "notes" | "tasks";

interface NavigationProps {
  selectedType: RecordType;
  onSelectType: (type: RecordType) => void;
  viewMode: ViewMode;
  taskFilter: TaskPriority | "done" | null;
  searchQuery: string;
  settingsOpen: boolean;
  memoryOpen: boolean;
  graphOpen: boolean;
  chatOpen: boolean;
  growthPreviewEnabled: boolean;
  onTaskFilterChange: (filter: TaskPriority | "done" | null) => void;
  onSearchChange: (query: string) => void;
  onToggleSettings: () => void;
  onToggleMemory: () => void;
  onToggleGraph: () => void;
  onToggleChat: () => void;
  activeTagIds: string[];
  onToggleTagFilter: (id: string) => void;
}

const TASK_FILTER_OPTIONS: { label: string; value: TaskPriority | "done" | null }[] = [
  { label: "全部任务", value: null },
  { label: "P0", value: "high" },
  { label: "P1", value: "medium" },
  { label: "P2", value: "low" },
  { label: "已完成", value: "done" },
];

export const TAG_COLORS = [
  "#a78bfa",
  "#fbbf24",
  "#34d399",
  "#fb7185",
  "#38bdf8",
  "#fb923c",
];

export const TAG_POPOVER_STYLE = {
  width: "min(320px, calc(100% + 1rem))",
  minWidth: "min(240px, calc(100% + 1rem))",
  maxWidth: "calc(100vw - 2rem)",
};

export const TAG_COLOR_ROW_CLASS = "flex flex-wrap items-center justify-start gap-2 px-1";
export const TAG_CREATE_ACTION_SPACING_CLASS = "mt-2";
export const TAG_POPOVER_POSITION_CLASS = "absolute left-1/2 -translate-x-1/2";

const CUSTOM_TAG_COLORS_STORAGE_KEY = "drp-custom-tag-colors";

interface HsvColor {
  h: number;
  s: number;
  v: number;
}

export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

export function normalizeCustomTagColors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalizedColors: string[] = [];

  for (const candidate of value) {
    if (typeof candidate !== "string") continue;
    const normalized = candidate.trim().toLowerCase();
    if (!isHexColor(normalized) || TAG_COLORS.includes(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    normalizedColors.push(normalized);
  }

  return normalizedColors;
}

export function upsertCustomTagColor(colors: string[], color: string, index?: number | null): string[] {
  const normalizedColors = normalizeCustomTagColors(colors);
  const normalized = color.trim().toLowerCase();
  if (!isHexColor(normalized) || TAG_COLORS.includes(normalized)) return normalizedColors;

  if (index !== undefined && index !== null && index >= 0 && index < normalizedColors.length) {
    const next = [...normalizedColors];
    next[index] = normalized;
    return normalizeCustomTagColors(next);
  }

  return normalizedColors.includes(normalized) ? normalizedColors : [...normalizedColors, normalized];
}

export function removeCustomTagColor(colors: string[], index: number): string[] {
  return normalizeCustomTagColors(colors).filter((_, colorIndex) => colorIndex !== index);
}

function readCustomTagColors(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_TAG_COLORS_STORAGE_KEY);
    return raw ? normalizeCustomTagColors(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function hexToHsv(value: string): HsvColor {
  const hex = isHexColor(value) ? value.slice(1) : "000000";
  const red = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const green = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === red) h = 60 * (((green - blue) / delta) % 6);
    else if (max === green) h = 60 * ((blue - red) / delta + 2);
    else h = 60 * ((red - green) / delta + 4);
    if (h < 0) h += 360;
  }

  return {
    h,
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

export function hsvToHex(h: number, s: number, v: number): string {
  const chroma = v * s;
  const hue = ((h % 360) + 360) % 360;
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const match = v - chroma;
  let red = 0;
  let green = 0;
  let blue = 0;

  if (hue < 60) [red, green, blue] = [chroma, x, 0];
  else if (hue < 120) [red, green, blue] = [x, chroma, 0];
  else if (hue < 180) [red, green, blue] = [0, chroma, x];
  else if (hue < 240) [red, green, blue] = [0, x, chroma];
  else if (hue < 300) [red, green, blue] = [x, 0, chroma];
  else [red, green, blue] = [chroma, 0, x];

  return `#${[red, green, blue]
    .map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

interface TagColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  customColors: string[];
  onCustomColorsChange: (colors: string[]) => void;
  label: string;
}

function TagColorPicker({ color, onChange, customColors, onCustomColorsChange, label }: TagColorPickerProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [hsv, setHsv] = useState(() => hexToHsv(color));
  const [hexDraft, setHexDraft] = useState(() => color);
  const [activeCustomIndex, setActiveCustomIndex] = useState<number | null>(() => {
    const index = customColors.indexOf(color.toLowerCase());
    return index >= 0 ? index : null;
  });
  const isCustomColor = !TAG_COLORS.includes(color.toLowerCase());

  useEffect(() => {
    if (!isHexColor(color)) return;
    setHsv(hexToHsv(color));
    setHexDraft(color);
  }, [color]);

  const applyHsv = (next: HsvColor) => {
    setHsv(next);
    const nextHex = hsvToHex(next.h, next.s, next.v);
    setHexDraft(nextHex);
    onChange(nextHex);
  };

  const updateSurface = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const next: HsvColor = {
      h: hsv.h,
      s: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      v: Math.min(1, Math.max(0, 1 - (event.clientY - rect.top) / rect.height)),
    };
    applyHsv(next);
  };

  const commitHexDraft = () => {
    if (isHexColor(hexDraft)) {
      const normalized = hexDraft.toLowerCase();
      setHexDraft(normalized);
      setHsv(hexToHsv(normalized));
      onChange(normalized);
      return;
    }
    setHexDraft(hsvToHex(hsv.h, hsv.s, hsv.v));
  };

  const saveCustomColor = () => {
    const nextHex = isHexColor(hexDraft) ? hexDraft.toLowerCase() : hsvToHex(hsv.h, hsv.s, hsv.v);
    setHexDraft(nextHex);
    setHsv(hexToHsv(nextHex));
    onChange(nextHex);
    const nextColors = upsertCustomTagColor(customColors, nextHex, activeCustomIndex);
    onCustomColorsChange(nextColors);
    const nextIndex = nextColors.indexOf(nextHex);
    setActiveCustomIndex(nextIndex >= 0 ? nextIndex : null);
    setPanelOpen(false);
  };

  const deleteCustomColor = (index: number) => {
    onCustomColorsChange(removeCustomTagColor(customColors, index));
    setActiveCustomIndex((current) => {
      if (current === null || current === index) return null;
      return current > index ? current - 1 : current;
    });
  };

  return (
    <div className="space-y-2">
      <div className={TAG_COLOR_ROW_CLASS}>
        {TAG_COLORS.map((preset) => (
          <button
            key={preset}
            type="button"
            aria-label={`${label}预设色 ${preset}`}
            onClick={() => {
              setPanelOpen(false);
              setActiveCustomIndex(null);
              setHsv(hexToHsv(preset));
              setHexDraft(preset);
              onChange(preset);
            }}
            className={`h-5 w-5 shrink-0 rounded-full transition-all duration-150 ${
              color.toLowerCase() === preset
                ? "ring-2 ring-white ring-offset-1 ring-offset-surface/95"
                : "ring-1 ring-white/10"
            }`}
            style={{ backgroundColor: preset }}
          />
        ))}
        {customColors.map((preset, index) => (
          <div key={`${preset}-${index}`} className="group relative h-5 w-5 shrink-0">
            <button
              type="button"
              aria-label={`${label}自定义预设色 ${preset}`}
              onClick={() => {
                setPanelOpen(false);
                setActiveCustomIndex(index);
                setHsv(hexToHsv(preset));
                setHexDraft(preset);
                onChange(preset);
              }}
              className={`h-5 w-5 rounded-full transition-all duration-150 ${
                color.toLowerCase() === preset
                  ? "ring-2 ring-white ring-offset-1 ring-offset-surface/95"
                  : "ring-1 ring-white/10"
              }`}
              style={{ backgroundColor: preset }}
            />
            <button
              type="button"
              aria-label={`删除${label}自定义颜色 ${preset}`}
              title={`删除自定义颜色 ${preset}`}
              onClick={(event) => {
                event.stopPropagation();
                deleteCustomColor(index);
              }}
              className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface/95 text-[10px] leading-none text-text-muted opacity-70 shadow-sm ring-1 ring-border transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 hover:text-text"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          aria-label={`${label}自定义颜色`}
          aria-expanded={panelOpen}
          onClick={() => setPanelOpen((open) => !open)}
          className={`h-5 w-5 shrink-0 rounded-full transition-all duration-150 ${
            panelOpen || isCustomColor
              ? "ring-2 ring-white ring-offset-1 ring-offset-surface/95"
              : "ring-1 ring-white/20"
          }`}
          title={`${label}自定义颜色`}
          style={{
            background: "conic-gradient(from 0deg, #fb7185, #fbbf24, #34d399, #38bdf8, #a78bfa, #e879f9, #fb7185)",
          }}
        />
      </div>

      {panelOpen && (
        <div className="space-y-2 rounded-lg border border-border bg-black/5 p-2">
          <div
            role="slider"
            aria-label={`${label}饱和度和明度`}
            aria-valuetext={hexDraft}
            tabIndex={0}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              updateSurface(event);
            }}
            onPointerMove={(event) => {
              if (event.buttons === 1) updateSurface(event);
            }}
            className="relative h-24 cursor-crosshair touch-none overflow-hidden rounded-md"
            style={{
              backgroundImage: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))`,
            }}
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
              style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
            />
          </div>
          <input
            type="range"
            min="0"
            max="360"
            step="1"
            value={hsv.h}
            aria-label={`${label}色相`}
            onChange={(event) => applyHsv({ ...hsv, h: Number(event.target.value) })}
            className="h-2 w-full cursor-pointer appearance-none rounded-full"
            style={{
              background: "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
            }}
          />
          <div className="flex items-center gap-2">
            <span className="h-5 w-5 shrink-0 rounded-full ring-1 ring-white/20" style={{ backgroundColor: hexDraft }} />
            <input
              value={hexDraft}
              onChange={(event) => setHexDraft(event.target.value)}
              onBlur={commitHexDraft}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitHexDraft();
                }
              }}
              aria-label={`${label}十六进制颜色`}
              className="min-w-0 flex-1 rounded-md border border-border bg-white/5 px-2 py-1 text-[11px] uppercase text-text outline-none focus:border-secondary/40"
              maxLength={7}
              spellCheck={false}
            />
          </div>
          <button
            type="button"
            onClick={saveCustomColor}
            className="w-full rounded-md bg-white/10 px-2 py-1 text-[11px] font-medium text-text-muted transition hover:bg-white/15 hover:text-text"
          >
            {activeCustomIndex === null ? "保存为预设" : "更新预设"}
          </button>
        </div>
      )}
    </div>
  );
}

const TASK_FILTER_STYLES: Record<string, string> = {
  high: "bg-danger/20 text-danger ring-danger/30",
  medium: "bg-primary/20 text-primary ring-primary/30",
  low: "bg-secondary/20 text-secondary ring-secondary/30",
  done: "bg-secondary/20 text-secondary ring-secondary/30",
};

export function Navigation({
  selectedType,
  onSelectType,
  viewMode,
  taskFilter,
  searchQuery,
  settingsOpen,
  memoryOpen,
  graphOpen,
  chatOpen,
  growthPreviewEnabled,
  activeTagIds,
  onTaskFilterChange,
  onSearchChange,
  onToggleSettings,
  onToggleMemory,
  onToggleGraph,
  onToggleChat,
  onToggleTagFilter,
}: NavigationProps) {
  const [focused, setFocused] = useState(false);
  const settings = useSettingsStore((state) => state.settings);
  const petName = settings.pet_name?.trim() || "小宠物";

  // ── Tag create popover ──
  const [showTagPopover, setShowTagPopover] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0]);
  const [customTagColors, setCustomTagColors] = useState<string[]>(readCustomTagColors);
  const tags = useTagsStore((s) => s.tags);
  const createTag = useTagsStore((s) => s.createTag);
  const updateTag = useTagsStore((s) => s.updateTag);
  const deleteTag = useTagsStore((s) => s.deleteTag);

  const tagPopoverRef = useRef<HTMLDivElement>(null);
  const createTagInputRef = useRef<HTMLInputElement>(null);

  // ── Tag action menu (opened from the tag's overflow button) ──
  const [tagMenu, setTagMenu] = useState<{ tagId: string; x: number; y: number } | null>(null);
  const tagMenuRef = useRef<HTMLDivElement>(null);

  // ── Tag edit popover (rename / recolor) ──
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [editTagName, setEditTagName] = useState("");
  const [editTagColor, setEditTagColor] = useState(TAG_COLORS[0]);
  const editPopoverRef = useRef<HTMLDivElement>(null);
  const editTagInputRef = useRef<HTMLInputElement>(null);
  const navigationRef = useRef<HTMLElement>(null);

  // ── Tag delete confirmation dialog ──
  const [pendingDeleteTag, setPendingDeleteTag] = useState<{ id: string; name: string } | null>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!showTagPopover) return;
    const handler = (e: MouseEvent) => {
      if (tagPopoverRef.current && !tagPopoverRef.current.contains(e.target as Node)) {
        setShowTagPopover(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showTagPopover]);

  // Focus the newly opened input without letting the overflowing popover move
  // the navigation scroll container horizontally.
  useEffect(() => {
    if (!showTagPopover) return;
    if (navigationRef.current) navigationRef.current.scrollLeft = 0;
    createTagInputRef.current?.focus({ preventScroll: true });
  }, [showTagPopover]);

  // Close tag action menu on outside click
  useEffect(() => {
    if (!tagMenu) return;
    const handler = (e: MouseEvent) => {
      if (tagMenuRef.current && !tagMenuRef.current.contains(e.target as Node)) {
        setTagMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [tagMenu]);

  useEffect(() => {
    if (!tagMenu) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTagMenu(null);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [tagMenu]);

  // Close edit popover on outside click
  useEffect(() => {
    if (!editingTag) return;
    const handler = (e: MouseEvent) => {
      if (editPopoverRef.current && !editPopoverRef.current.contains(e.target as Node)) {
        setEditingTag(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [editingTag]);

  useEffect(() => {
    if (!editingTag) return;
    if (navigationRef.current) navigationRef.current.scrollLeft = 0;
    editTagInputRef.current?.focus({ preventScroll: true });
  }, [editingTag]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(CUSTOM_TAG_COLORS_STORAGE_KEY, JSON.stringify(customTagColors));
    } catch {
      // ignore storage / quota errors
    }
  }, [customTagColors]);

  const rememberCustomTagColor = (color: string) => {
    setCustomTagColors((previous) => upsertCustomTagColor(previous, color));
  };

  const handleCreateTag = async () => {
    const trimmed = newTagName.trim();
    if (!trimmed) return;
    try {
      await createTag(trimmed, newTagColor);
      rememberCustomTagColor(newTagColor);
      setNewTagName("");
      setNewTagColor(TAG_COLORS[0]);
      setShowTagPopover(false);
    } catch {
      // error handled by store
    }
  };

  const handleStartEditTag = (tag: Tag) => {
    setEditTagName(tag.name);
    setEditTagColor(tag.color ?? TAG_COLORS[0]);
    setEditingTag(tag);
    setTagMenu(null);
  };

  const handleSaveEditTag = async () => {
    if (!editingTag) return;
    const trimmed = editTagName.trim();
    if (!trimmed) return;
    try {
      await updateTag(editingTag.id, trimmed, editTagColor);
      rememberCustomTagColor(editTagColor);
      setEditingTag(null);
    } catch {
      // error handled by store
    }
  };

  const handleDeleteTag = (tag: Tag) => {
    setTagMenu(null);
    setPendingDeleteTag({ id: tag.id, name: tag.name });
  };

  return (
    <>
      <nav ref={navigationRef} className="flex h-full flex-col gap-5 overflow-y-auto p-4">
      <button type="button" onClick={onToggleChat} className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${chatOpen ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-text-muted hover:text-text"}`}>和{petName}聊聊</button>
      <button type="button" onClick={onToggleGraph} className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${graphOpen ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-text-muted hover:text-text"}`}>知识图谱</button>
      {/* ── Type filter (single-select: 笔记 OR 待办) ── */}
      <div className="flex rounded-xl bg-surface/60 p-0.5 ring-1 ring-white/[5%]">
        <button
          type="button"
          onClick={() => onSelectType("note")}
          className={`
            flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150
            ${
              selectedType === "note"
                ? "bg-secondary/15 text-secondary shadow-sm shadow-secondary/10"
                : "text-text-muted hover:text-text"
            }
          `}
        >
          <div className="flex items-center justify-center gap-1.5">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            笔记
          </div>
        </button>
        <button
          type="button"
          onClick={() => onSelectType("task")}
          className={`
            flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150
            ${
              selectedType === "task"
                ? "bg-secondary/15 text-secondary shadow-sm shadow-secondary/10"
                : "text-text-muted hover:text-text"
            }
          `}
        >
          <div className="flex items-center justify-center gap-1.5">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            待办
          </div>
        </button>
      </div>

      {/* ── Search ── */}
      <div className="relative">
        <div
          className={`
            flex items-center gap-2 rounded-2xl border bg-surface/60 px-3 py-2.5
            text-sm transition-all duration-200
            ${focused
              ? "border-secondary/40 ring-2 ring-secondary/15"
              : "border-border"
            }
          `}
        >
          <svg
            className="h-4 w-4 shrink-0 text-text-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={viewMode === "tasks" ? "搜索待办…" : "搜索笔记…"}
            className="min-w-0 flex-1 bg-transparent text-sm text-text placeholder-text-muted outline-none"
          />
          {searchQuery.length > 0 && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="rounded-full p-0.5 text-text0 transition hover:text-text"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ── Record filters ── */}
      {viewMode !== "tasks" ? (
        <>
          {/* Tags filter */}
          <section>
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-text0">
              标签
            </p>
            {tags.length === 0 ? (
              <p className="text-[11px] text-text-muted">暂无标签</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => {
                  const isActive = activeTagIds.includes(tag.id);
                  const hasColor = !!tag.color;
                  return (
                    <div key={tag.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => onToggleTagFilter(tag.id)}
                        className={`
                          inline-flex items-center justify-center rounded-full py-1.5 pl-3 pr-3
                          text-xs font-medium transition-all duration-150
                          group-hover:justify-start group-hover:pr-7
                          ${!hasColor
                            ? isActive
                              ? "bg-secondary/15 text-secondary ring-1 ring-secondary/30"
                              : "bg-white/5 text-text-muted hover:bg-white/10 hover:text-text"
                            : ""
                          }
                        `}
                        style={
                          hasColor
                            ? {
                                backgroundColor: isActive
                                  ? `${tag.color!}33`
                                  : `${tag.color!}1a`,
                                color: tag.color!,
                                boxShadow: isActive
                                  ? `0 0 0 1px ${tag.color!}4d`
                                  : undefined,
                              }
                            : undefined
                        }
                      >
                        {tag.name}
                      </button>
                      <button
                        type="button"
                        aria-label={`管理标签 ${tag.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          const rect = event.currentTarget.getBoundingClientRect();
                          setTagMenu({ tagId: tag.id, x: rect.right + 4, y: rect.top });
                        }}
                        className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full px-1 text-sm leading-none text-current opacity-0 transition group-hover:opacity-70 hover:!opacity-100 focus:opacity-100"
                      >
                        ···
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {/* Create tag button + popover */}
            <div className="relative mt-2">
              <button
                type="button"
                onClick={() => setShowTagPopover((prev) => !prev)}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-text-muted transition hover:bg-white/5 hover:text-text"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                新建标签
              </button>

              {showTagPopover && (
                <div
                  ref={tagPopoverRef}
                  className={`${TAG_POPOVER_POSITION_CLASS} z-50 mt-1 rounded-xl border border-border bg-surface/95 p-3 shadow-2xl backdrop-blur-xl`}
                  style={TAG_POPOVER_STYLE}
                >
                  <input
                    type="text"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleCreateTag();
                      }
                      if (e.key === "Escape") {
                        setShowTagPopover(false);
                      }
                    }}
                    placeholder="标签名称…"
                    className="mb-2 w-full rounded-lg border border-border bg-white/5 px-2.5 py-1.5 text-xs text-text placeholder-text-muted outline-none transition focus:border-secondary/40 focus:ring-2 focus:ring-secondary/20"
                    ref={createTagInputRef}
                  />
                  <TagColorPicker
                    color={newTagColor}
                    onChange={setNewTagColor}
                    customColors={customTagColors}
                    onCustomColorsChange={setCustomTagColors}
                    label="新建标签"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCreateTag()}
                    disabled={!newTagName.trim()}
                    className={`${TAG_CREATE_ACTION_SPACING_CLASS} w-full rounded-lg bg-secondary/15 px-3 py-1.5 text-xs font-medium text-secondary transition hover:bg-secondary/25 disabled:opacity-40`}
                  >
                    创建
                  </button>
                </div>
              )}

              {/* Tag edit popover (rename / recolor) */}
              {editingTag && (
                <div
                  ref={editPopoverRef}
                  className={`${TAG_POPOVER_POSITION_CLASS} z-50 mt-1 rounded-xl border border-border bg-surface/95 p-3 shadow-2xl backdrop-blur-xl`}
                  style={TAG_POPOVER_STYLE}
                >
                  <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-text0">编辑标签</p>
                  <input
                    type="text"
                    value={editTagName}
                    onChange={(e) => setEditTagName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleSaveEditTag();
                      }
                      if (e.key === "Escape") {
                        setEditingTag(null);
                      }
                    }}
                    placeholder="标签名称…"
                    className="mb-2 w-full rounded-lg border border-border bg-white/5 px-2.5 py-1.5 text-xs text-text placeholder-text-muted outline-none transition focus:border-secondary/40 focus:ring-2 focus:ring-secondary/20"
                    ref={editTagInputRef}
                  />
                  <TagColorPicker
                    key={editingTag.id}
                    color={editTagColor}
                    onChange={setEditTagColor}
                    customColors={customTagColors}
                    onCustomColorsChange={setCustomTagColors}
                    label="编辑标签"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSaveEditTag()}
                    disabled={!editTagName.trim()}
                    className={`${TAG_CREATE_ACTION_SPACING_CLASS} w-full rounded-lg bg-secondary/15 px-3 py-1.5 text-xs font-medium text-secondary transition hover:bg-secondary/25 disabled:opacity-40`}
                  >
                    保存
                  </button>
                </div>
              )}
            </div>
          </section>
        </>
      ) : (
        <>
          {/* ── Task status filter ── */}
          <section>
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-text0">
              任务重要性
            </p>
            <div className="flex flex-wrap gap-1.5">
              {TASK_FILTER_OPTIONS.map((opt) => {
                const isActive = taskFilter === opt.value;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => onTaskFilterChange(opt.value)}
                    className={`
                      rounded-full border border-border/60 px-3 py-1.5 text-xs font-medium transition-all duration-150
                      ${
                        isActive && opt.value
                          ? `${TASK_FILTER_STYLES[opt.value]} ring-1`
                          : isActive && !opt.value
                            ? "bg-secondary/15 text-secondary ring-1 ring-secondary/30"
                            : "bg-white/5 text-text-muted hover:border-secondary/35 hover:bg-white/10 hover:text-text"
                      }
                    `}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </section>

        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Memory and settings toggles */}
      <div className="flex items-center gap-1.5">
        {growthPreviewEnabled && <button
          type="button"
          onClick={onToggleMemory}
          className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-150 ${memoryOpen ? "bg-secondary/15 text-secondary ring-1 ring-secondary/30" : "text-text0 hover:bg-white/5 hover:text-text"}`}
          title="知识记忆"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v11.494m0-11.494C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v11.494C4.168 16.977 5.754 16.5 7.5 16.5s3.332.477 4.5 1.253m0-11.494C13.168 5.477 14.754 5 16.5 5s3.332.477 4.5 1.253v11.494C19.832 16.977 18.246 16.5 16.5 16.5s-3.332.477-4.5 1.253" />
          </svg>
          知识记忆
        </button>}
        <button
          type="button"
          onClick={onToggleSettings}
          className={`
            inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5
            text-xs font-medium transition-all duration-150
            ${settingsOpen
              ? "bg-primary/15 text-primary ring-1 ring-primary/30"
              : "text-text0 hover:bg-white/5 hover:text-text"
            }
          `}
          title="设置"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
          </svg>
          {settingsOpen ? "关闭设置" : "设置"}
        </button>
      </div>

      {/* Tag action menu */}
      {tagMenu && (
        <div
          ref={tagMenuRef}
          role="menu"
          className="fixed z-50 w-36 rounded-xl border border-border bg-surface/95 p-1.5 shadow-2xl backdrop-blur-xl"
          style={{
            left: Math.min(tagMenu.x, Math.max(8, window.innerWidth - 152)),
            top: Math.min(tagMenu.y, Math.max(8, window.innerHeight - 132)),
          }}
        >
          {(() => {
            const tag = tags.find((t) => t.id === tagMenu.tagId);
            if (!tag) return null;
            return (
              <>
                <p className="truncate px-2.5 py-1 text-[10px] text-text0">标签：{tag.name}</p>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleStartEditTag(tag)}
                  className="block w-full rounded-lg px-2.5 py-1.5 text-left text-xs text-text transition hover:bg-white/5"
                >
                  编辑…
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => void handleDeleteTag(tag)}
                  className="block w-full rounded-lg px-2.5 py-1.5 text-left text-xs text-danger transition hover:bg-danger/10"
                >
                  删除
                </button>
              </>
            );
          })()}
        </div>
      )}
    </nav>

      {/* Tag delete confirm dialog */}
      <ConfirmDialog
        open={pendingDeleteTag !== null}
        message={
          pendingDeleteTag
            ? `确认删除标签「${pendingDeleteTag.name}」？\n该标签将从所有相关笔记中移除。`
            : ""
        }
        confirmLabel="确认删除"
        onConfirm={() => {
          if (pendingDeleteTag) void deleteTag(pendingDeleteTag.id);
          setPendingDeleteTag(null);
        }}
        onCancel={() => setPendingDeleteTag(null)}
      />
    </>
  );
}
