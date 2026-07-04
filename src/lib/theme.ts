// Theme application + system mode listener.
//
// Tokens are defined in styles.css under :root[data-theme="..."][data-mode="..."].
// This module writes the two data attributes on <html> and, when mode="system",
// follows the OS prefers-color-scheme.

export type ThemeName =
  | "midnight-amber"
  | "sakura-mist"
  | "matcha-morning"
  | "lavender-dream"
  | "sunset-warm";

export type ThemeMode = "light" | "dark" | "system";

export interface ThemeOption {
  label: string;
  value: ThemeName;
  swatch: {
    bg: string;
    surface: string;
    primary: string;
    accent: string;
  };
  displayFont: string;
  bodyFont: string;
  description: string;
}

export const THEME_OPTIONS: ThemeOption[] = [
  {
    label: "午夜琥珀",
    value: "midnight-amber",
    swatch: { bg: "#060b18", surface: "#0e1525", primary: "#f0b84d", accent: "#c48a4a" },
    displayFont: "JetBrains Mono",
    bodyFont: "IBM Plex Sans",
    description: "深夜终端 × 暖金光泽",
  },
  {
    label: "樱花薄雾",
    value: "sakura-mist",
    swatch: { bg: "#160812", surface: "#24101e", primary: "#d45a7a", accent: "#c49a40" },
    displayFont: "Playfair Display",
    bodyFont: "Nunito Sans",
    description: "编辑杂志 × 柔粉",
  },
  {
    label: "抹茶清晨",
    value: "matcha-morning",
    swatch: { bg: "#0a180e", surface: "#142418", primary: "#8aa56a", accent: "#d48a3a" },
    displayFont: "Fraunces",
    bodyFont: "DM Sans",
    description: "和纸质感 × 抹茶",
  },
  {
    label: "薰衣草梦境",
    value: "lavender-dream",
    swatch: { bg: "#120818", surface: "#1c1028", primary: "#9a7ad4", accent: "#c49ad4" },
    displayFont: "Cormorant Garamond",
    bodyFont: "Quicksand",
    description: "梦幻虹彩 × 软发光",
  },
  {
    label: "暮色暖阳",
    value: "sunset-warm",
    swatch: { bg: "#180c06", surface: "#261610", primary: "#c75d29", accent: "#d48a5a" },
    displayFont: "Archivo Black",
    bodyFont: "Work Sans",
    description: "暖色粗野 × 赤陶",
  },
];

export const THEME_MODE_OPTIONS: { label: string; value: ThemeMode }[] = [
  { label: "亮色", value: "light" },
  { label: "暗色", value: "dark" },
  { label: "跟随系统", value: "system" },
];

export const DEFAULT_THEME: ThemeName = "midnight-amber";
export const DEFAULT_THEME_MODE: ThemeMode = "dark";

const mediaQuery = typeof window !== "undefined"
  ? window.matchMedia("(prefers-color-scheme: dark)")
  : null;

let systemCleanup: (() => void) | null = null;

function resolveMode(mode: ThemeMode): "light" | "dark" {
  if (mode !== "system") return mode;
  return mediaQuery?.matches ? "dark" : "light";
}

export function applyTheme(theme: ThemeName, mode: ThemeMode): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.mode = resolveMode(mode);

  // Manage system listener
  if (systemCleanup) {
    systemCleanup();
    systemCleanup = null;
  }
  if (mode === "system" && mediaQuery) {
    const handler = (e: MediaQueryListEvent) => {
      root.dataset.mode = e.matches ? "dark" : "light";
    };
    mediaQuery.addEventListener("change", handler);
    systemCleanup = () => mediaQuery.removeEventListener("change", handler);
  }
}

export function parseTheme(value: string | undefined | null): ThemeName {
  return (THEME_OPTIONS.some((o) => o.value === value)
    ? (value as ThemeName)
    : DEFAULT_THEME);
}

export function parseThemeMode(value: string | undefined | null): ThemeMode {
  return (THEME_MODE_OPTIONS.some((o) => o.value === value)
    ? (value as ThemeMode)
    : DEFAULT_THEME_MODE);
}

// ── Cache + sync ──────────────────────────────────────────────────────

const CACHE_KEY = "drp-theme-cache";

interface ThemeCache {
  theme: ThemeName;
  mode: ThemeMode;
}

/** Synchronously apply theme from localStorage cache — call before React mounts to avoid FOUC. */
export function initThemeFromCache(): void {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ThemeCache>;
      applyTheme(parseTheme(parsed.theme), parseThemeMode(parsed.mode));
      return;
    }
  } catch {
    // ignore parse errors
  }
  applyTheme(DEFAULT_THEME, DEFAULT_THEME_MODE);
}

/** Persist theme to localStorage so next mount can apply it synchronously. */
export function cacheTheme(theme: ThemeName, mode: ThemeMode): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ theme, mode } satisfies ThemeCache));
  } catch {
    // ignore quota errors
  }
}
