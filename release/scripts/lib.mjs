import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const releaseDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const repositoryRoot = path.resolve(releaseDirectory, "..");

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function loadEnvironmentFile(filePath) {
  let source;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }

  const values = {};
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line);
    if (!match) throw new Error(`Invalid environment line in ${filePath}: ${rawLine}`);
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

const PUBLIC_DEMO_SERVICE_VARIABLES = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
  "VITE_FIREBASE_MEASUREMENT_ID",
  "VITE_API_BASE_URL",
  "OPEN_DICTATE_MANAGED_API_ORIGIN",
];

export async function createReleaseEnvironment(options) {
  const localEnvironment =
    options.production || options.publicDemo
      ? {}
      : await loadEnvironmentFile(path.join(repositoryRoot, ".env.local"));
  const releaseEnvironment = options.publicDemo
    ? {}
    : await loadEnvironmentFile(path.join(releaseDirectory, "release.env"));
  const environment = { ...localEnvironment, ...releaseEnvironment, ...process.env };

  if (options.publicDemo) {
    // Vite always reads .env.local. Explicit empty process values take
    // precedence so a distributor cannot accidentally embed local services.
    for (const name of PUBLIC_DEMO_SERVICE_VARIABLES) environment[name] = "";
    environment.VITE_ENABLE_PREVIEW_DATA = "false";
    environment.VITE_ENABLE_FIREBASE_EMULATORS = "false";
    return environment;
  }

  if (environment.VITE_API_BASE_URL && !environment.OPEN_DICTATE_MANAGED_API_ORIGIN) {
    try {
      environment.OPEN_DICTATE_MANAGED_API_ORIGIN = new URL(environment.VITE_API_BASE_URL).origin;
    } catch {
      // Validation reports a clear URL error during preflight.
    }
  }
  return environment;
}

export function parseArguments(argv) {
  const options = {
    production: false,
    publicDemo: false,
    skipChecks: false,
    target: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--production") options.production = true;
    else if (argument === "--public-demo") options.publicDemo = true;
    else if (argument === "--skip-checks") options.skipChecks = true;
    else if (argument === "--target") {
      options.target = argv[index + 1];
      if (!options.target) throw new Error("--target requires a Rust target triple");
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (options.production && options.publicDemo) {
    throw new Error("--production and --public-demo cannot be used together");
  }
  return options;
}

export function platformDetails(target) {
  if (process.platform === "darwin") {
    const architecture = target?.startsWith("x86_64")
      ? "x64"
      : target === "universal-apple-darwin"
        ? "universal"
        : "arm64";
    return { name: "macos", architecture, bundles: "app,dmg" };
  }
  if (process.platform === "win32") {
    const architecture = target?.startsWith("aarch64") ? "arm64" : "x64";
    return { name: "windows", architecture, bundles: "nsis,msi" };
  }
  throw new Error("Release builds are supported only on macOS and Windows.");
}

export async function projectVersions() {
  const packageJson = await readJson(path.join(repositoryRoot, "package.json"));
  const tauriConfig = await readJson(path.join(repositoryRoot, "src-tauri", "tauri.conf.json"));
  const cargoManifest = await readFile(
    path.join(repositoryRoot, "src-tauri", "Cargo.toml"),
    "utf8",
  );
  const cargoVersion = /^version\s*=\s*"([^"]+)"/mu.exec(cargoManifest)?.[1];
  return {
    packageVersion: packageJson.version,
    tauriVersion: tauriConfig.version,
    cargoVersion,
  };
}

export function assertMatchingVersions(versions) {
  const distinct = new Set(Object.values(versions));
  if (distinct.size !== 1 || distinct.has(undefined)) {
    throw new Error(
      `Version mismatch: package=${versions.packageVersion}, tauri=${versions.tauriVersion}, cargo=${versions.cargoVersion}`,
    );
  }
  return versions.packageVersion;
}

function isPlaceholder(value) {
  return !value || /YOUR_|REGION-|PROJECT_ID|example\.com|^\.\.\./iu.test(value);
}

export function validateReleaseEnvironment(environment, { production, publicDemo, platform }) {
  const errors = [];
  const apiBaseUrl = environment.VITE_API_BASE_URL;
  const managedOrigin = environment.OPEN_DICTATE_MANAGED_API_ORIGIN;

  if (publicDemo && PUBLIC_DEMO_SERVICE_VARIABLES.some((name) => environment[name])) {
    errors.push("public demo builds must not contain managed-service configuration");
  }

  if (apiBaseUrl && managedOrigin) {
    try {
      const apiOrigin = new URL(apiBaseUrl).origin;
      const pinnedOrigin = new URL(managedOrigin).origin;
      if (apiOrigin !== pinnedOrigin) {
        errors.push("VITE_API_BASE_URL and OPEN_DICTATE_MANAGED_API_ORIGIN use different origins");
      }
      if (production && (apiOrigin.startsWith("http://") || pinnedOrigin.startsWith("http://"))) {
        errors.push("production API URLs must use HTTPS");
      }
    } catch {
      errors.push("managed API URLs are invalid");
    }
  } else if (production) {
    errors.push("VITE_API_BASE_URL and OPEN_DICTATE_MANAGED_API_ORIGIN are required");
  }

  if (production) {
    for (const name of [
      "VITE_FIREBASE_API_KEY",
      "VITE_FIREBASE_AUTH_DOMAIN",
      "VITE_FIREBASE_PROJECT_ID",
      "VITE_FIREBASE_APP_ID",
    ]) {
      if (isPlaceholder(environment[name]))
        errors.push(`${name} is required and cannot be a placeholder`);
    }
    if (environment.VITE_ENABLE_PREVIEW_DATA === "true") {
      errors.push("VITE_ENABLE_PREVIEW_DATA must be false in production");
    }
    if (environment.VITE_ENABLE_FIREBASE_EMULATORS === "true") {
      errors.push("VITE_ENABLE_FIREBASE_EMULATORS must be false in production");
    }

    if (platform === "macos") {
      const hasCertificate = Boolean(
        environment.APPLE_CERTIFICATE && environment.APPLE_CERTIFICATE_PASSWORD,
      );
      const hasInstalledIdentity = Boolean(environment.APPLE_SIGNING_IDENTITY);
      const hasAppleIdNotary = Boolean(
        environment.APPLE_ID && environment.APPLE_PASSWORD && environment.APPLE_TEAM_ID,
      );
      const hasApiNotary = Boolean(
        environment.APPLE_API_KEY && environment.APPLE_API_ISSUER && environment.APPLE_API_KEY_PATH,
      );
      if (!hasCertificate && !hasInstalledIdentity) {
        errors.push("an Apple Developer ID signing identity or APPLE_CERTIFICATE is required");
      }
      if (!hasAppleIdNotary && !hasApiNotary) {
        errors.push("Apple notarization credentials are required");
      }
    }

    if (platform === "windows" && !environment.WINDOWS_CERTIFICATE_THUMBPRINT) {
      errors.push(
        "WINDOWS_CERTIFICATE_THUMBPRINT is required after importing the signing certificate",
      );
    }
  }

  if (errors.length) {
    throw new Error(`Release preflight failed:\n- ${errors.join("\n- ")}`);
  }
}

export async function findFiles(directory, predicate) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) results.push(...(await findFiles(fullPath, predicate)));
    else if (predicate(fullPath)) results.push(fullPath);
  }
  return results;
}

export async function collectArtifacts({ bundleDirectory, outputDirectory, platform }) {
  const suffixes = platform === "macos" ? [".dmg"] : [".exe", ".msi"];
  const artifacts = await findFiles(bundleDirectory, (filePath) => {
    const filename = path.basename(filePath).toLowerCase();
    return !filename.startsWith("rw.") && suffixes.some((suffix) => filename.endsWith(suffix));
  });
  if (!artifacts.length) throw new Error(`No distributable artifacts found in ${bundleDirectory}`);

  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  const copied = [];
  for (const source of artifacts) {
    const destination = path.join(outputDirectory, path.basename(source));
    await cp(source, destination);
    copied.push(destination);
  }

  const checksumLines = [];
  for (const filePath of copied.sort()) {
    const file = await readFile(filePath);
    checksumLines.push(
      `${createHash("sha256").update(file).digest("hex")}  ${path.basename(filePath)}`,
    );
  }
  const checksumPath = path.join(
    outputDirectory,
    `SHA256SUMS-${path.basename(outputDirectory)}.txt`,
  );
  await writeFile(checksumPath, `${checksumLines.join("\n")}\n`, "utf8");
  return [...copied, checksumPath];
}

export async function ensureFile(filePath) {
  const metadata = await stat(filePath);
  if (!metadata.isFile()) throw new Error(`Expected a file: ${filePath}`);
}
