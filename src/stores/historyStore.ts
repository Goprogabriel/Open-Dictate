import { create } from "zustand";

import { env } from "@/config/env";
import { previewDictations } from "@/test/fixtures";
import type { Dictation } from "@/types/domain";

interface HistoryState {
  dictations: Dictation[];
  pendingCloudDeletes: string[];
  hydrate: (dictations: Dictation[], pendingCloudDeletes?: string[]) => void;
  addDictation: (dictation: Dictation) => void;
  deleteDictation: (id: string) => void;
  acknowledgeCloudDelete: (id: string) => void;
  pruneBefore: (cutoffIso: string) => void;
  clear: () => void;
}

export const useHistoryStore = create<HistoryState>()((set) => ({
  dictations: env.enablePreviewData ? previewDictations : [],
  pendingCloudDeletes: [],
  hydrate: (dictations, pendingCloudDeletes = []) => set({ dictations, pendingCloudDeletes }),
  addDictation: (dictation) => set((state) => ({ dictations: [dictation, ...state.dictations] })),
  deleteDictation: (id) =>
    set((state) => {
      const item = state.dictations.find((dictation) => dictation.id === id);
      return {
        dictations: state.dictations.filter((dictation) => dictation.id !== id),
        pendingCloudDeletes:
          item?.syncState === "synced" && !state.pendingCloudDeletes.includes(id)
            ? [...state.pendingCloudDeletes, id]
            : state.pendingCloudDeletes,
      };
    }),
  acknowledgeCloudDelete: (id) =>
    set((state) => ({
      pendingCloudDeletes: state.pendingCloudDeletes.filter((candidate) => candidate !== id),
    })),
  pruneBefore: (cutoffIso) =>
    set((state) => ({
      dictations: state.dictations.filter((dictation) => dictation.createdAt >= cutoffIso),
    })),
  clear: () => set({ dictations: [] }),
}));
