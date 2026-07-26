import { Check, CircleAlert, Copy, Mic2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { nativeClient } from "@/services/native";
import { usePlatformStore } from "@/stores/platformStore";
import type { DictationPhase, HudStateEvent } from "@/types/native";
import { cn } from "@/utils/cn";

function previewState(): HudStateEvent {
  const params = new URLSearchParams(window.location.search);
  const phase = params.get("phase") as DictationPhase | null;
  return {
    phase: phase ?? "idle",
    startedAt: Date.now() - 12_000,
    errorCode: params.get("error") ?? null,
  };
}

function Waveform({ level }: { level: number }) {
  const bars = useMemo(() => [0.48, 0.76, 0.58, 0.95, 0.66, 0.84, 0.52], []);
  return (
    <div className="flex h-6 items-center gap-[3px]" aria-hidden="true">
      {bars.map((factor, index) => (
        <span
          key={`${factor}-${index}`}
          className="w-[3px] rounded-full bg-white/85 transition-[height] duration-75"
          style={{ height: `${Math.max(5, (8 + level * 18) * factor)}px` }}
        />
      ))}
    </div>
  );
}

export function RecordingHud() {
  const { t } = useTranslation();
  const [state, setState] = useState<HudStateEvent>(previewState);
  const [level, setLevel] = useState(0.3);
  const [elapsed, setElapsed] = useState(0);
  const shortcutLabel = usePlatformStore((store) => store.shortcutLabel);

  useEffect(() => {
    let removeHud: () => void = () => undefined;
    let removeAudio: () => void = () => undefined;
    void nativeClient.onHudState(setState).then((remove) => {
      removeHud = remove;
    });
    void nativeClient
      .onAudioLevel((event) => setLevel(event.level))
      .then((remove) => {
        removeAudio = remove;
      });
    return () => {
      removeHud();
      removeAudio();
    };
  }, []);

  useEffect(() => {
    if (state.phase !== "recording") return;
    const update = () => setElapsed(Date.now() - (state.startedAt ?? Date.now()));
    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [state.phase, state.startedAt]);

  const label = (() => {
    if (state.phase === "arming") return t("hud.states.starting");
    if (state.phase === "recording") return t("hud.states.listening");
    if (state.phase === "processing") return t("hud.states.polishing");
    if (state.phase === "inserting") return t("hud.states.inserting");
    if (state.phase === "success") return t("hud.states.inserted");
    if (state.phase === "cancelled") return t("hud.states.cancelled");
    if (state.phase === "error") return t(`hud.errors.${state.errorCode ?? "generic"}`);
    return t("hud.shortcut", { shortcut: shortcutLabel });
  })();

  const seconds = Math.floor(elapsed / 1000);
  const clock = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className="flex h-full w-full items-start justify-center bg-transparent px-1">
      <div
        className={cn(
          "flex min-h-[48px] w-full items-center gap-3 rounded-b-[18px] rounded-t-[10px] bg-[#111111] px-4 py-2 text-inverse shadow-float",
          state.phase === "error" && "bg-[#281b1a]/[0.98]",
        )}
      >
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full",
            state.phase === "recording" && "bg-recording text-white",
            (state.phase === "processing" ||
              state.phase === "inserting" ||
              state.phase === "arming") &&
              "bg-white/10 text-white",
            state.phase === "success" && "bg-accent text-white",
            state.phase === "error" && "bg-danger text-white",
            state.phase === "cancelled" && "bg-white/10 text-white/65",
          )}
        >
          {state.phase === "recording" ? <Mic2 className="size-3.5" /> : null}
          {state.phase === "success" ? <Check className="size-3.5" /> : null}
          {state.phase === "error" ? <CircleAlert className="size-3.5" /> : null}
          {state.phase === "cancelled" ? <X className="size-3.5" /> : null}
          {state.phase === "arming" ||
          state.phase === "processing" ||
          state.phase === "inserting" ? (
            <span className="size-3.5 animate-spin rounded-full border-2 border-white/70 border-r-transparent" />
          ) : null}
        </span>
        {state.phase === "recording" ? <Waveform level={level} /> : null}
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{label}</span>
        {state.phase === "recording" ? (
          <span className="text-[11px] font-semibold text-white/55 tabular-nums">{clock}</span>
        ) : null}
        {state.phase === "error" && state.hasFallbackText ? (
          <Copy className="size-3.5 shrink-0 text-white/55" />
        ) : null}
        {state.phase === "recording" ? (
          <span className="rounded-md bg-white/[0.08] px-1.5 py-1 text-[9px] font-semibold text-white/50">
            Esc
          </span>
        ) : null}
      </div>
    </div>
  );
}
