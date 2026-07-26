import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";

import { app } from "./app.js";
import { stripeWebhookHandler } from "./billing/webhook.js";
import {
  FUNCTION_REGION,
  OPENAI_API_KEY,
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
} from "./config.js";
import { firestore } from "./firebase.js";
import { releaseCredits } from "./ledger/store.js";

export const api = onRequest(
  {
    region: FUNCTION_REGION,
    cors: false,
    timeoutSeconds: 300,
    memory: "1GiB",
    concurrency: 20,
    maxInstances: 50,
    secrets: [OPENAI_API_KEY, STRIPE_SECRET_KEY],
  },
  app,
);

export const stripeWebhook = onRequest(
  {
    region: FUNCTION_REGION,
    cors: false,
    timeoutSeconds: 30,
    memory: "256MiB",
    concurrency: 40,
    maxInstances: 20,
    secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET],
  },
  stripeWebhookHandler,
);

export const reconcileStaleTranscriptionJobs = onSchedule(
  {
    region: FUNCTION_REGION,
    schedule: "every 15 minutes",
    timeZone: "Etc/UTC",
    timeoutSeconds: 120,
    memory: "256MiB",
    retryCount: 1,
  },
  async () => {
    const [jobs, expiredJobs, expiredDictations] = await Promise.all([
      firestore
        .collection("transcription_jobs")
        .where("status", "in", ["reserved", "processing"])
        .where("leaseExpiresAt", "<", Timestamp.now())
        .limit(100)
        .get(),
      firestore
        .collection("transcription_jobs")
        .where("expiresAt", "<", Timestamp.now())
        .limit(100)
        .get(),
      firestore.collectionGroup("items").where("expiresAt", "<=", Timestamp.now()).limit(200).get(),
    ]);

    const outcomes = await Promise.allSettled(
      jobs.docs.map(async (document) => {
        const uid: unknown = document.get("uid");
        if (typeof uid !== "string" || !uid) return;
        await releaseCredits(uid, document.id, "reservation_expired");
      }),
    );
    const failures = outcomes.filter((outcome) => outcome.status === "rejected").length;
    if (!expiredJobs.empty || !expiredDictations.empty) {
      const batch = firestore.batch();
      expiredJobs.docs.forEach((document) => batch.delete(document.ref));
      expiredDictations.docs.forEach((document) => batch.delete(document.ref));
      await batch.commit();
    }
    if (failures > 0) {
      logger.error("Some stale transcription reservations could not be released", {
        attempted: jobs.size,
        failures,
      });
    }
  },
);
