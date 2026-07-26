import type { AuthSession } from "@/services/contracts";

let currentSession: AuthSession | null = null;

export function setCurrentAuthSession(session: AuthSession | null): void {
  currentSession = session;
}

export function getCurrentAuthSession(): AuthSession | null {
  return currentSession;
}
