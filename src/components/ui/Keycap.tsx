import type { HTMLAttributes } from "react";

import { cn } from "@/utils/cn";

export function Keycap({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-line-strong bg-raised px-1.5 font-sans text-[11px] font-semibold text-ink-soft shadow-[0_1px_0_rgba(25,24,23,0.12)]",
        className,
      )}
      {...props}
    />
  );
}
