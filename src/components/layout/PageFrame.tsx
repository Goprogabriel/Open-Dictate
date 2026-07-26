import type { ReactNode } from "react";

import { cn } from "@/utils/cn";

interface PageFrameProps {
  children: ReactNode;
  className?: string;
}

export function PageFrame({ children, className }: PageFrameProps) {
  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <div
        className={cn(
          "page-enter mx-auto w-full max-w-[1240px] px-10 pb-14 pt-8 max-[1100px]:px-7",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
