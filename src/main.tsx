import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initThemeFromCache } from "./lib/theme";
import "./styles.css";

// Apply cached theme synchronously before React renders to avoid FOUC.
initThemeFromCache();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
