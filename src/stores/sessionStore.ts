import { create } from "zustand";

import { env } from "@/config/env";
import { previewProfile, previewSubscription } from "@/test/fixtures";
import type { Subscription, UserMode, UserProfile } from "@/types/domain";

type AuthStatus = "anonymous" | "loading" | "authenticated";

const localProfile: UserProfile = {
  id: "local",
  name: "",
  email: null,
  emailVerified: false,
  mode: "free",
  language: "en",
  createdAt: new Date().toISOString(),
};

const freeSubscription: Subscription = {
  plan: "free",
  status: "none",
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  remainingTokens: null,
  allowanceTokens: null,
  subscriptionTokens: 0,
  purchasedTokens: 0,
  subscriptionTokensExpireAt: null,
  topupOptions: [],
};

interface SessionState {
  authStatus: AuthStatus;
  profile: UserProfile;
  subscription: Subscription;
  setAuthStatus: (status: AuthStatus) => void;
  setProfile: (profile: UserProfile) => void;
  setSubscription: (subscription: Subscription) => void;
  configureLocalUser: (name?: string, mode?: "free" | "local") => void;
  configureProUser: (name: string, email: string, id?: string, emailVerified?: boolean) => void;
  signOut: () => void;
  setMode: (mode: UserMode) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  authStatus: env.enablePreviewData ? "authenticated" : "anonymous",
  profile: env.enablePreviewData ? previewProfile : localProfile,
  subscription: env.enablePreviewData ? previewSubscription : freeSubscription,
  setAuthStatus: (authStatus) => set({ authStatus }),
  setProfile: (profile) => set({ profile }),
  setSubscription: (subscription) => set({ subscription }),
  configureLocalUser: (name = "", mode = "free") =>
    set({
      authStatus: "anonymous",
      profile: { ...localProfile, name, mode },
      subscription: freeSubscription,
    }),
  configureProUser: (name, email, id = crypto.randomUUID(), emailVerified = false) =>
    set({
      authStatus: "authenticated",
      profile: {
        id,
        name,
        email,
        emailVerified,
        mode: "pro",
        language: "en",
        createdAt: new Date().toISOString(),
      },
      subscription: freeSubscription,
    }),
  signOut: () =>
    set({ authStatus: "anonymous", profile: localProfile, subscription: freeSubscription }),
  setMode: (mode) =>
    set((state) => ({
      profile: { ...state.profile, mode },
      subscription: mode === "pro" ? state.subscription : freeSubscription,
    })),
}));
