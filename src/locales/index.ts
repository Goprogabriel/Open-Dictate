import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import da from "./da.json";
import en from "./en.json";
import no from "./no.json";
import sv from "./sv.json";

export const LOCALE_STORAGE_KEY = "open-dictate-locale";
export const supportedLocales = ["en", "da", "no", "sv"] as const;

export type SupportedLocale = (typeof supportedLocales)[number];

export const resources = {
  en: { translation: en },
  da: { translation: da },
  no: { translation: no },
  sv: { translation: sv },
} as const;

function normalizeLocale(locale: string | null | undefined): SupportedLocale | null {
  if (!locale) {
    return null;
  }

  const baseLocale = locale.trim().toLowerCase().replace("_", "-").split("-")[0];
  const normalizedLocale = baseLocale === "nb" || baseLocale === "nn" ? "no" : baseLocale;

  return supportedLocales.includes(normalizedLocale as SupportedLocale)
    ? (normalizedLocale as SupportedLocale)
    : null;
}

function readPersistedLocale(): SupportedLocale | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function detectNavigatorLocale(): SupportedLocale | null {
  if (typeof navigator === "undefined") {
    return null;
  }

  const candidates = [...navigator.languages, navigator.language];

  for (const candidate of candidates) {
    const locale = normalizeLocale(candidate);

    if (locale) {
      return locale;
    }
  }

  return null;
}

export function detectInitialLocale(): SupportedLocale {
  return readPersistedLocale() ?? detectNavigatorLocale() ?? "en";
}

function persistLocale(locale: string): void {
  const normalizedLocale = normalizeLocale(locale);

  if (!normalizedLocale) {
    return;
  }

  if (typeof document !== "undefined") {
    document.documentElement.lang = normalizedLocale;
  }

  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, normalizedLocale);
  } catch {
    // The selected language still applies for this session when storage is blocked.
  }
}

const initialLocale = detectInitialLocale();

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: initialLocale,
    fallbackLng: "en",
    supportedLngs: supportedLocales,
    load: "languageOnly",
    interpolation: {
      escapeValue: false,
    },
    returnNull: false,
    react: {
      useSuspense: false,
    },
  });
}

persistLocale(initialLocale);
i18n.on("languageChanged", persistLocale);

export async function changeLocale(locale: SupportedLocale): Promise<void> {
  await i18n.changeLanguage(locale);
}

export default i18n;
