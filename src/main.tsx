import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import {
  applyTheme,
  cacheTheme,
  initThemeFromCache,
  parseTheme,
  parseThemeMode,
} from "./lib/theme";
import { useSettingsStore } from "./store/settings";
import "./styles.css";

// Apply cached theme synchronously before anything else to avoid FOUC.
initThemeFromCache();

// Load settings before first React paint so the correct theme is applied
// immediately — no flash of stale/default theme on visible windows (pet).
async function bootstrap() {
  const store = useSettingsStore.getState();
  await store.loadSettings();

  // Apply the real theme from DB settings before rendering.
  const { settings } = useSettingsStore.getState();
  const theme = parseTheme(settings.theme);
  const mode = parseThemeMode(settings.theme_mode);
  applyTheme(theme, mode);
  cacheTheme(theme, mode);

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
