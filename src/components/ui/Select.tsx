import { ChevronDown } from "lucide-react";
import { forwardRef, type SelectHTMLAttributes } from "react";

import { cn } from "@/utils/cn";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <span className={cn("relative inline-flex", className)}>
        <select
          ref={ref}
          className="h-10 w-full appearance-none rounded-xl border border-line-strong/80 bg-raised py-0 pl-3 pr-9 text-[13px] font-medium text-ink shadow-sm transition-colors hover:border-ink/25 focus:border-accent/60 focus:outline-none"
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-muted"
        />
      </span>
    );
  },
);
