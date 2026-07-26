import { nativeClient } from "@/services/native";

export const secureSecretService = {
  setOpenAiKey(apiKey: string): Promise<void> {
    return nativeClient.setApiKey(apiKey.trim());
  },
  hasOpenAiKey(): Promise<boolean> {
    return nativeClient.hasApiKey();
  },
  deleteOpenAiKey(): Promise<void> {
    return nativeClient.deleteApiKey();
  },
  testOpenAiKey(apiKey?: string): Promise<boolean> {
    return nativeClient.testApiKey(apiKey?.trim());
  },
};
