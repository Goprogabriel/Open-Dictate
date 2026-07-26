import { useEffect, useRef, type ReactNode } from "react";

import { appConfig } from "@/config/app";
import { env } from "@/config/env";
import { getCurrentAuthSession } from "@/services/firebase/sessionRuntime";
import { nativeClient } from "@/services/native";
import { useDictationStore } from "@/stores/dictationStore";
import { useDictionaryStore } from "@/stores/dictionaryStore";
import { useHistoryStore } from "@/stores/historyStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { usePromptStore } from "@/stores/promptStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useUsageStore } from "@/stores/usageStore";
import type { DictationPhase, HudStateEvent, TranscriptionOptions } from "@/types/native";
import { countWords } from "@/utils/format";
import { createId } from "@/utils/id";

function errorCodeFor(error: unknown): string {
  const payload =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown; message?: unknown })
      : null;
  const message = [
    error instanceof Error ? error.message : String(error),
    typeof payload?.code === "string" ? payload.code : "",
    typeof payload?.message === "string" ? payload.message : "",
  ]
    .join(" ")
    .toLowerCase();
  if (message.includes("microphone") || message.includes("device")) return "microphone";
  if (message.includes("accessibility") || message.includes("permission")) return "accessibility";
  if (message.includes("email_verification_required")) return "emailVerification";
  if (message.includes("authentication_required")) return "authentication";
  if (
    message.includes("insufficient_quota") ||
    message.includes("billing_hard_limit") ||
    message.includes("402")
  ) {
    return "apiQuota";
  }
  if (
    message.includes("rate_limit") ||
    message.includes("rate limited") ||
    message.includes("429")
  ) {
    return "rateLimit";
  }
  if (
    message.includes("allowance") ||
    message.includes("quota") ||
    message.includes("credit") ||
    message.includes("subscription")
  ) {
    return "allowance";
  }
  if (
    message.includes("api_key") ||
    message.includes("credential") ||
    message.includes("authentication") ||
    message.includes("401") ||
    message.includes("403")
  )
    return "apiKey";
  if (message.includes("speech")) return "noSpeech";
  if (message.includes("local_model") || message.includes("local model")) return "localModel";
  if (message.includes("network") || message.includes("fetch") || message.includes("offline"))
    return "offline";
  if (message.includes("insert")) return "insertion";
  if (message.includes("provider") || message.includes("transcri")) return "transcription";
  return "generic";
}

async function publishHud(state: HudStateEvent): Promise<void> {
  await nativeClient.updateHudState(state).catch(() => undefined);
}

function makeOptions(): TranscriptionOptions {
  const prompt = usePromptStore.getState();
  const preferences = usePreferencesStore.getState();
  const language = preferences.transcriptionLanguage;
  return {
    language,
    outputLanguage: prompt.outputLanguage,
    customPrompt: prompt.customPrompt,
    dictionary: useDictionaryStore
      .getState()
      .entries.filter((entry) => entry.language === "all" || entry.language === language)
      .slice(0, 100)
      .map(({ spoken, replacement }) => ({ spoken, replacement })),
    removeFillers: prompt.removeFillers,
    correctPunctuation: prompt.correctPunctuation,
    formatLists: prompt.formatLists,
    saveHistory: preferences.privacy.saveHistory,
    retentionDays: preferences.privacy.retentionDays,
  };
}

export function DictationRuntime({ children }: { children: ReactNode }) {
  const startingRef = useRef(false);
  const finalizingRef = useRef(false);
  const releasePendingRef = useRef(false);
  const pressTimestampRef = useRef(0);
  const resetTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!nativeClient.isAvailable()) return;

    let disposed = false;
    let removeShortcut: () => void = () => undefined;
    let removeAudio: () => void = () => undefined;

    const setPhase = (phase: DictationPhase) => {
      useDictationStore.getState().setPhase(phase);
      void publishHud({
        phase,
        startedAt: useDictationStore.getState().startedAt,
        hasFallbackText: Boolean(useDictationStore.getState().fallbackText),
      });
    };

    const scheduleReset = (delay: number) => {
      if (resetTimeoutRef.current) window.clearTimeout(resetTimeoutRef.current);
      resetTimeoutRef.current = window.setTimeout(() => {
        useDictationStore.getState().reset();
        void publishHud({ phase: "idle" });
      }, delay);
    };

    const fail = (error: unknown, fallbackText?: string) => {
      const errorCode = errorCodeFor(error);
      useDictationStore.getState().fail(errorCode, fallbackText);
      void publishHud({
        phase: "error",
        errorCode,
        hasFallbackText: Boolean(fallbackText),
      });
      scheduleReset(5_000);
    };

    const cancel = async () => {
      const recordingId = useDictationStore.getState().recordingId;
      releasePendingRef.current = false;
      startingRef.current = false;
      finalizingRef.current = false;
      if (recordingId) await nativeClient.cancelRecording(recordingId).catch(() => undefined);
      setPhase("cancelled");
      scheduleReset(850);
    };

    const finalize = async (recordingId: string) => {
      if (finalizingRef.current) return;
      finalizingRef.current = true;
      let nativeOwnsRecording = false;
      try {
        const heldFor = Date.now() - pressTimestampRef.current;
        if (heldFor < appConfig.accidentalHoldThresholdMs) {
          await cancel();
          return;
        }

        const recording = await nativeClient.stopRecording(recordingId);
        if (recording.durationMs < 300 || recording.sizeBytes < 1_000) {
          throw new Error("speech_too_short");
        }

        setPhase("processing");
        const sessionState = useSessionStore.getState();
        const processingMode = usePreferencesStore.getState().processingMode;
        const options = makeOptions();
        let result;

        if (processingMode === "free") {
          nativeOwnsRecording = true;
          result = await nativeClient.transcribeByok(recording.id, options);
        } else if (processingMode === "local") {
          nativeOwnsRecording = true;
          result = await nativeClient.transcribeLocal(
            recording.id,
            options,
            usePreferencesStore.getState().localAiQuality,
          );
        } else if (
          processingMode === "pro" &&
          ((sessionState.subscription.plan === "pro" &&
            (sessionState.subscription.status === "active" ||
              sessionState.subscription.status === "trialing")) ||
            sessionState.subscription.purchasedTokens > 0)
        ) {
          const session = getCurrentAuthSession();
          if (!session) throw new Error("authentication_required");
          if (!env.apiBaseUrl) throw new Error("managed_api_not_configured");
          nativeOwnsRecording = true;
          result = await nativeClient.transcribeManaged(
            recording.id,
            options,
            `${env.apiBaseUrl}/v1/dictations/transcribe`,
            await session.getIdToken(),
          );
        } else {
          throw new Error("subscription_required");
        }

        const text = result.text.trim();
        if (!text) throw new Error("no_speech_detected");

        setPhase("inserting");
        try {
          await nativeClient.insertText(text);
        } catch (insertionError) {
          await nativeClient.copyText(text).catch(() => undefined);
          fail(insertionError, text);
          return;
        }

        const preferences = usePreferencesStore.getState();
        const words = countWords(text);
        if (preferences.privacy.saveHistory) {
          useHistoryStore.getState().addDictation({
            id: result.dictationId ?? createId("dictation"),
            text,
            durationMs: recording.durationMs,
            application: recording.application || "Unknown",
            language: preferences.transcriptionLanguage,
            words,
            createdAt: new Date().toISOString(),
            syncState: processingMode === "pro" ? "synced" : "local",
          });
        }
        useUsageStore.getState().addUsage({
          durationMs: recording.durationMs,
          speakingMs: recording.speakingMs,
          words,
          transcriptionTokens: result.transcriptionTokens,
          transformTokens: result.transformTokens,
        });
        if (
          typeof result.remainingTokens === "number" ||
          typeof result.subscriptionTokens === "number" ||
          typeof result.purchasedTokens === "number" ||
          result.subscriptionTokensExpireAt !== undefined
        ) {
          const currentSubscription = useSessionStore.getState().subscription;
          useSessionStore.getState().setSubscription({
            ...currentSubscription,
            remainingTokens:
              typeof result.remainingTokens === "number"
                ? result.remainingTokens
                : currentSubscription.remainingTokens,
            subscriptionTokens:
              typeof result.subscriptionTokens === "number"
                ? result.subscriptionTokens
                : currentSubscription.subscriptionTokens,
            purchasedTokens:
              typeof result.purchasedTokens === "number"
                ? result.purchasedTokens
                : currentSubscription.purchasedTokens,
            subscriptionTokensExpireAt:
              result.subscriptionTokensExpireAt !== undefined
                ? result.subscriptionTokensExpireAt
                : currentSubscription.subscriptionTokensExpireAt,
          });
        }
        setPhase("success");
        scheduleReset(appConfig.successHudDurationMs);
      } catch (error) {
        if (!nativeOwnsRecording) {
          await nativeClient.cancelRecording(recordingId).catch(() => undefined);
        }
        fail(error);
      } finally {
        finalizingRef.current = false;
      }
    };

    const begin = async (timestampMs: number) => {
      if (
        startingRef.current ||
        finalizingRef.current ||
        useDictationStore.getState().phase !== "idle"
      ) {
        return;
      }
      startingRef.current = true;
      releasePendingRef.current = false;
      pressTimestampRef.current = timestampMs || Date.now();
      setPhase("arming");
      try {
        const { microphoneId } = usePreferencesStore.getState();
        const recording = await nativeClient.startRecording(microphoneId);
        if (disposed) {
          await nativeClient.cancelRecording(recording.id);
          return;
        }
        useDictationStore.getState().start(recording.id);
        void publishHud({ phase: "recording", startedAt: Date.now() });
        if (releasePendingRef.current) await finalize(recording.id);
      } catch (error) {
        fail(error);
      } finally {
        startingRef.current = false;
      }
    };

    void nativeClient
      .onShortcut((event) => {
        if (event.phase === "pressed") void begin(event.timestampMs);
        if (event.phase === "cancelled") void cancel();
        if (event.phase === "released") {
          releasePendingRef.current = true;
          const recordingId = useDictationStore.getState().recordingId;
          if (recordingId) void finalize(recordingId);
        }
      })
      .then((remove) => {
        removeShortcut = remove;
      });

    void nativeClient
      .onAudioLevel((event) => {
        if (event.recordingId === useDictationStore.getState().recordingId) {
          useDictationStore.getState().setAudioLevel(event.level);
        }
      })
      .then((remove) => {
        removeAudio = remove;
      });

    return () => {
      disposed = true;
      removeShortcut();
      removeAudio();
      if (resetTimeoutRef.current) window.clearTimeout(resetTimeoutRef.current);
    };
  }, []);

  return children;
}
