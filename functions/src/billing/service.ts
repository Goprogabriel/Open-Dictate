import { FieldValue, Timestamp, type DocumentData } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import type Stripe from "stripe";

import {
  BILLING_PORTAL_RETURN_URL,
  CHECKOUT_CANCEL_URL,
  CHECKOUT_SUCCESS_URL,
  MONTHLY_INCLUDED_CREDITS,
  STRIPE_PRO_MONTHLY_PRICE_ID,
  subscriptionMarginBps,
  topupTierConfiguration,
  topupTierConfigurations,
  type TopupTierConfiguration,
  type TopupTierId,
} from "../config.js";
import { firestore } from "../firebase.js";
import { AppError } from "../http/errors.js";
import type { AuthenticatedUser } from "../http/security.js";
import {
  getCreditAccount,
  grantSubscriptionCredits,
  spendableCreditProjection,
} from "../ledger/store.js";
import { stripeClient, stripeObjectId } from "./stripe.js";

function configuredUrl(name: string, value: string): string {
  try {
    const url = new URL(value);
    const localDevelopment = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(localDevelopment && url.protocol === "http:")) {
      throw new Error("HTTPS is required.");
    }
    return url.toString();
  } catch {
    throw new Error(`${name} must be an absolute HTTPS URL.`);
  }
}

async function assertSubscriptionPrice(priceId: string): Promise<void> {
  const price = await stripeClient().prices.retrieve(priceId);
  const recurring = price.recurring;
  if (
    !price.active ||
    price.currency !== "usd" ||
    price.unit_amount !== 500 ||
    price.type !== "recurring" ||
    !recurring ||
    recurring.interval !== "month" ||
    recurring.interval_count !== 1
  ) {
    throw new Error("The configured Pro price must be an active $5 USD monthly price.");
  }
}

async function assertTopupPrice(tier: TopupTierConfiguration): Promise<void> {
  const price = await stripeClient().prices.retrieve(tier.priceId);
  if (
    !price.active ||
    price.currency !== tier.currency ||
    price.unit_amount !== tier.amountMinor ||
    price.type !== "one_time"
  ) {
    throw new Error(`The configured ${tier.id} price does not match its published tier.`);
  }
}

function timestampToIso(value: unknown): string | null {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1_000).toISOString();
  }
  return null;
}

function documentField(data: DocumentData | undefined, key: string): unknown {
  return data ? (data as Record<string, unknown>)[key] : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function numericValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function subscriptionStatusIsPro(status: string): boolean {
  return status === "trialing" || status === "active" || status === "past_due";
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

function expandedInvoice(value: unknown): Stripe.Invoice | null {
  const record = asRecord(value);
  return typeof record.id === "string" && record.object === "invoice"
    ? (value as Stripe.Invoice)
    : null;
}

function invoiceIsPaid(invoice: Stripe.Invoice | null): invoice is Stripe.Invoice {
  return Boolean(invoice && invoice.status === "paid" && invoice.amount_paid > 0);
}

async function reconcileStripeSubscription(
  uid: string,
  data: DocumentData | undefined,
): Promise<void> {
  const customerId = documentField(data, "stripeCustomerId");
  if (typeof customerId !== "string" || !customerId) return;

  try {
    const page = await stripeClient().subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 10,
      expand: ["data.latest_invoice"],
    });
    const configuredPriceId = STRIPE_PRO_MONTHLY_PRICE_ID.value().trim();
    const subscription = page.data.find((candidate) => {
      const priceId = candidate.items.data[0]?.price.id;
      return priceId === configuredPriceId && subscriptionStatusIsPro(candidate.status);
    });
    if (!subscription) return;

    const period = subscriptionPeriod(subscription);
    const priceId = subscription.items.data[0]?.price.id ?? null;
    await firestore.doc(`subscriptions/${uid}`).set(
      {
        plan: "pro",
        status: subscription.status,
        stripeCustomerId: stripeObjectId(subscription.customer) ?? customerId,
        stripeSubscriptionId: subscription.id,
        stripePriceId: priceId,
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
        entitlementEndsAt: period.end,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        reconciledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const latestInvoice = expandedInvoice(asRecord(subscription).latest_invoice);
    if (period.end && invoiceIsPaid(latestInvoice)) {
      const marginBps = subscriptionMarginBps();
      await grantSubscriptionCredits(
        uid,
        MONTHLY_INCLUDED_CREDITS.value(),
        `stripe-invoice-${latestInvoice.id}`,
        period.start,
        period.end,
        {
          invoiceId: latestInvoice.id,
          amountPaidMinor: latestInvoice.amount_paid,
          currency: latestInvoice.currency,
          creditsGranted: MONTHLY_INCLUDED_CREDITS.value(),
          creditsExpire: true,
          platformMarginBps: marginBps,
          targetPlatformMarginMinor: Math.floor((latestInvoice.amount_paid * marginBps) / 10_000),
          reconciledFromStripe: true,
        },
      );
    }
  } catch (error) {
    logger.error("Stripe subscription reconciliation failed", {
      uid,
      errorType: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function ensureUserProfile(user: AuthenticatedUser): Promise<void> {
  const userRef = firestore.doc(`users/${user.uid}`);
  const snapshot = await userRef.get();
  if (snapshot.exists) return;

  await userRef.set(
    {
      name: user.name ?? "",
      email: user.email ?? "",
      language: "en",
      schemaVersion: 1,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

async function ensureStripeCustomer(user: AuthenticatedUser): Promise<string> {
  const subscriptionRef = firestore.doc(`subscriptions/${user.uid}`);
  const existing = await subscriptionRef.get();
  const existingCustomer: unknown = existing.get("stripeCustomerId");
  if (typeof existingCustomer === "string" && existingCustomer) return existingCustomer;

  const customer = await stripeClient().customers.create(
    {
      email: user.email ?? undefined,
      name: user.name ?? undefined,
      metadata: { firebaseUid: user.uid },
    },
    { idempotencyKey: `firebase-customer-${user.uid}` },
  );

  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(subscriptionRef);
    const currentCustomer: unknown = snapshot.get("stripeCustomerId");
    const currentPlan: unknown = snapshot.get("plan");
    const currentStatus: unknown = snapshot.get("status");
    transaction.set(
      subscriptionRef,
      {
        stripeCustomerId:
          typeof currentCustomer === "string" && currentCustomer ? currentCustomer : customer.id,
        plan: typeof currentPlan === "string" ? currentPlan : "free",
        status: typeof currentStatus === "string" ? currentStatus : "none",
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  const latest = await subscriptionRef.get();
  const persistedCustomer: unknown = latest.get("stripeCustomerId");
  return typeof persistedCustomer === "string" && persistedCustomer
    ? persistedCustomer
    : customer.id;
}

export async function createCheckoutSession(
  user: AuthenticatedUser,
  idempotencyKey: string,
): Promise<string> {
  try {
    await ensureUserProfile(user);
    const customerId = await ensureStripeCustomer(user);
    const priceId = STRIPE_PRO_MONTHLY_PRICE_ID.value().trim();
    if (!priceId.startsWith("price_")) throw new Error("STRIPE_PRO_MONTHLY_PRICE_ID is invalid.");

    await assertSubscriptionPrice(priceId);
    const session = await stripeClient().checkout.sessions.create(
      {
        mode: "subscription",
        customer: customerId,
        client_reference_id: user.uid,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: configuredUrl("CHECKOUT_SUCCESS_URL", CHECKOUT_SUCCESS_URL.value()),
        cancel_url: configuredUrl("CHECKOUT_CANCEL_URL", CHECKOUT_CANCEL_URL.value()),
        metadata: { firebaseUid: user.uid },
        subscription_data: { metadata: { firebaseUid: user.uid } },
      },
      { idempotencyKey: `checkout-${user.uid}-${idempotencyKey}` },
    );
    if (!session.url) throw new Error("Stripe did not return a Checkout URL.");
    return session.url;
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error("Stripe subscription Checkout session creation failed", {
      uid: user.uid,
      errorType: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw new AppError("billing_unavailable", 503, true);
  }
}

export async function createTopupSession(
  user: AuthenticatedUser,
  idempotencyKey: string,
  tierId: TopupTierId,
): Promise<string> {
  const entitlement = await firestore.doc(`subscriptions/${user.uid}`).get();
  const status: unknown = entitlement.get("status");
  if (status !== "active" && status !== "trialing") {
    throw new AppError("subscription_required", 403);
  }

  try {
    const customerId = await ensureStripeCustomer(user);
    const tier = topupTierConfiguration(tierId);

    await assertTopupPrice(tier);
    const session = await stripeClient().checkout.sessions.create(
      {
        mode: "payment",
        customer: customerId,
        line_items: [{ price: tier.priceId, quantity: 1 }],
        success_url: configuredUrl("CHECKOUT_SUCCESS_URL", CHECKOUT_SUCCESS_URL.value()),
        cancel_url: configuredUrl("CHECKOUT_CANCEL_URL", CHECKOUT_CANCEL_URL.value()),
        metadata: {
          firebaseUid: user.uid,
          purchaseKind: "credit_topup",
          topupTier: tier.id,
          credits: String(tier.credits),
          marginBps: String(tier.marginBps),
        },
        payment_intent_data: {
          metadata: {
            firebaseUid: user.uid,
            purchaseKind: "credit_topup",
            topupTier: tier.id,
          },
        },
      },
      { idempotencyKey: `topup-${user.uid}-${tier.id}-${idempotencyKey}` },
    );
    if (!session.url) throw new Error("Stripe did not return a Checkout URL.");
    return session.url;
  } catch (error) {
    if (error instanceof AppError) throw error;
    logger.error("Stripe top-up Checkout session creation failed", {
      uid: user.uid,
      tierId,
      errorType: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw new AppError("billing_unavailable", 503, true);
  }
}

export async function createPortalSession(user: AuthenticatedUser): Promise<string> {
  const subscription = await firestore.doc(`subscriptions/${user.uid}`).get();
  const customerId: unknown = subscription.get("stripeCustomerId");
  if (typeof customerId !== "string" || !customerId) {
    throw new AppError("subscription_required", 403);
  }

  try {
    const session = await stripeClient().billingPortal.sessions.create({
      customer: customerId,
      return_url: configuredUrl("BILLING_PORTAL_RETURN_URL", BILLING_PORTAL_RETURN_URL.value()),
    });
    return session.url;
  } catch {
    throw new AppError("billing_unavailable", 503, true);
  }
}

export async function getEntitlements(uid: string): Promise<Record<string, unknown>> {
  let snapshot = await firestore.doc(`subscriptions/${uid}`).get();
  await reconcileStripeSubscription(uid, snapshot.data());
  snapshot = await firestore.doc(`subscriptions/${uid}`).get();
  const creditAccount = await getCreditAccount(uid);
  const spendableCredits = spendableCreditProjection(creditAccount);
  const data = snapshot.data();
  const rawStatus = documentField(data, "status");
  const stripeStatus = typeof rawStatus === "string" ? rawStatus : "none";
  const status = ["trialing", "active", "past_due", "canceled"].includes(stripeStatus)
    ? stripeStatus
    : "none";
  const isPro = subscriptionStatusIsPro(status);

  return {
    plan: isPro ? "pro" : "free",
    status,
    currentPeriodEnd: timestampToIso(documentField(data, "currentPeriodEnd")),
    cancelAtPeriodEnd: documentField(data, "cancelAtPeriodEnd") === true,
    ...spendableCredits,
    allowanceTokens: isPro ? MONTHLY_INCLUDED_CREDITS.value() : null,
    topupOptions: topupTierConfigurations().map((tier) => ({
      tier: tier.id,
      amountMinor: tier.amountMinor,
      currency: tier.currency,
      credits: tier.credits,
    })),
  };
}

function invoiceStatus(status: Stripe.Invoice.Status | null): "paid" | "open" | "void" {
  if (status === "paid") return "paid";
  if (status === "void" || status === "uncollectible") return "void";
  return "open";
}

export async function listInvoices(uid: string): Promise<Record<string, unknown>[]> {
  const subscription = await firestore.doc(`subscriptions/${uid}`).get();
  const customerId: unknown = subscription.get("stripeCustomerId");
  if (typeof customerId !== "string" || !customerId) return [];

  try {
    const page = await stripeClient().invoices.list({ customer: customerId, limit: 25 });
    return page.data.map((invoice) => ({
      id: invoice.id,
      date: new Date(invoice.created * 1_000).toISOString(),
      amountMinor: invoice.amount_paid,
      currency: invoice.currency,
      status: invoiceStatus(invoice.status),
      receiptUrl: invoice.hosted_invoice_url ?? null,
    }));
  } catch {
    throw new AppError("billing_unavailable", 503, true);
  }
}
