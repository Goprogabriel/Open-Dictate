import type { Locale } from "@/types/domain";

const localeKey = "open-dictate-locale";

export const preferencesStorage = {
  getLocale(): Locale | null {
    const locale = localStorage.getItem(localeKey);
    return locale === "en" || locale === "da" || locale === "no" || locale === "sv" ? locale : null;
  },
  setLocale(locale: Locale): void {
    localStorage.setItem(localeKey, locale);
  },
};
