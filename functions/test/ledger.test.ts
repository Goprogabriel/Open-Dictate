import { describe, expect, it } from "vitest";

import {
  calculateActualCredits,
  captureTransition,
  createCreditBalance,
  estimateReservation,
  grantTransition,
  releaseTransition,
  reserveTransition,
} from "../src/ledger/transitions.js";

const initial = createCreditBalance({
  subscriptionCredits: 6_000,
  purchasedCredits: 4_000,
  reservedSubscriptionCredits: 0,
  reservedPurchasedCredits: 0,
  consumedSubscriptionCredits: 0,
  consumedPurchasedCredits: 0,
});

describe("credit transitions", () => {
  it("reserves, captures, and releases unused credits without losing value", () => {
    const reserved = reserveTransition(initial, 4_000);
    expect(reserved.reservation).toEqual({ subscriptionCredits: 4_000, purchasedCredits: 0 });

    const captured = captureTransition(reserved.balance, reserved.reservation, 2_500, true);
    expect(captured.balance.availableCredits).toBe(7_500);
    expect(captured.balance.subscriptionCredits).toBe(3_500);
    expect(captured.balance.purchasedCredits).toBe(4_000);
    expect(captured.availableDelta).toBe(1_500);
  });

  it("can record conservative-reservation overage as account debt", () => {
    const reserved = reserveTransition(initial, 4_000);
    const captured = captureTransition(reserved.balance, reserved.reservation, 12_000, true);
    expect(captured.balance.availableCredits).toBe(-2_000);
    expect(captured.consumed).toEqual({
      subscriptionCredits: 4_000,
      purchasedCredits: 8_000,
    });
  });

  it("returns a failed reservation completely", () => {
    const reserved = reserveTransition(initial, 3_000);
    expect(releaseTransition(reserved.balance, reserved.reservation, true).balance).toEqual(
      initial,
    );
  });

  it("grants credits without changing consumption", () => {
    const granted = grantTransition(initial, 5_000).balance;
    expect(granted.availableCredits).toBe(15_000);
    expect(granted.subscriptionCredits).toBe(6_000);
    expect(granted.purchasedCredits).toBe(9_000);
  });

  it("rejects insufficient balance and invalid integer inputs", () => {
    expect(() => reserveTransition(initial, 20_000)).toThrow("insufficient_credits");
    expect(() => reserveTransition(initial, 1.5)).toThrow(RangeError);
    expect(() =>
      captureTransition(initial, { subscriptionCredits: 1, purchasedCredits: 0 }, -1, true),
    ).toThrow(RangeError);
  });
});

describe("usage pricing", () => {
  const rates = {
    reserveCreditsPerMib: 8_000,
    transcribeCreditsPerSecond: 60,
    transcribeCreditsPerProviderToken: 1,
    minimumRequestReserveCredits: 3_000,
    maximumPolishReserveCredits: 15_000,
    polishInputCreditsPerMillion: 1_000_000,
    polishOutputCreditsPerMillion: 6_000_000,
  };

  it("reserves the most conservative configured estimate", () => {
    expect(estimateReservation(1024 * 1024, 60_000, rates)).toBe(18_600);
  });

  it("prices audio and text usage with integer ceiling", () => {
    expect(calculateActualCredits(60_000, 5_000, 1_001, 501, rates)).toBe(9_007);
  });
});
