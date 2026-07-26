import { Languages } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { changeLocale } from "@/locales";
import { usePreferencesStore } from "@/stores/preferencesStore";
import type { Locale } from "@/types/domain";

const languageOptions: Locale[] = ["en", "da", "no", "sv"];

export function LanguageStep({
  onBack,
  onContinue,
}: {
  onBack: () => void;
  onContinue: () => void;
}) {
  const { t, i18n } = useTranslation();
  const savedLocale = usePreferencesStore((state) => state.locale);
  const savedTranscriptionLanguage = usePreferencesStore((state) => state.transcriptionLanguage);
  const setLocale = usePreferencesStore((state) => state.setLocale);
  const setTranscriptionLanguage = usePreferencesStore((state) => state.setTranscriptionLanguage);
  const initialLocale = useMemo(() => {
    const resolvedLocale = i18n.resolvedLanguage as Locale | undefined;
    return resolvedLocale && languageOptions.includes(resolvedLocale)
      ? resolvedLocale
      : savedLocale;
  }, [i18n.resolvedLanguage, savedLocale]);
  const [appLanguage, setAppLanguage] = useState<Locale>(initialLocale);
  const [speechLanguage, setSpeechLanguage] = useState<Locale>(savedTranscriptionLanguage);

  const saveAndContinue = () => {
    setLocale(appLanguage);
    setTranscriptionLanguage(speechLanguage);
    void changeLocale(appLanguage);
    onContinue();
  };

  return (
    <div className="mx-auto max-w-[610px]">
      <div className="text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
          <Languages className="size-5" />
        </span>
        <h1 className="mt-5 font-display text-[46px] leading-none text-ink">
          {t("onboarding.language.title")}
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-sm leading-6 text-ink-muted">
          {t("onboarding.language.description")}
        </p>
      </div>

      <Card className="mt-9 overflow-hidden bg-raised" elevated>
        <div className="flex min-h-[82px] items-center justify-between gap-6 border-b border-line/80 px-5 py-4 max-[620px]:items-start max-[620px]:gap-4 max-[520px]:flex-col">
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold text-ink">
              {t("onboarding.language.interfaceLabel")}
            </h2>
            <p className="mt-1 text-xs leading-5 text-ink-muted">
              {t("onboarding.language.interfaceDescription")}
            </p>
          </div>
          <Select
            aria-label={t("onboarding.language.interfaceLabel")}
            value={appLanguage}
            onChange={(event) => {
              const nextLocale = event.target.value as Locale;
              setAppLanguage(nextLocale);
              void changeLocale(nextLocale);
            }}
            className="w-[170px] shrink-0 max-[520px]:w-full"
          >
            {languageOptions.map((language) => (
              <option key={language} value={language}>
                {t(`languages.${language}`)}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex min-h-[82px] items-center justify-between gap-6 px-5 py-4 max-[620px]:items-start max-[620px]:gap-4 max-[520px]:flex-col">
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold text-ink">
              {t("onboarding.language.speechLabel")}
            </h2>
            <p className="mt-1 text-xs leading-5 text-ink-muted">
              {t("onboarding.language.speechDescription")}
            </p>
          </div>
          <Select
            aria-label={t("onboarding.language.speechLabel")}
            value={speechLanguage}
            onChange={(event) => setSpeechLanguage(event.target.value as Locale)}
            className="w-[170px] shrink-0 max-[520px]:w-full"
          >
            {languageOptions.map((language) => (
              <option key={language} value={language}>
                {t(`languages.${language}`)}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      <div className="mt-6 flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={onBack}>
          {t("common.actions.back")}
        </Button>
        <Button onClick={saveAndContinue}>{t("common.actions.continue")}</Button>
      </div>
    </div>
  );
}
