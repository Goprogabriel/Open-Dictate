import { isTauriRuntime } from "@/utils/platform";

export interface ReservedExternalWindow {
  open: (url: string) => void;
  close: () => void;
}

function parseExternalUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("external_url_must_use_https");
  return parsed.toString();
}

export function reserveExternalWindow(): ReservedExternalWindow | null {
  if (isTauriRuntime() || typeof window === "undefined") return null;

  const target = (() => {
    try {
      return window.open("about:blank", "_blank");
    } catch {
      return null;
    }
  })();
  if (!target) return null;
  target.opener = null;

  return {
    open: (url) => {
      target.location.assign(parseExternalUrl(url));
    },
    close: () => {
      if (!target.closed) target.close();
    },
  };
}

export async function openExternal(
  url: string,
  reservedWindow: ReservedExternalWindow | null = null,
): Promise<void> {
  const parsed = parseExternalUrl(url);

  if (isTauriRuntime()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(parsed);
    return;
  }

  if (reservedWindow) {
    reservedWindow.open(parsed);
    return;
  }

  const target = window.open(parsed, "_blank");
  if (!target) throw new Error("external_window_blocked");
  target.opener = null;
}
