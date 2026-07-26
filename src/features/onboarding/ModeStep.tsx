import { Check, Cpu, KeyRound, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { UserMode } from "@/types/domain";

export function ModeStep({
  onBack,
  onSelect,
}: {
  onBack: () => void;
  onSelect: (mode: UserMode) => void;
}) {
  const { t } = useTranslation();
  const plans: Array<{
    mode: UserMode;
    icon: typeof KeyRound;
    accent: boolean;
    features: string[];
  }> = [
    {
      mode: "free",
      icon: KeyRound,
      accent: false,
      features: [
        t("onboarding.mode.free.featureOne"),
        t("onboarding.mode.free.featureTwo"),
        t("onboarding.mode.free.featureThree"),
      ],
    },
    {
      mode: "local",
      icon: Cpu,
      accent: true,
      features: [
        t("onboarding.mode.local.featureOne"),
        t("onboarding.mode.local.featureTwo"),
        t("onboarding.mode.local.featureThree"),
      ],
    },
    {
      mode: "pro",
      icon: Sparkles,
      accent: false,
      features: [
        t("onboarding.mode.pro.featureOne"),
        t("onboarding.mode.pro.featureTwo"),
        t("onboarding.mode.pro.featureThree"),
      ],
    },
  ];

  return (
    <div>
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="font-display text-[46px] leading-none text-ink">
          {t("onboarding.mode.title")}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-ink-muted">
          {t("onboarding.mode.description")}
        </p>
      </div>
      <div className="mt-10 grid grid-cols-3 gap-5 max-[980px]:grid-cols-1">
        {plans.map(({ mode, icon: Icon, accent, features }) => (
          <Card
            key={mode}
            elevated
            className={`flex h-full flex-col p-6 ${accent ? "border-ink/20 bg-raised" : ""}`}
          >
            <div className="flex items-start justify-between gap-4">
              <span className="flex size-10 items-center justify-center rounded-2xl bg-ink/[0.06] text-ink">
                <Icon className="size-4" />
              </span>
              {accent ? (
                <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[10px] font-bold text-accent">
                  {t("common.states.recommended")}
                </span>
              ) : null}
            </div>
            <h2 className="mt-6 min-h-[60px] font-display text-[30px] leading-none text-ink max-[980px]:min-h-0">
              {t(`onboarding.mode.${mode}.title`)}
            </h2>
            <p className="mt-2 min-h-[60px] text-xs leading-5 text-ink-muted max-[980px]:min-h-0">
              {t(`onboarding.mode.${mode}.description`)}
            </p>
            <p className="mt-6 text-[28px] font-semibold tracking-[-0.04em] text-ink">
              {t(`onboarding.mode.${mode}.price`)}
            </p>
            <Button
              variant={accent ? "primary" : "secondary"}
              size="lg"
              className="mt-5 w-full"
              onClick={() => onSelect(mode)}
            >
              {t(`onboarding.mode.${mode}.cta`)}
            </Button>
            <ul className="mt-6 space-y-3 border-t border-line/80 pt-5">
              {features.map((feature) => (
                <li
                  key={feature}
                  className="flex items-start gap-2.5 text-xs leading-5 text-ink-soft"
                >
                  <Check className="mt-0.5 size-3.5 shrink-0 text-accent" />
                  {feature}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
      <div className="mt-6 text-center">
        <Button variant="ghost" onClick={onBack}>
          {t("common.actions.back")}
        </Button>
      </div>
    </div>
  );
}
