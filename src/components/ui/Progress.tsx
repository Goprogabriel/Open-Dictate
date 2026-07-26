import { cn } from "@/utils/cn";

interface ProgressProps {
  value: number;
  className?: string;
  indicatorClassName?: string;
  label: string;
}

export function Progress({ value, className, indicatorClassName, label }: ProgressProps) {
  const normalized = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(normalized)}
      aria-label={label}
      className={cn("h-2 overflow-hidden rounded-full bg-ink/[0.08]", className)}
    >
      <div
        className={cn(
          "h-full rounded-full bg-accent transition-[width] duration-500",
          indicatorClassName,
        )}
        style={{ width: `${normalized}%` }}
      />
    </div>
  );
}
