import { Check, Mic2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ShortcutKeycaps } from "@/components/ui/ShortcutKeycaps";
import { useDictationStore } from "@/stores/dictationStore";
import { usePlatformStore } from "@/stores/platformStore";
import { cn } from "@/utils/cn";

export function PracticeStep({ onBack, onFinish }: { onBack: () => void; onFinish: () => void }) {
  const { t } = useTranslation();
  const phase = useDictationStore((state) => state.phase);
  const shortcutLabel = usePlatformStore((state) => state.shortcutLabel);
  const [value, setValue] = useState("");
  const success = value.trim().length > 0 || phase === "success";

  useEffect(() => {
    const listener = (event: ClipboardEvent) => {
      const pasted = event.clipboardData?.getData("text/plain");
      if (pasted) setValue((current) => current || pasted);
    };
    window.addEventListener("paste", listener);
    return () => window.removeEventListener("paste", listener);
  }, []);

  return (
    <div className="mx-auto max-w-[740px]">
      <div className="text-center">
        <h1 className="font-display text-[46px] leading-none text-ink">
          {success ? t("onboarding.practice.successTitle") : t("onboarding.practice.title")}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-ink-muted">
          {success
            ? t("onboarding.practice.successDescription")
            : t("onboarding.practice.description", { shortcut: shortcutLabel })}
        </p>
      </div>

      <Card className="mt-9 p-5" elevated>
        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                "flex size-8 items-center justify-center rounded-xl",
                phase === "recording" ? "bg-recording text-white" : "bg-ink/[0.06] text-ink-soft",
              )}
            >
              {success ? <Check className="size-3.5" /> : <Mic2 className="size-3.5" />}
            </span>
            <p className="text-xs font-semibold text-ink-soft">
              {phase === "recording"
                ? t("onboarding.practice.listening")
                : t("onboarding.practice.waiting", { shortcut: shortcutLabel })}
            </p>
          </div>
          <ShortcutKeycaps />
        </div>
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          autoFocus
          className="h-[180px] w-full resize-none rounded-2xl border border-line-strong/80 bg-surface p-5 text-lg leading-8 text-ink placeholder:text-ink-muted focus:border-accent/50 focus:outline-none"
          placeholder={t("onboarding.practice.fieldPlaceholder")}
        />
        <p className="mt-3 text-center text-xs text-ink-muted">{t("onboarding.practice.sample")}</p>
      </Card>

      <div className="mt-6 flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={onBack}>
          {t("common.actions.back")}
        </Button>
        <div className="flex items-center gap-2">
          {value ? (
            <Button variant="ghost" onClick={() => setValue("")}>
              {t("onboarding.practice.tryAgain")}
            </Button>
          ) : null}
          <Button onClick={onFinish}>
            {success ? <Check className="size-4" /> : null}
            {t("onboarding.practice.finish")}
          </Button>
        </div>
      </div>
    </div>
  );
}
