import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { FieldLabel, Input } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import type { Locale } from "@/types/domain";

export function DictionaryDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (spoken: string, replacement: string, language: Locale | "all") => void;
}) {
  const { t } = useTranslation();
  const [spoken, setSpoken] = useState("");
  const [replacement, setReplacement] = useState("");
  const [language, setLanguage] = useState<Locale | "all">("all");
  const [submitted, setSubmitted] = useState(false);

  const valid = Boolean(spoken.trim() && replacement.trim());

  const close = () => {
    setSpoken("");
    setReplacement("");
    setLanguage("all");
    setSubmitted(false);
    onClose();
  };

  const submit = () => {
    setSubmitted(true);
    if (!valid) return;
    onSubmit(spoken, replacement, language);
    close();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t("dictionary.form.addTitle")}
      description={t("dictionary.form.description")}
    >
      <div className="space-y-4">
        <div>
          <FieldLabel htmlFor="dictionary-spoken">{t("dictionary.form.wrongLabel")}</FieldLabel>
          <Input
            id="dictionary-spoken"
            value={spoken}
            onChange={(event) => setSpoken(event.target.value)}
            placeholder={t("dictionary.form.wrongPlaceholder")}
            invalid={submitted && !spoken.trim()}
            autoFocus
          />
        </div>
        <div>
          <FieldLabel htmlFor="dictionary-replacement">
            {t("dictionary.form.correctLabel")}
          </FieldLabel>
          <Input
            id="dictionary-replacement"
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            placeholder={t("dictionary.form.correctPlaceholder")}
            invalid={submitted && !replacement.trim()}
          />
        </div>
        <div>
          <FieldLabel htmlFor="dictionary-language">
            {t("dictionary.form.languageLabel")}
          </FieldLabel>
          <Select
            id="dictionary-language"
            value={language}
            onChange={(event) => setLanguage(event.target.value as Locale | "all")}
            className="w-full"
          >
            <option value="all">{t("dictionary.form.allLanguages")}</option>
            {(["en", "da", "no", "sv"] as Locale[]).map((item) => (
              <option key={item} value={item}>
                {t(`languages.${item}`)}
              </option>
            ))}
          </Select>
        </div>
        {submitted && !valid ? (
          <p className="text-xs font-medium text-danger">{t("dictionary.form.required")}</p>
        ) : null}
        {spoken && replacement ? (
          <p className="rounded-xl bg-accent-soft/55 px-3.5 py-3 text-xs text-accent">
            {t("dictionary.form.preview", { wrong: spoken, correct: replacement })}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={close}>
            {t("common.actions.cancel")}
          </Button>
          <Button onClick={submit}>{t("dictionary.form.add")}</Button>
        </div>
      </div>
    </Dialog>
  );
}
