import { Suspense, useEffect, useState, type ReactNode } from "react";

import {
  DictionaryPage,
  HistoryPage,
  ProfilePage,
  PromptPage,
  SettingsPage,
  UsagePage,
} from "@/app/lazyPages";
import { NavigationContext, routeFromHash, type AppRoute } from "@/app/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { appRoutes } from "@/config/app";

function deferredPage(page: ReactNode) {
  return (
    <Suspense
      fallback={
        <div className="h-full animate-pulse bg-canvas" aria-busy="true" aria-live="polite" />
      }
    >
      {page}
    </Suspense>
  );
}

function routePage(path: AppRoute): ReactNode {
  switch (path) {
    case appRoutes.history:
      return <HistoryPage />;
    case appRoutes.prompt:
      return <PromptPage />;
    case appRoutes.dictionary:
      return <DictionaryPage />;
    case appRoutes.profile:
      return <ProfilePage />;
    case appRoutes.settings:
      return <SettingsPage />;
    case appRoutes.usage:
      return <UsagePage />;
  }
}

export function AppRouter() {
  const [path, setPath] = useState<AppRoute>(routeFromHash);

  useEffect(() => {
    const synchronize = () => {
      const route = routeFromHash();
      if (window.location.hash !== `#${route}`) {
        const url = new URL(window.location.href);
        url.hash = route;
        window.history.replaceState(null, "", url);
      }
      setPath(route);
    };
    synchronize();
    window.addEventListener("hashchange", synchronize);
    return () => window.removeEventListener("hashchange", synchronize);
  }, []);

  return (
    <NavigationContext.Provider value={path}>
      <AppShell>{deferredPage(routePage(path))}</AppShell>
    </NavigationContext.Provider>
  );
}
