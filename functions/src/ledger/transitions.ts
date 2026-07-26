export interface CreditBalance {
  subscriptionCredits: number;
  purchasedCredits: number;
  reservedSubscriptionCredits: number;
  reservedPurchasedCredits: number;
  consumedSubscriptionCredits: number;
  consumedPurchasedCredits: number;
  availableCredits: number;
  reservedCredits: number;
  consumedCredits: number;
}

export interface CreditAllocation {
  subscriptionCredits: number;
  purchasedCredits: number;
}

export interface CreditTransition {
  balance: CreditBalance;
  availableDelta: number;
  reservedDelta: number;
  consumedDelta: number;
  subscriptionAvailableDelta: number;
  purchasedAvailableDelta: number;
  subscriptionReservedDelta: number;
  purchasedReservedDelta: number;
  subscriptionConsumedDelta: number;
  purchasedConsumedDelta: number;
  reservation: CreditAllocation;
  consumed: CreditAllocation;
  restored: CreditAllocation;
  expired: CreditAllocation;
}

function safeInteger(name: string, value: number, allowNegative = false): number {
  if (!Number.isSafeInteger(value) || (!allowNegative && value < 0)) {
    throw new RangeError(`${name} must be a safe integer${allowNegative ? "" : " at least zero"}.`);
  }
  return value;
}

export function validateBalance(balance: CreditBalance): CreditBalance {
  safeInteger("subscriptionCredits", balance.subscriptionCredits);
  safeInteger("purchasedCredits", balance.purchasedCredits, true);
  safeInteger("reservedSubscriptionCredits", balance.reservedSubscriptionCredits);
  safeInteger("reservedPurchasedCredits", balance.reservedPurchasedCredits);
  safeInteger("consumedSubscriptionCredits", balance.consumedSubscriptionCredits);
  safeInteger("consumedPurchasedCredits", balance.consumedPurchasedCredits);
  safeInteger("availableCredits", balance.availableCredits, true);
  safeInteger("reservedCredits", balance.reservedCredits);
  safeInteger("consumedCredits", balance.consumedCredits);
  if (balance.availableCredits !== balance.subscriptionCredits + balance.purchasedCredits) {
    throw new RangeError("availableCredits does not equal its pool balances.");
  }
  if (
    balance.reservedCredits !==
    balance.reservedSubscriptionCredits + balance.reservedPurchasedCredits
  ) {
    throw new RangeError("reservedCredits does not equal its pool balances.");
  }
  if (
    balance.consumedCredits !==
    balance.consumedSubscriptionCredits + balance.consumedPurchasedCredits
  ) {
    throw new RangeError("consumedCredits does not equal its pool balances.");
  }
  return balance;
}

export function createCreditBalance(values: {
  subscriptionCredits: number;
  purchasedCredits: number;
  reservedSubscriptionCredits: number;
  reservedPurchasedCredits: number;
  consumedSubscriptionCredits: number;
  consumedPurchasedCredits: number;
}): CreditBalance {
  const balance: CreditBalance = {
    ...values,
    availableCredits: values.subscriptionCredits + values.purchasedCredits,
    reservedCredits: values.reservedSubscriptionCredits + values.reservedPurchasedCredits,
    consumedCredits: values.consumedSubscriptionCredits + values.consumedPurchasedCredits,
  };
  return validateBalance(balance);
}

const zeroAllocation = (): CreditAllocation => ({ subscriptionCredits: 0, purchasedCredits: 0 });

function transition(
  before: CreditBalance,
  balance: CreditBalance,
  values: {
    reservation?: CreditAllocation;
    consumed?: CreditAllocation;
    restored?: CreditAllocation;
    expired?: CreditAllocation;
  } = {},
): CreditTransition {
  return {
    balance,
    availableDelta: balance.availableCredits - before.availableCredits,
    reservedDelta: balance.reservedCredits - before.reservedCredits,
    consumedDelta: balance.consumedCredits - before.consumedCredits,
    subscriptionAvailableDelta: balance.subscriptionCredits - before.subscriptionCredits,
    purchasedAvailableDelta: balance.purchasedCredits - before.purchasedCredits,
    subscriptionReservedDelta:
      balance.reservedSubscriptionCredits - before.reservedSubscriptionCredits,
    purchasedReservedDelta: balance.reservedPurchasedCredits - before.reservedPurchasedCredits,
    subscriptionConsumedDelta:
      balance.consumedSubscriptionCredits - before.consumedSubscriptionCredits,
    purchasedConsumedDelta: balance.consumedPurchasedCredits - before.consumedPurchasedCredits,
    reservation: values.reservation ?? zeroAllocation(),
    consumed: values.consumed ?? zeroAllocation(),
    restored: values.restored ?? zeroAllocation(),
    expired: values.expired ?? zeroAllocation(),
  };
}

export function reserveTransition(balance: CreditBalance, amount: number): CreditTransition {
  validateBalance(balance);
  safeInteger("amount", amount);
  if (amount <= 0) throw new RangeError("amount must be greater than zero.");
  if (balance.availableCredits < amount) throw new RangeError("insufficient_credits");

  // An outstanding purchased-credit debt reduces the amount of subscription
  // credit that can be reserved. Within the spendable total, subscription
  // credits are always allocated before the purchased pool.
  const spendableSubscriptionCredits = Math.max(
    0,
    Math.min(balance.subscriptionCredits, balance.availableCredits),
  );
  const subscriptionCredits = Math.min(spendableSubscriptionCredits, amount);
  const purchasedCredits = amount - subscriptionCredits;
  const reservation = { subscriptionCredits, purchasedCredits };
  const next = createCreditBalance({
    subscriptionCredits: balance.subscriptionCredits - subscriptionCredits,
    purchasedCredits: balance.purchasedCredits - purchasedCredits,
    reservedSubscriptionCredits: balance.reservedSubscriptionCredits + subscriptionCredits,
    reservedPurchasedCredits: balance.reservedPurchasedCredits + purchasedCredits,
    consumedSubscriptionCredits: balance.consumedSubscriptionCredits,
    consumedPurchasedCredits: balance.consumedPurchasedCredits,
  });
  return transition(balance, next, { reservation });
}

export function captureTransition(
  balance: CreditBalance,
  reservation: CreditAllocation,
  actualAmount: number,
  restoreSubscriptionCredits: boolean,
): CreditTransition {
  validateBalance(balance);
  safeInteger("reserved subscription credits", reservation.subscriptionCredits);
  safeInteger("reserved purchased credits", reservation.purchasedCredits);
  safeInteger("actualAmount", actualAmount);
  const reservedAmount = reservation.subscriptionCredits + reservation.purchasedCredits;
  if (reservedAmount <= 0) throw new RangeError("reservedAmount must be greater than zero.");
  if (
    balance.reservedSubscriptionCredits < reservation.subscriptionCredits ||
    balance.reservedPurchasedCredits < reservation.purchasedCredits
  ) {
    throw new RangeError("reservation_underflow");
  }

  const consumedSubscriptionCredits = Math.min(actualAmount, reservation.subscriptionCredits);
  const afterSubscription = actualAmount - consumedSubscriptionCredits;
  const reservedPurchasedConsumed = Math.min(afterSubscription, reservation.purchasedCredits);
  const purchasedOverage = afterSubscription - reservedPurchasedConsumed;
  const consumedPurchasedCredits = reservedPurchasedConsumed + purchasedOverage;
  const unusedSubscriptionCredits = reservation.subscriptionCredits - consumedSubscriptionCredits;
  const restoredSubscriptionCredits = restoreSubscriptionCredits ? unusedSubscriptionCredits : 0;
  const expiredSubscriptionCredits = unusedSubscriptionCredits - restoredSubscriptionCredits;
  const restoredPurchasedCredits = reservation.purchasedCredits - reservedPurchasedConsumed;
  const consumed = {
    subscriptionCredits: consumedSubscriptionCredits,
    purchasedCredits: consumedPurchasedCredits,
  };
  const restored = {
    subscriptionCredits: restoredSubscriptionCredits,
    purchasedCredits: restoredPurchasedCredits,
  };
  const expired = { subscriptionCredits: expiredSubscriptionCredits, purchasedCredits: 0 };
  const next = createCreditBalance({
    subscriptionCredits: balance.subscriptionCredits + restoredSubscriptionCredits,
    purchasedCredits: balance.purchasedCredits + restoredPurchasedCredits - purchasedOverage,
    reservedSubscriptionCredits:
      balance.reservedSubscriptionCredits - reservation.subscriptionCredits,
    reservedPurchasedCredits: balance.reservedPurchasedCredits - reservation.purchasedCredits,
    consumedSubscriptionCredits: balance.consumedSubscriptionCredits + consumedSubscriptionCredits,
    consumedPurchasedCredits: balance.consumedPurchasedCredits + consumedPurchasedCredits,
  });
  return transition(balance, next, { reservation, consumed, restored, expired });
}

export function releaseTransition(
  balance: CreditBalance,
  reservation: CreditAllocation,
  restoreSubscriptionCredits: boolean,
): CreditTransition {
  validateBalance(balance);
  safeInteger("reserved subscription credits", reservation.subscriptionCredits);
  safeInteger("reserved purchased credits", reservation.purchasedCredits);
  const reservedAmount = reservation.subscriptionCredits + reservation.purchasedCredits;
  if (reservedAmount <= 0) throw new RangeError("reservedAmount must be greater than zero.");
  if (
    balance.reservedSubscriptionCredits < reservation.subscriptionCredits ||
    balance.reservedPurchasedCredits < reservation.purchasedCredits
  ) {
    throw new RangeError("reservation_underflow");
  }

  const restored = {
    subscriptionCredits: restoreSubscriptionCredits ? reservation.subscriptionCredits : 0,
    purchasedCredits: reservation.purchasedCredits,
  };
  const expired = {
    subscriptionCredits: reservation.subscriptionCredits - restored.subscriptionCredits,
    purchasedCredits: 0,
  };
  const next = createCreditBalance({
    subscriptionCredits: balance.subscriptionCredits + restored.subscriptionCredits,
    purchasedCredits: balance.purchasedCredits + restored.purchasedCredits,
    reservedSubscriptionCredits:
      balance.reservedSubscriptionCredits - reservation.subscriptionCredits,
    reservedPurchasedCredits: balance.reservedPurchasedCredits - reservation.purchasedCredits,
    consumedSubscriptionCredits: balance.consumedSubscriptionCredits,
    consumedPurchasedCredits: balance.consumedPurchasedCredits,
  });
  return transition(balance, next, { reservation, restored, expired });
}

export function grantTransition(balance: CreditBalance, amount: number): CreditTransition {
  validateBalance(balance);
  safeInteger("amount", amount);
  if (amount <= 0) throw new RangeError("amount must be greater than zero.");

  const next = createCreditBalance({
    subscriptionCredits: balance.subscriptionCredits,
    purchasedCredits: balance.purchasedCredits + amount,
    reservedSubscriptionCredits: balance.reservedSubscriptionCredits,
    reservedPurchasedCredits: balance.reservedPurchasedCredits,
    consumedSubscriptionCredits: balance.consumedSubscriptionCredits,
    consumedPurchasedCredits: balance.consumedPurchasedCredits,
  });
  return transition(balance, next);
}

export function resetSubscriptionTransition(
  balance: CreditBalance,
  amount: number,
): CreditTransition {
  validateBalance(balance);
  safeInteger("amount", amount);
  if (amount <= 0) throw new RangeError("amount must be greater than zero.");

  const expired = { subscriptionCredits: balance.subscriptionCredits, purchasedCredits: 0 };
  const next = createCreditBalance({
    subscriptionCredits: amount,
    purchasedCredits: balance.purchasedCredits,
    reservedSubscriptionCredits: balance.reservedSubscriptionCredits,
    reservedPurchasedCredits: balance.reservedPurchasedCredits,
    consumedSubscriptionCredits: balance.consumedSubscriptionCredits,
    consumedPurchasedCredits: balance.consumedPurchasedCredits,
  });
  return transition(balance, next, { expired });
}

export function estimateReservation(
  audioBytes: number,
  durationMs: number,
  rates: {
    reserveCreditsPerMib: number;
    transcribeCreditsPerSecond: number;
    minimumRequestReserveCredits: number;
    maximumPolishReserveCredits: number;
  },
): number {
  safeInteger("audioBytes", audioBytes);
  safeInteger("durationMs", durationMs);

  const bytesEstimate = Math.ceil((audioBytes / (1024 * 1024)) * rates.reserveCreditsPerMib);
  const durationEstimate =
    Math.ceil(durationMs / 1_000) * rates.transcribeCreditsPerSecond +
    rates.maximumPolishReserveCredits;

  return Math.max(rates.minimumRequestReserveCredits, bytesEstimate, durationEstimate);
}

export function calculateActualCredits(
  durationMs: number,
  transcriptionTokens: number,
  polishInputTokens: number,
  polishOutputTokens: number,
  rates: {
    transcribeCreditsPerSecond: number;
    transcribeCreditsPerProviderToken: number;
    polishInputCreditsPerMillion: number;
    polishOutputCreditsPerMillion: number;
  },
): number {
  safeInteger("durationMs", durationMs);
  safeInteger("transcriptionTokens", transcriptionTokens);
  safeInteger("polishInputTokens", polishInputTokens);
  safeInteger("polishOutputTokens", polishOutputTokens);

  const transcription = Math.max(
    Math.ceil(durationMs / 1_000) * rates.transcribeCreditsPerSecond,
    transcriptionTokens * rates.transcribeCreditsPerProviderToken,
  );
  const polishInput = Math.ceil(
    (polishInputTokens * rates.polishInputCreditsPerMillion) / 1_000_000,
  );
  const polishOutput = Math.ceil(
    (polishOutputTokens * rates.polishOutputCreditsPerMillion) / 1_000_000,
  );

  return Math.max(1, transcription + polishInput + polishOutput);
}
