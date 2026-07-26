export const appConfig = {
  name: "Open Dictate",
  version: "0.1.0",
  proPriceMonthlyUsd: 5,
  accidentalHoldThresholdMs: 180,
  successHudDurationMs: 750,
  maximumRecordingDurationMs: 10 * 60 * 1000,
  maximumRecordingBytes: 24 * 1024 * 1024,
} as const;

export const appRoutes = {
  usage: "/usage",
  history: "/history",
  prompt: "/prompt",
  dictionary: "/dictionary",
  profile: "/profile",
  settings: "/settings",
} as const;
