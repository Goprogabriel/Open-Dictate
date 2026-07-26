export const POLISH_USAGE_ESTIMATION_VERSION = "utf8-request-bytes-plus-overhead-v1";

export type PolishUsageEstimationMethod =
  "provider_reported" | "request_safety_estimate" | "not_potentially_billable";

export type PolishAttemptOutcome = "applied" | "fallback";

export type PolishUsageFailureKind =
  | "none"
  | "missing_credentials"
  | "network_or_timeout"
  | "http_error"
  | "malformed_json"
  | "invalid_response"
  | "missing_output"
  | "missing_usage"
  | "unexpected_error";

export interface PolishUsageEstimation {
  method: PolishUsageEstimationMethod;
  version: typeof POLISH_USAGE_ESTIMATION_VERSION;
  attemptOutcome: PolishAttemptOutcome;
  failureKind: PolishUsageFailureKind;
  requestBodyBytes: number;
  inputOverheadTokens: number;
  outputTokenCeiling: number;
}

export interface CommercialPolishUsage {
  inputTokens: number;
  outputTokens: number;
  estimation: PolishUsageEstimation;
}

interface ReportedPolishUsage {
  inputTokens: number;
  outputTokens: number;
}

interface ResolvePolishUsageInput {
  reportedUsage?: ReportedPolishUsage;
  requestBodyBytes: number;
  inputOverheadTokens: number;
  outputTokenCeiling: number;
  attemptOutcome: PolishAttemptOutcome;
  failureKind: PolishUsageFailureKind;
  potentiallyBillable: boolean;
}

function nonNegativeSafeInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
  return value;
}

function safeAdd(name: string, left: number, right: number): number {
  const total = BigInt(left) + BigInt(right);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${name} exceeds the maximum safe integer.`);
  }
  return Number(total);
}

/**
 * Resolves the token counts used only for commercial provider-cost reporting.
 * A dispatched request without trustworthy provider usage is represented by a
 * deliberately high safety estimate: UTF-8 request bytes plus a configured
 * framing allowance for input, and the configured generation ceiling for
 * output. Customer allowance settlement remains independent of these values.
 */
export function resolveCommercialPolishUsage(
  input: ResolvePolishUsageInput,
): CommercialPolishUsage {
  const requestBodyBytes = nonNegativeSafeInteger("requestBodyBytes", input.requestBodyBytes);
  const inputOverheadTokens = nonNegativeSafeInteger(
    "inputOverheadTokens",
    input.inputOverheadTokens,
  );
  const outputTokenCeiling = nonNegativeSafeInteger("outputTokenCeiling", input.outputTokenCeiling);

  const estimationBase = {
    version: POLISH_USAGE_ESTIMATION_VERSION,
    attemptOutcome: input.attemptOutcome,
    failureKind: input.failureKind,
    requestBodyBytes,
    inputOverheadTokens,
    outputTokenCeiling,
  } as const;

  if (input.reportedUsage) {
    return {
      inputTokens: nonNegativeSafeInteger(
        "reportedUsage.inputTokens",
        input.reportedUsage.inputTokens,
      ),
      outputTokens: nonNegativeSafeInteger(
        "reportedUsage.outputTokens",
        input.reportedUsage.outputTokens,
      ),
      estimation: { method: "provider_reported", ...estimationBase },
    };
  }

  if (!input.potentiallyBillable) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      estimation: { method: "not_potentially_billable", ...estimationBase },
    };
  }

  return {
    inputTokens: safeAdd("estimated polish input tokens", requestBodyBytes, inputOverheadTokens),
    outputTokens: outputTokenCeiling,
    estimation: { method: "request_safety_estimate", ...estimationBase },
  };
}
