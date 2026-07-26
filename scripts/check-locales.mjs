import fs from "node:fs";
import path from "node:path";

const localeDirectory = path.resolve("src/locales");
const sourceDirectory = path.resolve("src");
const localeNames = ["en", "da", "no", "sv"];

function flatten(value, prefix = "", output = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object" && !Array.isArray(child)) {
      flatten(child, fullKey, output);
    } else {
      output.set(fullKey, String(child));
    }
  }
  return output;
}

function interpolationFields(value) {
  return [...value.matchAll(/\{\{\s*([^},\s]+)[^}]*\}\}/gu)].map((match) => match[1]).sort();
}

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return /\.(ts|tsx)$/u.test(entry.name) ? [fullPath] : [];
  });
}

const locales = Object.fromEntries(
  localeNames.map((locale) => [
    locale,
    flatten(JSON.parse(fs.readFileSync(path.join(localeDirectory, `${locale}.json`), "utf8"))),
  ]),
);
const canonicalKeys = [...locales.en.keys()].sort();
const failures = [];

for (const locale of localeNames.slice(1)) {
  const keys = [...locales[locale].keys()].sort();
  const missing = canonicalKeys.filter((key) => !locales[locale].has(key));
  const extra = keys.filter((key) => !locales.en.has(key));
  if (missing.length) failures.push(`${locale}: missing ${missing.join(", ")}`);
  if (extra.length) failures.push(`${locale}: extra ${extra.join(", ")}`);

  for (const key of canonicalKeys) {
    const expected = interpolationFields(locales.en.get(key) ?? "");
    const actual = interpolationFields(locales[locale].get(key) ?? "");
    if (expected.join("|") !== actual.join("|")) {
      failures.push(`${locale}: interpolation mismatch at ${key}`);
    }
  }
}

const literalKeyPattern = /\bt\(\s*["']([A-Za-z0-9_.-]+)["']/gu;
for (const file of sourceFiles(sourceDirectory)) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(literalKeyPattern)) {
    if (
      !locales.en.has(match[1]) &&
      !locales.en.has(`${match[1]}_one`) &&
      !locales.en.has(`${match[1]}_other`)
    ) {
      failures.push(`${path.relative(process.cwd(), file)}: unknown key ${match[1]}`);
    }
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `Validated ${canonicalKeys.length} translation values across ${localeNames.length} locales.`,
);
