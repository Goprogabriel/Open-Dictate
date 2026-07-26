import { z } from "zod";

import { env } from "@/config/env";
import type { AuthSession, BillingService } from "@/services/contracts";
import { HttpClient } from "@/services/api/httpClient";
import type { BillingInvoice, Subscription, TopupTierId } from "@/types/domain";

const httpsUrl = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === "https:");
const urlSchema = z.object({ url: httpsUrl });
const topupTierSchema = z.enum(["usd_5", "usd_10", "usd_20"]);
const subscriptionSchema = z.object({
  plan: z.enum(["free", "pro"]),
  status: z.enum(["none", "trialing", "active", "past_due", "canceled"]),
  currentPeriodEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  remainingTokens: z.number().int().nonnegative().nullable(),
  allowanceTokens: z.number().int().positive().nullable(),
  subscriptionTokens: z.number().int().nonnegative(),
  purchasedTokens: z.number().int().nonnegative(),
  subscriptionTokensExpireAt: z.string().nullable(),
  topupOptions: z.array(
    z.object({
      tier: topupTierSchema,
      amountMinor: z.number().int().positive(),
      currency: z.literal("usd"),
      credits: z.number().int().positive(),
    }),
  ),
});
const invoicesSchema = z.object({
  invoices: z.array(
    z.object({
      id: z.string(),
      date: z.string(),
      amountMinor: z.number().int(),
      currency: z.string(),
      status: z.enum(["paid", "open", "void"]),
      receiptUrl: httpsUrl.nullable(),
    }),
  ),
});

export class ApiBillingService implements BillingService {
  private readonly client: HttpClient;

  constructor(private readonly getSession: () => AuthSession | null) {
    if (!env.apiBaseUrl) throw new Error("api_not_configured");
    this.client = new HttpClient(env.apiBaseUrl);
  }

  private async idToken(): Promise<string> {
    const session = this.getSession();
    if (!session) throw new Error("authentication_required");
    return session.getIdToken();
  }

  async createCheckoutSession(): Promise<string> {
    const response = await this.client.request("/v1/billing/checkout-session", {
      method: "POST",
      idToken: await this.idToken(),
      idempotencyKey: `checkout_${crypto.randomUUID()}`,
      body: {},
      schema: urlSchema,
    });
    return response.url;
  }

  async createPortalSession(): Promise<string> {
    const response = await this.client.request("/v1/billing/portal-session", {
      method: "POST",
      idToken: await this.idToken(),
      body: {},
      schema: urlSchema,
    });
    return response.url;
  }

  async createTopupSession(tier: TopupTierId): Promise<string> {
    const response = await this.client.request("/v1/billing/topup-session", {
      method: "POST",
      idToken: await this.idToken(),
      idempotencyKey: `topup_${crypto.randomUUID()}`,
      body: { tier },
      schema: urlSchema,
    });
    return response.url;
  }

  async getSubscription(): Promise<Subscription> {
    return this.client.request("/v1/me/entitlements", {
      idToken: await this.idToken(),
      schema: subscriptionSchema,
    });
  }

  async listInvoices(): Promise<BillingInvoice[]> {
    const response = await this.client.request("/v1/billing/invoices", {
      idToken: await this.idToken(),
      schema: invoicesSchema,
    });
    return response.invoices;
  }
}
