import { create } from "zustand";

import type {
  PetLearningMessage,
  PetLearningSessionDraft,
} from "../types";

interface LearningCoachState {
  activeSession: PetLearningSessionDraft | null;
  startSession: (session: PetLearningSessionDraft) => void;
  appendUserMessage: (content: string) => void;
  appendAssistantMessage: (content: string) => void;
  closeSession: () => void;
  markConfirmed: () => void;
}

function appendMessage(
  session: PetLearningSessionDraft | null,
  message: PetLearningMessage,
): PetLearningSessionDraft | null {
  if (!session) return null;
  return {
    ...session,
    messages: [...session.messages, message],
  };
}

export const useLearningCoachStore = create<LearningCoachState>((set) => ({
  activeSession: null,
  startSession(session) {
    set({ activeSession: session });
  },
  appendUserMessage(content) {
    const trimmed = content.trim();
    if (!trimmed) return;
    set((state) => ({
      activeSession: appendMessage(state.activeSession, {
        role: "user",
        content: trimmed,
      }),
    }));
  },
  appendAssistantMessage(content) {
    const trimmed = content.trim();
    if (!trimmed) return;
    set((state) => ({
      activeSession: appendMessage(state.activeSession, {
        role: "assistant",
        content: trimmed,
      }),
    }));
  },
  closeSession() {
    set({ activeSession: null });
  },
  markConfirmed() {
    set((state) => ({
      activeSession: state.activeSession
        ? {
            ...state.activeSession,
            status: "confirmed",
          }
        : null,
    }));
  },
}));
