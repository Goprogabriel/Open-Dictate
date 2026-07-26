import { create } from "zustand";

import type { DictationPhase } from "@/types/native";

interface DictationState {
  phase: DictationPhase;
  recordingId: string | null;
  startedAt: number | null;
  audioLevel: number;
  errorCode: string | null;
  fallbackText: string | null;
  setPhase: (phase: DictationPhase) => void;
  start: (recordingId: string) => void;
  setAudioLevel: (audioLevel: number) => void;
  fail: (errorCode: string, fallbackText?: string) => void;
  setFallbackText: (fallbackText: string | null) => void;
  reset: () => void;
}

const initialState = {
  phase: "idle" as const,
  recordingId: null,
  startedAt: null,
  audioLevel: 0,
  errorCode: null,
  fallbackText: null,
};

export const useDictationStore = create<DictationState>((set) => ({
  ...initialState,
  setPhase: (phase) => set({ phase }),
  start: (recordingId) =>
    set({
      phase: "recording",
      recordingId,
      startedAt: Date.now(),
      errorCode: null,
      fallbackText: null,
    }),
  setAudioLevel: (audioLevel) => set({ audioLevel: Math.max(0, Math.min(1, audioLevel)) }),
  fail: (errorCode, fallbackText) =>
    set({ phase: "error", errorCode, fallbackText: fallbackText ?? null, audioLevel: 0 }),
  setFallbackText: (fallbackText) => set({ fallbackText }),
  reset: () => set(initialState),
}));
