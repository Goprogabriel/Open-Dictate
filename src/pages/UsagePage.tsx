import { CalendarDays, TrendingUp } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useAppNavigate } from "@/app/navigation";
import { PageFrame } from "@/components/layout/PageFrame";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { appRoutes } from "@/config/app";
import { MetricStrip } from "@/features/usage/MetricStrip";
import { TokenAllowanceCard } from "@/features/usage/TokenAllowanceCard";
import { UsageChart } from "@/features/usage/UsageChart";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useUsageStore } from "@/stores/usageStore";
import { formatMonth } from "@/utils/date";
import { formatDuration, formatNumber } from "@/utils/format";

export function UsagePage() {
  const { t } = useTranslation();
  const navigate = useAppNavigate();
  const locale = usePreferencesStore((state) => state.locale);
  const mode = usePreferencesStore((state) => state.processingMode);
  const subscription = useSessionStore((state) => state.subscription);
  const summary = useUsageStore((state) => state.summary);
  const totalTokens = summary.transcriptionTokens + summary.transformTokens;

  return (
    <PageFrame>
      <PageHeader
        title={t("usage.title")}
        description={t("usage.subtitle")}
        actions={
          <Select
            aria-label={t("usage.period.selectMonth")}
            defaultValue={summary.month}
            className="w-[170px]"
          >
            <option value={summary.month}>{formatMonth(summary.month, locale)}</option>
          </Select>
        }
      />

      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-5 max-[1060px]:grid-cols-1">
        <Card className="overflow-hidden" elevated>
          <div className="relative border-b border-line/80 p-7 pb-6">
            <div
              className="absolute right-7 top-7 flex h-11 items-end gap-1 opacity-55"
              aria-hidden="true"
            >
              {[12, 25, 17, 35, 22, 42, 28, 18, 32].map((height, index) => (
                <span
                  key={`${height}-${index}`}
                  className="w-1.5 rounded-full bg-accent"
                  style={{ height }}
                />
              ))}
            </div>
            <Badge tone="success" className="mb-5">
              <TrendingUp className="mr-1 size-3" />
              {t("usage.hero.increase", { value: `${summary.comparisonPercent}%` })}
            </Badge>
            <p className="max-w-[700px] font-display text-[42px] leading-[1.08] text-ink max-[1180px]:text-[36px]">
              {t("usage.hero.title", { time: formatDuration(summary.estimatedSavedMs) })}
            </p>
            <p className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
              <CalendarDays className="size-4" />
              {t("usage.hero.description")}
            </p>
          </div>

          <div className="p-7">
            <UsageChart points={summary.points} locale={locale} />
            <div className="mt-7 border-t border-line/80 pt-6">
              <MetricStrip summary={summary} locale={locale} />
            </div>
          </div>
        </Card>

        <TokenAllowanceCard
          subscription={subscription}
          mode={mode}
          locale={locale}
          onManage={() => navigate(appRoutes.profile)}
        />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-5 max-[900px]:grid-cols-1">
        <Card className="p-5">
          <p className="text-xs font-semibold text-ink">{t("usage.allowance.title")}</p>
          <div className="mt-4 flex items-center gap-4">
            <span className="size-2 rounded-full bg-accent" />
            <div className="min-w-0 flex-1">
              <div className="flex justify-between text-xs">
                <span className="text-ink-soft">{t("hud.states.transcribing")}</span>
                <span className="font-semibold text-ink tabular-nums">
                  {formatNumber(summary.transcriptionTokens, locale)}
                </span>
              </div>
              <div className="mt-3 flex justify-between text-xs">
                <span className="text-ink-soft">{t("hud.states.polishing")}</span>
                <span className="font-semibold text-ink tabular-nums">
                  {formatNumber(summary.transformTokens, locale)}
                </span>
              </div>
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold text-ink">{t("usage.calculation.title")}</p>
          <p className="mt-3 text-sm leading-6 text-ink-muted">
            {t("usage.calculation.description", {
              words: formatNumber(summary.wordsGenerated, locale),
              tokens: formatNumber(totalTokens, locale),
            })}
          </p>
        </Card>
      </div>
    </PageFrame>
  );
}
