import type { LocalAiQuality, PermissionSnapshot } from "@/types/domain";
import type {
  HudStateEvent,
  LocalModelStatus,
  MicrophoneDevice,
  NativeClient,
  PlatformInfo,
  SecureStateNamespace,
  TranscriptionResult,
} from "@/types/native";

export class WebNativeClient implements NativeClient {
  private apiKeyPresent = false;
  private readonly secureState = new Map<SecureStateNamespace, unknown>();

  isAvailable(): boolean {
    return false;
  }

  getPlatformInfo(): Promise<PlatformInfo> {
    const mac = /Mac/u.test(navigator.platform);
    return Promise.resolve({ os: "web", shortcutLabel: mac ? "⌥ + ⌘" : "Alt + Win" });
  }

  async listMicrophones(): Promise<MicrophoneDevice[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === "audioinput")
      .map((device, index) => ({
        id: device.deviceId,
        name: device.label || `Microphone ${index + 1}`,
        isDefault: device.deviceId === "default" || index === 0,
      }));
  }

  async getPermissions(): Promise<PermissionSnapshot> {
    if (!navigator.permissions) {
      return { microphone: "unknown", accessibility: "unknown", screenRecording: "unknown" };
    }

    try {
      const microphone = await navigator.permissions.query({ name: "microphone" });
      return {
        microphone:
          microphone.state === "prompt"
            ? "unknown"
            : microphone.state === "granted"
              ? "granted"
              : "denied",
        accessibility: "unknown",
        screenRecording: "unknown",
      };
    } catch {
      return { microphone: "unknown", accessibility: "unknown", screenRecording: "unknown" };
    }
  }

  async requestMicrophonePermission(): Promise<PermissionSnapshot> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return this.getPermissions();
  }

  openPermissionSettings(): Promise<void> {
    return Promise.resolve();
  }

  startRecording(): Promise<{ id: string }> {
    return Promise.reject(new Error("native_unavailable"));
  }

  stopRecording(): Promise<never> {
    return Promise.reject(new Error("native_unavailable"));
  }

  cancelRecording(): Promise<void> {
    return Promise.resolve();
  }

  transcribeByok(): Promise<TranscriptionResult> {
    return Promise.reject(new Error("native_unavailable"));
  }

  transcribeManaged(): Promise<TranscriptionResult> {
    return Promise.reject(new Error("native_unavailable"));
  }

  transcribeLocal(): Promise<TranscriptionResult> {
    return Promise.reject(new Error("native_unavailable"));
  }

  getLocalModelStatus(quality: LocalAiQuality): Promise<LocalModelStatus> {
    return Promise.resolve({ quality, installed: false, downloadedBytes: 0, totalBytes: 0 });
  }

  downloadLocalModels(): Promise<LocalModelStatus> {
    return Promise.reject(new Error("native_unavailable"));
  }

  uninstallLocalModels(): Promise<void> {
    return Promise.resolve();
  }

  async insertText(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
  }

  async copyText(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
  }

  setApiKey(apiKey: string): Promise<void> {
    this.apiKeyPresent = apiKey.trim().startsWith("sk-");
    return Promise.resolve();
  }

  hasApiKey(): Promise<boolean> {
    return Promise.resolve(this.apiKeyPresent);
  }

  deleteApiKey(): Promise<void> {
    this.apiKeyPresent = false;
    return Promise.resolve();
  }

  testApiKey(apiKey?: string): Promise<boolean> {
    return Promise.resolve(
      (apiKey?.trim().startsWith("sk-") ?? this.apiKeyPresent) && (apiKey?.length ?? 24) > 20,
    );
  }

  loadSecureState<T>(namespace: SecureStateNamespace): Promise<T | null> {
    return Promise.resolve((this.secureState.get(namespace) as T | undefined) ?? null);
  }

  saveSecureState(namespace: SecureStateNamespace, value: unknown): Promise<void> {
    this.secureState.set(namespace, structuredClone(value));
    return Promise.resolve();
  }

  getAutostartEnabled(): Promise<boolean> {
    return Promise.resolve(false);
  }

  async setAutostartEnabled(): Promise<void> {
    return Promise.resolve();
  }

  setRunInBackground(): Promise<void> {
    return Promise.resolve();
  }

  updateHudState(state: HudStateEvent): Promise<void> {
    window.dispatchEvent(
      new CustomEvent<HudStateEvent>("open-dictate:hud-state", { detail: state }),
    );
    return Promise.resolve();
  }

  onShortcut(): Promise<() => void> {
    return Promise.resolve(() => undefined);
  }

  onAudioLevel(): Promise<() => void> {
    return Promise.resolve(() => undefined);
  }

  onHudState(listener: (event: HudStateEvent) => void): Promise<() => void> {
    const handler = (event: Event) => listener((event as CustomEvent<HudStateEvent>).detail);
    window.addEventListener("open-dictate:hud-state", handler);
    return Promise.resolve(() => window.removeEventListener("open-dictate:hud-state", handler));
  }

  onLocalModelProgress(): Promise<() => void> {
    return Promise.resolve(() => undefined);
  }
}
