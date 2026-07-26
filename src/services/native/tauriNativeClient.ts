import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type { LocalAiQuality, PermissionSnapshot } from "@/types/domain";
import type {
  AudioLevelEvent,
  HudStateEvent,
  LocalModelProgress,
  LocalModelStatus,
  MicrophoneDevice,
  NativeClient,
  PlatformInfo,
  RecordingDescriptor,
  SecureStateNamespace,
  ShortcutEvent,
  TranscriptionOptions,
  TranscriptionResult,
} from "@/types/native";

export class TauriNativeClient implements NativeClient {
  isAvailable(): boolean {
    return true;
  }

  getPlatformInfo(): Promise<PlatformInfo> {
    return invoke<PlatformInfo>("get_platform_info");
  }

  listMicrophones(): Promise<MicrophoneDevice[]> {
    return invoke<MicrophoneDevice[]>("list_microphones");
  }

  getPermissions(): Promise<PermissionSnapshot> {
    return invoke<PermissionSnapshot>("get_permission_snapshot");
  }

  requestMicrophonePermission(): Promise<PermissionSnapshot> {
    return invoke<PermissionSnapshot>("request_microphone_permission");
  }

  openPermissionSettings(kind: keyof PermissionSnapshot): Promise<void> {
    return invoke("open_permission_settings", { kind });
  }

  startRecording(microphoneId: string | null): Promise<{ id: string }> {
    return invoke<{ id: string }>("start_recording", { microphoneId });
  }

  stopRecording(recordingId: string): Promise<RecordingDescriptor> {
    return invoke<RecordingDescriptor>("stop_recording", { recordingId });
  }

  cancelRecording(recordingId: string): Promise<void> {
    return invoke("cancel_recording", { recordingId });
  }

  transcribeByok(recordingId: string, options: TranscriptionOptions): Promise<TranscriptionResult> {
    return invoke<TranscriptionResult>("transcribe_byok", { recordingId, options });
  }

  transcribeManaged(
    recordingId: string,
    options: TranscriptionOptions,
    endpoint: string,
    idToken: string,
  ): Promise<TranscriptionResult> {
    return invoke<TranscriptionResult>("transcribe_managed", {
      recordingId,
      options,
      endpoint,
      idToken,
    });
  }

  transcribeLocal(
    recordingId: string,
    options: TranscriptionOptions,
    quality: LocalAiQuality,
  ): Promise<TranscriptionResult> {
    return invoke<TranscriptionResult>("transcribe_local", { recordingId, options, quality });
  }

  getLocalModelStatus(quality: LocalAiQuality): Promise<LocalModelStatus> {
    return invoke<LocalModelStatus>("get_local_model_status", { quality });
  }

  downloadLocalModels(quality: LocalAiQuality): Promise<LocalModelStatus> {
    return invoke<LocalModelStatus>("download_local_models", { quality });
  }

  uninstallLocalModels(): Promise<void> {
    return invoke("uninstall_local_models");
  }

  insertText(text: string): Promise<void> {
    return invoke("insert_text", { text });
  }

  copyText(text: string): Promise<void> {
    return invoke("copy_text", { text });
  }

  setApiKey(apiKey: string): Promise<void> {
    return invoke("set_api_key", { apiKey });
  }

  hasApiKey(): Promise<boolean> {
    return invoke<boolean>("has_api_key");
  }

  deleteApiKey(): Promise<void> {
    return invoke("delete_api_key");
  }

  testApiKey(apiKey?: string): Promise<boolean> {
    return invoke<boolean>("test_api_key", { apiKey: apiKey ?? null });
  }

  loadSecureState<T>(namespace: SecureStateNamespace): Promise<T | null> {
    return invoke<T | null>("load_secure_state", { namespace });
  }

  saveSecureState(namespace: SecureStateNamespace, value: unknown): Promise<void> {
    return invoke("save_secure_state", { namespace, value });
  }

  getAutostartEnabled(): Promise<boolean> {
    return invoke<boolean>("get_autostart_enabled");
  }

  setAutostartEnabled(enabled: boolean): Promise<void> {
    return invoke("set_autostart_enabled", { enabled });
  }

  setRunInBackground(enabled: boolean): Promise<void> {
    return invoke("set_run_in_background", { enabled });
  }

  updateHudState(state: HudStateEvent): Promise<void> {
    return invoke("update_hud_state", { state });
  }

  async onShortcut(listener: (event: ShortcutEvent) => void): Promise<() => void> {
    return listen<ShortcutEvent>("dictation://shortcut", ({ payload }) => listener(payload));
  }

  async onAudioLevel(listener: (event: AudioLevelEvent) => void): Promise<() => void> {
    return listen<AudioLevelEvent>("dictation://audio-level", ({ payload }) => listener(payload));
  }

  async onHudState(listener: (event: HudStateEvent) => void): Promise<() => void> {
    return listen<HudStateEvent>("dictation://hud-state", ({ payload }) => listener(payload));
  }

  async onLocalModelProgress(listener: (event: LocalModelProgress) => void): Promise<() => void> {
    return listen<LocalModelProgress>("local-model://progress", ({ payload }) => listener(payload));
  }
}
