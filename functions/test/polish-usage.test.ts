import { describe, expect, it } from "vitest";

import { resolveCommercialPolishUsage } from "../src/ledger/polish-usage.js";

const context = {
  requestBodyBytes: 1_200,
  inputOverheadTokens: 512,
  outputTokenCeiling: 4_096,
} as const;

describe("failed polish provider-cost usage", () => {
  it("prefers complete provider-reported usage even when output validation falls back", () => {
    const usage = resolveCommercialPolishUsage({
      ...context,
      reportedUsage: { inputTokens: 321, outputTokens: 42 },
      attemptOutcome: "fallback",
      failureKind: "missing_output",
      potentiallyBillable: true,
    });

    expect(usage).toEqual({
      inputTokens: 321,
      outputTokens: 42,
      estimation: {
        method: "provider_reported",
        version: "utf8-request-bytes-plus-overhead-v1",
        attemptOutcome: "fallback",
        failureKind: "missing_output",
        ...context,
      },
    });
  });

  it("uses an auditable safety estimate for an ambiguous timeout without usage", () => {
    const usage = resolveCommercialPolishUsage({
      ...context,
      attemptOutcome: "fallback",
      failureKind: "network_or_timeout",
      potentiallyBillable: true,
    });

    expect(usage.inputTokens).toBe(1_712);
    expect(usage.outputTokens).toBe(4_096);
    expect(usage.estimation).toEqual({
      method: "request_safety_estimate",
      version: "utf8-request-bytes-plus-overhead-v1",
      attemptOutcome: "fallback",
      failureKind: "network_or_timeout",
      ...context,
    });
  });

  it("records zero for a request known not to have reached billable processing", () => {
    const usage = resolveCommercialPolishUsage({
      ...context,
      attemptOutcome: "fallback",
      failureKind: "missing_credentials",
      potentiallyBillable: false,
    });

    expect(usage.inputTokens).toBe(0);
    expect(usage.outputTokens).toBe(0);
    expect(usage.estimation.method).toBe("not_potentially_billable");
  });

  it("rejects unsafe estimation inputs instead of silently overflowing", () => {
    expect(() =>
      resolveCommercialPolishUsage({
        ...context,
        requestBodyBytes: Number.MAX_SAFE_INTEGER,
        attemptOutcome: "fallback",
        failureKind: "network_or_timeout",
        potentiallyBillable: true,
      }),
    ).toThrow("estimated polish input tokens exceeds the maximum safe integer");
  });
});
