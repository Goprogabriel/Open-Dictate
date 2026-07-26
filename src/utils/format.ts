import type { Locale } from "@/types/domain";
import { getIntlLocale } from "@/utils/date";

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(getIntlLocale(locale)).format(value);
}

export function formatCompactNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(getIntlLocale(locale), {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function countWords(text: string): number {
  const normalized = text.trim();
  return normalized ? normalized.split(/\s+/u).length : 0;
}

export function formatCurrency(minorUnits: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(getIntlLocale(locale), {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(minorUnits / 100);
}

export function formatWholeCurrency(minorUnits: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(getIntlLocale(locale), {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(minorUnits / 100);
}
