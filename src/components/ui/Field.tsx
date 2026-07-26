import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";

import { cn } from "@/utils/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-xl border border-line-strong/80 bg-raised px-3.5 text-sm text-ink shadow-[0_1px_1px_rgba(25,24,23,0.03)] placeholder:text-ink-muted transition-colors hover:border-ink/25 focus:border-accent/60 focus:outline-none",
        invalid && "border-danger/70",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...props}
    />
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full resize-none rounded-2xl border border-line-strong/80 bg-raised px-4 py-3.5 text-[15px] leading-6 text-ink shadow-[0_1px_1px_rgba(25,24,23,0.03)] placeholder:text-ink-muted transition-colors hover:border-ink/25 focus:border-accent/60 focus:outline-none",
        className,
      )}
      {...props}
    />
  );
});

export function FieldLabel({
  children,
  htmlFor,
  hint,
}: {
  children: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="mb-2 flex items-baseline justify-between gap-3">
      <span className="text-[13px] font-semibold text-ink">{children}</span>
      {hint ? <span className="text-xs font-normal text-ink-muted">{hint}</span> : null}
    </label>
  );
}
