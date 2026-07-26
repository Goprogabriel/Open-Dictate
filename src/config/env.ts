import { z } from "zod";

const optionalUrl = z
  .string()
  .trim()
  .url()
  .transform((value) => value.replace(/\/$/, ""))
  .optional()
  .or(z.literal("").transform(() => undefined));

const booleanString = z
  .enum(["true", "false"])
  .optional()
  .transform((value) => value === "true");

const schema = z.object({
  firebaseApiKey: z.string().trim().optional(),
  firebaseAuthDomain: z.string().trim().optional(),
  firebaseProjectId: z.string().trim().optional(),
  firebaseStorageBucket: z.string().trim().optional(),
  firebaseMessagingSenderId: z.string().trim().optional(),
  firebaseAppId: z.string().trim().optional(),
  firebaseMeasurementId: z.string().trim().optional(),
  apiBaseUrl: optionalUrl,
  enablePreviewData: booleanString,
  enableFirebaseEmulators: booleanString,
});

export const env = schema.parse({
  firebaseApiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  firebaseAuthDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  firebaseProjectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  firebaseStorageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  firebaseMessagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  firebaseAppId: import.meta.env.VITE_FIREBASE_APP_ID,
  firebaseMeasurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL,
  enablePreviewData: import.meta.env.VITE_ENABLE_PREVIEW_DATA,
  enableFirebaseEmulators: import.meta.env.VITE_ENABLE_FIREBASE_EMULATORS,
});

export const hasFirebaseConfig = Boolean(
  env.firebaseApiKey && env.firebaseProjectId && env.firebaseAppId && env.firebaseAuthDomain,
);
