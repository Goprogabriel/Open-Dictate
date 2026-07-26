import { describe, expect, it } from "vitest";

import {
  calculateCommercialCost,
  type CommercialCostPricing,
} from "../src/ledger/commercial-cost.js";

const pricing: CommercialCostPricing = {
  scheduleVersion: "test-v1",
  platformMarginBps: 2_000,
  transcribeMicrousdPerMinute: 3_000,
  polishInputMicrousdPerMillionTokens: 250_000,
  polishOutputMicrousdPerMillionTokens: 2_000_000,
};

const polishUsageEstimation = {
  method: "provider_reported",
  version: "utf8-request-bytes-plus-overhead-v1",
  attemptOutcome: "applied",
  failureKind: "none",
  requestBodyBytes: 4_000,
  inputOverheadTokens: 512,
  outputTokenCeiling: 4_096,
} as const;

describe("commercial cost accounting", () => {
  it("calculates a true 20% gross margin using integer microusd", () => {
    const result = calculateCommercialCost(
      {
        durationMs: 60_000,
        transcriptionTokens: 1_200,
        polishInputTokens: 1_000_000,
        polishOutputTokens: 1_000_000,
      },
      pricing,
      polishUsageEstimation,
    );

    expect(result.components).toEqual({
      transcriptionMicrousd: 3_000,
      polishInputMicrousd: 250_000,
      polishOutputMicrousd: 2_000_000,
    });
    expect(result.estimatedProviderCostMicrousd).toBe(2_253_000);
    expect(result.estimatedPlatformFeeMicrousd).toBe(563_250);
    expect(result.estimatedChargedCostMicrousd).toBe(2_816_250);
    expect(result.estimatedPlatformFeeMicrousd * 10_000).toBe(
      result.estimatedChargedCostMicrousd * 2_000,
    );
    expect(result.usageEstimation.polish).toEqual(polishUsageEstimation);
  });

  it("rounds each provider component and the grossed-up charge upward", () => {
    const result = calculateCommercialCost(
      {
        durationMs: 1,
        transcriptionTokens: 1,
        polishInputTokens: 1,
        polishOutputTokens: 1,
      },
      pricing,
      polishUsageEstimation,
    );

    expect(result.components).toEqual({
      transcriptionMicrousd: 1,
      polishInputMicrousd: 1,
      polishOutputMicrousd: 2,
    });
    expect(result.estimatedProviderCostMicrousd).toBe(4);
    expect(result.estimatedPlatformFeeMicrousd).toBe(1);
    expect(result.estimatedChargedCostMicrousd).toBe(5);
  });

  it("records zero platform fee when margin is disabled", () => {
    const result = calculateCommercialCost(
      { durationMs: 20_000, transcriptionTokens: 0, polishInputTokens: 0, polishOutputTokens: 0 },
      { ...pricing, platformMarginBps: 0 },
      polishUsageEstimation,
    );

    expect(result.estimatedProviderCostMicrousd).toBe(1_000);
    expect(result.estimatedPlatformFeeMicrousd).toBe(0);
    expect(result.estimatedChargedCostMicrousd).toBe(1_000);
  });

  it("rejects invalid basis points and non-integer usage", () => {
    const usage = {
      durationMs: 1_000,
      transcriptionTokens: 0,
      polishInputTokens: 0,
      polishOutputTokens: 0,
    };

    expect(() =>
      calculateCommercialCost(
        usage,
        { ...pricing, platformMarginBps: 10_000 },
        polishUsageEstimation,
      ),
    ).toThrow("platformMarginBps must be less than 10,000");
    expect(() =>
      calculateCommercialCost({ ...usage, durationMs: 1.5 }, pricing, polishUsageEstimation),
    ).toThrow("durationMs must be a non-negative safe integer");
  });
});
