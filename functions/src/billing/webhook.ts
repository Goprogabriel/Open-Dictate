import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import type Stripe from "stripe";

import {
  MONTHLY_INCLUDED_CREDITS,
  STRIPE_PRO_MONTHLY_PRICE_ID,
  STRIPE_WEBHOOK_SECRET,
  subscriptionMarginBps,
  topupTierConfigurations,
  type TopupTierConfiguration,
} from "../config.js";
import { firestore } from "../firebase.js";
import { grantPurchasedCredits, grantSubscriptionCredits } from "../ledger/store.js";
import { stripeClient, stripeObjectId } from "./stripe.js";

type UnknownRecord = Record<string, unknown>;

interface WebhookRequest {
  method: string;
  body: unknown;
  rawBody?: Buffer;
  header(name: string): string | undefined;
}

interface WebhookResponse {
  status(code: number): WebhookResponse;
  json(body: unknown): void;
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function nestedRecord(record: UnknownRecord, key: string): UnknownRecord {
  return asRecord(record[key]);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function numericValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metadataUid(value: unknown): string | null {
  const record = asRecord(value);
  return (
    stringValue(nestedRecord(record, "metadata").firebaseUid) ??
    stringValue(record.client_reference_id)
  );
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const record = asRecord(invoice);
  const direct = stringValue(record.subscription) ?? stringValue(asRecord(record.subscription).id);
  if (direct) return direct;
  const details = nestedRecord(nestedRecord(record, "parent"), "subscription_details");
  return stringValue(details.subscription) ?? stringValue(asRecord(details.subscription).id);
}

function configuredSubscriptionLine(invoice: Stripe.Invoice): UnknownRecord | null {
  const invoiceRecord = asRecord(invoice);
  if (
    invoiceRecord.billing_reason !== "subscription_create" &&
    invoiceRecord.billing_reason !== "subscription_cycle"
  ) {
    return null;
  }

  const configuredPrice = STRIPE_PRO_MONTHLY_PRICE_ID.value().trim();
  const line = invoice.lines.data.find((lineItem) => {
    const line = asRecord(lineItem);
    const legacyPrice = asRecord(line.price).id;
    const priceDetails = nestedRecord(nestedRecord(line, "pricing"), "price_details");
    return legacyPrice === configuredPrice || priceDetails.price === configuredPrice;
  });
  return line ? asRecord(line) : null;
}

function subscriptionAllowancePeriod(invoice: Stripe.Invoice): {
  start: Timestamp | null;
  end: Timestamp;
} | null {
  const line = configuredSubscriptionLine(invoice);
  if (!line) return null;
  const period = nestedRecord(line, "period");
  const start = numericValue(period.start);
  const end = numericValue(period.end);
  if (!end) return null;
  return {
    start: start ? Timestamp.fromMillis(start * 1_000) : null,
    end: Timestamp.fromMillis(end * 1_000),
  };
}

function topupTierForPriceId(priceId: string): TopupTierConfiguration | null {
  return topupTierConfigurations().find((tier) => tier.priceId === priceId) ?? null;
}

function marginAmountMinor(revenueMinor: number, marginBps: number): number {
  return Math.floor((revenueMinor * marginBps) / 10_000);
}

async function uidForCustomer(customerId: string): Promise<string | null> {
  const snapshot = await firestore
    .collection("subscriptions")
    .where("stripeCustomerId", "==", customerId)
    .limit(2)
    .get();
  return snapshot.size === 1 ? (snapshot.docs[0]?.id ?? null) : null;
}

async function uidForStripeObject(
  value: unknown,
  customerId: string | null,
): Promise<string | null> {
  const direct = metadataUid(value);
  if (direct) return direct;
  return customerId ? uidForCustomer(customerId) : null;
}

function subscriptionPeriod(subscription: Stripe.Subscription): {
  start: Timestamp | null;
  end: Timestamp | null;
} {
  const record = asRecord(subscription);
  const firstItem = subscription.items.data[0];
  const itemRecord = asRecord(firstItem);
  const start =
    numericValue(record.current_period_start) ?? numericValue(itemRecord.current_period_start);
  const end =
    numericValue(record.current_period_end) ?? numericValue(itemRecord.current_period_end);
  return {
    start: start ? Timestamp.fromMillis(start * 1_000) : null,
    end: end ? Timestamp.fromMillis(end * 1_000) : null,
  };
}

async function projectSubscription(
  uid: string,
  subscription: Stripe.Subscription,
  eventCreated: number,
): Promise<void> {
  const priceId = subscription.items.data[0]?.price.id ?? null;
  const period = subscriptionPeriod(subscription);
  await firestore.doc(`subscriptions/${uid}`).set(
    {
      plan: priceId === STRIPE_PRO_MONTHLY_PRICE_ID.value() ? "pro" : "unknown",
      status: subscription.status,
      stripeCustomerId: stripeObjectId(subscription.customer),
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      entitlementEndsAt: period.end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      lastStripeEventCreated: eventCreated,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

async function refreshSubscription(
  subscriptionId: string,
  uidHint: string | null,
  eventCreated: number,
): Promise<void> {
  const subscription = await stripeClient().subscriptions.retrieve(subscriptionId);
  const customerId = stripeObjectId(subscription.customer);
  const uid = uidHint ?? (await uidForStripeObject(subscription, customerId));
  if (uid) await projectSubscription(uid, subscription, eventCreated);
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  eventCreated: number,
): Promise<void> {
  const customerId = stripeObjectId(session.customer);
  const uid = await uidForStripeObject(session, customerId);
  if (!uid) return;

  if (session.mode === "payment") {
    const metadata = asRecord(session.metadata);
    if (session.payment_status !== "paid" || metadata.purchaseKind !== "credit_topup") return;

    const lineItems = await stripeClient().checkout.sessions.listLineItems(session.id, {
      limit: 10,
    });
    const matchedTiers = lineItems.data.flatMap((lineItem) => {
      const priceId = stringValue(asRecord(lineItem.price).id);
      const tier = priceId ? topupTierForPriceId(priceId) : null;
      return tier && lineItem.quantity === 1 ? [tier] : [];
    });
    const tier = matchedTiers.length === 1 ? matchedTiers[0] : undefined;
    if (
      !tier ||
      session.amount_total !== tier.amountMinor ||
      session.currency !== tier.currency ||
      metadata.topupTier !== tier.id ||
      metadata.credits !== String(tier.credits) ||
      metadata.marginBps !== String(tier.marginBps)
    ) {
      return;
    }

    await grantPurchasedCredits(uid, tier.credits, `stripe-topup-${session.id}`, {
      checkoutSessionId: session.id,
      amountPaidMinor: session.amount_total,
      currency: session.currency,
      stripePriceId: tier.priceId,
      topupTier: tier.id,
      creditsGranted: tier.credits,
      creditsExpire: false,
      platformMarginBps: tier.marginBps,
      targetPlatformMarginMinor: marginAmountMinor(tier.amountMinor, tier.marginBps),
    });
    return;
  }

  if (!customerId) return;

  await firestore.doc(`subscriptions/${uid}`).set(
    {
      stripeCustomerId: customerId,
      stripeSubscriptionId: stripeObjectId(session.subscription),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const subscriptionId = stripeObjectId(session.subscription);
  if (subscriptionId) await refreshSubscription(subscriptionId, uid, eventCreated);
}

async function handleSubscriptionEvent(
  subscription: Stripe.Subscription,
  eventCreated: number,
): Promise<void> {
  const customerId = stripeObjectId(subscription.customer);
  const uid = await uidForStripeObject(subscription, customerId);
  if (!uid) return;

  if (subscription.status === "canceled") {
    await projectSubscription(uid, subscription, eventCreated);
    return;
  }
  await refreshSubscription(subscription.id, uid, eventCreated);
}

async function handleInvoicePaid(invoice: Stripe.Invoice, eventCreated: number): Promise<void> {
  const customerId = stripeObjectId(invoice.customer);
  let uid = await uidForStripeObject(invoice, customerId);
  const subscriptionId = invoiceSubscriptionId(invoice);

  if (!uid && subscriptionId) {
    const subscription = await stripeClient().subscriptions.retrieve(subscriptionId);
    uid = await uidForStripeObject(subscription, stripeObjectId(subscription.customer));
  }
  if (!uid) return;

  if (subscriptionId) await refreshSubscription(subscriptionId, uid, eventCreated);
  const allowancePeriod = subscriptionAllowancePeriod(invoice);
  if (invoice.amount_paid > 0 && configuredSubscriptionLine(invoice)) {
    if (!allowancePeriod) throw new Error("Subscription invoice is missing its billing period.");
    const marginBps = subscriptionMarginBps();
    await grantSubscriptionCredits(
      uid,
      MONTHLY_INCLUDED_CREDITS.value(),
      `stripe-invoice-${invoice.id}`,
      allowancePeriod.start,
      allowancePeriod.end,
      {
        invoiceId: invoice.id,
        amountPaidMinor: invoice.amount_paid,
        currency: invoice.currency,
        creditsGranted: MONTHLY_INCLUDED_CREDITS.value(),
        creditsExpire: true,
        platformMarginBps: marginBps,
        targetPlatformMarginMinor: marginAmountMinor(invoice.amount_paid, marginBps),
      },
    );
  }

  await firestore.doc(`subscriptions/${uid}`).set(
    {
      lastPaidInvoiceId: invoice.id,
      billingStatus: "paid",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

async function handleInvoiceProblem(invoice: Stripe.Invoice, eventType: string): Promise<void> {
  const customerId = stripeObjectId(invoice.customer);
  const uid = await uidForStripeObject(invoice, customerId);
  if (!uid) return;
  await firestore.doc(`subscriptions/${uid}`).set(
    {
      billingStatus:
        eventType === "invoice.payment_failed" ? "payment_failed" : "finalization_failed",
      lastProblemInvoiceId: invoice.id,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

async function processStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await handleCheckoutCompleted(event.data.object, event.created);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await handleSubscriptionEvent(event.data.object, event.created);
      break;
    case "invoice.paid":
      await handleInvoicePaid(event.data.object, event.created);
      break;
    case "invoice.payment_failed":
    case "invoice.finalization_failed":
      await handleInvoiceProblem(event.data.object, event.type);
      break;
    default:
      break;
  }
}

type EventClaim = "claimed" | "processed" | "busy";

async function claimEvent(event: Stripe.Event): Promise<EventClaim> {
  const eventRef = firestore.doc(`billing_events/${event.id}`);
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(eventRef);
    const data = asRecord(snapshot.data());
    if (data.status === "processed") return "processed";

    const lease: unknown = data.leaseExpiresAt;
    if (
      data.status === "processing" &&
      lease instanceof Timestamp &&
      lease.toMillis() > Date.now()
    ) {
      return "busy";
    }

    transaction.set(
      eventRef,
      {
        eventType: event.type,
        status: "processing",
        attempts: FieldValue.increment(1),
        stripeCreatedAt: Timestamp.fromMillis(event.created * 1_000),
        receivedAt: data.receivedAt ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        leaseExpiresAt: Timestamp.fromMillis(Date.now() + 5 * 60 * 1_000),
      },
      { merge: true },
    );
    return "claimed";
  });
}

export async function stripeWebhookHandler(
  request: WebhookRequest,
  response: WebhookResponse,
): Promise<void> {
  if (request.method !== "POST") {
    response.status(405).json({ error: { code: "method_not_allowed" } });
    return;
  }

  const signature = request.header("Stripe-Signature");
  const rawBody = request.body instanceof Buffer ? request.body : request.rawBody;
  if (!signature || !rawBody) {
    response.status(400).json({ error: { code: "invalid_webhook" } });
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripeClient().webhooks.constructEvent(
      rawBody,
      signature,
      STRIPE_WEBHOOK_SECRET.value(),
    );
  } catch {
    response.status(400).json({ error: { code: "invalid_webhook_signature" } });
    return;
  }

  const eventRef = firestore.doc(`billing_events/${event.id}`);
  let claimed = false;
  try {
    const claim = await claimEvent(event);
    if (claim === "processed") {
      response.status(200).json({ received: true, duplicate: true });
      return;
    }
    if (claim === "busy") {
      response.status(409).json({ error: { code: "event_processing_in_progress" } });
      return;
    }

    claimed = true;
    await processStripeEvent(event);
    await eventRef.set(
      {
        status: "processed",
        processedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        leaseExpiresAt: FieldValue.delete(),
      },
      { merge: true },
    );
    response.status(200).json({ received: true });
  } catch (error) {
    if (claimed) {
      await eventRef.set(
        {
          status: "failed",
          failureCode: "event_processing_failed",
          updatedAt: FieldValue.serverTimestamp(),
          leaseExpiresAt: FieldValue.delete(),
        },
        { merge: true },
      );
    }
    logger.error("Stripe event processing failed", {
      eventId: event.id,
      eventType: event.type,
      errorType: error instanceof Error ? error.name : typeof error,
    });
    response.status(500).json({ error: { code: "event_processing_failed" } });
  }
}
