import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { UserMode } from "@/types/domain";

interface OnboardingState {
  completed: boolean;
  step: number;
  mode: UserMode | null;
  setStep: (step: number) => void;
  setMode: (mode: UserMode) => void;
  complete: () => void;
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      completed: false,
      step: 0,
      mode: null,
      setStep: (step) => set({ step: Math.max(0, Math.min(6, step)) }),
      setMode: (mode) => set({ mode }),
      complete: () => set((state) => ({ completed: true, step: state.mode === "pro" ? 6 : 5 })),
      reset: () => set({ completed: false, step: 0, mode: null }),
    }),
    {
      name: "open-dictate-onboarding",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
