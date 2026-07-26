import { randomUUID } from "node:crypto";

import { Timestamp } from "firebase-admin/firestore";
import type { Request } from "express";

import { commercialCostPricing, creditPricing } from "../config.js";
import { firestore } from "../firebase.js";
import { AppError } from "../http/errors.js";
import { calculateCommercialCost } from "../ledger/commercial-cost.js";
import {
  captureCredits,
  getCreditAccount,
  getTranscriptionJob,
  markProcessing,
  releaseCredits,
  reserveCredits,
  spendableCreditProjection,
  type CreditAccountSnapshot,
  type SpendableCreditProjection,
  type TranscriptionJob,
} from "../ledger/store.js";
import { calculateActualCredits, estimateReservation } from "../ledger/transitions.js";
import { parseManagedAudio } from "./multipart.js";
import { ProviderRequestError, transcribeAndPolish } from "./openai.js";

function balanceResponse(account: CreditAccountSnapshot): SpendableCreditProjection {
  return spendableCreditProjection(account);
}

function jobResponse(
  job: TranscriptionJob,
  account?: CreditAccountSnapshot,
): Record<string, unknown> {
  return {
    requestId: job.id,
    status: job.status,
    dictationId: job.dictationId ?? null,
    text: job.status === "succeeded" ? (job.resultText ?? "") : null,
    rawText: null,
    transcriptionTokens: job.transcriptionTokens ?? 0,
    transformTokens: job.transformTokens ?? 0,
    providerRequestId: job.providerRequestId ?? null,
    creditsCharged: job.actualCredits ?? null,
    ...(account ? balanceResponse(account) : {}),
  };
}

async function assertManagedEntitlement(uid: string): Promise<void> {
  const snapshot = await firestore.doc(`subscriptions/${uid}`).get();
  const status: unknown = snapshot.get("status");
  const entitlementEndsAt: unknown = snapshot.get("entitlementEndsAt");
  const activeSubscription =
    (status === "active" || status === "trialing") &&
    (!(entitlementEndsAt instanceof Timestamp) || entitlementEndsAt.toMillis() >= Date.now());
  if (activeSubscription) return;

  // Purchased credits are durable customer property and remain usable across
  // subscription gaps. New top-ups still require an active subscription.
  const account = await getCreditAccount(uid);
  if (account.purchasedCredits <= 0) throw new AppError("subscription_required", 403);
}

export async function getManagedDictationStatus(
  uid: string,
  requestId: string,
): Promise<Record<string, unknown>> {
  const job = await getTranscriptionJob(uid, requestId);
  if (!job) throw new AppError("not_found", 404);
  return jobResponse(job, await getCreditAccount(uid));
}

export async function createManagedDictation(
  uid: string,
  requestId: string,
  request: Request,
): Promise<Record<string, unknown>> {
  await assertManagedEntitlement(uid);

  const existing = await getTranscriptionJob(uid, requestId);
  if (existing) {
    if (existing.status === "succeeded") {
      return jobResponse(existing, await getCreditAccount(uid));
    }
    if (existing.status === "failed") throw new AppError("request_already_failed", 409);
    throw new AppError("request_in_progress", 409, true);
  }

  const upload = await parseManagedAudio(request);
  const rates = creditPricing();
  const reservation = estimateReservation(upload.audio.length, upload.durationMs, rates);
  const reservedJob = await reserveCredits(uid, requestId, reservation, {
    audioBytes: upload.audio.length,
    declaredDurationMs: upload.durationMs,
    language: upload.language,
  });
  if (reservedJob.status !== "reserved") {
    if (reservedJob.status === "succeeded") {
      return jobResponse(reservedJob, await getCreditAccount(uid));
    }
    throw new AppError("request_in_progress", 409, true);
  }

  await markProcessing(uid, requestId);

  let result: Awaited<ReturnType<typeof transcribeAndPolish>>;
  try {
    result = await transcribeAndPolish({
      audio: upload.audio,
      mimeType: upload.mimeType,
      filename: upload.filename,
      language: upload.language,
      dictionary: upload.dictionary,
      preferences: upload.preferences,
    });
  } catch (error) {
    if (error instanceof ProviderRequestError && error.definitive) {
      await releaseCredits(uid, requestId, "provider_rejected");
    }
    throw error;
  }

  // Customer allowance settlement intentionally uses only the provider usage
  // exposed on the successful result. Ambiguous polish-attempt estimates below
  // are finance telemetry and must never become entitlement debits.
  const actualCredits = calculateActualCredits(
    upload.durationMs,
    result.transcriptionTokens,
    result.polishInputTokens,
    result.polishOutputTokens,
    rates,
  );
  const commercialCost = calculateCommercialCost(
    {
      durationMs: upload.durationMs,
      transcriptionTokens: result.transcriptionTokens,
      polishInputTokens: result.commercialPolishUsage.inputTokens,
      polishOutputTokens: result.commercialPolishUsage.outputTokens,
    },
    commercialCostPricing(),
    result.commercialPolishUsage.estimation,
  );
  const dictationId = randomUUID();
  const words = result.text.trim() ? result.text.trim().split(/\s+/u).length : 0;
  const remaining = await captureCredits(uid, requestId, actualCredits, {
    id: dictationId,
    text: result.text,
    durationMs: upload.durationMs,
    speakingMs: upload.speakingMs,
    application: upload.application,
    saveHistory: upload.saveHistory,
    retentionDays: upload.retentionDays,
    language: upload.language,
    words,
    transcriptionTokens: result.transcriptionTokens,
    polishInputTokens: result.polishInputTokens,
    polishOutputTokens: result.polishOutputTokens,
    transformTokens: result.polishInputTokens + result.polishOutputTokens,
    providerRequestId: result.providerRequestId,
    modelTranscription: result.transcriptionModel,
    modelPolish: result.polishModel,
    polishApplied: result.polishApplied,
    commercialCost,
  });

  return {
    requestId,
    status: "succeeded",
    dictationId: upload.saveHistory ? dictationId : null,
    text: result.text,
    rawText: null,
    transcriptionTokens: result.transcriptionTokens,
    transformTokens: result.polishInputTokens + result.polishOutputTokens,
    providerRequestId: result.providerRequestId ?? null,
    creditsCharged: actualCredits,
    ...balanceResponse(remaining),
    polishApplied: result.polishApplied,
  };
}
