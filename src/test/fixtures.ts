import type {
  BillingInvoice,
  Dictation,
  DictionaryEntry,
  Subscription,
  UsageSummary,
  UserProfile,
} from "@/types/domain";

const now = new Date();

function daysAgo(days: number, hour = 10): string {
  const value = new Date(now);
  value.setDate(value.getDate() - days);
  value.setHours(hour, 12, 0, 0);
  return value.toISOString();
}

export const previewProfile: UserProfile = {
  id: "preview-user",
  name: "Alex Morgan",
  email: "alex@example.com",
  emailVerified: true,
  mode: "pro",
  language: "en",
  createdAt: daysAgo(180),
};

export const previewSubscription: Subscription = {
  plan: "pro",
  status: "active",
  currentPeriodEnd: daysAgo(-13),
  cancelAtPeriodEnd: false,
  remainingTokens: 2_684_200,
  allowanceTokens: 3_500_000,
  subscriptionTokens: 2_584_200,
  purchasedTokens: 100_000,
  subscriptionTokensExpireAt: daysAgo(-13),
  topupOptions: [
    { tier: "usd_5", amountMinor: 500, currency: "usd", credits: 3_062_500 },
    { tier: "usd_10", amountMinor: 1_000, currency: "usd", credits: 6_562_500 },
    { tier: "usd_20", amountMinor: 2_000, currency: "usd", credits: 14_000_000 },
  ],
};

export const previewDictations: Dictation[] = [
  {
    id: "dictation-1",
    text: "Hey, can you send me that email tomorrow — actually Friday? I’ll review it before lunch.",
    durationMs: 18_400,
    application: "Slack",
    language: "en",
    words: 17,
    createdAt: daysAgo(0, 14),
    syncState: "synced",
  },
  {
    id: "dictation-2",
    text: "The onboarding flow is ready for review. The only remaining task is to verify the Windows permission state.",
    durationMs: 24_800,
    application: "Notion",
    language: "en",
    words: 19,
    createdAt: daysAgo(0, 9),
    syncState: "synced",
  },
  {
    id: "dictation-3",
    text: "Hej Maja. Tak for mødet i går. Jeg sender den opdaterede tidsplan inden klokken tre.",
    durationMs: 16_200,
    application: "Mail",
    language: "da",
    words: 16,
    createdAt: daysAgo(1, 16),
    syncState: "synced",
  },
  {
    id: "dictation-4",
    text: "Please structure the release notes into three sections: improvements, fixes, and known limitations.",
    durationMs: 12_900,
    application: "Linear",
    language: "en",
    words: 14,
    createdAt: daysAgo(4, 11),
    syncState: "synced",
  },
];

export const previewDictionary: DictionaryEntry[] = [
  {
    id: "term-1",
    spoken: "supabace",
    replacement: "Supabase",
    language: "all",
    createdAt: daysAgo(42),
    updatedAt: daysAgo(2),
  },
  {
    id: "term-2",
    spoken: "react native",
    replacement: "React Native",
    language: "all",
    createdAt: daysAgo(35),
    updatedAt: daysAgo(8),
  },
  {
    id: "term-3",
    spoken: "open ai",
    replacement: "OpenAI",
    language: "all",
    createdAt: daysAgo(24),
    updatedAt: daysAgo(12),
  },
];

function makeUsagePoints(): UsageSummary["points"] {
  return Array.from({ length: 30 }, (_, index) => {
    const date = new Date(now);
    date.setDate(date.getDate() - (29 - index));
    const weekday = date.getDay();
    const activity = weekday === 0 || weekday === 6 ? 0.42 : 1;
    const minutes = Math.round((4 + ((index * 7) % 14)) * activity);
    return {
      date: date.toISOString().slice(0, 10),
      minutes,
      words: minutes * 119,
      tokens: minutes * 860,
    };
  });
}

export const previewUsage: UsageSummary = {
  month: now.toISOString().slice(0, 7),
  dictationMs: 3 * 60 * 60 * 1000 + 28 * 60 * 1000,
  speakingMs: 2 * 60 * 60 * 1000 + 51 * 60 * 1000,
  wordsGenerated: 24_680,
  dictationCount: 187,
  transcriptionTokens: 218_400,
  transformTokens: 97_400,
  estimatedSavedMs: 4 * 60 * 60 * 1000 + 12 * 60 * 1000,
  comparisonPercent: 18,
  points: makeUsagePoints(),
};

export const previewInvoices: BillingInvoice[] = [
  {
    id: "invoice-1",
    date: daysAgo(18),
    amountMinor: 500,
    currency: "usd",
    status: "paid",
    receiptUrl: null,
  },
  {
    id: "invoice-2",
    date: daysAgo(48),
    amountMinor: 500,
    currency: "usd",
    status: "paid",
    receiptUrl: null,
  },
];
