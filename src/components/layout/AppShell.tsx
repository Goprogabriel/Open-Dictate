import type { ReactNode } from "react";

import { AppSidebar } from "@/components/layout/AppSidebar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full w-full bg-canvas">
      <AppSidebar />
      <main className="relative min-w-0 flex-1">
        <div
          data-tauri-drag-region
          className="tauri-drag-region pointer-events-none absolute inset-x-0 top-0 z-20 h-[var(--titlebar-height)]"
        />
        {children}
      </main>
    </div>
  );
}
