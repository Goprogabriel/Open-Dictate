import type { PolishUsageEstimation } from "./polish-usage.js";

const BASIS_POINTS_DENOMINATOR = 10_000;
const MILLISECONDS_PER_MINUTE = 60_000;
const TOKENS_PER_MILLION = 1_000_000;

export interface CommercialCostPricing {
  scheduleVersion: string;
  platformMarginBps: number;
  transcribeMicrousdPerMinute: number;
  polishInputMicrousdPerMillionTokens: number;
  polishOutputMicrousdPerMillionTokens: number;
}

export interface CommercialCostUsage {
  durationMs: number;
  transcriptionTokens: number;
  polishInputTokens: number;
  polishOutputTokens: number;
}

export interface CommercialCostBreakdown {
  basis: "estimated_provider_usage";
  currency: "USD";
  unit: "microusd";
  scheduleVersion: string;
  platformMarginBps: number;
  usage: CommercialCostUsage;
  usageEstimation: {
    polish: PolishUsageEstimation;
  };
  rates: {
    transcribeMicrousdPerMinute: number;
    polishInputMicrousdPerMillionTokens: number;
    polishOutputMicrousdPerMillionTokens: number;
  };
  components: {
    transcriptionMicrousd: number;
    polishInputMicrousd: number;
    polishOutputMicrousd: number;
  };
  estimatedProviderCostMicrousd: number;
  estimatedPlatformFeeMicrousd: number;
  estimatedChargedCostMicrousd: number;
}

function safeNonNegativeInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer.`);
  }
  return value;
}

function safePositiveInteger(name: string, value: number): number {
  safeNonNegativeInteger(name, value);
  if (value === 0) throw new RangeError(`${name} must be greater than zero.`);
  return value;
}

function safeNumber(name: string, value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${name} exceeds the maximum safe integer.`);
  }
  return Number(value);
}

function ceilMultiplyDivide(
  name: string,
  value: number,
  multiplier: number,
  divisor: number,
): number {
  safeNonNegativeInteger(name, value);
  safeNonNegativeInteger(`${name} multiplier`, multiplier);
  safePositiveInteger(`${name} divisor`, divisor);

  const numerator = BigInt(value) * BigInt(multiplier);
  if (numerator === 0n) return 0;
  return safeNumber(name, (numerator + BigInt(divisor) - 1n) / BigInt(divisor));
}

function safeSum(name: string, values: number[]): number {
  return safeNumber(
    name,
    values.reduce((total, value) => total + BigInt(value), 0n),
  );
}

/**
 * Estimates provider spend from measured usage and calculates the customer-side
 * cost required to preserve the configured gross margin. This accounting data
 * is intentionally independent from the authoritative credit ledger.
 */
export function calculateCommercialCost(
  usage: CommercialCostUsage,
  pricing: CommercialCostPricing,
  polishUsageEstimation: PolishUsageEstimation,
): CommercialCostBreakdown {
  const scheduleVersion = pricing.scheduleVersion.trim();
  if (!scheduleVersion) throw new RangeError("scheduleVersion must not be empty.");

  safeNonNegativeInteger("durationMs", usage.durationMs);
  safeNonNegativeInteger("transcriptionTokens", usage.transcriptionTokens);
  safeNonNegativeInteger("polishInputTokens", usage.polishInputTokens);
  safeNonNegativeInteger("polishOutputTokens", usage.polishOutputTokens);
  safePositiveInteger("transcribeMicrousdPerMinute", pricing.transcribeMicrousdPerMinute);
  safePositiveInteger(
    "polishInputMicrousdPerMillionTokens",
    pricing.polishInputMicrousdPerMillionTokens,
  );
  safePositiveInteger(
    "polishOutputMicrousdPerMillionTokens",
    pricing.polishOutputMicrousdPerMillionTokens,
  );
  safeNonNegativeInteger("platformMarginBps", pricing.platformMarginBps);
  if (pricing.platformMarginBps >= BASIS_POINTS_DENOMINATOR) {
    throw new RangeError("platformMarginBps must be less than 10,000.");
  }

  const transcriptionMicrousd = ceilMultiplyDivide(
    "transcriptionMicrousd",
    usage.durationMs,
    pricing.transcribeMicrousdPerMinute,
    MILLISECONDS_PER_MINUTE,
  );
  const polishInputMicrousd = ceilMultiplyDivide(
    "polishInputMicrousd",
    usage.polishInputTokens,
    pricing.polishInputMicrousdPerMillionTokens,
    TOKENS_PER_MILLION,
  );
  const polishOutputMicrousd = ceilMultiplyDivide(
    "polishOutputMicrousd",
    usage.polishOutputTokens,
    pricing.polishOutputMicrousdPerMillionTokens,
    TOKENS_PER_MILLION,
  );
  const estimatedProviderCostMicrousd = safeSum("estimatedProviderCostMicrousd", [
    transcriptionMicrousd,
    polishInputMicrousd,
    polishOutputMicrousd,
  ]);
  const estimatedChargedCostMicrousd = ceilMultiplyDivide(
    "estimatedChargedCostMicrousd",
    estimatedProviderCostMicrousd,
    BASIS_POINTS_DENOMINATOR,
    BASIS_POINTS_DENOMINATOR - pricing.platformMarginBps,
  );
  const estimatedPlatformFeeMicrousd = estimatedChargedCostMicrousd - estimatedProviderCostMicrousd;

  return {
    basis: "estimated_provider_usage",
    currency: "USD",
    unit: "microusd",
    scheduleVersion,
    platformMarginBps: pricing.platformMarginBps,
    usage: { ...usage },
    usageEstimation: { polish: { ...polishUsageEstimation } },
    rates: {
      transcribeMicrousdPerMinute: pricing.transcribeMicrousdPerMinute,
      polishInputMicrousdPerMillionTokens: pricing.polishInputMicrousdPerMillionTokens,
      polishOutputMicrousdPerMillionTokens: pricing.polishOutputMicrousdPerMillionTokens,
    },
    components: {
      transcriptionMicrousd,
      polishInputMicrousd,
      polishOutputMicrousd,
    },
    estimatedProviderCostMicrousd,
    estimatedPlatformFeeMicrousd,
    estimatedChargedCostMicrousd,
  };
}
