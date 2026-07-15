import { create } from "zustand";

import {
  clearAiApiKey as clearAiApiKeyCommand,
  getAiApiKeyStatus,
  getAllSettings,
  resetSettings as resetSettingsCommand,
  setAiApiKey as setAiApiKeyCommand,
  setShortcut as setShortcutCommand,
  updateSetting as updateSettingCommand,
} from "../lib/tauri";

interface SettingsState {
  settings: Record<string, string>;
  loading: boolean;
  hasLoaded: boolean;
  error: string | null;
  shortcutErrors: Record<string, string>;
  aiApiKeyConfigured: boolean;
  loadSettings: () => Promise<void>;
  setSetting: (key: string, value: string) => Promise<void>;
  setShortcut: (key: string, shortcut: string) => Promise<boolean>;
  resetSettings: () => Promise<void>;
  setAiApiKey: (value: string) => Promise<boolean>;
  clearAiApiKey: () => Promise<boolean>;
  clearError: () => void;
  clearShortcutError: (key: string) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: {},
  loading: false,
  hasLoaded: false,
  error: null,
  shortcutErrors: {},
  aiApiKeyConfigured: false,
  async loadSettings() {
    set({ loading: true, error: null });
    try {
      const [entries, apiKeyStatus] = await Promise.all([
        getAllSettings(),
        getAiApiKeyStatus(),
      ]);
      set({
        settings: Object.fromEntries(entries.map((entry) => [entry.key, entry.value])),
        aiApiKeyConfigured: apiKeyStatus.configured,
        loading: false,
        hasLoaded: true,
      });
    } catch (error) {
      // Log so IPC/DB failures in hidden webviews are visible per-window.
      console.error("[settings] loadSettings failed:", error);
      set({
        loading: false,
        hasLoaded: true,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
  async setSetting(key, value) {
    set({ loading: true, error: null });
    try {
      await updateSettingCommand(key, value);
      set((state) => ({
        settings: {
          ...state.settings,
          [key]: value,
        },
        loading: false,
      }));
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
  async setShortcut(key, shortcut) {
    try {
      const result = await setShortcutCommand(key, shortcut);
      if (result.ok) {
        set((state) => {
          const nextErrors = { ...state.shortcutErrors };
          delete nextErrors[key];
          return {
            settings: {
              ...state.settings,
              [key]: shortcut,
            },
            shortcutErrors: nextErrors,
          };
        });
        return true;
      } else {
        set((state) => ({
          shortcutErrors: {
            ...state.shortcutErrors,
            [key]: result.error ?? "设置快捷键失败",
          },
        }));
        return false;
      }
    } catch (error) {
      set((state) => ({
        shortcutErrors: {
          ...state.shortcutErrors,
          [key]: error instanceof Error ? error.message : String(error),
        },
      }));
      return false;
    }
  },
  async resetSettings() {
    set({ loading: true, error: null });
    try {
      await resetSettingsCommand();
      const [entries, apiKeyStatus] = await Promise.all([
        getAllSettings(),
        getAiApiKeyStatus(),
      ]);
      set({
        settings: Object.fromEntries(entries.map((entry) => [entry.key, entry.value])),
        aiApiKeyConfigured: apiKeyStatus.configured,
        loading: false,
        shortcutErrors: {},
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
  async setAiApiKey(value) {
    set({ loading: true, error: null });
    try {
      await setAiApiKeyCommand(value);
      set({ loading: false, aiApiKeyConfigured: true });
      return true;
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  },
  async clearAiApiKey() {
    set({ loading: true, error: null });
    try {
      await clearAiApiKeyCommand();
      set({ loading: false, aiApiKeyConfigured: false });
      return true;
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  },
  clearError() {
    if (get().error) {
      set({ error: null });
    }
  },
  clearShortcutError(key: string) {
    set((state) => {
      const next = { ...state.shortcutErrors };
      delete next[key];
      return { shortcutErrors: next };
    });
  },
}));
