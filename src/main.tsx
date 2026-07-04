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

// ── @fontsource font-face imports (body fonts: 400/500/600/700, display fonts: 400/700, Archivo Black: 400 only) ──
// Body fonts
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/nunito-sans/400.css";
import "@fontsource/nunito-sans/500.css";
import "@fontsource/nunito-sans/600.css";
import "@fontsource/nunito-sans/700.css";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/quicksand/400.css";
import "@fontsource/quicksand/500.css";
import "@fontsource/quicksand/600.css";
import "@fontsource/quicksand/700.css";
import "@fontsource/work-sans/400.css";
import "@fontsource/work-sans/500.css";
import "@fontsource/work-sans/600.css";
import "@fontsource/work-sans/700.css";
// Display fonts
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/playfair-display/400.css";
import "@fontsource/playfair-display/700.css";
import "@fontsource/fraunces/400.css";
import "@fontsource/fraunces/700.css";
import "@fontsource/cormorant-garamond/400.css";
import "@fontsource/cormorant-garamond/700.css";
import "@fontsource/archivo-black/400.css";

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
