import { ArrowRight, Check, Mic2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";
import { ShortcutKeycaps } from "@/components/ui/ShortcutKeycaps";

export function WelcomeStep({ onContinue }: { onContinue: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_380px] items-center gap-16 max-[850px]:grid-cols-1">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-accent">
          {t("onboarding.welcome.eyebrow")}
        </p>
        <h1 className="mt-5 font-display text-[56px] leading-[0.98] text-ink max-[1000px]:text-[48px]">
          {t("onboarding.welcome.title")}
        </h1>
        <p className="mt-6 max-w-xl text-xl leading-8 tracking-[-0.01em] text-ink-soft">
          {t("onboarding.welcome.description")}
        </p>
        <p className="mt-3 max-w-lg text-sm leading-6 text-ink-muted">
          {t("onboarding.welcome.detail")}
        </p>
        <Button size="lg" className="mt-8 min-w-[160px]" onClick={onContinue}>
          {t("onboarding.welcome.getStarted")}
          <ArrowRight className="size-4" />
        </Button>
        <p className="mt-4 flex items-center gap-2 text-xs text-ink-muted">
          <Check className="size-3.5 text-accent" />
          {t("onboarding.welcome.privacy")}
        </p>
      </div>

      <div className="relative mx-auto w-full max-w-[380px]">
        <div className="absolute -inset-8 rounded-full bg-white/35 blur-3xl" />
        <div className="relative rounded-[28px] border border-line bg-surface p-5 shadow-card">
          <div className="flex items-center justify-between">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-ink text-inverse">
              <Mic2 className="size-4" />
            </span>
            <ShortcutKeycaps />
          </div>
          <div className="mt-9 flex h-16 items-center justify-center gap-1.5" aria-hidden="true">
            {[18, 30, 48, 28, 55, 39, 24, 43, 60, 32, 20, 38, 26].map((height, index) => (
              <span
                key={`${height}-${index}`}
                className="w-1.5 rounded-full bg-ink"
                style={{ height }}
              />
            ))}
          </div>
          <div className="mt-8 rounded-2xl bg-sidebar/65 p-4">
            <p className="text-[11px] leading-5 text-ink-muted">
              “hey can you send me that email tomorrow um actually Friday”
            </p>
            <div className="my-3 h-px bg-line" />
            <p className="text-[13px] font-medium leading-5 text-ink">
              “Hey, can you send me that email tomorrow—actually, Friday?”
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
