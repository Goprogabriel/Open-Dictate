import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SetupStep } from "@/features/onboarding/SetupStep";
import { changeLocale } from "@/locales";
import type { AuthSession } from "@/services/contracts";
import { setCurrentAuthSession } from "@/services/firebase/sessionRuntime";
import { useSessionStore } from "@/stores/sessionStore";
import type { Subscription } from "@/types/domain";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  getSubscription: vi.fn(),
  sendVerificationEmail: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  env: { enablePreviewData: false, apiBaseUrl: "https://api.example.com" },
}));

vi.mock("@/services/api/billingService", () => ({
  ApiBillingService: vi.fn(function ApiBillingService() {
    return {
      getSubscription: mocks.getSubscription,
    };
  }),
}));

vi.mock("@/services/firebase/authService", () => ({
  authService: {
    signIn: mocks.signIn,
    signUp: mocks.signUp,
    sendVerificationEmail: mocks.sendVerificationEmail,
  },
}));

const activeSubscription: Subscription = {
  plan: "pro",
  status: "active",
  currentPeriodEnd: "2026-08-24T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  remainingTokens: 3_000_000,
  allowanceTokens: 3_500_000,
  subscriptionTokens: 3_000_000,
  purchasedTokens: 0,
  subscriptionTokensExpireAt: "2026-08-24T00:00:00.000Z",
  topupOptions: [],
};

const inactiveSubscription: Subscription = {
  plan: "free",
  status: "none",
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  remainingTokens: null,
  allowanceTokens: null,
  subscriptionTokens: 0,
  purchasedTokens: 0,
  subscriptionTokensExpireAt: null,
  topupOptions: [],
};

function session(): AuthSession {
  const authSession: AuthSession = {
    user: {
      id: "user-1",
      name: "Alex",
      email: "alex@example.com",
      emailVerified: true,
      mode: "pro",
      language: "en",
      createdAt: "2026-07-24T00:00:00.000Z",
    },
    emailVerified: true,
    getIdToken: vi.fn(() => Promise.resolve("firebase-token")),
    refresh: vi.fn(() => Promise.resolve(authSession)),
  };
  return authSession;
}

describe("SetupStep Pro login", () => {
  beforeEach(async () => {
    await changeLocale("en");
    setCurrentAuthSession(null);
    useSessionStore.getState().signOut();
    mocks.signIn.mockReset();
    mocks.signUp.mockReset();
    mocks.getSubscription.mockReset();
  });

  it("skips checkout when the signed-in account already has an active subscription", async () => {
    mocks.signIn.mockResolvedValue(session());
    mocks.getSubscription.mockResolvedValue(activeSubscription);
    const onContinue = vi.fn();

    render(<SetupStep mode="pro" onBack={vi.fn()} onContinue={onContinue} />);

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "alex@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in and continue" }));

    await waitFor(() => {
      expect(onContinue).toHaveBeenCalledWith({ subscriptionActive: true });
    });
    expect(useSessionStore.getState().subscription).toEqual(activeSubscription);
  });

  it("continues to checkout when the signed-in account is not subscribed", async () => {
    mocks.signIn.mockResolvedValue(session());
    mocks.getSubscription.mockResolvedValue(inactiveSubscription);
    const onContinue = vi.fn();

    render(<SetupStep mode="pro" onBack={vi.fn()} onContinue={onContinue} />);

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "alex@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in and continue" }));

    await waitFor(() => {
      expect(onContinue).toHaveBeenCalledWith({ subscriptionActive: false });
    });
    expect(useSessionStore.getState().subscription).toEqual(inactiveSubscription);
  });
});
