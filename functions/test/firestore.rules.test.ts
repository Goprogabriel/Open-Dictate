import { readFileSync } from "node:fs";

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

describe.skipIf(!emulatorAvailable)("Firestore tenant boundaries", () => {
  let environment: RulesTestEnvironment;

  beforeAll(async () => {
    environment = await initializeTestEnvironment({
      projectId: `open-dictate-rules-${Date.now()}`,
      firestore: {
        rules: readFileSync(new URL("../../firestore.rules", import.meta.url), "utf8"),
      },
    });
  });

  afterAll(async () => {
    await environment.cleanup();
  });

  it("allows a user to write validated settings and blocks another user", async () => {
    const owner = environment.authenticatedContext("owner").firestore();
    const stranger = environment.authenticatedContext("stranger").firestore();
    const reference = doc(owner, "settings/owner");

    await assertSucceeds(
      setDoc(reference, {
        prompt: "Write concise prose.",
        language: "en",
        removeFillers: true,
        correctPunctuation: true,
        formatLists: true,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(getDoc(doc(stranger, "settings/owner")));
  });

  it("allows owner dictionary changes but rejects oversized entries", async () => {
    const owner = environment.authenticatedContext("owner").firestore();
    await assertSucceeds(
      setDoc(doc(owner, "dictionary/owner/entries/openai"), {
        spoken: "open ai",
        replacement: "OpenAI",
        language: "all",
        createdAt: new Date(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(owner, "dictionary/owner/entries/oversized"), {
        spoken: "x".repeat(101),
        replacement: "value",
        language: "en",
        createdAt: new Date(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("makes dictionary tombstones terminal per id and permits re-add with a new id", async () => {
    const owner = environment.authenticatedContext("owner").firestore();
    const createdAt = new Date("2026-07-24T10:00:00.000Z");
    const original = doc(owner, "dictionary/owner/entries/terminal-id");

    await assertSucceeds(
      setDoc(original, {
        spoken: "supabace",
        replacement: "Supabase",
        language: "all",
        createdAt,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      setDoc(original, {
        deleted: true,
        createdAt,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(original, {
        spoken: "supabace",
        replacement: "Supabase",
        language: "all",
        createdAt,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      setDoc(doc(owner, "dictionary/owner/entries/new-uuid"), {
        spoken: "supabace",
        replacement: "Supabase",
        language: "all",
        createdAt: new Date("2026-07-24T10:01:00.000Z"),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("blocks every client write to financial and server-job collections", async () => {
    const owner = environment.authenticatedContext("owner").firestore();
    await assertFails(setDoc(doc(owner, "subscriptions/owner"), { status: "active" }));
    await assertFails(setDoc(doc(owner, "subscriptions/owner/ledger/fake"), { kind: "grant" }));
    await assertFails(setDoc(doc(owner, "billing_events/evt_fake"), { status: "processed" }));
    await assertFails(
      setDoc(doc(owner, "transcription_jobs/request_fake"), { status: "succeeded" }),
    );
  });

  it("allows an owner to delete server-created history but not forge it", async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "dictations/owner/items/dictation"), {
        text: "Hello.",
      });
    });

    const owner = environment.authenticatedContext("owner").firestore();
    const stranger = environment.authenticatedContext("stranger").firestore();
    await assertSucceeds(getDoc(doc(owner, "dictations/owner/items/dictation")));
    await assertFails(getDoc(doc(stranger, "dictations/owner/items/dictation")));
    await assertFails(setDoc(doc(owner, "dictations/owner/items/forged"), { text: "Forged" }));
  });
});
