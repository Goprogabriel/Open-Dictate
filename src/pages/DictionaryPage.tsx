import { ArrowRight, BookOpenText, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { PageFrame } from "@/components/layout/PageFrame";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Field";
import { DictionaryDialog } from "@/features/dictionary/DictionaryDialog";
import { useDictionaryStore } from "@/stores/dictionaryStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import type { Locale } from "@/types/domain";
import { formatShortDate } from "@/utils/date";

export function DictionaryPage() {
  const { t } = useTranslation();
  const locale = usePreferencesStore((state) => state.locale);
  const entries = useDictionaryStore((state) => state.entries);
  const addEntry = useDictionaryStore((state) => state.addEntry);
  const deleteEntry = useDictionaryStore((state) => state.deleteEntry);
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return entries.filter(
      (entry) =>
        !normalized ||
        entry.spoken.toLocaleLowerCase().includes(normalized) ||
        entry.replacement.toLocaleLowerCase().includes(normalized),
    );
  }, [entries, query]);

  return (
    <PageFrame>
      <PageHeader
        title={t("dictionary.title")}
        description={t("dictionary.subtitle")}
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="size-4" />
            {t("dictionary.addTerm")}
          </Button>
        }
      />

      <Card className="overflow-hidden" elevated>
        <div className="flex items-center justify-between gap-4 border-b border-line/80 p-4">
          <label className="relative w-full max-w-md">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("dictionary.searchPlaceholder")}
              aria-label={t("common.actions.search")}
              className="pl-10"
            />
          </label>
          <span className="shrink-0 text-xs font-semibold text-ink-muted">
            {t("dictionary.count", { count: filtered.length })}
          </span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={BookOpenText}
            title={entries.length ? t("dictionary.noResults.title") : t("dictionary.empty.title")}
            description={
              entries.length
                ? t("dictionary.noResults.description")
                : t("dictionary.empty.description")
            }
            actionLabel={!entries.length ? t("dictionary.addTerm") : undefined}
            onAction={!entries.length ? () => setDialogOpen(true) : undefined}
          />
        ) : (
          <div>
            <div className="grid grid-cols-[1fr_28px_1fr_130px_90px_40px] items-center gap-3 border-b border-line/80 bg-sidebar/30 px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.11em] text-ink-muted max-[980px]:grid-cols-[1fr_28px_1fr_40px]">
              <span>{t("dictionary.columns.heardAs")}</span>
              <span />
              <span>{t("dictionary.columns.writeAs")}</span>
              <span className="max-[980px]:hidden">{t("dictionary.columns.language")}</span>
              <span className="max-[980px]:hidden">{t("dictionary.columns.updated")}</span>
              <span />
            </div>
            {filtered.map((entry) => (
              <div
                key={entry.id}
                className="group grid min-h-[58px] grid-cols-[1fr_28px_1fr_130px_90px_40px] items-center gap-3 border-b border-line/70 px-5 py-3 text-[13px] last:border-b-0 hover:bg-ink/[0.018] max-[980px]:grid-cols-[1fr_28px_1fr_40px]"
              >
                <span className="truncate text-ink-soft">{entry.spoken}</span>
                <ArrowRight className="size-3.5 text-ink-muted" />
                <span className="truncate font-semibold text-ink">{entry.replacement}</span>
                <span className="text-xs text-ink-muted max-[980px]:hidden">
                  {entry.language === "all"
                    ? t("common.misc.all")
                    : t(`languages.${entry.language}`)}
                </span>
                <span className="text-xs text-ink-muted max-[980px]:hidden">
                  {formatShortDate(entry.updatedAt, locale)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-ink-muted opacity-0 group-hover:opacity-100 focus:opacity-100"
                  title={t("common.actions.remove")}
                  onClick={() => deleteEntry(entry.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
      {!entries.length ? (
        <p className="mt-3 text-center text-xs text-ink-muted">{t("dictionary.empty.examples")}</p>
      ) : null}

      <DictionaryDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={(spoken, replacement, language: Locale | "all") =>
          addEntry(spoken, replacement, language)
        }
      />
    </PageFrame>
  );
}
