export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isMacPlatform(): boolean {
  return /Mac|iPhone|iPad/u.test(navigator.platform);
}
