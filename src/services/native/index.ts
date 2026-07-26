import type { NativeClient } from "@/types/native";
import { isTauriRuntime } from "@/utils/platform";

import { TauriNativeClient } from "./tauriNativeClient";
import { WebNativeClient } from "./webNativeClient";

export const nativeClient: NativeClient = isTauriRuntime()
  ? new TauriNativeClient()
  : new WebNativeClient();
