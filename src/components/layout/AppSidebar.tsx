import {
  BarChart3,
  BookOpenText,
  History,
  Settings2,
  SlidersHorizontal,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { useAppPath } from "@/app/navigation";
import { Badge } from "@/components/ui/Badge";
import { Logo } from "@/components/ui/Logo";
import { ShortcutKeycaps } from "@/components/ui/ShortcutKeycaps";
import { appRoutes } from "@/config/app";
import { usePlatformStore } from "@/stores/platformStore";
import { useSessionStore } from "@/stores/sessionStore";
import { cn } from "@/utils/cn";

const navigation: Array<{ key: string; to: string; icon: LucideIcon }> = [
  { key: "usage", to: appRoutes.usage, icon: BarChart3 },
  { key: "history", to: appRoutes.history, icon: History },
  { key: "prompt", to: appRoutes.prompt, icon: SlidersHorizontal },
  { key: "dictionary", to: appRoutes.dictionary, icon: BookOpenText },
  { key: "profile", to: appRoutes.profile, icon: UserRound },
  { key: "settings", to: appRoutes.settings, icon: Settings2 },
];

function getInitials(name: string): string {
  if (!name.trim()) return "OD";
  return name
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export function AppSidebar() {
  const { t } = useTranslation();
  const profile = useSessionStore((state) => state.profile);
  const subscription = useSessionStore((state) => state.subscription);
  const shortcutLabel = usePlatformStore((state) => state.shortcutLabel);
  const currentPath = useAppPath();

  return (
    <aside className="relative z-10 flex h-full w-[var(--sidebar-width)] shrink-0 flex-col border-r border-line bg-sidebar px-3 pb-4 transition-[width] duration-200">
      <div
        data-tauri-drag-region
        className="tauri-drag-region h-[var(--titlebar-height)] shrink-0"
      />
      <div className="mb-6 flex h-11 items-center gap-2.5 px-2 max-[1039px]:justify-center max-[1039px]:px-0">
        <Logo className="size-6 shrink-0" />
        <span className="truncate text-[17px] font-semibold tracking-[-0.025em] text-ink max-[1039px]:hidden">
          Open Dictate
        </span>
      </div>

      <nav className="space-y-1" aria-label={t("nav.ariaLabel")}>
        {navigation.map(({ key, to, icon: Icon }) => (
          <a
            key={key}
            href={`#${to}`}
            title={t(`nav.${key}`)}
            aria-current={currentPath === to ? "page" : undefined}
            className={cn(
              "group flex h-[42px] cursor-default items-center gap-3 rounded-xl px-3 text-[13px] font-medium text-ink-soft transition-colors hover:bg-ink/[0.045] hover:text-ink max-[1039px]:justify-center max-[1039px]:px-0",
              currentPath === to && "bg-raised/75 text-ink shadow-[0_1px_2px_rgba(25,24,23,.05)]",
            )}
          >
            <Icon className="size-[17px] shrink-0" strokeWidth={1.8} />
            <span className="truncate max-[1039px]:hidden">{t(`nav.${key}`)}</span>
          </a>
        ))}
      </nav>

      <div className="mt-auto space-y-3">
        <div className="mx-1 rounded-2xl border border-line/80 bg-surface/75 p-3 max-[1039px]:hidden">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-xs font-semibold text-ink">
              <span className="size-1.5 rounded-full bg-accent shadow-[0_0_0_3px_rgba(58,114,88,.10)]" />
              {t("app.ready")}
            </span>
            <ShortcutKeycaps compact />
          </div>
          <p className="mt-2 text-[11px] leading-4 text-ink-muted">
            {t("hud.shortcut", { shortcut: shortcutLabel })}
          </p>
        </div>

        <a
          href={`#${appRoutes.profile}`}
          aria-current={currentPath === appRoutes.profile ? "page" : undefined}
          className={cn(
            "flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-ink/[0.04] max-[1039px]:justify-center",
            currentPath === appRoutes.profile && "bg-raised/75",
          )}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-[10px] font-bold tracking-wide text-inverse">
            {getInitials(profile.name)}
          </span>
          <span className="min-w-0 flex-1 max-[1039px]:hidden">
            <span className="block truncate text-xs font-semibold text-ink">
              {profile.name || t("profile.plan.free")}
            </span>
            <span className="block truncate text-[11px] text-ink-muted">
              {profile.email ?? t("common.states.notConnected")}
            </span>
          </span>
          <Badge
            tone={subscription.plan === "pro" ? "success" : "neutral"}
            className="max-[1039px]:hidden"
          >
            {subscription.plan === "pro" ? "Pro" : t("common.misc.all")}
          </Badge>
        </a>
      </div>
    </aside>
  );
}
