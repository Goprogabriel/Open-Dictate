import { z } from "zod";

import { nativeClient } from "@/services/native";
import { useDictionaryStore } from "@/stores/dictionaryStore";
import { useHistoryStore } from "@/stores/historyStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { usePromptStore } from "@/stores/promptStore";
import type {
  DictionaryEntry,
  DictionaryTombstone,
  Dictation,
  TransformationSettings,
} from "@/types/domain";
import type { SecureStateNamespace } from "@/types/native";

const SAVE_DEBOUNCE_MS = 250;
const LOCAL_SCOPE = "local";
const LEGACY_SCOPE = "legacy";

const localeSchema = z.enum(["en", "da", "no", "sv"]);
const dictationSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  durationMs: z.number().finite().nonnegative(),
  application: z.string(),
  language: localeSchema,
  words: z.number().int().nonnegative(),
  createdAt: z.string().min(1),
  syncState: z.enum(["local", "synced", "pending"]),
});
const dictionaryEntrySchema = z.object({
  id: z.string().min(1),
  spoken: z.string(),
  replacement: z.string(),
  language: z.union([localeSchema, z.literal("all")]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
const dictionaryTombstoneSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  deleted: z.literal(true),
});
const historyStateSchema = z.object({
  dictations: z.array(dictationSchema),
  pendingCloudDeletes: z.array(z.string().min(1)).default([]),
});
const dictionaryStateSchema = z.object({
  entries: z.array(dictionaryEntrySchema),
  tombstones: z.array(dictionaryTombstoneSchema).default([]),
});
const transformationSchema = z.object({
  customPrompt: z.string(),
  removeFillers: z.boolean(),
  correctPunctuation: z.boolean(),
  formatLists: z.boolean(),
  outputLanguage: localeSchema,
});
const promptStateSchema = z
  .union([
    z.object({
      settings: transformationSchema,
      updatedAt: z.string().min(1).nullable(),
    }),
    transformationSchema,
  ])
  .transform((value): PromptStatePayload =>
    "settings" in value ? value : { settings: value, updatedAt: null },
  );

interface HistoryStatePayload {
  dictations: Dictation[];
  pendingCloudDeletes: string[];
}

interface DictionaryStatePayload {
  entries: DictionaryEntry[];
  tombstones: DictionaryTombstone[];
}

interface PromptStatePayload {
  settings: TransformationSettings;
  updatedAt: string | null;
}

interface ScopedVault<T> {
  version: 2;
  scopes: Record<string, T>;
}

let initialization: Promise<void> | null = null;
let activeScope = LOCAL_SCOPE;
let suppressPersistence = false;
let historyVault: ScopedVault<HistoryStatePayload> | null = null;
let promptVault: ScopedVault<PromptStatePayload> | null = null;
let dictionaryVault: ScopedVault<DictionaryStatePayload> | null = null;
const saveTimers = new Map<string, number>();
const pendingWrites = new Map<SecureStateNamespace, Promise<void>>();

function emptyHistory(): HistoryStatePayload {
  return { dictations: [], pendingCloudDeletes: [] };
}

function emptyPrompt(): PromptStatePayload {
  return {
    settings: {
      customPrompt: "",
      removeFillers: true,
      correctPunctuation: true,
      formatLists: true,
      outputLanguage: "en",
    },
    updatedAt: null,
  };
}

function emptyDictionary(): DictionaryStatePayload {
  return { entries: [], tombstones: [] };
}

function persist(namespace: SecureStateNamespace, value: unknown): void {
  const previousWrite = pendingWrites.get(namespace) ?? Promise.resolve();
  const write = previousWrite
    .catch(() => undefined)
    .then(() => nativeClient.saveSecureState(namespace, value));
  pendingWrites.set(namespace, write);
  void write
    .catch((error: unknown) => {
      console.error(`Could not persist encrypted ${namespace} state.`, error);
    })
    .finally(() => {
      if (pendingWrites.get(namespace) === write) pendingWrites.delete(namespace);
    });
}

function updateVault(namespace: SecureStateNamespace, scope: string, value: unknown): void {
  if (namespace === "history" && historyVault) {
    historyVault = {
      version: 2,
      scopes: { ...historyVault.scopes, [scope]: value as HistoryStatePayload },
    };
    persist(namespace, historyVault);
  }
  if (namespace === "prompt" && promptVault) {
    promptVault = {
      version: 2,
      scopes: { ...promptVault.scopes, [scope]: value as PromptStatePayload },
    };
    persist(namespace, promptVault);
  }
  if (namespace === "dictionary" && dictionaryVault) {
    dictionaryVault = {
      version: 2,
      scopes: { ...dictionaryVault.scopes, [scope]: value as DictionaryStatePayload },
    };
    persist(namespace, dictionaryVault);
  }
}

function scheduleSave(namespace: SecureStateNamespace, scope: string, value: unknown): void {
  const timerKey = `${namespace}:${scope}`;
  const existing = saveTimers.get(timerKey);
  if (existing !== undefined) window.clearTimeout(existing);
  saveTimers.set(
    timerKey,
    window.setTimeout(() => {
      saveTimers.delete(timerKey);
      updateVault(namespace, scope, value);
    }, SAVE_DEBOUNCE_MS),
  );
}

function cancelScheduledSaves(scope: string): void {
  for (const [timerKey, timer] of saveTimers) {
    if (!timerKey.endsWith(`:${scope}`)) continue;
    window.clearTimeout(timer);
    saveTimers.delete(timerKey);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readLegacyState(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const envelope: unknown = JSON.parse(raw);
    return isRecord(envelope) && "state" in envelope ? envelope.state : null;
  } catch {
    return null;
  }
}

function scopedVaultSchema<T>(payloadSchema: z.ZodType<T>) {
  return z.object({
    version: z.literal(2),
    scopes: z.record(z.string(), payloadSchema),
  });
}

async function loadVault<T>(
  namespace: SecureStateNamespace,
  legacyKey: string,
  payloadSchema: z.ZodType<T>,
): Promise<ScopedVault<T>> {
  const encrypted = await nativeClient.loadSecureState<unknown>(namespace);
  if (encrypted !== null) {
    const scoped = scopedVaultSchema(payloadSchema).safeParse(encrypted);
    if (scoped.success) return scoped.data;

    const legacyPayload = payloadSchema.parse(encrypted);
    const migrated: ScopedVault<T> = {
      version: 2,
      scopes: { [LEGACY_SCOPE]: legacyPayload },
    };
    await nativeClient.saveSecureState(namespace, migrated);
    return migrated;
  }

  const legacy = readLegacyState(legacyKey);
  if (legacy !== null) {
    const legacyPayload = payloadSchema.parse(legacy);
    const migrated: ScopedVault<T> = {
      version: 2,
      scopes: { [LEGACY_SCOPE]: legacyPayload },
    };
    await nativeClient.saveSecureState(namespace, migrated);
    try {
      window.localStorage.removeItem(legacyKey);
    } catch {
      // The encrypted migration succeeded even if webview storage is unavailable.
    }
    return migrated;
  }

  return { version: 2, scopes: {} };
}

function adoptLegacy<T>(vault: ScopedVault<T>, scope: string): [ScopedVault<T>, boolean] {
  const legacy = vault.scopes[LEGACY_SCOPE];
  if (legacy === undefined || vault.scopes[scope] !== undefined) return [vault, false];

  const nextScopes = { ...vault.scopes, [scope]: legacy };
  delete nextScopes[LEGACY_SCOPE];
  return [{ version: 2, scopes: nextScopes }, true];
}

function hydrateScope(scope: string): void {
  activeScope = scope;
  suppressPersistence = true;
  const history = historyVault?.scopes[scope] ?? emptyHistory();
  const prompt = promptVault?.scopes[scope] ?? emptyPrompt();
  const dictionary = dictionaryVault?.scopes[scope] ?? emptyDictionary();
  const cutoff = new Date(
    Date.now() - usePreferencesStore.getState().privacy.retentionDays * 24 * 60 * 60 * 1_000,
  ).toISOString();
  useHistoryStore.getState().hydrate(
    history.dictations.filter((dictation) => dictation.createdAt >= cutoff),
    history.pendingCloudDeletes,
  );
  usePromptStore.getState().hydrate(prompt.settings, prompt.updatedAt);
  useDictionaryStore.getState().hydrate(dictionary.entries, dictionary.tombstones);
  suppressPersistence = false;
}

async function initialize(): Promise<void> {
  if (!nativeClient.isAvailable()) return;

  const [historyResult, promptResult, dictionaryResult] = await Promise.allSettled([
    loadVault("history", "open-dictate-history", historyStateSchema),
    loadVault("prompt", "open-dictate-prompt", promptStateSchema),
    loadVault("dictionary", "open-dictate-dictionary", dictionaryStateSchema),
  ]);

  if (historyResult.status === "fulfilled") historyVault = historyResult.value;
  if (promptResult.status === "fulfilled") promptVault = promptResult.value;
  if (dictionaryResult.status === "fulfilled") dictionaryVault = dictionaryResult.value;
  hydrateScope(LOCAL_SCOPE);

  if (historyVault) {
    useHistoryStore.subscribe((state, previous) => {
      if (
        !suppressPersistence &&
        (state.dictations !== previous.dictations ||
          state.pendingCloudDeletes !== previous.pendingCloudDeletes)
      ) {
        scheduleSave("history", activeScope, {
          dictations: state.dictations,
          pendingCloudDeletes: state.pendingCloudDeletes,
        } satisfies HistoryStatePayload);
      }
    });
  }

  if (promptVault) {
    usePromptStore.subscribe((state, previous) => {
      if (
        !suppressPersistence &&
        (state.customPrompt !== previous.customPrompt ||
          state.removeFillers !== previous.removeFillers ||
          state.correctPunctuation !== previous.correctPunctuation ||
          state.formatLists !== previous.formatLists ||
          state.outputLanguage !== previous.outputLanguage ||
          state.updatedAt !== previous.updatedAt)
      ) {
        scheduleSave("prompt", activeScope, {
          settings: {
            customPrompt: state.customPrompt,
            removeFillers: state.removeFillers,
            correctPunctuation: state.correctPunctuation,
            formatLists: state.formatLists,
            outputLanguage: state.outputLanguage,
          },
          updatedAt: state.updatedAt,
        } satisfies PromptStatePayload);
      }
    });
  }

  if (dictionaryVault) {
    useDictionaryStore.subscribe((state, previous) => {
      if (
        !suppressPersistence &&
        (state.entries !== previous.entries || state.tombstones !== previous.tombstones)
      ) {
        scheduleSave("dictionary", activeScope, {
          entries: state.entries,
          tombstones: state.tombstones,
        } satisfies DictionaryStatePayload);
      }
    });
  }

  usePreferencesStore.subscribe((state, previous) => {
    if (state.privacy.retentionDays === previous.privacy.retentionDays) return;
    const cutoff = new Date(
      Date.now() - state.privacy.retentionDays * 24 * 60 * 60 * 1_000,
    ).toISOString();
    useHistoryStore.getState().pruneBefore(cutoff);
  });
}

export function initializeSecureStatePersistence(): Promise<void> {
  initialization ??= initialize();
  return initialization;
}

export async function switchSecureStateScope(userId: string | null): Promise<void> {
  await initializeSecureStatePersistence();
  if (!nativeClient.isAvailable()) return;

  const scope = userId ? `user:${userId}` : LOCAL_SCOPE;
  if (historyVault) {
    const [next, changed] = adoptLegacy(historyVault, scope);
    historyVault = next;
    if (changed) persist("history", historyVault);
  }
  if (promptVault) {
    const [next, changed] = adoptLegacy(promptVault, scope);
    promptVault = next;
    if (changed) persist("prompt", promptVault);
  }
  if (dictionaryVault) {
    const [next, changed] = adoptLegacy(dictionaryVault, scope);
    dictionaryVault = next;
    if (changed) persist("dictionary", dictionaryVault);
  }
  hydrateScope(scope);
}

export async function clearSecureStateScope(userId: string | null): Promise<void> {
  await initializeSecureStatePersistence();

  const scope = userId ? `user:${userId}` : LOCAL_SCOPE;
  cancelScheduledSaves(scope);
  await Promise.allSettled([...pendingWrites.values()]);

  const writes: Promise<void>[] = [];
  if (historyVault) {
    const scopes = { ...historyVault.scopes };
    delete scopes[scope];
    historyVault = { version: 2, scopes };
    writes.push(nativeClient.saveSecureState("history", historyVault));
  }
  if (promptVault) {
    const scopes = { ...promptVault.scopes };
    delete scopes[scope];
    promptVault = { version: 2, scopes };
    writes.push(nativeClient.saveSecureState("prompt", promptVault));
  }
  if (dictionaryVault) {
    const scopes = { ...dictionaryVault.scopes };
    delete scopes[scope];
    dictionaryVault = { version: 2, scopes };
    writes.push(nativeClient.saveSecureState("dictionary", dictionaryVault));
  }

  await Promise.all(writes);
  hydrateScope(scope);
}
