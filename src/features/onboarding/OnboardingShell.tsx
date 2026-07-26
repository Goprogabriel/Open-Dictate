import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Logo } from "@/components/ui/Logo";

export function OnboardingShell({
  step,
  totalSteps = 5,
  children,
}: {
  step: number;
  totalSteps?: number;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="relative h-full overflow-y-auto bg-canvas">
      <div data-tauri-drag-region className="tauri-drag-region fixed inset-x-0 top-0 z-10 h-10" />
      <header className="fixed left-0 right-0 top-0 z-20 flex h-16 items-end justify-between px-8 pb-2 pointer-events-none">
        <div className="flex items-center gap-2.5">
          <Logo className="size-6" />
          <span className="text-sm font-semibold tracking-[-0.02em] text-ink">Open Dictate</span>
        </div>
        <span className="text-xs font-medium text-ink-muted">
          {t("onboarding.progress", { current: step + 1, total: totalSteps })}
        </span>
      </header>
      <div className="mx-auto flex min-h-full w-full max-w-[940px] items-center justify-center px-10 py-24">
        <main className="page-enter w-full" key={step}>
          {children}
        </main>
      </div>
      <div className="fixed bottom-0 left-0 right-0 h-1 bg-line/50">
        <div
          className="h-full bg-accent transition-[width] duration-500"
          style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
        />
      </div>
    </div>
  );
}
