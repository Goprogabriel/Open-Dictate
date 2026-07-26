import { useTranslation } from "react-i18next";

import type { Locale, UsageSummary } from "@/types/domain";
import { formatDuration, formatNumber } from "@/utils/format";

export function MetricStrip({ summary, locale }: { summary: UsageSummary; locale: Locale }) {
  const { t } = useTranslation();
  const metrics = [
    { label: t("usage.metrics.dictationTime"), value: formatDuration(summary.dictationMs) },
    { label: t("usage.metrics.speakingTime"), value: formatDuration(summary.speakingMs) },
    {
      label: t("usage.metrics.wordsGenerated"),
      value: formatNumber(summary.wordsGenerated, locale),
    },
    { label: t("usage.metrics.dictations"), value: formatNumber(summary.dictationCount, locale) },
  ];

  return (
    <dl className="grid grid-cols-4 divide-x divide-line/80 max-[1120px]:grid-cols-2 max-[1120px]:gap-y-6 max-[1120px]:divide-x-0">
      {metrics.map((metric) => (
        <div key={metric.label} className="px-5 first:pl-0 last:pr-0 max-[1120px]:px-0">
          <dt className="text-[11px] font-medium text-ink-muted">{metric.label}</dt>
          <dd className="mt-1.5 text-xl font-semibold tracking-[-0.03em] text-ink tabular-nums">
            {metric.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
