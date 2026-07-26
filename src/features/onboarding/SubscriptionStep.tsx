import { Check, Copy, CreditCard, MailCheck, Plus, RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { env } from "@/config/env";
import { ApiBillingService } from "@/services/api/billingService";
import { ApiError } from "@/services/api/httpClient";
import type { BillingService } from "@/services/contracts";
import { authService } from "@/services/firebase/authService";
import { getCurrentAuthSession, setCurrentAuthSession } from "@/services/firebase/sessionRuntime";
import { nativeClient } from "@/services/native";
import {
  openExternal,
  reserveExternalWindow,
  type ReservedExternalWindow,
} from "@/services/openExternal";
import { useSessionStore } from "@/stores/sessionStore";

type CheckoutStage = "verification" | "ready" | "opening" | "awaiting" | "verifying" | "active";

type OnboardingBillingService = Pick<BillingService, "createCheckoutSession" | "getSubscription">;

interface SubscriptionStepProps {
  onBack: () => void;
  onContinue: () => void;
  billingService?: OnboardingBillingService;
  openCheckout?: (url: string, reservedWindow?: ReservedExternalWindow | null) => Promise<void>;
  previewMode?: boolean;
}

export function SubscriptionStep({
  onBack,
  onContinue,
  billingService,
  openCheckout = openExternal,
  previewMode = env.enablePreviewData,
}: SubscriptionStepProps) {
  const { t } = useTranslation();
  const profile = useSessionStore((state) => state.profile);
  const subscription = useSessionStore((state) => state.subscription);
  const setProfile = useSessionStore((state) => state.setProfile);
  const setSubscription = useSessionStore((state) => state.setSubscription);
  const [stage, setStage] = useState<CheckoutStage>(() => {
    if (previewMode || getCurrentAuthSession()?.emailVerified) return "ready";
    return "verification";
  });
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [checkoutOpenFailed, setCheckoutOpenFailed] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [noticeKey, setNoticeKey] = useState<string | null>(null);
  const [verificationEmailBusy, setVerificationEmailBusy] = useState(false);

  const resolveBillingService = (): OnboardingBillingService =>
    billingService ?? new ApiBillingService(getCurrentAuthSession);

  const checkoutCreationErrorKey = (error: unknown): string => {
    if (error instanceof ApiError) {
      if (error.code === "authentication_required") {
        return "onboarding.setup.subscription.authRequired";
      }
      if (error.code === "email_verification_required") {
        return "onboarding.setup.subscription.notVerified";
      }
      return "onboarding.setup.subscription.createError";
    }

    if (error instanceof Error && error.message === "api_not_configured") {
      return "onboarding.setup.subscription.configurationError";
    }

    return "onboarding.setup.subscription.createError";
  };

  const refreshVerifiedSession = async () => {
    const session = getCurrentAuthSession();
    if (!session) {
      setStage("verification");
      setErrorKey("onboarding.setup.subscription.authRequired");
      return null;
    }

    const refreshedSession = await session.refresh();
    setCurrentAuthSession(refreshedSession);
    setProfile(refreshedSession.user);
    if (!refreshedSession.emailVerified) {
      setStage("verification");
      setErrorKey("onboarding.setup.subscription.notVerified");
      return null;
    }

    return refreshedSession;
  };

  const recheckVerification = async () => {
    setErrorKey(null);
    setNoticeKey(null);
    setStage("verifying");
    try {
      const session = await refreshVerifiedSession();
      if (session) setStage("ready");
    } catch {
      setStage("verification");
      setErrorKey("onboarding.setup.subscription.verificationError");
    }
  };

  const resendVerificationEmail = async () => {
    setErrorKey(null);
    setNoticeKey(null);
    setVerificationEmailBusy(true);
    try {
      const session = await authService.sendVerificationEmail();
      setCurrentAuthSession(session);
      setProfile(session.user);
      setNoticeKey("onboarding.setup.subscription.verificationSent");
    } catch {
      setErrorKey("onboarding.setup.subscription.verificationSendError");
    } finally {
      setVerificationEmailBusy(false);
    }
  };

  const startCheckout = async () => {
    setErrorKey(null);
    setNoticeKey(null);
    setCheckoutOpenFailed(false);
    const reservedWindow = openCheckout === openExternal ? reserveExternalWindow() : null;

    if (previewMode) {
      reservedWindow?.close();
      setSubscription({ ...subscription, plan: "pro", status: "active" });
      setStage("active");
      return;
    }

    setStage("opening");
    try {
      const session = await refreshVerifiedSession();
      if (!session) {
        reservedWindow?.close();
        return;
      }
      const url = await resolveBillingService().createCheckoutSession();
      setCheckoutUrl(url);
      try {
        if (reservedWindow) {
          await openCheckout(url, reservedWindow);
        } else {
          await openCheckout(url);
        }
      } catch (error) {
        reservedWindow?.close();
        console.error("Checkout URL was created but could not be opened.", error);
        setStage("awaiting");
        setCheckoutOpenFailed(true);
        return;
      }
      setStage("awaiting");
    } catch (error) {
      reservedWindow?.close();
      console.error("Checkout session could not be created.", error);
      setStage("ready");
      setErrorKey(checkoutCreationErrorKey(error));
    }
  };

  const retryOpeningCheckout = async () => {
    if (!checkoutUrl) return;
    setErrorKey(null);
    setNoticeKey(null);
    try {
      await openCheckout(checkoutUrl);
      setCheckoutOpenFailed(false);
    } catch (error) {
      console.error("Checkout URL could not be opened on retry.", error);
      setCheckoutOpenFailed(true);
    }
  };

  const copyCheckoutUrl = async () => {
    if (!checkoutUrl) return;
    setErrorKey(null);
    try {
      await nativeClient.copyText(checkoutUrl);
      setNoticeKey("onboarding.setup.subscription.checkoutLinkCopied");
    } catch {
      setErrorKey("onboarding.setup.subscription.checkoutLinkCopyError");
    }
  };

  const verifySubscription = async () => {
    setErrorKey(null);
    setNoticeKey(null);
    setStage("verifying");
    try {
      const session = await refreshVerifiedSession();
      if (!session) return;
      let nextSubscription = await resolveBillingService().getSubscription();
      for (const delayMs of [1_000, 2_000, 4_000, 8_000]) {
        if (
          nextSubscription.plan === "pro" &&
          (nextSubscription.status === "active" || nextSubscription.status === "trialing")
        ) {
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        nextSubscription = await resolveBillingService().getSubscription();
      }
      if (
        nextSubscription.plan !== "pro" ||
        (nextSubscription.status !== "active" && nextSubscription.status !== "trialing")
      ) {
        setStage("awaiting");
        setErrorKey("onboarding.setup.subscription.verifyError");
        return;
      }
      setSubscription(nextSubscription);
      setStage("active");
    } catch {
      setStage("awaiting");
      setErrorKey("onboarding.setup.subscription.verifyError");
    }
  };

  const isBusy = stage === "opening" || stage === "verifying";

  return (
    <div className="mx-auto max-w-[720px]">
      <div className="text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-accent">
          {t("onboarding.setup.subscription.plan")}
        </p>
        <h1 className="mt-4 font-display text-[46px] leading-none text-ink">
          {t("onboarding.setup.subscription.title")}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-ink-muted">
          {t("onboarding.setup.subscription.description")}
        </p>
      </div>

      <Card className="mt-9 overflow-hidden" elevated>
        <div className="flex items-end justify-between gap-5 border-b border-line/80 p-6">
          <div>
            <div className="flex size-10 items-center justify-center rounded-2xl bg-ink text-inverse">
              <Sparkles className="size-4" />
            </div>
            <h2 className="mt-5 font-display text-[30px] leading-none text-ink">
              {t("onboarding.setup.subscription.plan")}
            </h2>
          </div>
          <div className="text-right">
            <p className="text-[28px] font-semibold tracking-[-0.04em] text-ink">
              {t("onboarding.setup.subscription.price")}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              {t("onboarding.setup.subscription.renewal")}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-3 divide-x divide-line/80 max-[700px]:grid-cols-1 max-[700px]:divide-x-0 max-[700px]:divide-y">
          <div className="p-5">
            <Check className="size-4 text-accent" />
            <h3 className="mt-3 text-[13px] font-semibold text-ink">
              {t("onboarding.setup.subscription.included")}
            </h3>
            <p className="mt-1 text-xs leading-5 text-ink-muted">
              {t("onboarding.setup.subscription.allowanceDescription")}
            </p>
          </div>
          <div className="p-5">
            <Plus className="size-4 text-accent" />
            <h3 className="mt-3 text-[13px] font-semibold text-ink">
              {t("onboarding.setup.subscription.topUp")}
            </h3>
            <p className="mt-1 text-xs leading-5 text-ink-muted">
              {t("onboarding.setup.subscription.topUpDescription")}
            </p>
          </div>
          <div className="p-5">
            <RefreshCw className="size-4 text-accent" />
            <h3 className="mt-3 text-[13px] font-semibold text-ink">
              {t("onboarding.setup.subscription.billingCycle")}
            </h3>
            <p className="mt-1 text-xs leading-5 text-ink-muted">
              {t("onboarding.setup.subscription.billingCycleDescription")}
            </p>
          </div>
        </div>

        <div className="border-t border-line/80 bg-sidebar/35 p-5">
          {stage === "verification" || (stage === "verifying" && !checkoutUrl) ? (
            <div className="flex items-center gap-4 max-[620px]:items-start">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                <MailCheck className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[13px] font-semibold text-ink">
                  {t("onboarding.setup.subscription.verificationTitle")}
                </h3>
                <p className="mt-1 text-xs leading-5 text-ink-muted">
                  {t("onboarding.setup.subscription.verificationDescription", {
                    email: profile.email ?? t("onboarding.setup.subscription.emailFallback"),
                  })}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                loading={verificationEmailBusy}
                onClick={() => void resendVerificationEmail()}
              >
                {t("onboarding.setup.subscription.resendVerification")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                loading={stage === "verifying"}
                onClick={() => void recheckVerification()}
              >
                {stage === "verifying"
                  ? t("onboarding.setup.subscription.verificationChecking")
                  : t("onboarding.setup.subscription.verificationCheck")}
              </Button>
            </div>
          ) : null}

          {stage === "ready" || stage === "opening" ? (
            <div className="flex items-center justify-between gap-5 max-[620px]:items-start">
              <div>
                <h3 className="text-[13px] font-semibold text-ink">
                  {t("onboarding.setup.subscription.secureTitle")}
                </h3>
                <p className="mt-1 text-xs leading-5 text-ink-muted">
                  {t("onboarding.setup.subscription.secureDescription")}
                </p>
              </div>
              <Button loading={stage === "opening"} onClick={() => void startCheckout()}>
                <CreditCard className="size-4" />
                {stage === "opening"
                  ? t("onboarding.setup.subscription.opening")
                  : t("onboarding.setup.subscription.checkout")}
              </Button>
            </div>
          ) : null}

          {(stage === "awaiting" || (stage === "verifying" && checkoutUrl)) && checkoutUrl ? (
            <div className="flex items-center justify-between gap-5 max-[620px]:flex-col max-[620px]:items-stretch">
              <div className="min-w-0 flex-1">
                <h3 className="text-[13px] font-semibold text-ink">
                  {t(
                    checkoutOpenFailed
                      ? "onboarding.setup.subscription.browserFallbackTitle"
                      : "onboarding.setup.subscription.checkoutOpenedTitle",
                  )}
                </h3>
                <p
                  role={checkoutOpenFailed ? "alert" : undefined}
                  className="mt-1 text-xs leading-5 text-ink-muted"
                >
                  {t(
                    checkoutOpenFailed
                      ? "onboarding.setup.subscription.browserFallbackDescription"
                      : "onboarding.setup.subscription.checkoutOpenedDescription",
                  )}
                </p>
                {checkoutOpenFailed ? (
                  <button
                    type="button"
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-ink transition-colors hover:text-accent"
                    onClick={() => void copyCheckoutUrl()}
                  >
                    <Copy className="size-3.5" />
                    {t("onboarding.setup.subscription.copyCheckoutLink")}
                  </button>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-2 max-[620px]:justify-start">
                {checkoutOpenFailed ? (
                  <Button variant="secondary" size="sm" onClick={() => void retryOpeningCheckout()}>
                    {t("onboarding.setup.subscription.retryBrowser")}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  loading={stage === "verifying"}
                  onClick={() => void verifySubscription()}
                >
                  {stage === "verifying"
                    ? t("onboarding.setup.subscription.verifying")
                    : t("onboarding.setup.subscription.verify")}
                </Button>
              </div>
            </div>
          ) : null}

          {stage === "active" ? (
            <div className="flex items-center justify-between gap-5">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-accent">
                <Check className="size-4" />
                {t("onboarding.setup.subscription.confirmed")}
              </p>
              <Button size="sm" onClick={onContinue}>
                {t("common.actions.continue")}
              </Button>
            </div>
          ) : null}

          {errorKey ? (
            <p role="alert" className="mt-4 text-xs font-medium text-danger">
              {t(errorKey)}
            </p>
          ) : null}
          {noticeKey ? (
            <p role="status" className="mt-4 text-xs font-medium text-accent">
              {t(noticeKey)}
            </p>
          ) : null}
        </div>
      </Card>

      <div className="mt-6 text-center">
        <Button variant="ghost" disabled={isBusy} onClick={onBack}>
          {t("common.actions.back")}
        </Button>
      </div>
    </div>
  );
}
