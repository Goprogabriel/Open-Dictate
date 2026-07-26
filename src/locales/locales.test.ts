import da from "@/locales/da.json";
import en from "@/locales/en.json";
import i18n, { changeLocale, detectInitialLocale, LOCALE_STORAGE_KEY } from "@/locales/index";
import no from "@/locales/no.json";
import sv from "@/locales/sv.json";

type TranslationTree = Record<string, unknown>;

const locales = { en, da, no, sv } satisfies Record<string, TranslationTree>;
const requiredNamespaces = [
  "common",
  "nav",
  "onboarding",
  "hud",
  "usage",
  "history",
  "prompt",
  "dictionary",
  "profile",
  "settings",
  "languages",
  "permissions",
] as const;

function flatten(tree: TranslationTree, prefix = ""): Map<string, string> {
  const entries = new Map<string, string>();

  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "string") {
      entries.set(path, value);
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [childPath, childValue] of flatten(value as TranslationTree, path)) {
        entries.set(childPath, childValue);
      }
    }
  }

  return entries;
}

function placeholders(value: string): string[] {
  return [...(value.match(/\{\{[^{}]+\}\}/gu) ?? [])].sort();
}

describe("locale catalogs", () => {
  const englishEntries = flatten(en);
  const englishKeys = [...englishEntries.keys()].sort();

  it.each(Object.entries(locales))("keeps %s complete and aligned with English", (_, catalog) => {
    const entries = flatten(catalog);

    expect([...entries.keys()].sort()).toEqual(englishKeys);
    expect([...entries.values()].every((value) => value.trim().length > 0)).toBe(true);
  });

  it.each(Object.entries(locales))("exposes the required namespaces in %s", (_, catalog) => {
    expect(Object.keys(catalog)).toEqual(expect.arrayContaining([...requiredNamespaces]));
  });

  it.each(Object.entries(locales).filter(([locale]) => locale !== "en"))(
    "preserves interpolation variables in %s",
    (_, catalog) => {
      const entries = flatten(catalog);

      for (const [key, englishValue] of englishEntries) {
        expect(placeholders(entries.get(key) ?? ""), key).toEqual(placeholders(englishValue));
      }
    },
  );
});

describe("locale detection", () => {
  const originalLanguages = navigator.languages;
  const originalLanguage = navigator.language;

  afterEach(async () => {
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      value: originalLanguages,
    });
    Object.defineProperty(navigator, "language", {
      configurable: true,
      value: originalLanguage,
    });
    await changeLocale("en");
    window.localStorage.clear();
  });

  it("prefers a persisted supported locale", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "da-DK");
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      value: ["sv-SE"],
    });

    expect(detectInitialLocale()).toBe("da");
  });

  it("maps Norwegian browser variants to the supported no locale", () => {
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      value: ["nb-NO"],
    });

    expect(detectInitialLocale()).toBe("no");
  });

  it("falls back to English when no candidate is supported", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "fr");
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      value: ["fr-FR"],
    });
    Object.defineProperty(navigator, "language", {
      configurable: true,
      value: "fr-FR",
    });

    expect(detectInitialLocale()).toBe("en");
  });

  it("persists language changes and updates the document language", async () => {
    await changeLocale("sv");

    expect(i18n.resolvedLanguage).toBe("sv");
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("sv");
    expect(document.documentElement.lang).toBe("sv");
  });
});
