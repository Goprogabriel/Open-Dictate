import { useDictationStore } from "@/stores/dictationStore";
import { useHistoryStore } from "@/stores/historyStore";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { usePromptStore } from "@/stores/promptStore";
import { useUsageStore } from "@/stores/usageStore";
import type { UsageSummary } from "@/types/domain";

const emptyUsage: UsageSummary = {
  month: "2026-07",
  dictationMs: 0,
  speakingMs: 0,
  wordsGenerated: 0,
  dictationCount: 0,
  transcriptionTokens: 0,
  transformTokens: 0,
  estimatedSavedMs: 0,
  comparisonPercent: 0,
  points: [],
};

describe("dictation store", () => {
  beforeEach(() => {
    useDictationStore.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts a recording with a timestamp and clears stale errors", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T08:30:00.000Z"));
    useDictationStore.getState().fail("microphone_denied", "fallback");

    useDictationStore.getState().start("recording-1");

    expect(useDictationStore.getState()).toMatchObject({
      phase: "recording",
      recordingId: "recording-1",
      startedAt: Date.parse("2026-07-24T08:30:00.000Z"),
      errorCode: null,
      fallbackText: null,
    });
  });

  it("clamps audio levels to the normalized range", () => {
    useDictationStore.getState().setAudioLevel(-0.25);
    expect(useDictationStore.getState().audioLevel).toBe(0);

    useDictationStore.getState().setAudioLevel(0.42);
    expect(useDictationStore.getState().audioLevel).toBe(0.42);

    useDictationStore.getState().setAudioLevel(1.6);
    expect(useDictationStore.getState().audioLevel).toBe(1);
  });

  it("records a recoverable failure and resets cleanly", () => {
    useDictationStore.getState().start("recording-2");
    useDictationStore.getState().setAudioLevel(0.8);
    useDictationStore.getState().fail("insertion_failed", "Recovered text");

    expect(useDictationStore.getState()).toMatchObject({
      phase: "error",
      errorCode: "insertion_failed",
      fallbackText: "Recovered text",
      audioLevel: 0,
    });

    useDictationStore.getState().reset();
    expect(useDictationStore.getState()).toMatchObject({
      phase: "idle",
      recordingId: null,
      startedAt: null,
      errorCode: null,
      fallbackText: null,
    });
  });
});

describe("onboarding store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useOnboardingStore.getState().reset();
  });

  it("keeps navigation inside the longest onboarding flow", () => {
    useOnboardingStore.getState().setStep(-10);
    expect(useOnboardingStore.getState().step).toBe(0);

    useOnboardingStore.getState().setStep(20);
    expect(useOnboardingStore.getState().step).toBe(6);
  });

  it("tracks the selected mode and completion lifecycle", () => {
    useOnboardingStore.getState().setMode("pro");
    useOnboardingStore.getState().setStep(3);
    useOnboardingStore.getState().complete();

    expect(useOnboardingStore.getState()).toMatchObject({
      completed: true,
      step: 6,
      mode: "pro",
    });

    useOnboardingStore.getState().reset();
    expect(useOnboardingStore.getState()).toMatchObject({
      completed: false,
      step: 0,
      mode: null,
    });
  });

  it("preserves the six-step completion position for free users", () => {
    useOnboardingStore.getState().setMode("free");
    useOnboardingStore.getState().complete();

    expect(useOnboardingStore.getState()).toMatchObject({
      completed: true,
      step: 5,
      mode: "free",
    });
  });

  it("preserves the account-free completion position for local AI users", () => {
    useOnboardingStore.getState().setMode("local");
    useOnboardingStore.getState().complete();

    expect(useOnboardingStore.getState()).toMatchObject({
      completed: true,
      step: 5,
      mode: "local",
    });
  });
});

describe("usage calculations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-24T08:30:00.000Z"));
    useUsageStore.getState().setSummary({ ...emptyUsage });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("accumulates usage and estimates time saved against typing speed", () => {
    useUsageStore.getState().addUsage({
      durationMs: 10_000,
      speakingMs: 8_000,
      words: 30,
      transcriptionTokens: 210,
      transformTokens: 90,
    });

    expect(useUsageStore.getState().summary).toMatchObject({
      dictationMs: 10_000,
      speakingMs: 8_000,
      wordsGenerated: 30,
      dictationCount: 1,
      transcriptionTokens: 210,
      transformTokens: 90,
      estimatedSavedMs: 29_990,
      points: [{ date: "2026-07-24", minutes: 0.2, words: 30, tokens: 300 }],
    });
  });

  it("never subtracts saved time for a slower dictation", () => {
    useUsageStore.getState().setSummary({ ...emptyUsage, estimatedSavedMs: 5_000 });

    useUsageStore.getState().addUsage({
      durationMs: 10_000,
      speakingMs: 7_500,
      words: 2,
      transcriptionTokens: 20,
      transformTokens: 10,
    });

    expect(useUsageStore.getState().summary.estimatedSavedMs).toBe(5_000);
  });
});

describe("prompt store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    usePromptStore.setState({
      customPrompt: "",
      removeFillers: true,
      correctPunctuation: true,
      formatLists: true,
      outputLanguage: "en",
      saveState: "saved",
      updatedAt: null,
    });
  });

  it("marks edited instructions and behaviors as needing persistence", () => {
    usePromptStore.getState().setPrompt("Keep the answer concise.");
    usePromptStore.getState().setBehavior({ removeFillers: false, formatLists: false });
    usePromptStore.getState().setOutputLanguage("da");

    expect(usePromptStore.getState()).toMatchObject({
      customPrompt: "Keep the answer concise.",
      removeFillers: false,
      correctPunctuation: true,
      formatLists: false,
      outputLanguage: "da",
      saveState: "saving",
    });
    expect(usePromptStore.getState().updatedAt).toEqual(expect.any(String));

    usePromptStore.getState().setSaveState("saved");
    expect(usePromptStore.getState().saveState).toBe("saved");
  });
});

describe("history synchronization intent", () => {
  const synced = {
    id: "cloud-1",
    text: "Synced text",
    durationMs: 1_000,
    application: "Mail",
    language: "en" as const,
    words: 2,
    createdAt: "2026-07-24T08:00:00.000Z",
    syncState: "synced" as const,
  };
  const local = { ...synced, id: "local-1", syncState: "local" as const };

  beforeEach(() => {
    useHistoryStore.getState().hydrate([synced, local], []);
  });

  it("queues explicit cloud deletions but keeps local cache clearing device-only", () => {
    useHistoryStore.getState().deleteDictation(synced.id);
    useHistoryStore.getState().deleteDictation(local.id);

    expect(useHistoryStore.getState().pendingCloudDeletes).toEqual([synced.id]);

    useHistoryStore.getState().hydrate([synced], []);
    useHistoryStore.getState().clear();
    expect(useHistoryStore.getState()).toMatchObject({
      dictations: [],
      pendingCloudDeletes: [],
    });
  });

  it("acknowledges a completed remote deletion", () => {
    useHistoryStore.getState().deleteDictation(synced.id);
    useHistoryStore.getState().acknowledgeCloudDelete(synced.id);

    expect(useHistoryStore.getState().pendingCloudDeletes).toEqual([]);
  });
});
