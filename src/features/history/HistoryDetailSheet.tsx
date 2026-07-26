import { Copy, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import type { Dictation, Locale } from "@/types/domain";
import { formatDateTime } from "@/utils/date";
import { formatDuration, formatNumber } from "@/utils/format";

export function HistoryDetailSheet({
  item,
  locale,
  onClose,
  onCopy,
  onReuse,
  onDelete,
}: {
  item: Dictation | null;
  locale: Locale;
  onClose: () => void;
  onCopy: () => void;
  onReuse: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!item) return;
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [item, onClose]);

  if (!item) return null;

  return (
    <div className="fixed inset-0 z-40 bg-ink/10 backdrop-blur-[1px]" role="presentation">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label={t("common.actions.close")}
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-detail-title"
        className="page-enter absolute bottom-3 right-3 top-3 flex w-[min(480px,calc(100%-24px))] flex-col rounded-[22px] border border-line bg-surface shadow-float"
      >
        <header className="flex items-start justify-between border-b border-line/80 px-6 py-5">
          <div>
            <div className="flex items-center gap-2">
              <h2 id="history-detail-title" className="text-base font-semibold text-ink">
                {item.application}
              </h2>
              <Badge>{formatDuration(item.durationMs)}</Badge>
            </div>
            <p className="mt-1 text-xs text-ink-muted">{formatDateTime(item.createdAt, locale)}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="-mr-2 -mt-2"
            onClick={onClose}
            aria-label={t("common.actions.close")}
          >
            <X className="size-4" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <p className="whitespace-pre-wrap text-[15px] leading-7 text-ink">{item.text}</p>
          <dl className="mt-8 grid grid-cols-2 gap-3 border-t border-line/80 pt-5">
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-muted">
                {t("history.details.language")}
              </dt>
              <dd className="mt-1 text-xs font-medium uppercase text-ink">{item.language}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-muted">
                {t("usage.metrics.wordsGenerated")}
              </dt>
              <dd className="mt-1 text-xs font-medium text-ink">
                {formatNumber(item.words, locale)}
              </dd>
            </div>
          </dl>
        </div>
        <footer className="flex items-center gap-2 border-t border-line/80 px-6 py-4">
          <Button onClick={onCopy} className="flex-1">
            <Copy className="size-4" />
            {t("common.actions.copy")}
          </Button>
          <Button variant="secondary" onClick={onReuse}>
            <RotateCcw className="size-4" />
            {t("common.actions.reuse")}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-danger"
            onClick={onDelete}
            aria-label={t("common.actions.delete")}
          >
            <Trash2 className="size-4" />
          </Button>
        </footer>
      </aside>
    </div>
  );
}
