import type { ReactNode } from "react";

import { Card } from "@/components/ui/Card";
import { cn } from "@/utils/cn";

export function SettingsGroup({
  title,
  description,
  children,
  danger = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <section className="grid grid-cols-[180px_minmax(0,1fr)] gap-8 max-[1120px]:grid-cols-1 max-[1120px]:gap-3">
      <div className="pt-1">
        <h2 className={cn("text-sm font-semibold text-ink", danger && "text-danger")}>{title}</h2>
        {description ? (
          <p className="mt-1 text-xs leading-5 text-ink-muted">{description}</p>
        ) : null}
      </div>
      <Card className={cn("overflow-hidden bg-raised", danger && "border-danger/25")}>
        {children}
      </Card>
    </section>
  );
}

export function SettingRow({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[68px] items-center justify-between gap-6 border-b border-line/80 px-5 py-3.5 last:border-b-0",
        className,
      )}
    >
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        {description ? (
          <p className="mt-0.5 text-xs leading-5 text-ink-muted">{description}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}
