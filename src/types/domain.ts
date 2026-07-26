export const supportedLocales = ["en", "da", "no", "sv"] as const;

export type Locale = (typeof supportedLocales)[number];
export type UserMode = "free" | "local" | "pro";
export type LocalAiQuality = "low" | "medium" | "high";
export type SubscriptionStatus = "none" | "trialing" | "active" | "past_due" | "canceled";
export type TopupTierId = "usd_5" | "usd_10" | "usd_20";
export type PermissionState = "unknown" | "granted" | "denied" | "restricted";

export interface TopupOption {
  tier: TopupTierId;
  amountMinor: number;
  currency: "usd";
  credits: number;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string | null;
  emailVerified?: boolean;
  mode: UserMode;
  language: Locale;
  createdAt: string;
}

export interface Subscription {
  plan: "free" | "pro";
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  remainingTokens: number | null;
  allowanceTokens: number | null;
  subscriptionTokens: number;
  purchasedTokens: number;
  subscriptionTokensExpireAt: string | null;
  topupOptions: TopupOption[];
}

export interface Dictation {
  id: string;
  text: string;
  durationMs: number;
  application: string;
  language: Locale;
  words: number;
  createdAt: string;
  syncState: "local" | "synced" | "pending";
}

export interface DictionaryEntry {
  id: string;
  spoken: string;
  replacement: string;
  language: Locale | "all";
  createdAt: string;
  updatedAt: string;
}

export interface DictionaryTombstone {
  id: string;
  createdAt: string;
  updatedAt: string;
  deleted: true;
}

export type DictionaryRecord = DictionaryEntry | DictionaryTombstone;

export interface UsagePoint {
  date: string;
  minutes: number;
  words: number;
  tokens: number;
}

export interface UsageSummary {
  month: string;
  dictationMs: number;
  speakingMs: number;
  wordsGenerated: number;
  dictationCount: number;
  transcriptionTokens: number;
  transformTokens: number;
  estimatedSavedMs: number;
  comparisonPercent: number;
  points: UsagePoint[];
}

export interface TransformationSettings {
  customPrompt: string;
  removeFillers: boolean;
  correctPunctuation: boolean;
  formatLists: boolean;
  outputLanguage: Locale;
}

export interface TransformationSettingsRecord {
  settings: TransformationSettings;
  /**
   * The last known server or local mutation time. `null` is reserved for
   * pre-versioning local data and a brand-new installation.
   */
  updatedAt: string | null;
}

export type RemoteTransformationSettings =
  | { exists: false; settings: null; updatedAt: null }
  | ({ exists: true } & TransformationSettingsRecord);

export interface PrivacySettings {
  saveHistory: boolean;
  retentionDays: 7 | 30 | 90 | 365;
  shareDiagnostics: boolean;
}

export interface AppPreferences {
  locale: Locale;
  transcriptionLanguage: Locale;
  processingMode: UserMode;
  localAiQuality: LocalAiQuality;
  microphoneId: string | null;
  launchAtStartup: boolean;
  runInBackground: boolean;
  privacy: PrivacySettings;
}

export interface PermissionSnapshot {
  microphone: PermissionState;
  accessibility: PermissionState;
  screenRecording: PermissionState;
}

export interface BillingInvoice {
  id: string;
  date: string;
  amountMinor: number;
  currency: string;
  status: "paid" | "open" | "void";
  receiptUrl: string | null;
}
