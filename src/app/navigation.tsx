import { createContext, useContext } from "react";

import { appRoutes } from "@/config/app";

export type AppRoute = (typeof appRoutes)[keyof typeof appRoutes];

const validRoutes = new Set<AppRoute>(Object.values(appRoutes));
export const NavigationContext = createContext<AppRoute>(appRoutes.usage);

export function routeFromHash(): AppRoute {
  const candidate = window.location.hash.slice(1).split("?", 1)[0];
  return validRoutes.has(candidate as AppRoute) ? (candidate as AppRoute) : appRoutes.usage;
}

export function navigateTo(path: string): void {
  const route = validRoutes.has(path as AppRoute) ? (path as AppRoute) : appRoutes.usage;
  if (window.location.hash !== `#${route}`) window.location.hash = route;
}

export function useAppPath(): AppRoute {
  return useContext(NavigationContext);
}

export function useAppNavigate(): (path: string) => void {
  return navigateTo;
}
