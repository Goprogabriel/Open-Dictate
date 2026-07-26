import { create } from "zustand";

import type { PlatformInfo } from "@/types/native";

function initialPlatform(): PlatformInfo {
  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const windows = /Windows/u.test(userAgent);
  const macos = /Macintosh|Mac OS/u.test(userAgent);
  return {
    os: windows ? "windows" : macos ? "macos" : "web",
    shortcutLabel: windows ? "Alt + Win" : "⌥ + ⌘",
  };
}

interface PlatformState extends PlatformInfo {
  setPlatformInfo: (platform: PlatformInfo) => void;
}

export const usePlatformStore = create<PlatformState>((set) => ({
  ...initialPlatform(),
  setPlatformInfo: (platform) => set(platform),
}));
