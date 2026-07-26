import { lazy } from "react";

export const UsagePage = lazy(() =>
  import("@/pages/UsagePage").then((module) => ({ default: module.UsagePage })),
);
export const HistoryPage = lazy(() =>
  import("@/pages/HistoryPage").then((module) => ({ default: module.HistoryPage })),
);
export const PromptPage = lazy(() =>
  import("@/pages/PromptPage").then((module) => ({ default: module.PromptPage })),
);
export const DictionaryPage = lazy(() =>
  import("@/pages/DictionaryPage").then((module) => ({ default: module.DictionaryPage })),
);
export const ProfilePage = lazy(() =>
  import("@/pages/ProfilePage").then((module) => ({ default: module.ProfilePage })),
);
export const SettingsPage = lazy(() =>
  import("@/pages/SettingsPage").then((module) => ({ default: module.SettingsPage })),
);
