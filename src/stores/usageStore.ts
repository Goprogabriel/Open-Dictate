import { create } from "zustand";

import { env } from "@/config/env";
import { previewUsage } from "@/test/fixtures";
import type { UsagePoint, UsageSummary } from "@/types/domain";

const emptyUsage: UsageSummary = {
  month: new Date().toISOString().slice(0, 7),
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

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function updateDailyPoint(
  points: UsagePoint[],
  date: string,
  usage: {
    durationMs: number;
    words: number;
    transcriptionTokens: number;
    transformTokens: number;
  },
): UsagePoint[] {
  const existing = points.find((point) => point.date === date);
  const totalDurationMs = (existing?.minutes ?? 0) * 60_000 + usage.durationMs;
  const nextPoint: UsagePoint = {
    date,
    minutes: Number((totalDurationMs / 60_000).toFixed(1)),
    words: (existing?.words ?? 0) + usage.words,
    tokens: (existing?.tokens ?? 0) + usage.transcriptionTokens + usage.transformTokens,
  };
  return [...points.filter((point) => point.date !== date), nextPoint]
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-30);
}

function ensureChartPoints(summary: UsageSummary): UsagePoint[] {
  if (summary.points.length > 0 || summary.dictationCount === 0) {
    return summary.points;
  }

  return [
    {
      date: `${summary.month}-01`,
      minutes: Number((summary.dictationMs / 60_000).toFixed(1)),
      words: summary.wordsGenerated,
      tokens: summary.transcriptionTokens + summary.transformTokens,
    },
  ];
}

interface UsageState {
  summary: UsageSummary;
  setSummary: (summary: UsageSummary) => void;
  reset: () => void;
  addUsage: (usage: {
    durationMs: number;
    speakingMs: number;
    words: number;
    transcriptionTokens: number;
    transformTokens: number;
  }) => void;
}

export const useUsageStore = create<UsageState>((set) => ({
  summary: env.enablePreviewData ? previewUsage : emptyUsage,
  setSummary: (summary) => set({ summary: { ...summary, points: ensureChartPoints(summary) } }),
  reset: () => set({ summary: { ...emptyUsage, points: [] } }),
  addUsage: ({ durationMs, speakingMs, words, transcriptionTokens, transformTokens }) =>
    set((state) => {
      const now = new Date();
      const currentMonth = monthKey(now);
      const summary =
        state.summary.month === currentMonth
          ? state.summary
          : { ...emptyUsage, month: currentMonth };

      return {
        summary: {
          ...summary,
          dictationMs: summary.dictationMs + durationMs,
          speakingMs: summary.speakingMs + speakingMs,
          wordsGenerated: summary.wordsGenerated + words,
          dictationCount: summary.dictationCount + 1,
          transcriptionTokens: summary.transcriptionTokens + transcriptionTokens,
          transformTokens: summary.transformTokens + transformTokens,
          estimatedSavedMs: summary.estimatedSavedMs + Math.max(0, words * 1333 - durationMs),
          points: updateDailyPoint(summary.points, dateKey(now), {
            durationMs,
            words,
            transcriptionTokens,
            transformTokens,
          }),
        },
      };
    }),
}));
