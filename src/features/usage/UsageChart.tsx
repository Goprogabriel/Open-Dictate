import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatShortDate } from "@/utils/date";
import type { Locale, UsagePoint } from "@/types/domain";
import { cn } from "@/utils/cn";

interface UsageChartProps {
  points: UsagePoint[];
  locale: Locale;
}

export function UsageChart({ points, locale }: UsageChartProps) {
  const { t } = useTranslation();
  const [metric, setMetric] = useState<"minutes" | "words">("minutes");
  const data = useMemo(
    () =>
      points.map((point) => ({
        ...point,
        label: formatShortDate(point.date, locale),
      })),
    [locale, points],
  );

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-ink">{t("usage.chart.title")}</h3>
          <p className="mt-1 text-xs text-ink-muted">{t("usage.period.last30Days")}</p>
        </div>
        <div className="flex rounded-xl bg-ink/[0.055] p-1">
          {(["minutes", "words"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setMetric(item)}
              className={cn(
                "h-7 rounded-lg px-3 text-[11px] font-semibold text-ink-muted transition-colors",
                metric === item && "bg-raised text-ink shadow-sm",
              )}
            >
              {t(`usage.chart.${item}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="h-[250px] w-full">
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 2, left: -24, bottom: 0 }}>
              <defs>
                <linearGradient id="usage-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3a7258" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#3a7258" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="#e2ddd5" strokeDasharray="2 5" />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#89847c", fontSize: 10 }}
                interval="preserveStartEnd"
                minTickGap={42}
                dy={8}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#89847c", fontSize: 10 }}
                allowDecimals={metric === "minutes"}
                width={36}
              />
              <Tooltip
                cursor={{ stroke: "#cac3b9", strokeDasharray: "3 3" }}
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid #e2ddd5",
                  boxShadow: "0 8px 30px rgba(25,24,23,.10)",
                  fontSize: 12,
                  background: "#fff",
                }}
                formatter={(value) => [
                  typeof value === "number" ? value.toLocaleString(locale) : value,
                  t(`usage.chart.${metric}`),
                ]}
                labelStyle={{ color: "#89847c", marginBottom: 4 }}
              />
              <Area
                type="monotone"
                dataKey={metric}
                stroke="#3a7258"
                strokeWidth={2}
                fill="url(#usage-fill)"
                activeDot={{ r: 4, fill: "#3a7258", stroke: "#fbf9f6", strokeWidth: 3 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-line-strong text-xs text-ink-muted">
            {t("usage.chart.empty")}
          </div>
        )}
      </div>
    </div>
  );
}
