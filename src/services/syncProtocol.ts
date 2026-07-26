import type {
  DictionaryEntry,
  DictionaryRecord,
  DictionaryTombstone,
  RemoteTransformationSettings,
  TransformationSettings,
  TransformationSettingsRecord,
} from "@/types/domain";

export function isDictionaryTombstone(record: DictionaryRecord): record is DictionaryTombstone {
  return "deleted" in record && record.deleted;
}

export function dictionaryRecordChanged(left: DictionaryRecord, right: DictionaryRecord): boolean {
  if (isDictionaryTombstone(left) || isDictionaryTombstone(right)) {
    return (
      !isDictionaryTombstone(left) ||
      !isDictionaryTombstone(right) ||
      left.createdAt !== right.createdAt ||
      left.updatedAt !== right.updatedAt
    );
  }

  return (
    left.spoken !== right.spoken ||
    left.replacement !== right.replacement ||
    left.language !== right.language ||
    left.createdAt !== right.createdAt ||
    left.updatedAt !== right.updatedAt
  );
}

function dictionaryRecordPayloadChanged(left: DictionaryRecord, right: DictionaryRecord): boolean {
  if (
    left.id !== right.id ||
    left.createdAt !== right.createdAt ||
    isDictionaryTombstone(left) !== isDictionaryTombstone(right)
  ) {
    return true;
  }

  if (isDictionaryTombstone(left) || isDictionaryTombstone(right)) return false;

  return (
    left.spoken !== right.spoken ||
    left.replacement !== right.replacement ||
    left.language !== right.language
  );
}

/**
 * Replaces a device-authored timestamp with Firestore's committed timestamp
 * only while the exact attempted mutation is still current. A later local edit
 * must retain its own timestamp and be uploaded by the already queued write.
 */
export function resolveDictionaryWriteAcknowledgement(
  attempted: DictionaryRecord,
  current: DictionaryRecord | undefined,
  committed: DictionaryRecord,
): DictionaryRecord | null {
  if (
    !current ||
    current.id !== attempted.id ||
    dictionaryRecordChanged(attempted, current) ||
    dictionaryRecordPayloadChanged(attempted, committed)
  ) {
    return null;
  }

  if (isDictionaryTombstone(current)) {
    return { ...current, updatedAt: committed.updatedAt };
  }

  return { ...current, updatedAt: committed.updatedAt };
}

/**
 * Collapses duplicate records to one terminal state per id. Once an id has a
 * tombstone, no live record for that id may win again; users re-adding a term
 * receive a new id. Timestamps only order records of the same kind.
 */
function collapseDictionaryRecords(records: DictionaryRecord[]): DictionaryRecord[] {
  const recordsById = new Map<string, DictionaryRecord>();

  for (const candidate of records) {
    const current = recordsById.get(candidate.id);
    if (!current) {
      recordsById.set(candidate.id, candidate);
      continue;
    }

    const currentIsTombstone = isDictionaryTombstone(current);
    const candidateIsTombstone = isDictionaryTombstone(candidate);
    if (
      (candidateIsTombstone && !currentIsTombstone) ||
      (candidateIsTombstone === currentIsTombstone && candidate.updatedAt > current.updatedAt)
    ) {
      recordsById.set(candidate.id, candidate);
    }
  }

  return [...recordsById.values()];
}

export function splitDictionaryRecords(records: DictionaryRecord[]): {
  entries: DictionaryEntry[];
  tombstones: DictionaryTombstone[];
} {
  const entries: DictionaryEntry[] = [];
  const tombstones: DictionaryTombstone[] = [];
  for (const record of collapseDictionaryRecords(records)) {
    if (isDictionaryTombstone(record)) tombstones.push(record);
    else entries.push(record);
  }
  return { entries, tombstones };
}

/**
 * Resolves one terminal record per id. A tombstone always beats a live record
 * for the same id, regardless of timestamps. Among two live records or two
 * tombstones, the server wins exact timestamp ties because its timestamp has
 * already been acknowledged; otherwise the newest mutation wins.
 * `localWinners` must be retried against Firestore.
 */
export function mergeDictionaryRecords(
  localRecords: DictionaryRecord[],
  remoteRecords: DictionaryRecord[],
): { records: DictionaryRecord[]; localWinners: DictionaryRecord[] } {
  const recordsById = new Map(
    collapseDictionaryRecords(remoteRecords).map((record) => [record.id, record]),
  );
  const localWinners: DictionaryRecord[] = [];

  for (const local of collapseDictionaryRecords(localRecords)) {
    const remote = recordsById.get(local.id);
    const localIsTombstone = isDictionaryTombstone(local);
    const remoteIsTombstone = remote ? isDictionaryTombstone(remote) : false;
    if (
      !remote ||
      (localIsTombstone && !remoteIsTombstone) ||
      (localIsTombstone === remoteIsTombstone && local.updatedAt > remote.updatedAt)
    ) {
      recordsById.set(local.id, local);
      localWinners.push(local);
    }
  }

  const records = [...recordsById.values()].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
  return { records, localWinners };
}

export function transformationSettingsChanged(
  left: TransformationSettings,
  right: TransformationSettings,
): boolean {
  return (
    left.customPrompt !== right.customPrompt ||
    left.outputLanguage !== right.outputLanguage ||
    left.removeFillers !== right.removeFillers ||
    left.correctPunctuation !== right.correctPunctuation ||
    left.formatLists !== right.formatLists
  );
}

function transformationRecordChanged(
  left: TransformationSettingsRecord,
  right: TransformationSettingsRecord,
): boolean {
  return (
    left.updatedAt !== right.updatedAt ||
    transformationSettingsChanged(left.settings, right.settings)
  );
}

/**
 * A server timestamp acknowledges one particular settings mutation. If the
 * user edited again while that write was in flight, the acknowledgement is
 * stale and must not overwrite the newer device timestamp.
 */
export function resolveTransformationWriteAcknowledgement(
  attempted: TransformationSettingsRecord,
  current: TransformationSettingsRecord,
  committed: TransformationSettingsRecord,
): TransformationSettingsRecord | null {
  if (
    committed.updatedAt === null ||
    transformationRecordChanged(attempted, current) ||
    transformationSettingsChanged(attempted.settings, committed.settings)
  ) {
    return null;
  }

  return { settings: current.settings, updatedAt: committed.updatedAt };
}

export type TransformationMergeDecision =
  | { kind: "none" }
  | { kind: "hydrate"; record: TransformationSettingsRecord }
  | { kind: "hydrate-and-upload"; record: TransformationSettingsRecord }
  | { kind: "upload"; record: TransformationSettingsRecord };

/**
 * Settings values never imply document existence. A present cloud document is
 * ordered by its explicit `updatedAt`, even when its values equal defaults.
 * Local edits made while the read was in flight are deliberately preserved.
 */
export function resolveTransformationMerge(
  initialLocal: TransformationSettingsRecord,
  currentLocal: TransformationSettingsRecord,
  remote: RemoteTransformationSettings,
): TransformationMergeDecision {
  if (transformationRecordChanged(initialLocal, currentLocal)) {
    return { kind: "upload", record: currentLocal };
  }

  if (!remote.exists) return { kind: "upload", record: currentLocal };

  const remoteRecord: TransformationSettingsRecord = {
    settings: remote.settings,
    updatedAt: remote.updatedAt,
  };

  // Migrate legacy cloud documents without fabricating a timestamp. Preserve
  // their values, then write them back through the timestamped repository.
  if (remote.updatedAt === null) {
    return { kind: "hydrate-and-upload", record: remoteRecord };
  }

  if (currentLocal.updatedAt === null || remote.updatedAt > currentLocal.updatedAt) {
    return { kind: "hydrate", record: remoteRecord };
  }

  if (currentLocal.updatedAt > remote.updatedAt) {
    return { kind: "upload", record: currentLocal };
  }

  return transformationSettingsChanged(currentLocal.settings, remote.settings)
    ? { kind: "hydrate", record: remoteRecord }
    : { kind: "none" };
}
