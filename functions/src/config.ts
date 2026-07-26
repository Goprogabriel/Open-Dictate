import { defineInt, defineSecret, defineString } from "firebase-functions/params";

import type { CommercialCostPricing } from "./ledger/commercial-cost.js";

export const FUNCTION_REGION = "europe-west1";

export const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
export const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
export const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");

export const ALLOWED_ORIGINS = defineString("ALLOWED_ORIGINS", {
  default: "tauri://localhost,http://tauri.localhost,http://localhost:1420",
});

export const STRIPE_PRO_MONTHLY_PRICE_ID = defineString("STRIPE_PRO_MONTHLY_PRICE_ID");
export const STRIPE_TOPUP_5_PRICE_ID = defineString("STRIPE_TOPUP_5_PRICE_ID");
export const STRIPE_TOPUP_10_PRICE_ID = defineString("STRIPE_TOPUP_10_PRICE_ID");
export const STRIPE_TOPUP_20_PRICE_ID = defineString("STRIPE_TOPUP_20_PRICE_ID");
export const TOPUP_5_CREDITS = defineInt("TOPUP_5_CREDITS");
export const TOPUP_10_CREDITS = defineInt("TOPUP_10_CREDITS");
export const TOPUP_20_CREDITS = defineInt("TOPUP_20_CREDITS");
export const SUBSCRIPTION_MARGIN_BPS = defineInt("SUBSCRIPTION_MARGIN_BPS");
export const TOPUP_5_MARGIN_BPS = defineInt("TOPUP_5_MARGIN_BPS");
export const TOPUP_10_MARGIN_BPS = defineInt("TOPUP_10_MARGIN_BPS");
export const TOPUP_20_MARGIN_BPS = defineInt("TOPUP_20_MARGIN_BPS");
export const CHECKOUT_SUCCESS_URL = defineString("CHECKOUT_SUCCESS_URL");
export const CHECKOUT_CANCEL_URL = defineString("CHECKOUT_CANCEL_URL");
export const BILLING_PORTAL_RETURN_URL = defineString("BILLING_PORTAL_RETURN_URL");

export const OPENAI_TRANSCRIBE_MODEL = defineString("OPENAI_TRANSCRIBE_MODEL", {
  default: "gpt-4o-mini-transcribe",
});
export const OPENAI_POLISH_MODEL = defineString("OPENAI_POLISH_MODEL", {
  default: "gpt-5-mini",
});
export const OPENAI_POLISH_MAX_OUTPUT_TOKENS = defineInt("OPENAI_POLISH_MAX_OUTPUT_TOKENS", {
  default: 4_096,
});
export const OPENAI_FAILED_POLISH_INPUT_OVERHEAD_TOKENS = defineInt(
  "OPENAI_FAILED_POLISH_INPUT_OVERHEAD_TOKENS",
  { default: 512 },
);

export const MONTHLY_INCLUDED_CREDITS = defineInt("MONTHLY_INCLUDED_CREDITS");
export const TRANSCRIBE_CREDITS_PER_SECOND = defineInt("TRANSCRIBE_CREDITS_PER_SECOND");
export const TRANSCRIBE_CREDITS_PER_PROVIDER_TOKEN = defineInt(
  "TRANSCRIBE_CREDITS_PER_PROVIDER_TOKEN",
);
export const POLISH_INPUT_CREDITS_PER_MILLION = defineInt("POLISH_INPUT_CREDITS_PER_MILLION");
export const POLISH_OUTPUT_CREDITS_PER_MILLION = defineInt("POLISH_OUTPUT_CREDITS_PER_MILLION");
export const RESERVE_CREDITS_PER_MIB = defineInt("RESERVE_CREDITS_PER_MIB");
export const MIN_REQUEST_RESERVE_CREDITS = defineInt("MIN_REQUEST_RESERVE_CREDITS");
export const MAX_POLISH_RESERVE_CREDITS = defineInt("MAX_POLISH_RESERVE_CREDITS", {
  // Covers the configured maximum response plus a long transcript/input.
  // Settlement refunds the unused portion to the allowance ledger.
  default: 60_000,
});
export const MAX_AUDIO_BYTES = defineInt("MAX_AUDIO_BYTES", { default: 24 * 1024 * 1024 });
export const MAX_AUDIO_DURATION_MS = defineInt("MAX_AUDIO_DURATION_MS", {
  default: 10 * 60 * 1_000,
});

export const COMMERCIAL_COST_SCHEDULE_VERSION = defineString("COMMERCIAL_COST_SCHEDULE_VERSION");
export const OPENAI_TRANSCRIBE_COST_MICROUSD_PER_MINUTE = defineInt(
  "OPENAI_TRANSCRIBE_COST_MICROUSD_PER_MINUTE",
);
export const OPENAI_POLISH_INPUT_COST_MICROUSD_PER_MILLION_TOKENS = defineInt(
  "OPENAI_POLISH_INPUT_COST_MICROUSD_PER_MILLION_TOKENS",
);
export const OPENAI_POLISH_OUTPUT_COST_MICROUSD_PER_MILLION_TOKENS = defineInt(
  "OPENAI_POLISH_OUTPUT_COST_MICROUSD_PER_MILLION_TOKENS",
);

function positiveInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid positive integer parameter: ${name}`);
  }
  return value;
}

function basisPoints(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 10_000) {
    throw new Error(`Invalid basis-point parameter: ${name}`);
  }
  return value;
}

function stripePriceId(name: string, value: string): string {
  const priceId = value.trim();
  if (!priceId.startsWith("price_")) throw new Error(`${name} is invalid.`);
  return priceId;
}

export interface CreditPricing {
  transcribeCreditsPerSecond: number;
  transcribeCreditsPerProviderToken: number;
  polishInputCreditsPerMillion: number;
  polishOutputCreditsPerMillion: number;
  reserveCreditsPerMib: number;
  minimumRequestReserveCredits: number;
  maximumPolishReserveCredits: number;
}

export interface PolishRequestPolicy {
  maxOutputTokens: number;
  failedAttemptInputOverheadTokens: number;
}

export function polishRequestPolicy(): PolishRequestPolicy {
  return {
    maxOutputTokens: positiveInteger(
      "OPENAI_POLISH_MAX_OUTPUT_TOKENS",
      OPENAI_POLISH_MAX_OUTPUT_TOKENS.value(),
    ),
    failedAttemptInputOverheadTokens: positiveInteger(
      "OPENAI_FAILED_POLISH_INPUT_OVERHEAD_TOKENS",
      OPENAI_FAILED_POLISH_INPUT_OVERHEAD_TOKENS.value(),
    ),
  };
}

export function creditPricing(): CreditPricing {
  return {
    transcribeCreditsPerSecond: positiveInteger(
      "TRANSCRIBE_CREDITS_PER_SECOND",
      TRANSCRIBE_CREDITS_PER_SECOND.value(),
    ),
    transcribeCreditsPerProviderToken: positiveInteger(
      "TRANSCRIBE_CREDITS_PER_PROVIDER_TOKEN",
      TRANSCRIBE_CREDITS_PER_PROVIDER_TOKEN.value(),
    ),
    polishInputCreditsPerMillion: positiveInteger(
      "POLISH_INPUT_CREDITS_PER_MILLION",
      POLISH_INPUT_CREDITS_PER_MILLION.value(),
    ),
    polishOutputCreditsPerMillion: positiveInteger(
      "POLISH_OUTPUT_CREDITS_PER_MILLION",
      POLISH_OUTPUT_CREDITS_PER_MILLION.value(),
    ),
    reserveCreditsPerMib: positiveInteger(
      "RESERVE_CREDITS_PER_MIB",
      RESERVE_CREDITS_PER_MIB.value(),
    ),
    minimumRequestReserveCredits: positiveInteger(
      "MIN_REQUEST_RESERVE_CREDITS",
      MIN_REQUEST_RESERVE_CREDITS.value(),
    ),
    maximumPolishReserveCredits: positiveInteger(
      "MAX_POLISH_RESERVE_CREDITS",
      MAX_POLISH_RESERVE_CREDITS.value(),
    ),
  };
}

export function commercialCostPricing(): CommercialCostPricing {
  const scheduleVersion = COMMERCIAL_COST_SCHEDULE_VERSION.value().trim();
  if (!scheduleVersion || scheduleVersion.length > 64) {
    throw new Error("Invalid commercial cost schedule version.");
  }
  return {
    scheduleVersion,
    // Dictation telemetry measures provider spend only. Revenue margins are
    // authoritative on subscription and top-up grant ledger entries because
    // they differ by funding source and top-up tier.
    platformMarginBps: 0,
    transcribeMicrousdPerMinute: positiveInteger(
      "OPENAI_TRANSCRIBE_COST_MICROUSD_PER_MINUTE",
      OPENAI_TRANSCRIBE_COST_MICROUSD_PER_MINUTE.value(),
    ),
    polishInputMicrousdPerMillionTokens: positiveInteger(
      "OPENAI_POLISH_INPUT_COST_MICROUSD_PER_MILLION_TOKENS",
      OPENAI_POLISH_INPUT_COST_MICROUSD_PER_MILLION_TOKENS.value(),
    ),
    polishOutputMicrousdPerMillionTokens: positiveInteger(
      "OPENAI_POLISH_OUTPUT_COST_MICROUSD_PER_MILLION_TOKENS",
      OPENAI_POLISH_OUTPUT_COST_MICROUSD_PER_MILLION_TOKENS.value(),
    ),
  };
}

export type TopupTierId = "usd_5" | "usd_10" | "usd_20";

export interface TopupTierConfiguration {
  id: TopupTierId;
  amountMinor: 500 | 1_000 | 2_000;
  currency: "usd";
  credits: number;
  marginBps: number;
  priceId: string;
}

export function subscriptionMarginBps(): number {
  return basisPoints("SUBSCRIPTION_MARGIN_BPS", SUBSCRIPTION_MARGIN_BPS.value());
}

export function topupTierConfiguration(id: TopupTierId): TopupTierConfiguration {
  switch (id) {
    case "usd_5": {
      const marginBps = basisPoints("TOPUP_5_MARGIN_BPS", TOPUP_5_MARGIN_BPS.value());
      return {
        id,
        amountMinor: 500,
        currency: "usd",
        credits: positiveInteger("TOPUP_5_CREDITS", TOPUP_5_CREDITS.value()),
        marginBps,
        priceId: stripePriceId("STRIPE_TOPUP_5_PRICE_ID", STRIPE_TOPUP_5_PRICE_ID.value()),
      };
    }
    case "usd_10": {
      const marginBps = basisPoints("TOPUP_10_MARGIN_BPS", TOPUP_10_MARGIN_BPS.value());
      return {
        id,
        amountMinor: 1_000,
        currency: "usd",
        credits: positiveInteger("TOPUP_10_CREDITS", TOPUP_10_CREDITS.value()),
        marginBps,
        priceId: stripePriceId("STRIPE_TOPUP_10_PRICE_ID", STRIPE_TOPUP_10_PRICE_ID.value()),
      };
    }
    case "usd_20": {
      const marginBps = basisPoints("TOPUP_20_MARGIN_BPS", TOPUP_20_MARGIN_BPS.value());
      return {
        id,
        amountMinor: 2_000,
        currency: "usd",
        credits: positiveInteger("TOPUP_20_CREDITS", TOPUP_20_CREDITS.value()),
        marginBps,
        priceId: stripePriceId("STRIPE_TOPUP_20_PRICE_ID", STRIPE_TOPUP_20_PRICE_ID.value()),
      };
    }
  }
}

export function topupTierConfigurations(): readonly TopupTierConfiguration[] {
  return [
    topupTierConfiguration("usd_5"),
    topupTierConfiguration("usd_10"),
    topupTierConfiguration("usd_20"),
  ];
}

export function allowedOrigins(): ReadonlySet<string> {
  return new Set(
    ALLOWED_ORIGINS.value()
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}
