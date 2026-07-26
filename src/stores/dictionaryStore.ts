import { create } from "zustand";

import { env } from "@/config/env";
import { splitDictionaryRecords } from "@/services/syncProtocol";
import { previewDictionary } from "@/test/fixtures";
import type { DictionaryEntry, DictionaryTombstone, Locale } from "@/types/domain";
import { createId } from "@/utils/id";
import { nextIsoTimestamp } from "@/utils/timestamps";

interface DictionaryState {
  entries: DictionaryEntry[];
  /** Tombstones stay internal to sync/persistence and are never rendered or dictated. */
  tombstones: DictionaryTombstone[];
  hydrate: (entries: DictionaryEntry[], tombstones?: DictionaryTombstone[]) => void;
  addEntry: (spoken: string, replacement: string, language: Locale | "all") => void;
  updateEntry: (
    id: string,
    patch: Partial<Pick<DictionaryEntry, "spoken" | "replacement" | "language">>,
  ) => void;
  deleteEntry: (id: string) => void;
}

export const useDictionaryStore = create<DictionaryState>()((set) => ({
  entries: env.enablePreviewData ? previewDictionary : [],
  tombstones: [],
  hydrate: (entries, tombstones = []) => set(splitDictionaryRecords([...entries, ...tombstones])),
  addEntry: (spoken, replacement, language) =>
    set((state) => {
      const timestamp = new Date().toISOString();
      return {
        entries: [
          {
            id: createId("term"),
            spoken: spoken.trim(),
            replacement: replacement.trim(),
            language,
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          ...state.entries,
        ],
      };
    }),
  updateEntry: (id, patch) =>
    set((state) => ({
      entries: state.entries.map((entry) =>
        entry.id === id
          ? { ...entry, ...patch, updatedAt: nextIsoTimestamp(entry.updatedAt) }
          : entry,
      ),
    })),
  deleteEntry: (id) =>
    set((state) => {
      const entry = state.entries.find((candidate) => candidate.id === id);
      if (!entry) return state;

      const timestamp = nextIsoTimestamp(entry.updatedAt);
      const tombstone: DictionaryTombstone = {
        id,
        createdAt: entry.createdAt,
        updatedAt: timestamp,
        deleted: true,
      };
      return {
        entries: state.entries.filter((candidate) => candidate.id !== id),
        tombstones: [tombstone, ...state.tombstones.filter((item) => item.id !== id)],
      };
    }),
}));
