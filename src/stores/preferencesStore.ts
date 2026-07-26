import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type {
  AppPreferences,
  LocalAiQuality,
  Locale,
  PrivacySettings,
  UserMode,
} from "@/types/domain";

interface PreferencesState extends AppPreferences {
  setLocale: (locale: Locale) => void;
  setTranscriptionLanguage: (locale: Locale) => void;
  setProcessingMode: (mode: UserMode) => void;
  setLocalAiQuality: (quality: LocalAiQuality) => void;
  setMicrophone: (microphoneId: string | null) => void;
  setLaunchAtStartup: (enabled: boolean) => void;
  setRunInBackground: (enabled: boolean) => void;
  setPrivacy: (settings: Partial<PrivacySettings>) => void;
  reset: () => void;
}

function defaultPreferences(): AppPreferences {
  return {
    locale: "en",
    transcriptionLanguage: "en",
    processingMode: "free",
    localAiQuality: "medium",
    microphoneId: null,
    launchAtStartup: false,
    runInBackground: true,
    privacy: {
      saveHistory: true,
      retentionDays: 30,
      shareDiagnostics: false,
    },
  };
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      ...defaultPreferences(),
      setLocale: (locale) => set({ locale }),
      setTranscriptionLanguage: (transcriptionLanguage) => set({ transcriptionLanguage }),
      setProcessingMode: (processingMode) => set({ processingMode }),
      setLocalAiQuality: (localAiQuality) => set({ localAiQuality }),
      setMicrophone: (microphoneId) => set({ microphoneId }),
      setLaunchAtStartup: (launchAtStartup) => set({ launchAtStartup }),
      setRunInBackground: (runInBackground) => set({ runInBackground }),
      setPrivacy: (settings) => set((state) => ({ privacy: { ...state.privacy, ...settings } })),
      reset: () => set(defaultPreferences()),
    }),
    {
      name: "open-dictate-preferences",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
