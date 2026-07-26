import type { LocalAiQuality, Locale, PermissionSnapshot } from "@/types/domain";

export type DictationPhase =
  "idle" | "arming" | "recording" | "processing" | "inserting" | "success" | "cancelled" | "error";

export interface ShortcutEvent {
  phase: "pressed" | "released" | "cancelled";
  timestampMs: number;
}

export interface AudioLevelEvent {
  recordingId: string;
  level: number;
}

export interface RecordingDescriptor {
  id: string;
  durationMs: number;
  speakingMs: number;
  sizeBytes: number;
  sampleRate: number;
  application: string;
}

export interface HudStateEvent {
  phase: DictationPhase;
  errorCode?: string | null;
  startedAt?: number | null;
  hasFallbackText?: boolean;
}

export interface TranscriptionOptions {
  language: Locale;
  outputLanguage: Locale;
  customPrompt: string;
  dictionary: Array<{ spoken: string; replacement: string }>;
  removeFillers: boolean;
  correctPunctuation: boolean;
  formatLists: boolean;
  saveHistory: boolean;
  retentionDays: 7 | 30 | 90 | 365;
}

export interface TranscriptionResult {
  text: string;
  rawText?: string;
  transcriptionTokens: number;
  transformTokens: number;
  requestId?: string;
  providerRequestId?: string;
  dictationId?: string | null;
  remainingTokens?: number | null;
  subscriptionTokens?: number;
  purchasedTokens?: number;
  subscriptionTokensExpireAt?: string | null;
}

export interface LocalModelStatus {
  quality: LocalAiQuality;
  installed: boolean;
  downloadedBytes: number;
  totalBytes: number;
}

export interface LocalModelProgress extends LocalModelStatus {
  file: string;
  state: "downloading" | "verifying" | "ready" | "error";
}

export interface MicrophoneDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface PlatformInfo {
  os: "macos" | "windows" | "linux" | "web";
  shortcutLabel: string;
}

export type SecureStateNamespace = "history" | "prompt" | "dictionary";

export interface NativeClient {
  isAvailable(): boolean;
  getPlatformInfo(): Promise<PlatformInfo>;
  listMicrophones(): Promise<MicrophoneDevice[]>;
  getPermissions(): Promise<PermissionSnapshot>;
  requestMicrophonePermission(): Promise<PermissionSnapshot>;
  openPermissionSettings(kind: keyof PermissionSnapshot): Promise<void>;
  startRecording(microphoneId: string | null): Promise<{ id: string }>;
  stopRecording(recordingId: string): Promise<RecordingDescriptor>;
  cancelRecording(recordingId: string): Promise<void>;
  transcribeByok(recordingId: string, options: TranscriptionOptions): Promise<TranscriptionResult>;
  transcribeManaged(
    recordingId: string,
    options: TranscriptionOptions,
    endpoint: string,
    idToken: string,
  ): Promise<TranscriptionResult>;
  transcribeLocal(
    recordingId: string,
    options: TranscriptionOptions,
    quality: LocalAiQuality,
  ): Promise<TranscriptionResult>;
  getLocalModelStatus(quality: LocalAiQuality): Promise<LocalModelStatus>;
  downloadLocalModels(quality: LocalAiQuality): Promise<LocalModelStatus>;
  uninstallLocalModels(): Promise<void>;
  insertText(text: string): Promise<void>;
  copyText(text: string): Promise<void>;
  setApiKey(apiKey: string): Promise<void>;
  hasApiKey(): Promise<boolean>;
  deleteApiKey(): Promise<void>;
  testApiKey(apiKey?: string): Promise<boolean>;
  loadSecureState<T>(namespace: SecureStateNamespace): Promise<T | null>;
  saveSecureState(namespace: SecureStateNamespace, value: unknown): Promise<void>;
  getAutostartEnabled(): Promise<boolean>;
  setAutostartEnabled(enabled: boolean): Promise<void>;
  setRunInBackground(enabled: boolean): Promise<void>;
  updateHudState(state: HudStateEvent): Promise<void>;
  onShortcut(listener: (event: ShortcutEvent) => void): Promise<() => void>;
  onAudioLevel(listener: (event: AudioLevelEvent) => void): Promise<() => void>;
  onHudState(listener: (event: HudStateEvent) => void): Promise<() => void>;
  onLocalModelProgress(listener: (event: LocalModelProgress) => void): Promise<() => void>;
}
