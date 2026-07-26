import { ApiBillingService } from "@/services/api/billingService";
import type { AuthSession } from "@/services/contracts";

vi.mock("@/config/env", () => ({
  env: { apiBaseUrl: "https://api.example.com" },
}));

const getIdToken = vi.fn(() => Promise.resolve("firebase-id-token"));
const session: AuthSession = {
  user: {
    id: "user-1",
    name: "Alex",
    email: "alex@example.com",
    mode: "pro",
    language: "en",
    createdAt: "2026-07-24T00:00:00.000Z",
  },
  emailVerified: true,
  getIdToken,
  refresh: vi.fn(() => Promise.resolve(session)),
};

describe("ApiBillingService authentication", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    getIdToken.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("authorizes checkout and supplies the backend-required idempotency key", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ url: "https://checkout.stripe.com/session" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const service = new ApiBillingService(() => session);

    await expect(service.createCheckoutSession()).resolves.toBe(
      "https://checkout.stripe.com/session",
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(request?.headers);
    expect(url).toBe("https://api.example.com/v1/billing/checkout-session");
    expect(request?.method).toBe("POST");
    expect(headers.get("Authorization")).toBe("Bearer firebase-id-token");
    expect(headers.get("Idempotency-Key")).toMatch(/^checkout_[A-Za-z0-9_-]{16,}$/u);
  });

  it("authorizes entitlement refresh before confirming onboarding", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
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
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const service = new ApiBillingService(() => session);

    await expect(service.getSubscription()).resolves.toMatchObject({
      plan: "pro",
      status: "active",
      remainingTokens: 3_000_000,
    });

    const [, request] = fetchMock.mock.calls[0] ?? [];
    expect(new Headers(request?.headers).get("Authorization")).toBe("Bearer firebase-id-token");
  });

  it("creates an authenticated, idempotent token top-up session", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ url: "https://checkout.stripe.com/topup" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const service = new ApiBillingService(() => session);

    await expect(service.createTopupSession("usd_10")).resolves.toBe(
      "https://checkout.stripe.com/topup",
    );

    const [url, request] = fetchMock.mock.calls[0] ?? [];
    const headers = new Headers(request?.headers);
    expect(url).toBe("https://api.example.com/v1/billing/topup-session");
    expect(request?.method).toBe("POST");
    expect(headers.get("Authorization")).toBe("Bearer firebase-id-token");
    expect(headers.get("Idempotency-Key")).toMatch(/^topup_[A-Za-z0-9_-]{16,}$/u);
    expect(request?.body).toBe(JSON.stringify({ tier: "usd_10" }));
  });
});
