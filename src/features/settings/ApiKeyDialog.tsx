import { Eye, EyeOff, KeyRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { FieldLabel, Input } from "@/components/ui/Field";
import { secureSecretService } from "@/services/secureSecretService";

export function ApiKeyDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [apiKey, setApiKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<"idle" | "testing" | "invalid">("idle");

  const save = async () => {
    setStatus("testing");
    try {
      const valid = await secureSecretService.testOpenAiKey(apiKey);
      if (!valid) {
        setStatus("invalid");
        return;
      }
      await secureSecretService.setOpenAiKey(apiKey);
      setApiKey("");
      setStatus("idle");
      onSaved();
      onClose();
    } catch {
      setStatus("invalid");
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("settings.api.keyTitle")}
      description={t("settings.api.keyDescription")}
    >
      <div>
        <FieldLabel htmlFor="settings-api-key">{t("onboarding.setup.apiKey.label")}</FieldLabel>
        <div className="relative">
          <KeyRound className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
          <Input
            id="settings-api-key"
            type={visible ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value);
              setStatus("idle");
            }}
            placeholder={t("onboarding.setup.apiKey.placeholder")}
            className="pl-10 pr-11"
            invalid={status === "invalid"}
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-ink-muted hover:bg-ink/[0.05] hover:text-ink"
            onClick={() => setVisible((value) => !value)}
            aria-label={
              visible ? t("onboarding.setup.apiKey.hide") : t("onboarding.setup.apiKey.show")
            }
          >
            {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {status === "invalid" ? (
          <p className="mt-2 text-xs text-danger">{t("settings.api.testFailure")}</p>
        ) : null}
        <p className="mt-3 text-xs leading-5 text-ink-muted">{t("onboarding.setup.apiKey.help")}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.actions.cancel")}
          </Button>
          <Button
            loading={status === "testing"}
            disabled={!apiKey.trim()}
            onClick={() => void save()}
          >
            {status === "testing" ? t("common.states.testing") : t("common.actions.save")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
