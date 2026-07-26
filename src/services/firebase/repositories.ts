import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
} from "firebase/firestore";

import type {
  Dictation,
  DictionaryRecord,
  Locale,
  RemoteTransformationSettings,
  TransformationSettings,
  TransformationSettingsRecord,
  UsageSummary,
} from "@/types/domain";
import { isDictionaryTombstone, transformationSettingsChanged } from "@/services/syncProtocol";

import { getFirebaseServices } from "./client";

function timestampToIso(value: unknown): string {
  return value instanceof Timestamp ? value.toDate().toISOString() : new Date().toISOString();
}

function timestampToIsoOrNull(value: unknown): string | null {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

async function requireFirestore() {
  const firebase = await getFirebaseServices();
  if (!firebase) throw new Error("firebase_not_configured");
  return firebase.firestore;
}

function dictionaryRecordFromData(
  id: string,
  data: Record<string, unknown>,
): DictionaryRecord | null {
  const createdAt = timestampToIsoOrNull(data.createdAt);
  const updatedAt = timestampToIsoOrNull(data.updatedAt);
  if (!createdAt || !updatedAt) return null;

  if (data.deleted === true) return { id, createdAt, updatedAt, deleted: true };

  return {
    id,
    spoken: stringOr(data.spoken, ""),
    replacement: stringOr(data.replacement, ""),
    language: (data.language ?? "all") as Locale | "all",
    createdAt,
    updatedAt,
  };
}

function transformationSettingsFromData(data: Record<string, unknown>): TransformationSettings {
  return {
    customPrompt: stringOr(data.prompt, ""),
    outputLanguage: (data.language ?? "en") as Locale,
    removeFillers: data.removeFillers !== false,
    correctPunctuation: data.correctPunctuation !== false,
    formatLists: data.formatLists !== false,
  };
}

export class FirebaseDictionaryRepository {
  constructor(private readonly uid: string) {}

  async list(): Promise<DictionaryRecord[]> {
    const firestore = await requireFirestore();
    const snapshot = await getDocs(
      query(collection(firestore, "dictionary", this.uid, "entries"), orderBy("updatedAt", "desc")),
    );
    return snapshot.docs.flatMap<DictionaryRecord>((item) => {
      const record = dictionaryRecordFromData(item.id, item.data());
      return record ? [record] : [];
    });
  }

  async save(record: DictionaryRecord): Promise<DictionaryRecord> {
    const firestore = await requireFirestore();
    const reference = doc(firestore, "dictionary", this.uid, "entries", record.id);
    const createdAt = Timestamp.fromDate(new Date(record.createdAt));

    if (isDictionaryTombstone(record)) {
      await setDoc(reference, {
        deleted: true,
        createdAt,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(reference, {
        spoken: record.spoken,
        replacement: record.replacement,
        language: record.language,
        createdAt,
        updatedAt: serverTimestamp(),
      });
    }

    // `setDoc` has reached the backend at this point. Bypass the local cache so
    // the caller can replace its device clock with Firestore's committed time.
    const snapshot = await getDocFromServer(reference);
    const committed = snapshot.exists()
      ? dictionaryRecordFromData(snapshot.id, snapshot.data())
      : null;
    if (!committed) throw new Error("dictionary_write_acknowledgement_missing");
    return committed;
  }
}

export class FirebaseHistoryRepository {
  constructor(private readonly uid: string) {}

  async list(): Promise<Dictation[]> {
    const firestore = await requireFirestore();
    const snapshot = await getDocs(
      query(
        collection(firestore, "dictations", this.uid, "items"),
        orderBy("createdAt", "desc"),
        limit(250),
      ),
    );
    return snapshot.docs.map((item) => {
      const data = item.data();
      return {
        id: item.id,
        text: String(data.text ?? ""),
        durationMs: Number(data.durationMs ?? 0),
        application: String(data.application ?? ""),
        language: (data.language ?? "en") as Locale,
        words: Number(data.words ?? 0),
        createdAt: timestampToIso(data.createdAt),
        syncState: "synced",
      };
    });
  }

  save(): Promise<void> {
    return Promise.reject(new Error("dictations_are_server_owned"));
  }

  async delete(id: string): Promise<void> {
    const firestore = await requireFirestore();
    await deleteDoc(doc(firestore, "dictations", this.uid, "items", id));
  }

  clear(): Promise<void> {
    return Promise.reject(new Error("bulk_delete_requires_backend"));
  }
}

export class FirebaseSettingsRepository {
  constructor(private readonly uid: string) {}

  async getTransformationSettings(): Promise<RemoteTransformationSettings> {
    const firestore = await requireFirestore();
    const snapshot = await getDoc(doc(firestore, "settings", this.uid));
    if (!snapshot.exists()) return { exists: false, settings: null, updatedAt: null };

    const data = snapshot.data();
    return {
      exists: true,
      settings: transformationSettingsFromData(data),
      updatedAt: timestampToIsoOrNull(data.updatedAt),
    };
  }

  async saveTransformationSettings(
    settings: TransformationSettings,
  ): Promise<TransformationSettingsRecord> {
    const firestore = await requireFirestore();
    const reference = doc(firestore, "settings", this.uid);
    await setDoc(
      reference,
      {
        prompt: settings.customPrompt,
        language: settings.outputLanguage,
        removeFillers: settings.removeFillers,
        correctPunctuation: settings.correctPunctuation,
        formatLists: settings.formatLists,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    const snapshot = await getDocFromServer(reference);
    if (!snapshot.exists()) throw new Error("settings_write_acknowledgement_missing");
    const data = snapshot.data();
    const committed: TransformationSettingsRecord = {
      settings: transformationSettingsFromData(data),
      updatedAt: timestampToIsoOrNull(data.updatedAt),
    };
    if (
      committed.updatedAt === null ||
      transformationSettingsChanged(settings, committed.settings)
    ) {
      throw new Error("settings_write_acknowledgement_superseded");
    }
    return committed;
  }
}

export class FirebaseUsageRepository {
  constructor(private readonly uid: string) {}

  async getMonth(month: string): Promise<UsageSummary> {
    const firestore = await requireFirestore();
    const snapshot = await getDoc(doc(firestore, "usage", this.uid, "periods", month));
    const data = snapshot.data();
    return {
      month,
      dictationMs: Number(data?.dictationMs ?? 0),
      speakingMs: Number(data?.speakingMs ?? 0),
      wordsGenerated: Number(data?.wordsGenerated ?? 0),
      dictationCount: Number(data?.dictationCount ?? 0),
      transcriptionTokens: Number(data?.transcriptionTokens ?? 0),
      transformTokens: Number(data?.transformTokens ?? 0),
      estimatedSavedMs: Number(data?.estimatedSavedMs ?? 0),
      comparisonPercent: Number(data?.comparisonPercent ?? 0),
      points: Array.isArray(data?.points) ? (data.points as UsageSummary["points"]) : [],
    };
  }
}
