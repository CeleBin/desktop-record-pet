import { useEffect } from "react";

import { MainPanel } from "./components/panel/MainPanel";
import { PetShell } from "./components/pet/PetShell";
import { QuickInput } from "./components/capture/QuickInput";
import { ScreenshotOverlay } from "./components/capture/ScreenshotOverlay";
import { SupplementBox } from "./components/capture/SupplementBox";
import { TodoOverlay } from "./components/todo/TodoOverlay";
import { useSettingsStore } from "./store/settings";
import {
  applyTheme,
  cacheTheme,
  parseTheme,
  parseThemeMode,
} from "./lib/theme";

/** Subscribes to settings store and re-applies theme when theme/theme_mode changes. */
function ThemeManager() {
  const settings = useSettingsStore((s) => s.settings);
  const loadSettings = useSettingsStore((s) => s.loadSettings);

  // Load settings on mount (each window loads independently)
  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // Re-apply theme whenever theme/theme_mode settings change
  useEffect(() => {
    const theme = parseTheme(settings.theme);
    const mode = parseThemeMode(settings.theme_mode);
    applyTheme(theme, mode);
    cacheTheme(theme, mode);
  }, [settings.theme, settings.theme_mode]);

  return null;
}

function App() {
  const windowLabel =
    new URLSearchParams(window.location.search).get("window") ?? "main-panel";

  return (
    <>
      <ThemeManager />
      {windowLabel === "pet" ? (
        <PetShell />
      ) : windowLabel === "quick-input" ? (
        <QuickInput />
      ) : windowLabel === "supplement-box" ? (
        <SupplementBox />
      ) : windowLabel === "screenshot-overlay" ? (
        <ScreenshotOverlay />
      ) : windowLabel === "todo-overlay" ? (
        <TodoOverlay />
      ) : (
        <MainPanel />
      )}
    </>
  );
}

export default App;
