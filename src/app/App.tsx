import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";

import { navigateTo } from "@/app/navigation";
import { AppRouter } from "@/app/router";
import { env } from "@/config/env";
import { DictationRuntime } from "@/features/dictation/DictationRuntime";
import { RecordingHud } from "@/features/dictation/RecordingHud";
import { OnboardingFlow } from "@/features/onboarding/OnboardingFlow";
import { useAuthBootstrap } from "@/hooks/useAuthBootstrap";
import { initializeSecureStatePersistence } from "@/services/secureStateService";
import { nativeClient } from "@/services/native";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { usePlatformStore } from "@/stores/platformStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { isTauriRuntime } from "@/utils/platform";

function isRecorderWindow(): boolean {
  const previewWindow = new URLSearchParams(window.location.search).get("window");
  if (previewWindow === "recorder") return true;
  return isTauriRuntime() && getCurrentWindow().label === "recorder-overlay";
}

function shouldShowOnboardingPreview(): boolean {
  return (
    env.enablePreviewData &&
    new URLSearchParams(window.location.search).get("preview") === "onboarding"
  );
}

function MainApplication() {
  useAuthBootstrap();
  const onboardingComplete = useOnboardingStore((state) => state.completed);
  const runInBackground = usePreferencesStore((state) => state.runInBackground);
  const setLaunchAtStartup = usePreferencesStore((state) => state.setLaunchAtStartup);
  const setPlatformInfo = usePlatformStore((state) => state.setPlatformInfo);

  useEffect(() => {
    if (isRecorderWindow()) return;
    void initializeSecureStatePersistence();
    void nativeClient
      .getPlatformInfo()
      .then(setPlatformInfo)
      .catch(() => undefined);
    if (nativeClient.isAvailable()) {
      void nativeClient
        .getAutostartEnabled()
        .then(setLaunchAtStartup)
        .catch(() => undefined);
    }
  }, [setLaunchAtStartup, setPlatformInfo]);

  useEffect(() => {
    if (isRecorderWindow()) return;
    void nativeClient.setRunInBackground(runInBackground).catch(() => undefined);
  }, [runInBackground]);

  useEffect(() => {
    if (!isTauriRuntime() || isRecorderWindow()) return;
    let remove: () => void = () => undefined;
    void listen<string>("app://navigate", ({ payload }) => {
      if (payload.startsWith("/")) navigateTo(payload);
    }).then((unlisten) => {
      remove = unlisten;
    });
    return () => remove();
  }, []);

  return (
    <DictationRuntime>
      {shouldShowOnboardingPreview() || (!onboardingComplete && !env.enablePreviewData) ? (
        <OnboardingFlow />
      ) : (
        <AppRouter />
      )}
    </DictationRuntime>
  );
}

export function App() {
  return isRecorderWindow() ? <RecordingHud /> : <MainApplication />;
}
