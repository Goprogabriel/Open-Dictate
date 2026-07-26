import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  setPersistence,
  indexedDBLocalPersistence,
  type Auth,
} from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";

import { env, hasFirebaseConfig } from "@/config/env";

interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  firestore: Firestore;
}

let services: FirebaseServices | null = null;
let emulatorConnected = false;

export async function getFirebaseServices(): Promise<FirebaseServices | null> {
  if (!hasFirebaseConfig) return null;
  if (services) return services;

  const app = getApps().length
    ? getApp()
    : initializeApp({
        apiKey: env.firebaseApiKey,
        authDomain: env.firebaseAuthDomain,
        projectId: env.firebaseProjectId,
        storageBucket: env.firebaseStorageBucket,
        messagingSenderId: env.firebaseMessagingSenderId,
        appId: env.firebaseAppId,
        measurementId: env.firebaseMeasurementId,
      });

  const auth = getAuth(app);
  const firestore = getFirestore(app);
  await setPersistence(auth, indexedDBLocalPersistence);

  if (env.enableFirebaseEmulators && !emulatorConnected) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
    emulatorConnected = true;
  }

  services = { app, auth, firestore };
  return services;
}
