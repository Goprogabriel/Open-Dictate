import {
  ArrowUpRight,
  CalendarClock,
  Check,
  CreditCard,
  Infinity as InfinityIcon,
  KeyRound,
  Mail,
  UserRound,
  WalletCards,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { PageFrame } from "@/components/layout/PageFrame";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Progress } from "@/components/ui/Progress";
import { env } from "@/config/env";
import { ApiBillingService } from "@/services/api/billingService";
import { authService } from "@/services/firebase/authService";
import { getCurrentAuthSession, setCurrentAuthSession } from "@/services/firebase/sessionRuntime";
import { openExternal } from "@/services/openExternal";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { previewInvoices } from "@/test/fixtures";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { BillingInvoice, TopupOption, TopupTierId } from "@/types/domain";
import { formatDateTime, formatShortDate } from "@/utils/date";
import {
  formatCompactNumber,
  formatCurrency,
  formatNumber,
  formatWholeCurrency,
} from "@/utils/format";

function initials(name: string): string {
  return (
    name
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "OD"
  );
}

const topupTiers: TopupTierId[] = ["usd_5", "usd_10", "usd_20"];
const topupFallbackPrices: Record<TopupTierId, number> = {
  usd_5: 500,
  usd_10: 1_000,
  usd_20: 2_000,
};

export function ProfilePage() {
  const { t } = useTranslation();
  const profile = useSessionStore((state) => state.profile);
  const subscription = useSessionStore((state) => state.subscription);
  const setProfile = useSessionStore((state) => state.setProfile);
  const setSubscription = useSessionStore((state) => state.setSubscription);
  const restartOnboarding = useOnboardingStore((state) => state.reset);
  const locale = usePreferencesStore((state) => state.locale);
  const processingMode = usePreferencesStore((state) => state.processingMode);
  const allowance = subscription.allowanceTokens ?? 0;
  const subscriptionTokens = subscription.subscriptionTokens;
  const purchasedTokens = subscription.purchasedTokens;
  const remainingTokens = subscription.remainingTokens ?? subscriptionTokens + purchasedTokens;
  const includedUsed = Math.max(0, allowance - Math.min(allowance, subscriptionTokens));
  const percent = allowance ? Math.min(100, (includedUsed / allowance) * 100) : 0;
  const hasSubscription = processingMode === "pro" && subscription.plan === "pro";
  const hasManagedBalance = processingMode === "pro" && (hasSubscription || purchasedTokens > 0);
  const subscriptionActive = subscription.status === "active" || subscription.status === "trialing";
  const topupOptions = topupTiers.map(
    (tier): TopupOption | (Omit<TopupOption, "credits"> & { credits: null }) =>
      subscription.topupOptions.find((option) => option.tier === tier) ?? {
        tier,
        amountMinor: topupFallbackPrices[tier],
        currency: "usd",
        credits: null,
      },
  );
  const [invoices, setInvoices] = useState<BillingInvoice[]>(
    env.enablePreviewData ? previewInvoices : [],
  );
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingError, setBillingError] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);
  const [selectedTopupTier, setSelectedTopupTier] = useState<TopupTierId>("usd_5");
  const [verificationBusy, setVerificationBusy] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [verificationError, setVerificationError] = useState(false);
  const selectedTopupOption = topupOptions.find((option) => option.tier === selectedTopupTier) ?? {
    tier: selectedTopupTier,
    amountMinor: topupFallbackPrices[selectedTopupTier],
    currency: "usd",
    credits: null,
  };
  const billingService = useMemo(
    () =>
      profile.mode === "pro" && env.apiBaseUrl
        ? new ApiBillingService(getCurrentAuthSession)
        : null,
    [profile.mode],
  );

  useEffect(() => {
    if (!billingService || env.enablePreviewData) return;
    let active = true;
    const refreshBilling = () => {
      void Promise.allSettled([
        billingService.listInvoices(),
        billingService.getSubscription(),
      ]).then(([invoiceResult, subscriptionResult]) => {
        if (!active) return;
        if (invoiceResult.status === "fulfilled") setInvoices(invoiceResult.value);
        if (subscriptionResult.status === "fulfilled") {
          setSubscription(subscriptionResult.value);
        }
        if (invoiceResult.status === "rejected" || subscriptionResult.status === "rejected") {
          setBillingError(true);
        }
      });
    };
    refreshBilling();
    window.addEventListener("focus", refreshBilling);
    return () => {
      active = false;
      window.removeEventListener("focus", refreshBilling);
    };
  }, [billingService, setSubscription]);

  const openBilling = async (kind: "portal" | "topup", tier?: TopupTierId) => {
    if (!billingService) return;
    setBillingBusy(true);
    setBillingError(false);
    try {
      const url =
        kind === "portal"
          ? await billingService.createPortalSession()
          : await billingService.createTopupSession(tier ?? selectedTopupTier);
      await openExternal(url);
      if (kind === "topup") setTopupOpen(false);
    } catch {
      setBillingError(true);
    } finally {
      setBillingBusy(false);
    }
  };

  const openReceipt = async (url: string) => {
    setBillingError(false);
    try {
      await openExternal(url);
    } catch {
      setBillingError(true);
    }
  };

  const sendVerificationEmail = async () => {
    setVerificationBusy(true);
    setVerificationSent(false);
    setVerificationError(false);
    try {
      const session = await authService.sendVerificationEmail();
      setCurrentAuthSession(session);
      setProfile(session.user);
      setVerificationSent(true);
    } catch {
      setVerificationError(true);
    } finally {
      setVerificationBusy(false);
    }
  };

  return (
    <PageFrame>
      <PageHeader title={t("profile.title")} description={t("profile.subtitle")} />

      <div className="grid grid-cols-[minmax(0,1fr)_340px] gap-5 max-[1040px]:grid-cols-1">
        <div className="space-y-5">
          <Card className="p-6" elevated>
            <div className="flex items-center gap-5">
              <div className="flex size-16 shrink-0 items-center justify-center rounded-full bg-ink text-lg font-semibold tracking-[-0.03em] text-inverse">
                {initials(profile.name)}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-xl font-semibold tracking-[-0.025em] text-ink">
                  {profile.name || t("profile.guest.title")}
                </h2>
                <p className="mt-1 flex items-center gap-2 truncate text-sm text-ink-muted">
                  {profile.email ? (
                    <Mail className="size-3.5" />
                  ) : (
                    <UserRound className="size-3.5" />
                  )}
                  {profile.email ??
                    t(processingMode === "local" ? "profile.plan.local" : "profile.plan.free")}
                </p>
              </div>
              {profile.email ? (
                profile.emailVerified ? (
                  <Badge tone="success">
                    <Check className="mr-1 size-3" />
                    {t("profile.identity.emailVerified")}
                  </Badge>
                ) : (
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone="warning">
                      <Mail className="mr-1 size-3" />
                      {t("profile.identity.emailNotVerified")}
                    </Badge>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={verificationBusy}
                      onClick={() => void sendVerificationEmail()}
                    >
                      {t("profile.identity.verifyEmail")}
                    </Button>
                  </div>
                )
              ) : null}
            </div>
            {verificationSent ? (
              <p role="status" className="mt-4 text-xs font-medium text-accent">
                {t("profile.identity.verificationSent")}
              </p>
            ) : null}
            {verificationError ? (
              <p role="alert" className="mt-4 text-xs font-medium text-danger">
                {t("profile.identity.verificationError")}
              </p>
            ) : null}
            <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-line/80 pt-5">
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-[0.11em] text-ink-muted">
                  {t("profile.identity.name")}
                </dt>
                <dd className="mt-1 text-sm text-ink">{profile.name || "—"}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-[0.11em] text-ink-muted">
                  {t("profile.identity.email")}
                </dt>
                <dd className="mt-1 truncate text-sm text-ink">{profile.email ?? "—"}</dd>
              </div>
            </dl>
          </Card>

          <Card className="overflow-hidden bg-raised">
            <div className="flex items-center justify-between border-b border-line/80 px-5 py-4">
              <h2 className="text-sm font-semibold text-ink">{t("profile.billing.history")}</h2>
              {invoices.length ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={billingBusy}
                  onClick={() => void openBilling("portal")}
                >
                  {t("common.actions.viewAll")}
                </Button>
              ) : null}
            </div>
            {invoices.length ? (
              <div>
                {invoices.map((invoice) => (
                  <div
                    key={invoice.id}
                    className="grid grid-cols-[1fr_1fr_90px_74px_70px] items-center gap-3 border-b border-line/70 px-5 py-4 text-xs last:border-b-0"
                  >
                    <span className="text-ink-soft">{formatDateTime(invoice.date, locale)}</span>
                    <span className="font-medium text-ink">{t("profile.plan.pro")}</span>
                    <span className="font-semibold text-ink tabular-nums">
                      {formatCurrency(invoice.amountMinor, invoice.currency, locale)}
                    </span>
                    <Badge
                      tone={
                        invoice.status === "paid"
                          ? "success"
                          : invoice.status === "open"
                            ? "warning"
                            : "danger"
                      }
                      className="justify-center"
                    >
                      {invoice.status === "paid"
                        ? t("profile.billing.paid")
                        : invoice.status === "open"
                          ? t("profile.billing.pending")
                          : t("profile.billing.failed")}
                    </Badge>
                    {invoice.receiptUrl ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t("profile.billing.invoice")}
                        onClick={() => void openReceipt(invoice.receiptUrl!)}
                      >
                        {t("profile.billing.invoice")}
                      </Button>
                    ) : (
                      <span className="text-center text-ink-muted">—</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[150px] items-center justify-center text-sm text-ink-muted">
                {t("profile.billing.empty")}
              </div>
            )}
          </Card>
        </div>

        <Card className="flex min-h-[400px] flex-col overflow-hidden bg-ink p-6 text-inverse shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-inverse/55">
                {t("profile.plan.title")}
              </p>
              <h2 className="mt-2 font-display text-[30px] leading-none">
                {processingMode === "local"
                  ? t("profile.plan.local")
                  : hasSubscription
                    ? t("profile.plan.pro")
                    : hasManagedBalance
                      ? t("profile.plan.balance")
                      : t("profile.plan.free")}
              </h2>
              <p className="mt-3 text-xs leading-5 text-inverse/65">
                {processingMode === "local"
                  ? t("profile.plan.localDescription")
                  : hasSubscription
                    ? t("profile.plan.proDescription")
                    : hasManagedBalance
                      ? t("profile.plan.balanceDescription")
                      : t("profile.plan.freeDescription")}
              </p>
            </div>
            {hasSubscription || hasManagedBalance ? (
              <div className="flex flex-col items-end gap-2">
                {hasSubscription ? (
                  <Badge className="bg-white/10 text-inverse">{t("profile.plan.price")}</Badge>
                ) : null}
                <Badge
                  className="bg-white/10 text-inverse"
                  tone={
                    subscription.status === "past_due"
                      ? "danger"
                      : subscriptionActive
                        ? "success"
                        : "neutral"
                  }
                >
                  {subscription.status === "past_due"
                    ? t("profile.plan.pastDue")
                    : subscription.status === "canceled"
                      ? t("profile.plan.cancelled")
                      : subscriptionActive
                        ? t("common.states.active")
                        : t("profile.plan.inactive")}
                </Badge>
              </div>
            ) : (
              <KeyRound className="size-5 text-inverse/55" />
            )}
          </div>

          {hasManagedBalance ? (
            <div className="mt-8">
              <p className="font-display text-[46px] leading-none tabular-nums">
                {formatCompactNumber(remainingTokens, locale)}
              </p>
              <p className="mt-2 text-xs text-inverse/60">{t("profile.tokens.total")}</p>
              <div className={`mt-5 grid gap-2 ${hasSubscription ? "grid-cols-2" : "grid-cols-1"}`}>
                {hasSubscription ? (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.055] p-3">
                    <CalendarClock className="size-3.5 text-[#9fc2ae]" />
                    <p className="mt-3 text-lg font-semibold tabular-nums">
                      {formatCompactNumber(subscriptionTokens, locale)}
                    </p>
                    <p className="mt-1 text-[10px] leading-4 text-inverse/55">
                      {t("profile.tokens.subscription")}
                    </p>
                  </div>
                ) : null}
                <div className="rounded-2xl border border-white/10 bg-white/[0.055] p-3">
                  <InfinityIcon className="size-3.5 text-[#d8b98a]" />
                  <p className="mt-3 text-lg font-semibold tabular-nums">
                    {formatCompactNumber(purchasedTokens, locale)}
                  </p>
                  <p className="mt-1 text-[10px] leading-4 text-inverse/55">
                    {t("profile.tokens.purchased")}
                  </p>
                </div>
              </div>
              {hasSubscription ? (
                <>
                  <Progress
                    className="mt-4 bg-white/10"
                    indicatorClassName="bg-[#9fc2ae]"
                    value={percent}
                    label={t("profile.tokens.subscription")}
                  />
                  <div className="mt-2 flex justify-between text-[10px] text-inverse/50">
                    <span>
                      {t("profile.tokens.used", { count: formatNumber(includedUsed, locale) })}
                    </span>
                    <span>{formatNumber(allowance, locale)}</span>
                  </div>
                </>
              ) : null}
              <p className="mt-3 flex items-start gap-2 text-[10px] leading-4 text-inverse/50">
                <WalletCards className="mt-0.5 size-3 shrink-0" />
                <span>
                  {hasSubscription ? (
                    <>
                      {t("profile.tokens.subscriptionFirst")}{" "}
                      {subscription.subscriptionTokensExpireAt
                        ? t("profile.tokens.expires", {
                            date: formatShortDate(subscription.subscriptionTokensExpireAt, locale),
                          })
                        : t("profile.tokens.expiresMonthly")}
                    </>
                  ) : (
                    t("profile.tokens.purchasedOnly")
                  )}
                </span>
              </p>
            </div>
          ) : (
            <div className="mt-9 rounded-2xl border border-white/10 bg-white/[0.055] p-4">
              <p className="text-xs leading-5 text-inverse/70">{t("profile.guest.description")}</p>
            </div>
          )}

          <div className="mt-auto space-y-2 pt-8">
            {billingError ? (
              <p className="text-xs text-[#f4b7ad]" role="status" aria-live="polite">
                {t("common.states.error")}
              </p>
            ) : null}
            {profile.mode === "pro" ? (
              <Button
                className="w-full bg-inverse text-ink hover:bg-white"
                disabled={billingBusy}
                onClick={() => void openBilling("portal")}
              >
                <CreditCard className="size-4" />
                {t("profile.billing.manage")}
                <ArrowUpRight className="ml-auto size-3.5" />
              </Button>
            ) : null}
            <Button
              className={
                profile.mode === "pro"
                  ? "w-full border-white/15 bg-white/[0.06] text-inverse hover:bg-white/10"
                  : "w-full bg-inverse text-ink hover:bg-white"
              }
              variant={profile.mode === "pro" ? "secondary" : "primary"}
              onClick={restartOnboarding}
            >
              {t("profile.plan.change")}
              <ArrowUpRight className="ml-auto size-3.5" />
            </Button>
            {subscriptionActive ? (
              <Button
                className="w-full border-white/15 bg-white/[0.06] text-inverse hover:bg-white/10"
                variant="secondary"
                disabled={billingBusy}
                onClick={() => setTopupOpen(true)}
              >
                {t("profile.billing.purchase")}
              </Button>
            ) : null}
          </div>
        </Card>
      </div>

      <Dialog
        open={topupOpen}
        onClose={() => setTopupOpen(false)}
        title={t("profile.topup.title")}
        description={t("profile.topup.description")}
      >
        <div className="grid grid-cols-3 gap-2">
          {topupOptions.map((option) => {
            const selected = selectedTopupTier === option.tier;
            return (
              <button
                key={option.tier}
                type="button"
                aria-pressed={selected}
                className={`rounded-2xl border p-4 text-left transition-colors ${
                  selected
                    ? "border-ink bg-ink text-inverse"
                    : "border-line-strong/80 bg-raised text-ink hover:border-ink/30"
                }`}
                onClick={() => setSelectedTopupTier(option.tier)}
              >
                <span className="block font-display text-[28px] leading-none">
                  {formatWholeCurrency(option.amountMinor, option.currency, locale)}
                </span>
                <span
                  className={`mt-3 block text-[10px] leading-4 ${
                    selected ? "text-inverse/60" : "text-ink-muted"
                  }`}
                >
                  {option.credits === null
                    ? t("profile.topup.tokenPack")
                    : t("profile.topup.tokens", {
                        count: formatNumber(option.credits, locale),
                      })}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-4 rounded-2xl bg-accent-soft/60 p-4">
          <p className="text-xs font-semibold text-accent">{t("profile.topup.neverExpires")}</p>
          <p className="mt-1 text-[11px] leading-5 text-accent/75">
            {t("profile.topup.subscriptionFirst")}
          </p>
        </div>
        {billingError ? (
          <p className="mt-3 text-xs text-danger" role="status" aria-live="polite">
            {t("common.states.error")}
          </p>
        ) : null}
        <Button
          className="mt-5 w-full"
          loading={billingBusy}
          onClick={() => void openBilling("topup", selectedTopupTier)}
        >
          {t("profile.topup.continue", {
            amount: formatWholeCurrency(
              selectedTopupOption.amountMinor,
              selectedTopupOption.currency,
              locale,
            ),
          })}
          <ArrowUpRight className="ml-auto size-3.5" />
        </Button>
      </Dialog>
    </PageFrame>
  );
}
