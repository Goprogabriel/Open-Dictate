import { Check, ExternalLink, Mic2, MousePointer2, Power } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Switch } from "@/components/ui/Switch";
import { env } from "@/config/env";
import { nativeClient } from "@/services/native";
import { usePreferencesStore } from "@/stores/preferencesStore";
import type { PermissionSnapshot } from "@/types/domain";
import { cn } from "@/utils/cn";

const initialPermissions: PermissionSnapshot = {
  microphone: "unknown",
  accessibility: "unknown",
  screenRecording: "unknown",
};

export function PermissionStep({
  onBack,
  onContinue,
}: {
  onBack: () => void;
  onContinue: () => void;
}) {
  const { t } = useTranslation();
  const launchAtStartup = usePreferencesStore((state) => state.launchAtStartup);
  const setLaunchAtStartup = usePreferencesStore((state) => state.setLaunchAtStartup);
  const [permissions, setPermissions] = useState(initialPermissions);
  const [checking, setChecking] = useState(true);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      setPermissions(await nativeClient.getPermissions());
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void nativeClient
      .getPermissions()
      .then((snapshot) => {
        if (active) setPermissions(snapshot);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const requestMicrophone = async () => {
    setChecking(true);
    try {
      setPermissions(await nativeClient.requestMicrophonePermission());
    } finally {
      setChecking(false);
    }
  };

  const updateStartup = async (enabled: boolean) => {
    setLaunchAtStartup(enabled);
    await nativeClient.setAutostartEnabled(enabled).catch(() => setLaunchAtStartup(!enabled));
  };

  const requiredGranted =
    env.enablePreviewData ||
    (permissions.microphone === "granted" && permissions.accessibility === "granted");

  const rows = [
    {
      key: "microphone" as const,
      icon: Mic2,
      action: () => void requestMicrophone(),
    },
    {
      key: "accessibility" as const,
      icon: MousePointer2,
      action: () => void nativeClient.openPermissionSettings("accessibility"),
    },
  ];

  return (
    <div className="mx-auto max-w-[680px]">
      <div className="text-center">
        <h1 className="font-display text-[46px] leading-none text-ink">
          {t("onboarding.permissions.title")}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-ink-muted">
          {t("onboarding.permissions.description")}
        </p>
      </div>

      <Card className="mt-9 overflow-hidden bg-raised" elevated>
        {rows.map(({ key, icon: Icon, action }) => {
          const granted = permissions[key] === "granted" || env.enablePreviewData;
          return (
            <div
              key={key}
              className="flex min-h-[82px] items-center gap-4 border-b border-line/80 px-5 py-4"
            >
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-2xl",
                  granted ? "bg-accent-soft text-accent" : "bg-ink/[0.055] text-ink-soft",
                )}
              >
                {granted ? <Check className="size-4" /> : <Icon className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-[13px] font-semibold text-ink">
                    {t(`onboarding.permissions.${key}.title`)}
                  </h2>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-danger">
                    {t("onboarding.permissions.states.required")}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-ink-muted">
                  {t(`onboarding.permissions.${key}.description`)}
                </p>
              </div>
              {granted ? (
                <span className="text-xs font-semibold text-accent">
                  {t("onboarding.permissions.states.granted")}
                </span>
              ) : (
                <Button variant="secondary" size="sm" onClick={action} disabled={checking}>
                  {key === "accessibility" ? <ExternalLink className="size-3.5" /> : null}
                  {t("onboarding.permissions.states.request")}
                </Button>
              )}
            </div>
          );
        })}
        <div className="flex min-h-[82px] items-center gap-4 px-5 py-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-ink/[0.055] text-ink-soft">
            <Power className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-semibold text-ink">
              {t("onboarding.permissions.startup.title")}
            </h2>
            <p className="mt-1 text-xs leading-5 text-ink-muted">
              {t("onboarding.permissions.startup.description")}
            </p>
          </div>
          <Switch
            checked={launchAtStartup}
            onCheckedChange={(enabled) => void updateStartup(enabled)}
            label={t("onboarding.permissions.startup.title")}
          />
        </div>
      </Card>

      <div className="mt-6 flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={onBack}>
          {t("common.actions.back")}
        </Button>
        <div className="flex items-center gap-3">
          {!requiredGranted ? (
            <Button variant="ghost" size="sm" onClick={() => void refresh()}>
              {t("permissions.actions.checkAgain")}
            </Button>
          ) : null}
          <Button disabled={!requiredGranted} onClick={onContinue}>
            {t("common.actions.continue")}
          </Button>
        </div>
      </div>
      {!requiredGranted ? (
        <p className="mt-3 text-right text-xs text-ink-muted">
          {t("onboarding.permissions.continueWhenReady")}
        </p>
      ) : null}
    </div>
  );
}
