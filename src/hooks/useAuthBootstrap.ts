import { useEffect } from "react";

import { startAccountSync } from "@/services/accountSyncService";
import { authService } from "@/services/firebase/authService";
import { setCurrentAuthSession } from "@/services/firebase/sessionRuntime";
import {
  initializeSecureStatePersistence,
  switchSecureStateScope,
} from "@/services/secureStateService";
import { useSessionStore } from "@/stores/sessionStore";
import { usePreferencesStore } from "@/stores/preferencesStore";

export function useAuthBootstrap(): void {
  useEffect(() => {
    useSessionStore.getState().setAuthStatus("loading");
    const secureStateReady = initializeSecureStatePersistence();
    let stopAccountSync: () => void = () => undefined;
    let sessionRevision = 0;
    let disposed = false;
    const stopAuth = authService.observe((session) => {
      const revision = ++sessionRevision;
      stopAccountSync();
      stopAccountSync = () => undefined;
      setCurrentAuthSession(session);
      useSessionStore.getState().setAuthStatus("loading");
      void secureStateReady
        .then(() => switchSecureStateScope(session?.user.id ?? null))
        .then(() => {
          if (disposed || revision !== sessionRevision) return;
          if (!session) {
            const mode = usePreferencesStore.getState().processingMode;
            useSessionStore.getState().configureLocalUser("", mode === "local" ? "local" : "free");
            return;
          }
          useSessionStore.getState().setProfile(session.user);
          useSessionStore.getState().setAuthStatus("authenticated");
          stopAccountSync = startAccountSync(session);
        })
        .catch(() => {
          if (!disposed && revision === sessionRevision) {
            useSessionStore.getState().signOut();
          }
        });
    });
    return () => {
      disposed = true;
      sessionRevision += 1;
      stopAccountSync();
      stopAuth();
    };
  }, []);
}
