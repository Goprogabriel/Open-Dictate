import { Eye, EyeOff, KeyRound, LockKeyhole } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FieldLabel, Input } from "@/components/ui/Field";
import { env } from "@/config/env";
import { ApiBillingService } from "@/services/api/billingService";
import { LocalAiSetup } from "@/features/settings/LocalAiSetup";
import { authService } from "@/services/firebase/authService";
import { getCurrentAuthSession, setCurrentAuthSession } from "@/services/firebase/sessionRuntime";
import { secureSecretService } from "@/services/secureSecretService";
import { useSessionStore } from "@/stores/sessionStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import type { Subscription, UserMode } from "@/types/domain";

interface SetupContinueOptions {
  subscriptionActive?: boolean;
}

type ProAccountMode = "create" | "signIn";

function subscriptionIsActive(subscription: Subscription): boolean {
  return (
    subscription.plan === "pro" &&
    (subscription.status === "active" || subscription.status === "trialing")
  );
}

export function SetupStep({
  mode,
  onBack,
  onContinue,
}: {
  mode: UserMode;
  onBack: () => void;
  onContinue: (options?: SetupContinueOptions) => void;
}) {
  const { t } = useTranslation();
  const [accountMode, setAccountMode] = useState<ProAccountMode>("create");
  const [apiKey, setApiKey] = useState("");
  const [keyVisible, setKeyVisible] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configureLocalUser = useSessionStore((state) => state.configureLocalUser);
  const configureProUser = useSessionStore((state) => state.configureProUser);
  const setSubscription = useSessionStore((state) => state.setSubscription);
  const setProcessingMode = usePreferencesStore((state) => state.setProcessingMode);

  const refreshSubscription = async (): Promise<boolean> => {
    if (!env.apiBaseUrl) return false;

    try {
      const nextSubscription = await new ApiBillingService(getCurrentAuthSession).getSubscription();
      setSubscription(nextSubscription);
      return subscriptionIsActive(nextSubscription);
    } catch {
      return false;
    }
  };

  const submitFree = async () => {
    setBusy(true);
    setError(null);
    try {
      const valid = await secureSecretService.testOpenAiKey(apiKey);
      if (!valid) {
        setError(t("onboarding.setup.apiKey.invalid"));
        return;
      }
      await secureSecretService.setOpenAiKey(apiKey);
      setProcessingMode("free");
      if (!getCurrentAuthSession()) configureLocalUser();
      onContinue();
    } catch {
      setError(t("onboarding.setup.apiKey.invalid"));
    } finally {
      setBusy(false);
    }
  };

  const submitPro = async () => {
    setBusy(true);
    setError(null);
    try {
      if (env.enablePreviewData) {
        setProcessingMode("pro");
        configureProUser(name, email, undefined, true);
        onContinue({ subscriptionActive: true });
      } else {
        const session =
          accountMode === "create"
            ? await authService.signUp({ name, email, password })
            : await authService.signIn(email, password);
        setCurrentAuthSession(session);
        setProcessingMode("pro");
        configureProUser(
          session.user.name || name.trim() || email.trim(),
          session.user.email ?? email,
          session.user.id,
          session.emailVerified,
        );
        const subscriptionActive = await refreshSubscription();
        onContinue({ subscriptionActive });
      }
    } catch {
      setError(
        accountMode === "create" ? t("errors.generic") : t("onboarding.setup.account.signInError"),
      );
    } finally {
      setBusy(false);
    }
  };

  const formValid =
    mode === "free"
      ? apiKey.trim().length > 20
      : /.+@.+\..+/u.test(email) &&
        (accountMode === "create"
          ? name.trim().length > 1 && password.length >= 8
          : password.length > 0);

  if (mode === "local") {
    return (
      <div className="mx-auto max-w-[760px]">
        <div className="text-center">
          <h1 className="font-display text-[46px] leading-none text-ink">
            {t("onboarding.setup.local.title")}
          </h1>
          <p className="mx-auto mt-4 max-w-lg text-sm leading-6 text-ink-muted">
            {t("onboarding.setup.local.description")}
          </p>
        </div>
        <Card className="mt-9 p-6" elevated>
          <LocalAiSetup onReady={() => onContinue()} />
          <div className="mt-5 border-t border-line/80 pt-4">
            <Button variant="ghost" onClick={onBack}>
              {t("common.actions.back")}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[610px]">
      <div className="text-center">
        <h1 className="font-display text-[46px] leading-none text-ink">
          {mode === "free"
            ? t("onboarding.setup.apiKey.title")
            : accountMode === "create"
              ? t("onboarding.setup.account.title")
              : t("onboarding.setup.account.signInTitle")}
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-sm leading-6 text-ink-muted">
          {mode === "free"
            ? t("onboarding.setup.apiKey.description")
            : accountMode === "create"
              ? t("onboarding.setup.account.description")
              : t("onboarding.setup.account.signInDescription")}
        </p>
      </div>
      <Card className="mt-9 p-6" elevated>
        {mode === "free" ? (
          <div>
            <FieldLabel htmlFor="onboarding-api-key">
              {t("onboarding.setup.apiKey.label")}
            </FieldLabel>
            <div className="relative">
              <KeyRound className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
              <Input
                id="onboarding-api-key"
                type={keyVisible ? "text" : "password"}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={t("onboarding.setup.apiKey.placeholder")}
                autoComplete="off"
                spellCheck={false}
                className="pl-10 pr-11"
                invalid={Boolean(error)}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setKeyVisible((value) => !value)}
                aria-label={
                  keyVisible ? t("onboarding.setup.apiKey.hide") : t("onboarding.setup.apiKey.show")
                }
                className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-ink-muted hover:bg-ink/[0.05] hover:text-ink"
              >
                {keyVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-ink-muted">
              <LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-accent" />
              {t("onboarding.setup.apiKey.help")}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 rounded-xl bg-ink/[0.055] p-1">
              {(["create", "signIn"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    setAccountMode(item);
                    setError(null);
                  }}
                  className={`h-8 rounded-lg text-xs font-semibold transition-colors ${
                    accountMode === item
                      ? "bg-raised text-ink shadow-sm"
                      : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {item === "create"
                    ? t("onboarding.setup.account.createTab")
                    : t("onboarding.setup.account.signInTab")}
                </button>
              ))}
            </div>
            {accountMode === "create" ? (
              <div>
                <FieldLabel htmlFor="onboarding-name">
                  {t("onboarding.setup.account.name")}
                </FieldLabel>
                <Input
                  id="onboarding-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t("onboarding.setup.account.namePlaceholder")}
                  autoComplete="name"
                  autoFocus
                />
              </div>
            ) : null}
            <div>
              <FieldLabel htmlFor="onboarding-email">
                {t("onboarding.setup.account.email")}
              </FieldLabel>
              <Input
                id="onboarding-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t("onboarding.setup.account.emailPlaceholder")}
                autoComplete="email"
              />
            </div>
            <div>
              <FieldLabel htmlFor="onboarding-password">
                {t("onboarding.setup.account.password")}
              </FieldLabel>
              <Input
                id="onboarding-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t("onboarding.setup.account.passwordPlaceholder")}
                autoComplete={accountMode === "create" ? "new-password" : "current-password"}
              />
            </div>
            {accountMode === "create" ? (
              <p className="text-[11px] leading-5 text-ink-muted">
                {t("onboarding.setup.account.terms")}
              </p>
            ) : null}
          </div>
        )}
        {error ? <p className="mt-4 text-xs font-medium text-danger">{error}</p> : null}
        <div className="mt-6 flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={onBack}>
            {t("common.actions.back")}
          </Button>
          <Button
            loading={busy}
            disabled={!formValid}
            onClick={() => void (mode === "free" ? submitFree() : submitPro())}
          >
            {mode === "free"
              ? t("onboarding.setup.apiKey.validate")
              : accountMode === "create"
                ? t("onboarding.setup.account.create")
                : t("onboarding.setup.account.signInSubmit")}
          </Button>
        </div>
      </Card>
    </div>
  );
}
