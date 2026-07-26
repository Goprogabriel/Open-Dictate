import { Keycap } from "@/components/ui/Keycap";
import { usePlatformStore } from "@/stores/platformStore";

export function ShortcutKeycaps({ compact = false }: { compact?: boolean }) {
  const os = usePlatformStore((state) => state.os);
  const shortcutLabel = usePlatformStore((state) => state.shortcutLabel);

  if (compact) {
    return <span className="text-[11px] font-semibold text-ink-muted">{shortcutLabel}</span>;
  }

  const keys = os === "windows" ? ["Alt", "Win"] : ["⌥", "⌘"];
  return (
    <div className="flex items-center gap-1.5" aria-label={shortcutLabel}>
      <Keycap>{keys[0]}</Keycap>
      <span className="text-xs text-ink-muted">+</span>
      <Keycap>{keys[1]}</Keycap>
    </div>
  );
}
