import { ArrowDown } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/ui/Card";

export function PromptPreview() {
  const { t } = useTranslation();
  return (
    <Card className="sticky top-8 overflow-hidden" elevated>
      <div className="border-b border-line/80 px-5 py-4">
        <h2 className="text-sm font-semibold text-ink">{t("prompt.preview.title")}</h2>
      </div>
      <div className="p-5">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-muted">
          {t("prompt.preview.input")}
        </p>
        <p className="mt-3 rounded-2xl bg-sidebar/55 p-4 text-sm leading-6 text-ink-soft">
          {t("prompt.preview.sampleInput")}
        </p>
        <div className="my-3 flex justify-center">
          <ArrowDown className="size-4 text-ink-muted" />
        </div>
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-accent">
          {t("prompt.preview.output")}
        </p>
        <p className="mt-3 rounded-2xl border border-accent/15 bg-accent-soft/55 p-4 text-sm leading-6 text-ink">
          {t("prompt.preview.sampleOutput")}
        </p>
      </div>
    </Card>
  );
}
