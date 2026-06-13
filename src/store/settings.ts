import { create } from "zustand";

import {
  getAllSettings,
  resetSettings as resetSettingsCommand,
  setShortcut as setShortcutCommand,
  updateSetting as updateSettingCommand,
} from "../lib/tauri";

interface SettingsState {
  settings: Record<string, string>;
  loading: boolean;
  error: string | null;
  shortcutErrors: Record<string, string>;
  loadSettings: () => Promise<void>;
  setSetting: (key: string, value: string) => Promise<void>;
  setShortcut: (key: string, shortcut: string) => Promise<boolean>;
  resetSettings: () => Promise<void>;
  clearError: () => void;
  clearShortcutError: (key: string) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: {},
  loading: false,
  error: null,
  shortcutErrors: {},
  async loadSettings() {
    set({ loading: true, error: null });
    try {
      const entries = await getAllSettings();
      set({
        settings: Object.fromEntries(entries.map((entry) => [entry.key, entry.value])),
        loading: false,
      });
    } catch (error) {
      set({
        loading: false,
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
      const entries = await getAllSettings();
      set({
        settings: Object.fromEntries(entries.map((entry) => [entry.key, entry.value])),
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
