import { useDictionaryStore } from "@/stores/dictionaryStore";

describe("dictionary store tombstones", () => {
  beforeEach(() => {
    useDictionaryStore.getState().hydrate([], []);
  });

  it("uses a new UUID when a deleted term is intentionally re-added", () => {
    const dictionary = useDictionaryStore.getState();
    dictionary.addEntry("supabace", "Supabase", "all");
    const deletedId = useDictionaryStore.getState().entries[0]?.id;
    expect(deletedId).toBeDefined();
    if (!deletedId) throw new Error("dictionary entry was not created");

    useDictionaryStore.getState().deleteEntry(deletedId);
    useDictionaryStore.getState().addEntry("supabace", "Supabase", "all");

    const state = useDictionaryStore.getState();
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0]?.id).not.toBe(deletedId);
    expect(state.tombstones).toEqual([expect.objectContaining({ id: deletedId, deleted: true })]);
  });
});
