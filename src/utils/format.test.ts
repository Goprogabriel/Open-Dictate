import { formatMonth, getIntlLocale } from "@/utils/date";
import { countWords, formatCurrency, formatDuration, formatNumber } from "@/utils/format";

describe("formatDuration", () => {
  it.each([
    [-1, "0s"],
    [0, "0s"],
    [1_499, "1s"],
    [59_500, "1m 0s"],
    [61_000, "1m 1s"],
    [3_661_000, "1h 1m"],
  ])("formats %i milliseconds as %s", (milliseconds, expected) => {
    expect(formatDuration(milliseconds)).toBe(expected);
  });
});

describe("countWords", () => {
  it("counts words separated by Unicode whitespace", () => {
    expect(countWords("  Open\tDictate\nturns\u00a0voice into text  ")).toBe(6);
  });

  it("returns zero for blank input", () => {
    expect(countWords(" \n\t ")).toBe(0);
  });
});

describe("localized formatting", () => {
  it("maps product locales to explicit Intl locales", () => {
    expect(getIntlLocale("en")).toBe("en-US");
    expect(getIntlLocale("da")).toBe("da-DK");
    expect(getIntlLocale("no")).toBe("nb-NO");
    expect(getIntlLocale("sv")).toBe("sv-SE");
  });

  it("formats numbers using the selected locale", () => {
    expect(formatNumber(12_345, "en")).toBe("12,345");
    expect(formatNumber(12_345, "da")).toBe("12.345");
  });

  it("converts minor currency units before formatting", () => {
    expect(formatCurrency(500, "usd", "en")).toBe("$5.00");
  });

  it("formats a stable year-month value without a timezone shift", () => {
    expect(formatMonth("2026-07", "en")).toBe("July 2026");
    expect(formatMonth("2026-07", "da")).toBe("juli 2026");
  });
});
