import { Search, Trash2, Waves } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { PageFrame } from "@/components/layout/PageFrame";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { DictationRow } from "@/features/history/DictationRow";
import { HistoryDetailSheet } from "@/features/history/HistoryDetailSheet";
import { nativeClient } from "@/services/native";
import { useHistoryStore } from "@/stores/historyStore";
import { usePlatformStore } from "@/stores/platformStore";
import { usePreferencesStore } from "@/stores/preferencesStore";
import type { Dictation } from "@/types/domain";
import { formatNumber } from "@/utils/format";

type DateGroup = "today" | "yesterday" | "earlier";

function getDateGroup(value: string): DateGroup {
  const date = new Date(value);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const itemStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const difference = Math.round((start - itemStart) / 86_400_000);
  if (difference <= 0) return "today";
  if (difference === 1) return "yesterday";
  return "earlier";
}

export function HistoryPage() {
  const { t } = useTranslation();
  const locale = usePreferencesStore((state) => state.locale);
  const dictations = useHistoryStore((state) => state.dictations);
  const shortcutLabel = usePlatformStore((state) => state.shortcutLabel);
  const deleteDictation = useHistoryStore((state) => state.deleteDictation);
  const [query, setQuery] = useState("");
  const [application, setApplication] = useState("all");
  const [selected, setSelected] = useState<Dictation | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Dictation | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const applications = useMemo(
    () => [...new Set(dictations.map((item) => item.application))].sort(),
    [dictations],
  );
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return dictations.filter(
      (item) =>
        (application === "all" || item.application === application) &&
        (!normalized ||
          item.text.toLocaleLowerCase().includes(normalized) ||
          item.application.toLocaleLowerCase().includes(normalized)),
    );
  }, [application, dictations, query]);
  const groups = useMemo(
    () =>
      filtered.reduce<Record<DateGroup, Dictation[]>>(
        (result, item) => {
          result[getDateGroup(item.createdAt)].push(item);
          return result;
        },
        { today: [], yesterday: [], earlier: [] },
      ),
    [filtered],
  );

  const copy = async (item: Dictation) => {
    await nativeClient.copyText(item.text);
    setCopied(item.id);
    window.setTimeout(() => setCopied(null), 1200);
  };

  const reuse = async (item: Dictation) => {
    await copy(item);
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    deleteDictation(pendingDelete.id);
    if (selected?.id === pendingDelete.id) setSelected(null);
    setPendingDelete(null);
  };

  return (
    <PageFrame>
      <PageHeader
        title={t("history.title")}
        description={t("history.subtitle")}
        actions={
          <span className="rounded-full bg-ink/[0.055] px-3 py-1.5 text-xs font-semibold text-ink-soft">
            {t("history.resultCount", { count: filtered.length })}
          </span>
        }
      />

      <Card className="overflow-hidden" elevated>
        <div className="flex items-center gap-3 border-b border-line/80 p-4">
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("history.searchPlaceholder")}
              aria-label={t("common.actions.search")}
              className="pl-10"
            />
          </label>
          <Select
            value={application}
            onChange={(event) => setApplication(event.target.value)}
            aria-label={t("history.filters.application")}
            className="w-[170px]"
          >
            <option value="all">{t("history.filters.allApplications")}</option>
            {applications.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={Waves}
            title={
              dictations.length === 0 ? t("history.empty.title") : t("history.noResults.title")
            }
            description={
              dictations.length === 0
                ? t("history.empty.description", { shortcut: shortcutLabel })
                : t("history.noResults.description")
            }
          />
        ) : (
          <div>
            {(["today", "yesterday", "earlier"] as DateGroup[]).map((group) =>
              groups[group].length ? (
                <section key={group}>
                  <h2 className="border-b border-line/70 bg-sidebar/35 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-muted">
                    {t(`history.groups.${group}`)}
                  </h2>
                  {groups[group].map((item) => (
                    <DictationRow
                      key={item.id}
                      item={item}
                      locale={locale}
                      onSelect={() => setSelected(item)}
                      onCopy={() => void copy(item)}
                      onReuse={() => void reuse(item)}
                    />
                  ))}
                </section>
              ) : null,
            )}
          </div>
        )}
      </Card>

      {copied ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-xs font-semibold text-inverse shadow-float">
          {t("history.item.copied")}
        </div>
      ) : null}

      <HistoryDetailSheet
        item={selected}
        locale={locale}
        onClose={() => setSelected(null)}
        onCopy={() => selected && void copy(selected)}
        onReuse={() => selected && void reuse(selected)}
        onDelete={() => selected && setPendingDelete(selected)}
      />

      <Dialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        title={t("history.delete.title")}
        description={t("history.delete.description")}
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setPendingDelete(null)}>
            {t("common.actions.cancel")}
          </Button>
          <Button variant="danger" onClick={confirmDelete}>
            <Trash2 className="size-4" />
            {t("common.actions.delete")}
          </Button>
        </div>
      </Dialog>

      <p className="mt-3 text-right text-[11px] text-ink-muted">
        {formatNumber(filtered.length, locale)} / {formatNumber(dictations.length, locale)}
      </p>
    </PageFrame>
  );
}
