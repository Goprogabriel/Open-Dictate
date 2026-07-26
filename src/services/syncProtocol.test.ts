import {
  mergeDictionaryRecords,
  resolveDictionaryWriteAcknowledgement,
  resolveTransformationMerge,
  resolveTransformationWriteAcknowledgement,
  splitDictionaryRecords,
} from "@/services/syncProtocol";
import type {
  DictionaryEntry,
  DictionaryTombstone,
  RemoteTransformationSettings,
  TransformationSettings,
  TransformationSettingsRecord,
} from "@/types/domain";

const defaults: TransformationSettings = {
  customPrompt: "",
  outputLanguage: "en",
  removeFillers: true,
  correctPunctuation: true,
  formatLists: true,
};

function prompt(customPrompt: string, updatedAt: string | null): TransformationSettingsRecord {
  return { settings: { ...defaults, customPrompt }, updatedAt };
}

const entry: DictionaryEntry = {
  id: "term-1",
  spoken: "supabace",
  replacement: "Supabase",
  language: "all",
  createdAt: "2026-07-01T10:00:00.000Z",
  updatedAt: "2026-07-20T10:00:00.000Z",
};

function deleted(updatedAt: string): DictionaryTombstone {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    updatedAt,
    deleted: true,
  };
}

describe("dictionary sync protocol", () => {
  it("keeps a newer remote deletion hidden instead of resurrecting a stale local entry", () => {
    const { records, localWinners } = mergeDictionaryRecords(
      [entry],
      [deleted("2026-07-21T10:00:00.000Z")],
    );
    const visible = splitDictionaryRecords(records);

    expect(visible.entries).toEqual([]);
    expect(visible.tombstones).toHaveLength(1);
    expect(localWinners).toEqual([]);
  });

  it("retains an offline local tombstone and marks it for retry when it is newest", () => {
    const tombstone = deleted("2026-07-22T10:00:00.000Z");
    const { records, localWinners } = mergeDictionaryRecords([tombstone], [entry]);

    expect(splitDictionaryRecords(records)).toEqual({ entries: [], tombstones: [tombstone] });
    expect(localWinners).toEqual([tombstone]);
  });

  it("keeps an older remote tombstone terminal against a newer local live record", () => {
    const recreated = { ...entry, updatedAt: "2026-07-23T10:00:00.000Z" };
    const tombstone = deleted("2026-07-19T10:00:00.000Z");
    const { records, localWinners } = mergeDictionaryRecords([recreated], [tombstone]);

    expect(splitDictionaryRecords(records)).toEqual({ entries: [], tombstones: [tombstone] });
    expect(localWinners).toEqual([]);
  });

  it("retries an older local tombstone instead of accepting a newer remote live record", () => {
    const tombstone = deleted("2026-07-19T10:00:00.000Z");
    const newerRemote = { ...entry, updatedAt: "2026-07-23T10:00:00.000Z" };
    const { records, localWinners } = mergeDictionaryRecords([tombstone], [newerRemote]);

    expect(splitDictionaryRecords(records)).toEqual({ entries: [], tombstones: [tombstone] });
    expect(localWinners).toEqual([tombstone]);
  });

  it("keeps a terminal tombstone while an intentional re-add uses a new id", () => {
    const tombstone = deleted("2026-07-22T10:00:00.000Z");
    const readded: DictionaryEntry = {
      ...entry,
      id: "term-2",
      createdAt: "2026-07-23T10:00:00.000Z",
      updatedAt: "2026-07-23T10:00:00.000Z",
    };
    const { records, localWinners } = mergeDictionaryRecords([tombstone, readded], []);

    expect(splitDictionaryRecords(records)).toEqual({
      entries: [readded],
      tombstones: [tombstone],
    });
    expect(localWinners).toEqual([tombstone, readded]);
  });

  it("collapses malformed live/tombstone duplicates to the terminal tombstone", () => {
    const tombstone = deleted("2026-07-19T10:00:00.000Z");

    expect(
      splitDictionaryRecords([{ ...entry, updatedAt: "2026-07-23T10:00:00.000Z" }, tombstone]),
    ).toEqual({ entries: [], tombstones: [tombstone] });
  });

  it("replaces a future-skewed device timestamp with the committed server timestamp", () => {
    const attempted = { ...entry, updatedAt: "2027-01-01T00:00:00.000Z" };
    const committed = { ...attempted, updatedAt: "2026-07-24T10:00:00.000Z" };

    expect(resolveDictionaryWriteAcknowledgement(attempted, attempted, committed)).toEqual(
      committed,
    );
  });

  it("does not acknowledge a dictionary write over a newer local edit", () => {
    const attempted = { ...entry, updatedAt: "2027-01-01T00:00:00.000Z" };
    const edited = {
      ...attempted,
      replacement: "Supabase Inc.",
      updatedAt: "2027-01-01T00:00:00.001Z",
    };
    const committed = { ...attempted, updatedAt: "2026-07-24T10:00:00.000Z" };

    expect(resolveDictionaryWriteAcknowledgement(attempted, edited, committed)).toBeNull();
  });

  it("preserves a tombstone's terminal shape while acknowledging its server timestamp", () => {
    const attempted = deleted("2027-01-01T00:00:00.000Z");
    const committed = deleted("2026-07-24T10:00:00.000Z");

    expect(resolveDictionaryWriteAcknowledgement(attempted, attempted, committed)).toEqual(
      committed,
    );
  });
});

describe("prompt settings sync protocol", () => {
  it("accepts an intentional newer cloud reset to defaults", () => {
    const local = prompt("Keep this stale instruction", "2026-07-20T10:00:00.000Z");
    const remote: RemoteTransformationSettings = {
      exists: true,
      settings: defaults,
      updatedAt: "2026-07-21T10:00:00.000Z",
    };

    expect(resolveTransformationMerge(local, local, remote)).toEqual({
      kind: "hydrate",
      record: { settings: defaults, updatedAt: remote.updatedAt },
    });
  });

  it("treats a missing cloud document explicitly and establishes the local record", () => {
    const local = prompt("Local instruction", "2026-07-20T10:00:00.000Z");

    expect(
      resolveTransformationMerge(local, local, {
        exists: false,
        settings: null,
        updatedAt: null,
      }),
    ).toEqual({ kind: "upload", record: local });
  });

  it("preserves an edit made while the cloud read is in flight", () => {
    const initial = prompt("Old local", "2026-07-20T10:00:00.000Z");
    const edited = prompt("Edited during hydration", "2026-07-24T10:00:00.000Z");
    const remote: RemoteTransformationSettings = {
      exists: true,
      settings: { ...defaults, customPrompt: "Remote" },
      updatedAt: "2026-07-25T10:00:00.000Z",
    };

    expect(resolveTransformationMerge(initial, edited, remote)).toEqual({
      kind: "upload",
      record: edited,
    });
  });

  it("migrates a present legacy cloud document without inventing a timestamp", () => {
    const local = prompt("", null);
    const remote: RemoteTransformationSettings = {
      exists: true,
      settings: { ...defaults, customPrompt: "Legacy cloud value" },
      updatedAt: null,
    };

    expect(resolveTransformationMerge(local, local, remote)).toEqual({
      kind: "hydrate-and-upload",
      record: { settings: remote.settings, updatedAt: null },
    });
  });

  it("replaces a future-skewed prompt timestamp with the committed server timestamp", () => {
    const attempted = prompt("Stay concise", "2027-01-01T00:00:00.000Z");
    const committed = prompt("Stay concise", "2026-07-24T10:00:00.000Z");

    expect(resolveTransformationWriteAcknowledgement(attempted, attempted, committed)).toEqual(
      committed,
    );
  });

  it("does not acknowledge a prompt write over an edit made while it was in flight", () => {
    const attempted = prompt("Stay concise", "2027-01-01T00:00:00.000Z");
    const edited = prompt("Use detailed explanations", "2027-01-01T00:00:00.001Z");
    const committed = prompt("Stay concise", "2026-07-24T10:00:00.000Z");

    expect(resolveTransformationWriteAcknowledgement(attempted, edited, committed)).toBeNull();
  });

  it("rejects a readback that no longer matches the attempted prompt mutation", () => {
    const attempted = prompt("Stay concise", "2027-01-01T00:00:00.000Z");
    const committed = prompt("Changed elsewhere", "2026-07-24T10:00:00.000Z");

    expect(resolveTransformationWriteAcknowledgement(attempted, attempted, committed)).toBeNull();
  });
});
