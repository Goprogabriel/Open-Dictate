import { cn } from "@/utils/cn";

export function Logo({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 32 32"
      className={cn("size-7 text-ink", className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M6.3 17.2c-3.1-1.2-3.7-4.4-2.4-6.7 1.2-2.2 4.1-3.4 6.8-1.9 3.4 1.8 3.2 7.4.5 11.2-2.3 3.3-6.3 4.8-8.4 2.1-1.6-2.2-.3-5.2 2.5-6.2"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M25.7 14.8c3.1 1.2 3.7 4.4 2.4 6.7-1.2 2.2-4.1 3.4-6.8 1.9-3.4-1.8-3.2-7.4-.5-11.2 2.3-3.3 6.3-4.8 8.4-2.1 1.6 2.2.3 5.2-2.5 6.2"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11.7 20.7c1.2-1.9 2.6-3.3 4.2-4.7 1.6-1.3 3-2.8 4.3-4.8"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
