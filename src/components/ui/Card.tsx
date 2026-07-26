import type { HTMLAttributes } from "react";

import { cn } from "@/utils/cn";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
}

export function Card({ className, elevated = false, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-[18px] border border-line/90 bg-surface",
        elevated && "bg-raised shadow-card",
        className,
      )}
      {...props}
    />
  );
}
