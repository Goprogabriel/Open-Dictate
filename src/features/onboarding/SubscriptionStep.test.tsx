import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SubscriptionStep } from "@/features/onboarding/SubscriptionStep";
import { changeLocale } from "@/locales";
import { ApiError } from "@/services/api/httpClient";
import type { AuthSession, BillingService } from "@/services/contracts";
import { setCurrentAuthSession } from "@/services/firebase/sessionRuntime";
import { useSessionStore } from "@/stores/sessionStore";
import type { Subscription } from "@/types/domain";

const activeSubscription: Subscription = {
  plan: "pro",
  status: "active",
  currentPeriodEnd: "2026-08-24T00:00:00.000Z",
  cancelAtPeriodEnd: false,
  remainingTokens: 3_000_000,
  allowanceTokens: 3_500_000,
  subscriptionTokens: 2_900_000,
  purchasedTokens: 100_000,
  subscriptionTokensExpireAt: "2026-08-24T00:00:00.000Z",
  topupOptions: [
    { tier: "usd_5", amountMinor: 500, currency: "usd", credits: 3_062_500 },
    { tier: "usd_10", amountMinor: 1_000, currency: "usd", credits: 6_562_500 },
    { tier: "usd_20", amountMinor: 2_000, currency: "usd", credits: 14_000_000 },
  ],
};

function createSession(initiallyVerified: boolean, verifiedAfterRefresh: boolean) {
  const refresh = vi.fn<() => Promise<AuthSession>>();
  const session: AuthSession = {
    user: {
      id: "user-1",
      name: "Alex",
      email: "alex@example.com",
      mode: "pro",
      language: "en",
      createdAt: "2026-07-24T00:00:00.000Z",
    },
    emailVerified: initiallyVerified,
    getIdToken: vi.fn(() => Promise.resolve("firebase-token")),
    refresh,
  };
  const refreshedSession = { ...session, emailVerified: verifiedAfterRefresh };
  refresh.mockResolvedValue(refreshedSession);
  return { session, refresh };
}

function createBillingService(subscription = activeSubscription) {
  return {
    createCheckoutSession: vi.fn(() => Promise.resolve("https://checkout.stripe.com/session")),
    getSubscription: vi.fn(() => Promise.resolve(subscription)),
  } satisfies Pick<BillingService, "createCheckoutSession" | "getSubscription">;
}

describe("SubscriptionStep", () => {
  beforeEach(async () => {
    await changeLocale("en");
    useSessionStore.getState().configureProUser("Alex", "alex@example.com", "user-1");
  });

  afterEach(() => {
    setCurrentAuthSession(null);
    act(() => useSessionStore.getState().configureLocalUser());
  });

  it("requires refreshed email verification before opening checkout", async () => {
    const { session, refresh } = createSession(false, true);
    setCurrentAuthSession(session);
    const billingService = createBillingService();
    const openCheckout = vi.fn(() => Promise.resolve());
    const onContinue = vi.fn();

    render(
      <SubscriptionStep
        previewMode={false}
        billingService={billingService}
        openCheckout={openCheckout}
        onBack={vi.fn()}
        onContinue={onContinue}
      />,
    );

    expect(screen.getByText(/verification link to alex@example.com/u)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Continue to secure checkout" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "I've verified my email" }));
      await Promise.resolve();
    });
    expect(
      await screen.findByRole("button", { name: "Continue to secure checkout" }),
    ).toBeEnabled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue to secure checkout" }));
      await Promise.resolve();
    });
    expect(await screen.findByText("Checkout opened in your browser")).toBeVisible();
    expect(billingService.createCheckoutSession).toHaveBeenCalledOnce();
    expect(openCheckout).toHaveBeenCalledWith("https://checkout.stripe.com/session");
    expect(screen.queryByRole("button", { name: "Copy payment link" })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "I've completed checkout" }));
      await Promise.resolve();
    });
    expect(await screen.findByText("Your Pro subscription is active")).toBeVisible();
    expect(billingService.getSubscription).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(useSessionStore.getState().subscription).toEqual(activeSubscription);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it("keeps checkout locked when Firebase still reports an unverified email", async () => {
    const { session } = createSession(false, false);
    setCurrentAuthSession(session);
    const billingService = createBillingService();

    render(
      <SubscriptionStep
        previewMode={false}
        billingService={billingService}
        openCheckout={vi.fn(() => Promise.resolve())}
        onBack={vi.fn()}
        onContinue={vi.fn()}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "I've verified my email" }));
      await Promise.resolve();
    });

    expect(await screen.findByText(/email is not verified yet/u)).toHaveAttribute("role", "alert");
    expect(billingService.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("reports checkout creation failures without leaving the payment-opening state", async () => {
    const { session } = createSession(true, true);
    setCurrentAuthSession(session);
    const billingService = {
      createCheckoutSession: vi.fn(() =>
        Promise.reject(new ApiError(503, "billing_unavailable", "Billing unavailable")),
      ),
      getSubscription: vi.fn(() => Promise.resolve(activeSubscription)),
    } satisfies Pick<BillingService, "createCheckoutSession" | "getSubscription">;
    const openCheckout = vi.fn(() => Promise.resolve());

    render(
      <SubscriptionStep
        previewMode={false}
        billingService={billingService}
        openCheckout={openCheckout}
        onBack={vi.fn()}
        onContinue={vi.fn()}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue to secure checkout" }));
      await Promise.resolve();
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't prepare secure checkout.",
    );
    expect(screen.getByRole("button", { name: "Continue to secure checkout" })).toBeEnabled();
    expect(openCheckout).not.toHaveBeenCalled();
  });

  it("keeps a created checkout session available when the browser cannot be opened", async () => {
    const { session } = createSession(true, true);
    setCurrentAuthSession(session);
    const billingService = createBillingService();
    const openCheckout = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("external_window_blocked"))
      .mockResolvedValueOnce();

    render(
      <SubscriptionStep
        previewMode={false}
        billingService={billingService}
        openCheckout={openCheckout}
        onBack={vi.fn()}
        onContinue={vi.fn()}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue to secure checkout" }));
      await Promise.resolve();
    });

    expect(await screen.findByText("Pay in your browser")).toBeVisible();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't open the payment page automatically.",
    );
    expect(screen.getByRole("button", { name: "Copy payment link" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Try opening again" })).toBeEnabled();
    expect(billingService.createCheckoutSession).toHaveBeenCalledOnce();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try opening again" }));
      await Promise.resolve();
    });

    expect(await screen.findByText("Checkout opened in your browser")).toBeVisible();
    expect(openCheckout).toHaveBeenLastCalledWith("https://checkout.stripe.com/session");
    expect(billingService.createCheckoutSession).toHaveBeenCalledOnce();
  });

  it("simulates activation without network or browser calls in preview mode", async () => {
    setCurrentAuthSession(null);
    const billingService = createBillingService();
    const openCheckout = vi.fn(() => Promise.resolve());
    const onContinue = vi.fn();

    render(
      <SubscriptionStep
        previewMode
        billingService={billingService}
        openCheckout={openCheckout}
        onBack={vi.fn()}
        onContinue={onContinue}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue to secure checkout" }));
      await Promise.resolve();
    });

    expect(await screen.findByText("Your Pro subscription is active")).toBeVisible();
    expect(billingService.createCheckoutSession).not.toHaveBeenCalled();
    expect(openCheckout).not.toHaveBeenCalled();
    expect(useSessionStore.getState().subscription).toMatchObject({
      plan: "pro",
      status: "active",
    });

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(onContinue).toHaveBeenCalledOnce());
  });
});
