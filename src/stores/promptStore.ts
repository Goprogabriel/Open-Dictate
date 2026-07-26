import { create } from "zustand";

import type { Locale, TransformationSettings } from "@/types/domain";
import { nextIsoTimestamp } from "@/utils/timestamps";

interface PromptState extends TransformationSettings {
  saveState: "saved" | "saving" | "error";
  updatedAt: string | null;
  hydrate: (settings: TransformationSettings, updatedAt?: string | null) => void;
  setPrompt: (customPrompt: string) => void;
  setOutputLanguage: (outputLanguage: Locale) => void;
  setBehavior: (
    behavior: Partial<
      Pick<TransformationSettings, "removeFillers" | "correctPunctuation" | "formatLists">
    >,
  ) => void;
  setSaveState: (saveState: PromptState["saveState"]) => void;
}

export const usePromptStore = create<PromptState>()((set) => ({
  customPrompt: "",
  removeFillers: true,
  correctPunctuation: true,
  formatLists: true,
  outputLanguage: "en",
  saveState: "saved",
  updatedAt: null,
  hydrate: (settings, updatedAt = null) => set({ ...settings, updatedAt, saveState: "saved" }),
  setPrompt: (customPrompt) =>
    set((state) => ({
      customPrompt,
      updatedAt: nextIsoTimestamp(state.updatedAt),
      saveState: "saving",
    })),
  setOutputLanguage: (outputLanguage) =>
    set((state) => ({
      outputLanguage,
      updatedAt: nextIsoTimestamp(state.updatedAt),
      saveState: "saving",
    })),
  setBehavior: (behavior) =>
    set((state) => ({
      ...behavior,
      updatedAt: nextIsoTimestamp(state.updatedAt),
      saveState: "saving",
    })),
  setSaveState: (saveState) => set({ saveState }),
}));
