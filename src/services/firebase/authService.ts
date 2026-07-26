import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";

import type { AuthService, AuthSession, SignUpInput } from "@/services/contracts";
import { getFirebaseServices } from "@/services/firebase/client";

function toSession(user: User): AuthSession {
  return {
    user: {
      id: user.uid,
      name: user.displayName ?? "",
      email: user.email,
      emailVerified: user.emailVerified,
      mode: "pro",
      language: "en",
      createdAt: user.metadata.creationTime ?? new Date().toISOString(),
    },
    emailVerified: user.emailVerified,
    getIdToken: (forceRefresh = false) => user.getIdToken(forceRefresh),
    refresh: async () => {
      await user.reload();
      await user.getIdToken(true);
      return toSession(user);
    },
  };
}

class FirebaseAuthService implements AuthService {
  observe(listener: (session: AuthSession | null) => void): () => void {
    let unsubscribe: () => void = () => undefined;
    let active = true;

    void getFirebaseServices()
      .then((firebase) => {
        if (!active || !firebase) {
          listener(null);
          return;
        }
        unsubscribe = onAuthStateChanged(firebase.auth, (user) =>
          listener(user ? toSession(user) : null),
        );
      })
      .catch(() => {
        if (active) listener(null);
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }

  async signUp(input: SignUpInput): Promise<AuthSession> {
    const firebase = await getFirebaseServices();
    if (!firebase) throw new Error("firebase_not_configured");
    const credential = await createUserWithEmailAndPassword(
      firebase.auth,
      input.email.trim(),
      input.password,
    );
    await updateProfile(credential.user, { displayName: input.name.trim() });
    await sendEmailVerification(credential.user);
    return toSession(credential.user);
  }

  async signIn(email: string, password: string): Promise<AuthSession> {
    const firebase = await getFirebaseServices();
    if (!firebase) throw new Error("firebase_not_configured");
    const credential = await signInWithEmailAndPassword(firebase.auth, email.trim(), password);
    return toSession(credential.user);
  }

  async signOut(): Promise<void> {
    const firebase = await getFirebaseServices();
    if (firebase) await signOut(firebase.auth);
  }

  async sendVerificationEmail(): Promise<AuthSession> {
    const firebase = await getFirebaseServices();
    const user = firebase?.auth.currentUser;
    if (!firebase || !user) throw new Error("authentication_required");
    await sendEmailVerification(user);
    await user.reload();
    return toSession(user);
  }

  async sendPasswordReset(email: string): Promise<void> {
    const firebase = await getFirebaseServices();
    if (!firebase) throw new Error("firebase_not_configured");
    await sendPasswordResetEmail(firebase.auth, email.trim());
  }
}

export const authService: AuthService = new FirebaseAuthService();
