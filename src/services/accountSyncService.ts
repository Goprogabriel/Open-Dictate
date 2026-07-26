import { env } from "@/config/env";
import { ApiBillingService } from "@/services/api/billingService";
import type { AuthSession } from "@/services/contracts";
import {
  FirebaseDictionaryRepository,
  FirebaseHistoryRepository,
  FirebaseSettingsRepository,
  FirebaseUsageRepository,
} from "@/services/firebase/repositories";
import { getCurrentAuthSession } from "@/services/firebase/sessionRuntime";
import {
  dictionaryRecordChanged,
  mergeDictionaryRecords,
  resolveDictionaryWriteAcknowledgement,
  resolveTransformationMerge,
  resolveTransformationWriteAcknowledgement,
  splitDictionaryRecords,
  transformationSettingsChanged,
} from "@/services/syncProtocol";
import { useDictionaryStore } from "@/stores/dictionaryStore";
import { useHistoryStore } from "@/stores/historyStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { usePromptStore } from "@/stores/promptStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useUsageStore } from "@/stores/usageStore";
import type {
  DictionaryRecord,
  TransformationSettings,
  TransformationSettingsRecord,
} from "@/types/domain";

const SYNC_DEBOUNCE_MS = 450;

function currentTransformation(): TransformationSettings {
  const state = usePromptStore.getState();
  return {
    customPrompt: state.customPrompt,
    outputLanguage: state.outputLanguage,
    removeFillers: state.removeFillers,
    correctPunctuation: state.correctPunctuation,
    formatLists: state.formatLists,
  };
}

function currentTransformationRecord(): TransformationSettingsRecord {
  return {
    settings: currentTransformation(),
    updatedAt: usePromptStore.getState().updatedAt,
  };
}

function currentDictionaryRecords(): DictionaryRecord[] {
  const state = useDictionaryStore.getState();
  return [...state.entries, ...state.tombstones];
}

export function startAccountSync(session: AuthSession): () => void {
  const uid = session.user.id;
  const initialTransformation = currentTransformationRecord();
  const settingsRepository = new FirebaseSettingsRepository(uid);
  const dictionaryRepository = new FirebaseDictionaryRepository(uid);
  const historyRepository = new FirebaseHistoryRepository(uid);
  const usageRepository = new FirebaseUsageRepository(uid);
  const timers = new Map<string, number>();
  const pendingWrites = new Map<string, Promise<void>>();
  const unsubscribers: Array<() => void> = [];
  const billingService = env.apiBaseUrl ? new ApiBillingService(getCurrentAuthSession) : null;
  let entitlementRefreshTimer: number | null = null;
  let active = true;
  let applyingDictionaryAcknowledgement = false;
  let applyingTransformationAcknowledgement = false;

  const later = (key: string, action: () => Promise<void>) => {
    const existingTimer = timers.get(key);
    if (existingTimer !== undefined) window.clearTimeout(existingTimer);

    const timer = window.setTimeout(() => {
      timers.delete(key);
      if (!active) return;

      const previousWrite = pendingWrites.get(key) ?? Promise.resolve();
      const write = previousWrite
        .catch(() => undefined)
        .then(async () => {
          if (active) await action();
        });
      pendingWrites.set(key, write);
      void write
        .catch(() => undefined)
        .finally(() => {
          if (pendingWrites.get(key) === write) pendingWrites.delete(key);
        });
    }, SYNC_DEBOUNCE_MS);
    timers.set(key, timer);
  };

  const persistCurrentTransformation = async (reportErrors: boolean): Promise<void> => {
    const attempted = currentTransformationRecord();
    try {
      const committed = await settingsRepository.saveTransformationSettings(attempted.settings);
      if (!active) return;

      const acknowledged = resolveTransformationWriteAcknowledgement(
        attempted,
        currentTransformationRecord(),
        committed,
      );
      if (!acknowledged) return;

      applyingTransformationAcknowledgement = true;
      try {
        usePromptStore.getState().hydrate(acknowledged.settings, acknowledged.updatedAt);
      } finally {
        applyingTransformationAcknowledgement = false;
      }
    } catch (error) {
      const current = currentTransformationRecord();
      const attemptedIsStillCurrent =
        current.updatedAt === attempted.updatedAt &&
        !transformationSettingsChanged(current.settings, attempted.settings);
      if (active && reportErrors && attemptedIsStillCurrent) {
        usePromptStore.getState().setSaveState("error");
      }
      throw error;
    }
  };

  const persistDictionaryRecord = async (attempted: DictionaryRecord): Promise<void> => {
    const committed = await dictionaryRepository.save(attempted);
    if (!active) return;

    const records = currentDictionaryRecords();
    const current = records.find((record) => record.id === attempted.id);
    const acknowledged = resolveDictionaryWriteAcknowledgement(attempted, current, committed);
    if (!acknowledged) return;

    const nextRecords = records.map((record) =>
      record.id === acknowledged.id ? acknowledged : record,
    );
    const { entries, tombstones } = splitDictionaryRecords(nextRecords);
    applyingDictionaryAcknowledgement = true;
    try {
      useDictionaryStore.getState().hydrate(entries, tombstones);
    } finally {
      applyingDictionaryAcknowledgement = false;
    }
  };

  const scheduleHistoryDelete = (id: string) => {
    later(`history:${id}`, async () => {
      await historyRepository.delete(id);
      if (active) useHistoryStore.getState().acknowledgeCloudDelete(id);
    });
  };

  void (async () => {
    const month = useUsageStore.getState().summary.month;
    const [settingsResult, dictionaryResult, historyResult, usageResult, subscriptionResult] =
      await Promise.allSettled([
        settingsRepository.getTransformationSettings(),
        dictionaryRepository.list(),
        historyRepository.list(),
        usageRepository.getMonth(month),
        billingService?.getSubscription() ?? Promise.resolve(null),
      ]);
    if (!active) return;

    if (settingsResult.status === "fulfilled") {
      const decision = resolveTransformationMerge(
        initialTransformation,
        currentTransformationRecord(),
        settingsResult.value,
      );
      if (decision.kind === "hydrate" || decision.kind === "hydrate-and-upload") {
        usePromptStore.getState().hydrate(decision.record.settings, decision.record.updatedAt);
      }
      if (decision.kind === "upload" || decision.kind === "hydrate-and-upload") {
        later("settings", () => persistCurrentTransformation(true));
      }
    }

    if (dictionaryResult.status === "fulfilled") {
      const { records, localWinners } = mergeDictionaryRecords(
        currentDictionaryRecords(),
        dictionaryResult.value,
      );
      const { entries, tombstones } = splitDictionaryRecords(records);
      useDictionaryStore.getState().hydrate(entries, tombstones);
      for (const record of localWinners) {
        later(`dictionary:${record.id}`, () => persistDictionaryRecord(record));
      }
    }

    if (historyResult.status === "fulfilled") {
      const historyState = useHistoryStore.getState();
      const localHistory = historyState.dictations;
      const pendingDeletes = new Set(historyState.pendingCloudDeletes);
      const cutoff = new Date(
        Date.now() - usePreferencesStore.getState().privacy.retentionDays * 24 * 60 * 60 * 1_000,
      ).toISOString();
      const cloudHistory = historyResult.value.filter(
        (item) => !pendingDeletes.has(item.id) && item.createdAt >= cutoff,
      );
      const cloudIds = new Set(cloudHistory.map((item) => item.id));
      useHistoryStore.getState().hydrate(
        [...cloudHistory, ...localHistory.filter((item) => !cloudIds.has(item.id))].sort(
          (left, right) => right.createdAt.localeCompare(left.createdAt),
        ),
        historyState.pendingCloudDeletes,
      );
    }

    if (usageResult.status === "fulfilled") {
      useUsageStore.getState().setSummary(usageResult.value);
    }
    if (subscriptionResult.status === "fulfilled" && subscriptionResult.value) {
      useSessionStore.getState().setSubscription(subscriptionResult.value);
    }

    if (!active) return;

    unsubscribers.push(
      usePromptStore.subscribe((state, previous) => {
        if (applyingTransformationAcknowledgement) return;
        if (
          state.customPrompt === previous.customPrompt &&
          state.outputLanguage === previous.outputLanguage &&
          state.removeFillers === previous.removeFillers &&
          state.correctPunctuation === previous.correctPunctuation &&
          state.formatLists === previous.formatLists &&
          state.updatedAt === previous.updatedAt
        ) {
          return;
        }
        later("settings", () => persistCurrentTransformation(true));
      }),
    );

    unsubscribers.push(
      useDictionaryStore.subscribe((state, previous) => {
        if (applyingDictionaryAcknowledgement) return;
        const previousRecords: DictionaryRecord[] = [...previous.entries, ...previous.tombstones];
        const currentRecords: DictionaryRecord[] = [...state.entries, ...state.tombstones];
        const previousById = new Map(previousRecords.map((record) => [record.id, record]));
        for (const record of currentRecords) {
          const previousRecord = previousById.get(record.id);
          if (!previousRecord || dictionaryRecordChanged(previousRecord, record)) {
            later(`dictionary:${record.id}`, () => persistDictionaryRecord(record));
          }
        }
      }),
    );

    unsubscribers.push(
      useHistoryStore.subscribe((state, previous) => {
        const previousDeletes = new Set(previous.pendingCloudDeletes);
        for (const id of state.pendingCloudDeletes) {
          if (!previousDeletes.has(id)) scheduleHistoryDelete(id);
        }
      }),
    );

    for (const id of useHistoryStore.getState().pendingCloudDeletes) {
      scheduleHistoryDelete(id);
    }

    if (billingService) {
      entitlementRefreshTimer = window.setInterval(
        () => {
          if (!active) return;
          void billingService
            .getSubscription()
            .then((subscription) => {
              if (active) useSessionStore.getState().setSubscription(subscription);
            })
            .catch(() => undefined);
        },
        5 * 60 * 1_000,
      );
    }
  })().catch(() => undefined);

  return () => {
    active = false;
    for (const timer of timers.values()) window.clearTimeout(timer);
    timers.clear();
    for (const unsubscribe of unsubscribers) unsubscribe();
    unsubscribers.length = 0;
    if (entitlementRefreshTimer !== null) window.clearInterval(entitlementRefreshTimer);
  };
}
