import type { LocalAiQuality } from "@/types/domain";

export interface LocalAiTier {
  quality: LocalAiQuality;
  whisperModel: string;
  languageModel: string;
  downloadBytes: number;
}

export const localAiTiers: LocalAiTier[] = [
  {
    quality: "low",
    whisperModel: "Whisper Small",
    languageModel: "Qwen3 1.7B",
    downloadBytes: 2_322_027_983,
  },
  {
    quality: "medium",
    whisperModel: "Whisper Medium",
    languageModel: "Qwen3 4B",
    downloadBytes: 4_031_043_315,
  },
  {
    quality: "high",
    whisperModel: "Whisper Large v3 Turbo",
    languageModel: "Qwen3 8B",
    downloadBytes: 6_652_338_763,
  },
];

export function formatModelBytes(bytes: number): string {
  if (bytes <= 0) return "0 GB";
  return `${(bytes / 1_000_000_000).toFixed(bytes >= 10_000_000_000 ? 0 : 1)} GB`;
}
