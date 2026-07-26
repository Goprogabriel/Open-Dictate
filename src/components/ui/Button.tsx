import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "@/utils/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-ink text-inverse shadow-sm hover:bg-black disabled:bg-ink/35 disabled:text-inverse/80",
  secondary:
    "border border-line-strong/80 bg-surface text-ink shadow-sm hover:border-ink/25 hover:bg-raised disabled:text-ink-muted",
  ghost: "text-ink-soft hover:bg-ink/[0.055] hover:text-ink disabled:text-ink-muted",
  danger: "bg-danger text-white shadow-sm hover:bg-[#a83f3b] disabled:bg-danger/40",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-[13px]",
  lg: "h-[46px] px-5 text-sm",
  icon: "size-9 p-0",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", loading = false, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex shrink-0 cursor-default items-center justify-center gap-2 rounded-xl font-semibold transition-[background,color,border-color,transform] duration-150 active:scale-[0.985] disabled:pointer-events-none",
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
        />
      ) : null}
      {children}
    </button>
  );
});
