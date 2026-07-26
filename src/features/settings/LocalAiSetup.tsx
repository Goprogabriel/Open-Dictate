import { Check, Download, HardDrive, LoaderCircle, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";
import { Progress } from "@/components/ui/Progress";
import { formatModelBytes, localAiTiers } from "@/services/localAi";
import { nativeClient } from "@/services/native";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { LocalAiQuality } from "@/types/domain";
import type { LocalModelProgress, LocalModelStatus } from "@/types/native";

function downloadErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return null;
}

export function LocalAiSetup({
  compact = false,
  onReady,
}: {
  compact?: boolean;
  onReady?: () => void;
}) {
  const { t } = useTranslation();
  const savedQuality = usePreferencesStore((state) => state.localAiQuality);
  const setLocalAiQuality = usePreferencesStore((state) => state.setLocalAiQuality);
  const setProcessingMode = usePreferencesStore((state) => state.setProcessingMode);
  const configureLocalUser = useSessionStore((state) => state.configureLocalUser);
  const hasAccount = useSessionStore((state) => state.profile.email !== null);
  const [quality, setQuality] = useState<LocalAiQuality>(savedQuality);
  const [status, setStatus] = useState<LocalModelStatus | null>(null);
  const [progress, setProgress] = useState<LocalModelProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tier = useMemo(
    () => localAiTiers.find((candidate) => candidate.quality === quality) ?? localAiTiers[1]!,
    [quality],
  );
  const downloadedBytes =
    progress?.quality === quality
      ? progress.downloadedBytes
      : status?.quality === quality
        ? status.downloadedBytes
        : 0;
  const totalBytes =
    progress?.quality === quality
      ? progress.totalBytes
      : status?.quality === quality && status.totalBytes > 0
        ? status.totalBytes
        : tier.downloadBytes;
  const percent = totalBytes ? (downloadedBytes / totalBytes) * 100 : 0;
  const installed = status?.quality === quality && status.installed;

  useEffect(() => {
    let active = true;
    let remove: () => void = () => undefined;
    void nativeClient
      .onLocalModelProgress((event) => {
        if (active && event.quality === quality) setProgress(event);
      })
      .then((unlisten) => {
        remove = unlisten;
      });
    void nativeClient
      .getLocalModelStatus(quality)
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      remove();
    };
  }, [quality]);

  const activate = () => {
    setLocalAiQuality(quality);
    setProcessingMode("local");
    if (!hasAccount) configureLocalUser("", "local");
    onReady?.();
  };

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await nativeClient.downloadLocalModels(quality);
      setStatus(next);
      setProgress(null);
      activate();
    } catch (downloadError) {
      setError(downloadErrorMessage(downloadError) ?? "");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div
        className={`grid gap-3 ${compact ? "grid-cols-1" : "grid-cols-3 max-[760px]:grid-cols-1"}`}
      >
        {localAiTiers.map((candidate) => {
          const selected = candidate.quality === quality;
          return (
            <button
              key={candidate.quality}
              type="button"
              aria-pressed={selected}
              className={`rounded-2xl border p-4 text-left transition-colors ${
                selected
                  ? "border-ink bg-ink text-inverse"
                  : "border-line-strong/80 bg-raised text-ink hover:border-ink/30"
              }`}
              onClick={() => {
                setQuality(candidate.quality);
                setProgress(null);
                setError(null);
              }}
            >
              <span className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">
                  {t(`localAi.quality.${candidate.quality}`)}
                </span>
                <span className={`text-[10px] ${selected ? "text-inverse/60" : "text-ink-muted"}`}>
                  {formatModelBytes(candidate.downloadBytes)}
                </span>
              </span>
              <span
                className={`mt-2 block text-[11px] leading-5 ${selected ? "text-inverse/70" : "text-ink-muted"}`}
              >
                {candidate.whisperModel}
                <br />
                {candidate.languageModel}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 rounded-2xl bg-sidebar/50 p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            {installed ? (
              <Check className="size-4" />
            ) : busy ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <HardDrive className="size-4" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-ink">
                {installed
                  ? t("localAi.installed")
                  : busy
                    ? t("localAi.downloading")
                    : t("localAi.downloadRequired")}
              </p>
              <p className="text-[10px] text-ink-muted tabular-nums">
                {formatModelBytes(downloadedBytes)} / {formatModelBytes(totalBytes)}
              </p>
            </div>
            {(busy || downloadedBytes > 0) && !installed ? (
              <Progress className="mt-2" value={percent} label={t("localAi.downloadProgress")} />
            ) : null}
            <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-4 text-ink-muted">
              <ShieldCheck className="mt-0.5 size-3 shrink-0 text-accent" />
              {t("localAi.privacy")}
            </p>
          </div>
        </div>
        {error !== null ? (
          <p className="mt-3 text-xs font-medium text-danger" role="alert">
            {t("localAi.downloadError")}
            {error ? <span className="mt-1 block font-normal">{error}</span> : null}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end">
          {installed ? (
            <Button onClick={activate}>
              <Check className="size-4" />
              {t("localAi.useModels")}
            </Button>
          ) : (
            <Button loading={busy} onClick={() => void download()}>
              <Download className="size-4" />
              {busy ? t("localAi.downloading") : t("localAi.downloadAndContinue")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
