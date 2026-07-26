import { ArrowUpRight, CalendarClock, Infinity as InfinityIcon, WalletCards } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Progress } from "@/components/ui/Progress";
import type { Locale, Subscription, UserMode } from "@/types/domain";
import { formatShortDate } from "@/utils/date";
import { formatCompactNumber, formatNumber } from "@/utils/format";

export function TokenAllowanceCard({
  subscription,
  mode,
  locale,
  onManage,
}: {
  subscription: Subscription;
  mode: UserMode;
  locale: Locale;
  onManage: () => void;
}) {
  const { t } = useTranslation();
  const allowance = subscription.allowanceTokens ?? 0;
  const subscriptionTokens = subscription.subscriptionTokens;
  const purchasedTokens = subscription.purchasedTokens;
  const remaining = subscription.remainingTokens ?? subscriptionTokens + purchasedTokens;
  const includedUsed = allowance ? allowance - Math.min(allowance, subscriptionTokens) : 0;
  const percent = allowance ? Math.min(100, (includedUsed / allowance) * 100) : 0;
  const hasSubscription = mode === "pro" && subscription.plan === "pro";
  const hasManagedBalance = mode === "pro" && (hasSubscription || purchasedTokens > 0);
  const subscriptionActive = subscription.status === "active" || subscription.status === "trialing";

  return (
    <Card className="flex h-full flex-col p-5" elevated>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
            {t("usage.plan.title")}
          </p>
          <h3 className="mt-1 text-base font-semibold text-ink">
            {hasSubscription
              ? t("profile.plan.pro")
              : hasManagedBalance
                ? t("usage.plan.balance")
                : mode === "local"
                  ? t("usage.plan.local")
                  : t("usage.plan.free")}
          </h3>
        </div>
        <Badge
          tone={
            subscriptionActive
              ? "success"
              : subscription.status === "past_due"
                ? "warning"
                : "neutral"
          }
        >
          {subscriptionActive
            ? t("common.states.active")
            : subscription.status === "past_due"
              ? t("usage.plan.pastDue")
              : subscription.status === "canceled"
                ? t("profile.plan.cancelled")
                : hasManagedBalance
                  ? t("usage.plan.inactive")
                  : t("profile.plan.free")}
        </Badge>
      </div>

      {hasManagedBalance ? (
        <div className="mt-7">
          <div className="flex items-end justify-between gap-4">
            <p className="font-display text-[42px] leading-none text-ink tabular-nums">
              {formatCompactNumber(remaining, locale)}
            </p>
            <p className="pb-1 text-xs text-ink-muted">
              {t("usage.allowance.totalRemaining", {
                count: formatNumber(remaining, locale),
              })}
            </p>
          </div>
          {hasSubscription ? (
            <>
              <Progress className="mt-4" value={percent} label={t("usage.allowance.title")} />
              <div className="mt-2 flex justify-between text-[11px] text-ink-muted">
                <span>{formatNumber(includedUsed, locale)}</span>
                <span>{formatNumber(allowance, locale)}</span>
              </div>
            </>
          ) : null}
          <div className={`mt-4 grid gap-2 ${hasSubscription ? "grid-cols-2" : "grid-cols-1"}`}>
            {hasSubscription ? (
              <div className="rounded-2xl bg-accent-soft/55 p-3">
                <CalendarClock className="size-3.5 text-accent" />
                <p className="mt-2 text-sm font-semibold text-ink tabular-nums">
                  {formatCompactNumber(subscriptionTokens, locale)}
                </p>
                <p className="mt-0.5 text-[10px] leading-4 text-ink-muted">
                  {t("usage.allowance.subscriptionTokens")}
                </p>
              </div>
            ) : null}
            <div className="rounded-2xl bg-[#f6efe4] p-3">
              <InfinityIcon className="size-3.5 text-[#997345]" />
              <p className="mt-2 text-sm font-semibold text-ink tabular-nums">
                {formatCompactNumber(purchasedTokens, locale)}
              </p>
              <p className="mt-0.5 text-[10px] leading-4 text-ink-muted">
                {t("usage.allowance.purchasedTokens")}
              </p>
            </div>
          </div>
          <p className="mt-3 flex items-start gap-2 text-[10px] leading-4 text-ink-muted">
            <WalletCards className="mt-0.5 size-3 shrink-0" />
            <span>
              {hasSubscription ? (
                <>
                  {t("usage.allowance.subscriptionFirst")}{" "}
                  {subscription.subscriptionTokensExpireAt
                    ? t("usage.allowance.expires", {
                        date: formatShortDate(subscription.subscriptionTokensExpireAt, locale),
                      })
                    : t("usage.allowance.expiresMonthly")}
                </>
              ) : (
                t("usage.allowance.purchasedOnly")
              )}
            </span>
          </p>
        </div>
      ) : (
        <div className="mt-7 rounded-2xl bg-accent-soft/65 p-4">
          <p className="text-sm font-semibold text-accent">
            {mode === "local" ? t("usage.plan.local") : t("usage.plan.free")}
          </p>
          <p className="mt-1 text-xs leading-5 text-accent/80">
            {mode === "local" ? t("usage.allowance.local") : t("usage.allowance.byok")}
          </p>
        </div>
      )}

      <div className="mt-auto pt-7">
        <Button variant="secondary" className="w-full" onClick={onManage}>
          {mode === "pro" ? t("usage.plan.manageBilling") : t("common.actions.upgrade")}
          <ArrowUpRight className="size-3.5" />
        </Button>
      </div>
    </Card>
  );
}
