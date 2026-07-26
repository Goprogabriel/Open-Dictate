import type { Locale } from "@/types/domain";

const localeMap: Record<Locale, string> = {
  en: "en-US",
  da: "da-DK",
  no: "nb-NO",
  sv: "sv-SE",
};

export function getIntlLocale(locale: Locale): string {
  return localeMap[locale];
}

export function formatDateTime(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatShortDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function formatMonth(value: string, locale: Locale): string {
  const date = new Date(`${value}-01T12:00:00`);
  return new Intl.DateTimeFormat(getIntlLocale(locale), {
    month: "long",
    year: "numeric",
  }).format(date);
}
