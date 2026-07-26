const nativeState = vi.hoisted(() => new Map<string, unknown>());

vi.mock("@/services/native", () => ({
  nativeClient: {
    isAvailable: () => true,
    loadSecureState: vi.fn((namespace: string) =>
      Promise.resolve(structuredClone(nativeState.get(namespace) ?? null)),
    ),
    saveSecureState: vi.fn((namespace: string, value: unknown) => {
      nativeState.set(namespace, structuredClone(value));
      return Promise.resolve();
    }),
  },
}));

import {
  initializeSecureStatePersistence,
  switchSecureStateScope,
} from "@/services/secureStateService";
import { useDictionaryStore } from "@/stores/dictionaryStore";
import { usePromptStore } from "@/stores/promptStore";

describe("encrypted state account scopes", () => {
  beforeAll(() => {
    vi.useFakeTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("keeps local and authenticated prompt data isolated on the same device", async () => {
    nativeState.clear();
    await initializeSecureStatePersistence();

    usePromptStore.getState().setPrompt("Local instructions");
    await vi.advanceTimersByTimeAsync(300);

    await switchSecureStateScope("account-a");
    expect(usePromptStore.getState().customPrompt).toBe("");
    usePromptStore.getState().setPrompt("Account A instructions");
    useDictionaryStore.getState().addEntry("supabace", "Supabase", "all");
    await vi.advanceTimersByTimeAsync(300);
    const dictionaryId = useDictionaryStore.getState().entries[0]?.id;
    expect(dictionaryId).toBeDefined();
    if (!dictionaryId) throw new Error("dictionary entry was not created");
    useDictionaryStore.getState().deleteEntry(dictionaryId);
    await vi.advanceTimersByTimeAsync(300);

    await switchSecureStateScope("account-b");
    expect(usePromptStore.getState().customPrompt).toBe("");
    expect(useDictionaryStore.getState()).toMatchObject({ entries: [], tombstones: [] });

    await switchSecureStateScope("account-a");
    expect(usePromptStore.getState().customPrompt).toBe("Account A instructions");
    expect(useDictionaryStore.getState().entries).toEqual([]);
    expect(useDictionaryStore.getState().tombstones).toEqual([
      expect.objectContaining({ id: dictionaryId, deleted: true }),
    ]);

    await switchSecureStateScope(null);
    expect(usePromptStore.getState().customPrompt).toBe("Local instructions");
  });
});
