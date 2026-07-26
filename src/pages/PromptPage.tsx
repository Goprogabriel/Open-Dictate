import { Check, RotateCcw, Sparkles } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { PageFrame } from "@/components/layout/PageFrame";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FieldLabel, Textarea } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { PromptPreview } from "@/features/prompt/PromptPreview";
import { usePromptStore } from "@/stores/promptStore";
import type { Locale } from "@/types/domain";
import { cn } from "@/utils/cn";

const maxPromptLength = 4000;
type Preset = {
  key: "professional" | "concise" | "technical" | "danish";
  value: string;
  title?: string;
  language?: Locale;
};

export function PromptPage() {
  const { t, i18n } = useTranslation();
  const customPrompt = usePromptStore((state) => state.customPrompt);
  const outputLanguage = usePromptStore((state) => state.outputLanguage);
  const removeFillers = usePromptStore((state) => state.removeFillers);
  const correctPunctuation = usePromptStore((state) => state.correctPunctuation);
  const formatLists = usePromptStore((state) => state.formatLists);
  const saveState = usePromptStore((state) => state.saveState);
  const setPrompt = usePromptStore((state) => state.setPrompt);
  const setOutputLanguage = usePromptStore((state) => state.setOutputLanguage);
  const setBehavior = usePromptStore((state) => state.setBehavior);
  const setSaveState = usePromptStore((state) => state.setSaveState);

  useEffect(() => {
    if (saveState !== "saving") return;
    const timeout = window.setTimeout(() => setSaveState("saved"), 650);
    return () => window.clearTimeout(timeout);
  }, [
    customPrompt,
    correctPunctuation,
    formatLists,
    outputLanguage,
    removeFillers,
    saveState,
    setSaveState,
  ]);

  const appLanguage = i18n.resolvedLanguage ?? "en";
  const danishLanguageName =
    appLanguage === "en" ? t("languages.da") : t("languages.da").toLocaleLowerCase(appLanguage);
  const presets: Preset[] = [
    { key: "professional", value: t("prompt.examples.professional") },
    { key: "concise", value: t("prompt.presets.concise") },
    { key: "technical", value: t("prompt.examples.detail") },
    {
      key: "danish",
      title: t("prompt.presets.writeInLanguage", { language: danishLanguageName }),
      value: t("prompt.examples.language", { language: danishLanguageName }),
      language: "da",
    },
  ];

  const applyPreset = (value: string, language?: Locale) => {
    setPrompt(value);
    if (language) setOutputLanguage(language);
  };

  const behaviors = [
    {
      key: "removeFillers" as const,
      title: t("prompt.behaviors.removeFillers"),
      description: t("prompt.behaviors.removeFillersDescription"),
      checked: removeFillers,
    },
    {
      key: "correctPunctuation" as const,
      title: t("prompt.behaviors.punctuation"),
      description: t("prompt.behaviors.punctuationDescription"),
      checked: correctPunctuation,
    },
    {
      key: "formatLists" as const,
      title: t("prompt.behaviors.formatLists"),
      description: t("prompt.behaviors.formatListsDescription"),
      checked: formatLists,
    },
  ];

  return (
    <PageFrame>
      <PageHeader
        title={t("prompt.title")}
        description={t("prompt.subtitle")}
        actions={
          <span
            className={cn(
              "flex items-center gap-1.5 text-xs font-medium",
              saveState === "error" ? "text-danger" : "text-ink-muted",
            )}
          >
            {saveState === "saved" ? <Check className="size-3.5 text-accent" /> : null}
            {t(`prompt.saveStatus.${saveState}`)}
          </span>
        }
      />

      <div className="grid grid-cols-[minmax(0,1fr)_330px] items-start gap-5 max-[1040px]:grid-cols-1">
        <div className="space-y-5">
          <Card className="p-6" elevated>
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-accent" />
              <h2 className="text-sm font-semibold text-ink">{t("prompt.presets.title")}</h2>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {presets.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => applyPreset(preset.value, preset.language)}
                  className="h-9 rounded-full border border-line-strong/80 bg-surface px-3.5 text-xs font-semibold text-ink-soft transition-colors hover:border-ink/25 hover:bg-raised hover:text-ink"
                >
                  {preset.title ?? t(`prompt.presets.${preset.key}`)}
                </button>
              ))}
            </div>

            <div className="mt-6">
              <FieldLabel
                htmlFor="custom-prompt"
                hint={t("prompt.editor.characterCount", {
                  count: customPrompt.length,
                  max: maxPromptLength,
                })}
              >
                {t("prompt.editor.label")}
              </FieldLabel>
              <Textarea
                id="custom-prompt"
                rows={8}
                maxLength={maxPromptLength}
                value={customPrompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={t("prompt.editor.placeholder")}
              />
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="max-w-lg text-xs leading-5 text-ink-muted">
                  {t("prompt.editor.description")}
                </p>
                {customPrompt ? (
                  <Button variant="ghost" size="sm" onClick={() => setPrompt("")}>
                    <RotateCcw className="size-3.5" />
                    {t("common.actions.clear")}
                  </Button>
                ) : null}
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden bg-raised">
            <div className="flex items-center justify-between border-b border-line/80 px-5 py-4">
              <h2 className="text-sm font-semibold text-ink">{t("prompt.behaviors.title")}</h2>
              <label className="flex items-center gap-2 text-xs text-ink-muted">
                {t("languages.en")}
                <Select
                  aria-label={t("languages.en")}
                  value={outputLanguage}
                  onChange={(event) => setOutputLanguage(event.target.value as Locale)}
                  className="w-[145px]"
                >
                  {(["en", "da", "no", "sv"] as Locale[]).map((language) => (
                    <option key={language} value={language}>
                      {t(`languages.${language}`)}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            {behaviors.map((behavior) => (
              <div
                key={behavior.key}
                className="flex min-h-[72px] items-center justify-between gap-6 border-b border-line/70 px-5 py-3.5 last:border-0"
              >
                <div>
                  <h3 className="text-[13px] font-semibold text-ink">{behavior.title}</h3>
                  <p className="mt-0.5 text-xs leading-5 text-ink-muted">{behavior.description}</p>
                </div>
                <Switch
                  checked={behavior.checked}
                  onCheckedChange={(checked) => setBehavior({ [behavior.key]: checked })}
                  label={behavior.title}
                />
              </div>
            ))}
          </Card>
        </div>

        <PromptPreview />
      </div>
    </PageFrame>
  );
}
