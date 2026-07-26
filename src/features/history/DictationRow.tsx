import { Copy, MoreHorizontal, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";
import type { Dictation, Locale } from "@/types/domain";
import { formatDateTime } from "@/utils/date";
import { formatDuration } from "@/utils/format";

function applicationMonogram(application: string): string {
  return application.slice(0, 1).toUpperCase();
}

export function DictationRow({
  item,
  locale,
  onSelect,
  onCopy,
  onReuse,
}: {
  item: Dictation;
  locale: Locale;
  onSelect: () => void;
  onCopy: () => void;
  onReuse: () => void;
}) {
  const { t } = useTranslation();

  return (
    <article className="group flex items-center gap-4 border-b border-line/70 px-4 py-4 last:border-b-0 hover:bg-ink/[0.018]">
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 cursor-default items-center gap-4 text-left"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-line bg-raised text-xs font-bold text-ink-soft shadow-sm">
          {applicationMonogram(item.application)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-xs">
            <strong className="font-semibold text-ink">{item.application}</strong>
            <span className="text-ink-muted">·</span>
            <span className="text-ink-muted">{formatDateTime(item.createdAt, locale)}</span>
          </span>
          <span className="mt-1.5 line-clamp-2 block text-[13px] leading-5 text-ink-soft">
            {item.text}
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-ink/[0.045] px-2 py-1 text-[10px] font-semibold text-ink-muted tabular-nums">
          {formatDuration(item.durationMs)}
        </span>
      </button>
      <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <Button size="icon" variant="ghost" title={t("common.actions.copy")} onClick={onCopy}>
          <Copy className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" title={t("common.actions.reuse")} onClick={onReuse}>
          <RotateCcw className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" title={t("common.actions.showMore")} onClick={onSelect}>
          <MoreHorizontal className="size-4" />
        </Button>
      </div>
    </article>
  );
}
