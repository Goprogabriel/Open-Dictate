import { createHash } from "node:crypto";

import { FieldValue, Timestamp, type DocumentData } from "firebase-admin/firestore";

import { firestore } from "../firebase.js";
import { AppError } from "../http/errors.js";
import type { CommercialCostBreakdown } from "./commercial-cost.js";
import {
  captureTransition,
  grantTransition,
  releaseTransition,
  resetSubscriptionTransition,
  reserveTransition,
  createCreditBalance,
  type CreditAllocation,
  type CreditBalance,
  type CreditTransition,
} from "./transitions.js";

const BALANCE_SCHEMA_VERSION = 2;

export type TranscriptionJobStatus = "reserved" | "processing" | "succeeded" | "failed";

export interface TranscriptionJob {
  id: string;
  uid: string;
  status: TranscriptionJobStatus;
  reservedCredits: number;
  reservedSubscriptionCredits: number;
  reservedPurchasedCredits: number;
  subscriptionCreditPeriodId?: string;
  actualCredits?: number;
  dictationId?: string;
  resultText?: string;
  transcriptionTokens?: number;
  transformTokens?: number;
  providerRequestId?: string;
  failureCode?: string;
}

export interface CreditAccountSnapshot extends CreditBalance {
  subscriptionTokensExpireAt: string | null;
}

export interface SpendableCreditProjection {
  remainingTokens: number;
  subscriptionTokens: number;
  purchasedTokens: number;
  subscriptionTokensExpireAt: string | null;
}

export interface CapturedDictation {
  id: string;
  text: string;
  durationMs: number;
  speakingMs: number;
  application: string;
  saveHistory: boolean;
  retentionDays: 7 | 30 | 90 | 365;
  language: string;
  words: number;
  transcriptionTokens: number;
  polishInputTokens: number;
  polishOutputTokens: number;
  transformTokens: number;
  providerRequestId?: string;
  modelTranscription: string;
  modelPolish: string;
  polishApplied: boolean;
  commercialCost: CommercialCostBreakdown;
}

function integer(data: DocumentData | undefined, key: string): number {
  const value: unknown = data ? (data as Record<string, unknown>)[key] : undefined;
  return Number.isSafeInteger(value) ? Number(value) : 0;
}

function hasInteger(data: DocumentData | undefined, key: string): boolean {
  const value: unknown = data ? (data as Record<string, unknown>)[key] : undefined;
  return Number.isSafeInteger(value);
}

function stringField(data: DocumentData | undefined, key: string): string | undefined {
  const value: unknown = data ? (data as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" && value ? value : undefined;
}

function timestampField(data: DocumentData | undefined, key: string): Timestamp | null {
  const value: unknown = data ? (data as Record<string, unknown>)[key] : undefined;
  return value instanceof Timestamp ? value : null;
}

function subscriptionCreditsAreCurrent(
  data: DocumentData | undefined,
  nowMillis = Date.now(),
): boolean {
  const expiresAt = timestampField(data, "subscriptionCreditsExpireAt");
  return expiresAt !== null && expiresAt.toMillis() > nowMillis;
}

function balanceFrom(data: DocumentData | undefined, nowMillis = Date.now()): CreditBalance {
  const hasAvailablePools =
    hasInteger(data, "subscriptionCredits") || hasInteger(data, "purchasedCredits");
  const hasReservedPools =
    hasInteger(data, "reservedSubscriptionCredits") || hasInteger(data, "reservedPurchasedCredits");
  const hasConsumedPools =
    hasInteger(data, "consumedSubscriptionCredits") || hasInteger(data, "consumedPurchasedCredits");

  // Schema v1 blended every grant into a single balance. At the v2 boundary,
  // preserve all legacy available credits and in-flight reservations as
  // purchased/non-expiring value because their original source is unknowable.
  // The first transactional write persists this explicit migration.
  const rawSubscriptionCredits = hasAvailablePools ? integer(data, "subscriptionCredits") : 0;
  return createCreditBalance({
    subscriptionCredits: subscriptionCreditsAreCurrent(data, nowMillis)
      ? rawSubscriptionCredits
      : 0,
    purchasedCredits: hasAvailablePools
      ? integer(data, "purchasedCredits")
      : integer(data, "availableCredits"),
    reservedSubscriptionCredits: hasReservedPools
      ? integer(data, "reservedSubscriptionCredits")
      : 0,
    reservedPurchasedCredits: hasReservedPools
      ? integer(data, "reservedPurchasedCredits")
      : integer(data, "reservedCredits"),
    consumedSubscriptionCredits: hasConsumedPools
      ? integer(data, "consumedSubscriptionCredits")
      : 0,
    consumedPurchasedCredits: hasConsumedPools
      ? integer(data, "consumedPurchasedCredits")
      : integer(data, "consumedCredits"),
  });
}

function transitionFields(transition: CreditTransition): Record<string, unknown> {
  return {
    balanceSchemaVersion: BALANCE_SCHEMA_VERSION,
    subscriptionCredits: transition.balance.subscriptionCredits,
    purchasedCredits: transition.balance.purchasedCredits,
    reservedSubscriptionCredits: transition.balance.reservedSubscriptionCredits,
    reservedPurchasedCredits: transition.balance.reservedPurchasedCredits,
    consumedSubscriptionCredits: transition.balance.consumedSubscriptionCredits,
    consumedPurchasedCredits: transition.balance.consumedPurchasedCredits,
    availableCredits: transition.balance.availableCredits,
    reservedCredits: transition.balance.reservedCredits,
    consumedCredits: transition.balance.consumedCredits,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

function transitionLedgerFields(
  transition: CreditTransition,
  expiredSubscriptionCredits = transition.expired.subscriptionCredits,
): Record<string, unknown> {
  return {
    availableDelta: transition.availableDelta,
    reservedDelta: transition.reservedDelta,
    consumedDelta: transition.consumedDelta,
    subscriptionAvailableDelta: transition.subscriptionAvailableDelta,
    purchasedAvailableDelta: transition.purchasedAvailableDelta,
    subscriptionReservedDelta: transition.subscriptionReservedDelta,
    purchasedReservedDelta: transition.purchasedReservedDelta,
    subscriptionConsumedDelta: transition.subscriptionConsumedDelta,
    purchasedConsumedDelta: transition.purchasedConsumedDelta,
    creditAllocation: {
      reservation: transition.reservation,
      consumed: transition.consumed,
      restored: transition.restored,
      expired: {
        subscriptionCredits: expiredSubscriptionCredits,
        purchasedCredits: transition.expired.purchasedCredits,
      },
    },
  };
}

function accountSnapshot(
  balance: CreditBalance,
  data: DocumentData | undefined,
): CreditAccountSnapshot {
  const expiresAt = timestampField(data, "subscriptionCreditsExpireAt");
  return {
    ...balance,
    subscriptionTokensExpireAt:
      expiresAt && expiresAt.toMillis() > Date.now() ? expiresAt.toDate().toISOString() : null,
  };
}

export function spendableCreditProjection(
  account: CreditAccountSnapshot,
): SpendableCreditProjection {
  return {
    remainingTokens: Math.max(0, account.availableCredits),
    subscriptionTokens: Math.max(
      0,
      Math.min(account.subscriptionCredits, account.availableCredits),
    ),
    purchasedTokens: Math.max(0, account.purchasedCredits),
    subscriptionTokensExpireAt: account.subscriptionTokensExpireAt,
  };
}

function reservationFromJob(job: TranscriptionJob): CreditAllocation {
  return {
    subscriptionCredits: job.reservedSubscriptionCredits,
    purchasedCredits: job.reservedPurchasedCredits,
  };
}

function mayRestoreSubscriptionReservation(
  job: TranscriptionJob,
  subscriptionData: DocumentData | undefined,
  nowMillis: number,
): boolean {
  return (
    job.reservedSubscriptionCredits > 0 &&
    job.subscriptionCreditPeriodId !== undefined &&
    job.subscriptionCreditPeriodId ===
      stringField(subscriptionData, "subscriptionCreditPeriodId") &&
    subscriptionCreditsAreCurrent(subscriptionData, nowMillis)
  );
}

function ledgerDocumentId(kind: string, sourceId: string): string {
  return createHash("sha256").update(`${kind}:${sourceId}`).digest("hex");
}

function jobFrom(id: string, data: DocumentData): TranscriptionJob {
  const hasReservationPools =
    Number.isSafeInteger(data.reservedSubscriptionCredits) ||
    Number.isSafeInteger(data.reservedPurchasedCredits);
  const reservedCredits = Number.isSafeInteger(data.reservedCredits)
    ? Number(data.reservedCredits)
    : 0;
  return {
    id,
    uid: String(data.uid),
    status: String(data.status) as TranscriptionJobStatus,
    reservedCredits,
    reservedSubscriptionCredits: hasReservationPools
      ? integer(data, "reservedSubscriptionCredits")
      : 0,
    reservedPurchasedCredits: hasReservationPools
      ? integer(data, "reservedPurchasedCredits")
      : reservedCredits,
    subscriptionCreditPeriodId:
      typeof data.subscriptionCreditPeriodId === "string"
        ? data.subscriptionCreditPeriodId
        : undefined,
    actualCredits: Number.isSafeInteger(data.actualCredits)
      ? Number(data.actualCredits)
      : undefined,
    dictationId: typeof data.dictationId === "string" ? data.dictationId : undefined,
    resultText: typeof data.resultText === "string" ? data.resultText : undefined,
    transcriptionTokens: Number.isSafeInteger(data.transcriptionTokens)
      ? Number(data.transcriptionTokens)
      : undefined,
    transformTokens: Number.isSafeInteger(data.transformTokens)
      ? Number(data.transformTokens)
      : undefined,
    providerRequestId:
      typeof data.providerRequestId === "string" ? data.providerRequestId : undefined,
    failureCode: typeof data.failureCode === "string" ? data.failureCode : undefined,
  };
}

export async function getTranscriptionJob(
  uid: string,
  requestId: string,
): Promise<TranscriptionJob | null> {
  const snapshot = await firestore.doc(`transcription_jobs/${requestId}`).get();
  if (!snapshot.exists) return null;
  const job = jobFrom(snapshot.id, snapshot.data() ?? {});
  if (job.uid !== uid) throw new AppError("not_found", 404);
  return job;
}

export async function getCreditAccount(uid: string): Promise<CreditAccountSnapshot> {
  const snapshot = await firestore.doc(`subscriptions/${uid}`).get();
  return accountSnapshot(balanceFrom(snapshot.data()), snapshot.data());
}

export async function reserveCredits(
  uid: string,
  requestId: string,
  amount: number,
  metadata: Record<string, unknown>,
): Promise<TranscriptionJob> {
  const subscriptionRef = firestore.doc(`subscriptions/${uid}`);
  const jobRef = firestore.doc(`transcription_jobs/${requestId}`);
  const ledgerRef = subscriptionRef
    .collection("ledger")
    .doc(ledgerDocumentId("reserve", requestId));

  return firestore.runTransaction(async (transaction) => {
    const [jobSnapshot, subscriptionSnapshot, ledgerSnapshot] = await Promise.all([
      transaction.get(jobRef),
      transaction.get(subscriptionRef),
      transaction.get(ledgerRef),
    ]);

    if (jobSnapshot.exists) {
      const existing = jobFrom(jobSnapshot.id, jobSnapshot.data() ?? {});
      if (existing.uid !== uid) throw new AppError("not_found", 404);
      return existing;
    }
    if (ledgerSnapshot.exists) throw new AppError("request_already_failed", 409);

    let transition: CreditTransition;
    try {
      transition = reserveTransition(balanceFrom(subscriptionSnapshot.data()), amount);
    } catch (error) {
      if (error instanceof RangeError && error.message === "insufficient_credits") {
        throw new AppError("insufficient_credits", 402);
      }
      throw error;
    }

    const now = Timestamp.now();
    const leaseExpiresAt = Timestamp.fromMillis(now.toMillis() + 10 * 60 * 1_000);
    const subscriptionCreditPeriodId =
      transition.reservation.subscriptionCredits > 0
        ? stringField(subscriptionSnapshot.data(), "subscriptionCreditPeriodId")
        : undefined;
    const job: TranscriptionJob = {
      id: requestId,
      uid,
      status: "reserved",
      reservedCredits: amount,
      reservedSubscriptionCredits: transition.reservation.subscriptionCredits,
      reservedPurchasedCredits: transition.reservation.purchasedCredits,
      ...(subscriptionCreditPeriodId ? { subscriptionCreditPeriodId } : {}),
    };

    transaction.set(subscriptionRef, transitionFields(transition), { merge: true });
    transaction.create(jobRef, {
      uid,
      status: job.status,
      reservedCredits: amount,
      reservedSubscriptionCredits: transition.reservation.subscriptionCredits,
      reservedPurchasedCredits: transition.reservation.purchasedCredits,
      ...(subscriptionCreditPeriodId ? { subscriptionCreditPeriodId } : {}),
      createdAt: now,
      updatedAt: now,
      leaseExpiresAt,
      ...metadata,
    });
    transaction.create(ledgerRef, {
      kind: "reservation",
      sourceId: requestId,
      ...transitionLedgerFields(transition),
      subscriptionCreditPeriodId: subscriptionCreditPeriodId ?? null,
      createdAt: now,
      metadata,
    });

    return job;
  });
}

export async function markProcessing(uid: string, requestId: string): Promise<void> {
  const jobRef = firestore.doc(`transcription_jobs/${requestId}`);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    if (!snapshot.exists) throw new AppError("not_found", 404);
    const job = jobFrom(snapshot.id, snapshot.data() ?? {});
    if (job.uid !== uid) throw new AppError("not_found", 404);
    if (job.status === "processing") return;
    if (job.status !== "reserved") throw new AppError("request_in_progress", 409);

    transaction.update(jobRef, {
      status: "processing",
      updatedAt: FieldValue.serverTimestamp(),
      leaseExpiresAt: Timestamp.fromMillis(Date.now() + 10 * 60 * 1_000),
    });
  });
}

export async function captureCredits(
  uid: string,
  requestId: string,
  actualCredits: number,
  dictation: CapturedDictation,
): Promise<CreditAccountSnapshot> {
  const subscriptionRef = firestore.doc(`subscriptions/${uid}`);
  const jobRef = firestore.doc(`transcription_jobs/${requestId}`);
  const ledgerRef = subscriptionRef
    .collection("ledger")
    .doc(ledgerDocumentId("capture", requestId));
  const dictationRef = firestore.doc(`dictations/${uid}/items/${dictation.id}`);
  const month = new Date().toISOString().slice(0, 7);
  const periodRef = firestore.doc(`usage/${uid}/periods/${month}`);

  return firestore.runTransaction(async (transaction) => {
    const [jobSnapshot, subscriptionSnapshot] = await Promise.all([
      transaction.get(jobRef),
      transaction.get(subscriptionRef),
    ]);
    if (!jobSnapshot.exists) throw new AppError("not_found", 404);
    const job = jobFrom(jobSnapshot.id, jobSnapshot.data() ?? {});
    if (job.uid !== uid) throw new AppError("not_found", 404);
    if (job.status === "succeeded") {
      return accountSnapshot(balanceFrom(subscriptionSnapshot.data()), subscriptionSnapshot.data());
    }
    if (job.status !== "processing" && job.status !== "reserved") {
      throw new AppError("request_already_failed", 409);
    }

    const now = Timestamp.now();
    const transition = captureTransition(
      balanceFrom(subscriptionSnapshot.data(), now.toMillis()),
      reservationFromJob(job),
      actualCredits,
      mayRestoreSubscriptionReservation(job, subscriptionSnapshot.data(), now.toMillis()),
    );
    const estimatedTypingMs = Math.round((dictation.words / 40) * 60_000);
    const estimatedSavedMs = Math.max(0, estimatedTypingMs - dictation.durationMs);

    transaction.set(subscriptionRef, transitionFields(transition), { merge: true });
    transaction.create(ledgerRef, {
      kind: "capture",
      sourceId: requestId,
      ...transitionLedgerFields(transition),
      subscriptionCreditPeriodId: job.subscriptionCreditPeriodId ?? null,
      actualCredits,
      createdAt: now,
      metadata: {
        transcriptionTokens: dictation.transcriptionTokens,
        transformTokens: dictation.transformTokens,
        modelTranscription: dictation.modelTranscription,
        modelPolish: dictation.modelPolish,
        commercialCost: dictation.commercialCost,
      },
    });
    transaction.update(jobRef, {
      status: "succeeded",
      actualCredits,
      ...(dictation.saveHistory ? { dictationId: dictation.id } : {}),
      resultText: dictation.text,
      transcriptionTokens: dictation.transcriptionTokens,
      transformTokens: dictation.transformTokens,
      providerRequestId: dictation.providerRequestId,
      commercialCost: dictation.commercialCost,
      creditAllocation: {
        subscriptionCreditPeriodId: job.subscriptionCreditPeriodId ?? null,
        reserved: transition.reservation,
        consumed: transition.consumed,
        restored: transition.restored,
        expired: transition.expired,
      },
      updatedAt: now,
      completedAt: now,
      expiresAt: Timestamp.fromMillis(now.toMillis() + 24 * 60 * 60 * 1_000),
      leaseExpiresAt: FieldValue.delete(),
    });
    if (dictation.saveHistory) {
      transaction.create(dictationRef, {
        text: dictation.text,
        durationMs: dictation.durationMs,
        speakingMs: dictation.speakingMs,
        application: dictation.application,
        language: dictation.language,
        words: dictation.words,
        transcriptionTokens: dictation.transcriptionTokens,
        polishInputTokens: dictation.polishInputTokens,
        polishOutputTokens: dictation.polishOutputTokens,
        transformTokens: dictation.transformTokens,
        providerRequestId: dictation.providerRequestId,
        modelTranscription: dictation.modelTranscription,
        modelPolish: dictation.modelPolish,
        polishApplied: dictation.polishApplied,
        commercialCost: dictation.commercialCost,
        creditAllocation: {
          subscriptionCreditPeriodId: job.subscriptionCreditPeriodId ?? null,
          consumed: transition.consumed,
        },
        createdAt: now,
        expiresAt: Timestamp.fromMillis(
          now.toMillis() + dictation.retentionDays * 24 * 60 * 60 * 1_000,
        ),
      });
    }
    transaction.set(
      periodRef,
      {
        month,
        dictationMs: FieldValue.increment(dictation.durationMs),
        speakingMs: FieldValue.increment(dictation.speakingMs),
        wordsGenerated: FieldValue.increment(dictation.words),
        dictationCount: FieldValue.increment(1),
        transcriptionTokens: FieldValue.increment(dictation.transcriptionTokens),
        transformTokens: FieldValue.increment(dictation.transformTokens),
        estimatedProviderCostMicrousd: FieldValue.increment(
          dictation.commercialCost.estimatedProviderCostMicrousd,
        ),
        estimatedPlatformFeeMicrousd: FieldValue.increment(
          dictation.commercialCost.estimatedPlatformFeeMicrousd,
        ),
        estimatedChargedCostMicrousd: FieldValue.increment(
          dictation.commercialCost.estimatedChargedCostMicrousd,
        ),
        commercialCostScheduleVersions: FieldValue.arrayUnion(
          dictation.commercialCost.scheduleVersion,
        ),
        platformMarginBpsValues: FieldValue.arrayUnion(dictation.commercialCost.platformMarginBps),
        estimatedSavedMs: FieldValue.increment(estimatedSavedMs),
        updatedAt: now,
      },
      { merge: true },
    );

    return accountSnapshot(transition.balance, subscriptionSnapshot.data());
  });
}

export async function releaseCredits(
  uid: string,
  requestId: string,
  failureCode: string,
): Promise<CreditAccountSnapshot> {
  const subscriptionRef = firestore.doc(`subscriptions/${uid}`);
  const jobRef = firestore.doc(`transcription_jobs/${requestId}`);
  const ledgerRef = subscriptionRef
    .collection("ledger")
    .doc(ledgerDocumentId("release", requestId));

  return firestore.runTransaction(async (transaction) => {
    const [jobSnapshot, subscriptionSnapshot] = await Promise.all([
      transaction.get(jobRef),
      transaction.get(subscriptionRef),
    ]);
    if (!jobSnapshot.exists) throw new AppError("not_found", 404);
    const job = jobFrom(jobSnapshot.id, jobSnapshot.data() ?? {});
    if (job.uid !== uid) throw new AppError("not_found", 404);
    if (job.status === "failed" || job.status === "succeeded") {
      return accountSnapshot(balanceFrom(subscriptionSnapshot.data()), subscriptionSnapshot.data());
    }

    const now = Timestamp.now();
    const transition = releaseTransition(
      balanceFrom(subscriptionSnapshot.data(), now.toMillis()),
      reservationFromJob(job),
      mayRestoreSubscriptionReservation(job, subscriptionSnapshot.data(), now.toMillis()),
    );
    transaction.set(subscriptionRef, transitionFields(transition), { merge: true });
    transaction.create(ledgerRef, {
      kind: "release",
      sourceId: requestId,
      ...transitionLedgerFields(transition),
      subscriptionCreditPeriodId: job.subscriptionCreditPeriodId ?? null,
      failureCode,
      createdAt: now,
    });
    transaction.update(jobRef, {
      status: "failed",
      failureCode,
      updatedAt: now,
      completedAt: now,
      expiresAt: Timestamp.fromMillis(now.toMillis() + 24 * 60 * 60 * 1_000),
      leaseExpiresAt: FieldValue.delete(),
    });

    return accountSnapshot(transition.balance, subscriptionSnapshot.data());
  });
}

export async function grantPurchasedCredits(
  uid: string,
  amount: number,
  sourceId: string,
  metadata: Record<string, unknown>,
): Promise<boolean> {
  const subscriptionRef = firestore.doc(`subscriptions/${uid}`);
  const ledgerRef = subscriptionRef.collection("ledger").doc(ledgerDocumentId("grant", sourceId));

  return firestore.runTransaction(async (transaction) => {
    const [ledgerSnapshot, subscriptionSnapshot] = await Promise.all([
      transaction.get(ledgerRef),
      transaction.get(subscriptionRef),
    ]);
    if (ledgerSnapshot.exists) return false;

    const transition = grantTransition(balanceFrom(subscriptionSnapshot.data()), amount);
    const now = Timestamp.now();
    transaction.set(subscriptionRef, transitionFields(transition), { merge: true });
    transaction.create(ledgerRef, {
      kind: "purchased_credit_grant",
      sourceId,
      ...transitionLedgerFields(transition),
      createdAt: now,
      metadata,
    });
    return true;
  });
}

export async function grantSubscriptionCredits(
  uid: string,
  amount: number,
  sourceId: string,
  periodStart: Timestamp | null,
  periodEnd: Timestamp,
  metadata: Record<string, unknown>,
): Promise<boolean> {
  const subscriptionRef = firestore.doc(`subscriptions/${uid}`);
  const ledgerRef = subscriptionRef
    .collection("ledger")
    .doc(ledgerDocumentId("subscription-grant", sourceId));
  const legacyLedgerRef = subscriptionRef
    .collection("ledger")
    .doc(ledgerDocumentId("grant", sourceId));

  return firestore.runTransaction(async (transaction) => {
    const [ledgerSnapshot, legacyLedgerSnapshot, subscriptionSnapshot] = await Promise.all([
      transaction.get(ledgerRef),
      transaction.get(legacyLedgerRef),
      transaction.get(subscriptionRef),
    ]);
    if (ledgerSnapshot.exists || legacyLedgerSnapshot.exists) return false;

    const now = Timestamp.now();
    const currentExpiry = timestampField(
      subscriptionSnapshot.data(),
      "subscriptionCreditsExpireAt",
    );
    const priorSubscriptionCredits = integer(subscriptionSnapshot.data(), "subscriptionCredits");
    const stalePeriod =
      periodEnd.toMillis() <= now.toMillis() ||
      (currentExpiry !== null && currentExpiry.toMillis() >= periodEnd.toMillis());

    if (stalePeriod) {
      transaction.create(ledgerRef, {
        kind: "subscription_credit_grant_ignored",
        sourceId,
        reason: periodEnd.toMillis() <= now.toMillis() ? "period_expired" : "older_period",
        periodStart,
        periodEnd,
        createdAt: now,
        metadata,
      });
      return false;
    }

    const transition = resetSubscriptionTransition(
      balanceFrom(subscriptionSnapshot.data(), now.toMillis()),
      amount,
    );
    transaction.set(
      subscriptionRef,
      {
        ...transitionFields(transition),
        subscriptionCreditPeriodId: sourceId,
        subscriptionCreditsGranted: amount,
        subscriptionCreditsPeriodStart: periodStart,
        subscriptionCreditsExpireAt: periodEnd,
      },
      { merge: true },
    );
    transaction.create(ledgerRef, {
      kind: "subscription_credit_reset",
      sourceId,
      ...transitionLedgerFields(transition, priorSubscriptionCredits),
      expiredPriorSubscriptionCredits: priorSubscriptionCredits,
      periodStart,
      periodEnd,
      createdAt: now,
      metadata,
    });
    return true;
  });
}
