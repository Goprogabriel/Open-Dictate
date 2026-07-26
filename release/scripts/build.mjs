import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import {
  assertMatchingVersions,
  collectArtifacts,
  createReleaseEnvironment,
  parseArguments,
  platformDetails,
  projectVersions,
  releaseDirectory,
  repositoryRoot,
} from "./lib.mjs";

const executeFile = promisify(execFile);

function run(command, arguments_, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: repositoryRoot,
      env: environment,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function detachStaleDmgBuildImages() {
  if (process.platform !== "darwin") return;
  const { stdout } = await executeFile("hdiutil", ["info"]);
  const blocks = stdout.split(/^={10,}$/mu);
  const targetRoot = path.join(repositoryRoot, "src-tauri", "target") + path.sep;

  for (const block of blocks) {
    const imagePath = /^image-path\s*:\s*(.+)$/mu.exec(block)?.[1]?.trim();
    const device = /^(\/dev\/disk\d+)\s/mu.exec(block)?.[1];
    if (imagePath?.startsWith(targetRoot) && path.basename(imagePath).startsWith("rw.") && device) {
      console.log(`Detaching stale Tauri DMG build image ${device}.`);
      await executeFile("hdiutil", ["detach", "-force", device]);
    }
  }
}

const options = parseArguments(process.argv.slice(2));
const platform = platformDetails(options.target);
const version = assertMatchingVersions(await projectVersions());
const environment = await createReleaseEnvironment(options);

const preflightArguments = ["release/scripts/preflight.mjs"];
if (options.production) preflightArguments.push("--production");
if (options.publicDemo) preflightArguments.push("--public-demo");
if (options.target) preflightArguments.push("--target", options.target);
await run(process.execPath, preflightArguments, environment);

if (!options.skipChecks) {
  await run("npm", ["run", "typecheck"], environment);
  await run("npm", ["test", "--", "--run"], environment);
  await run("npm", ["run", "locales:check"], environment);
}

if (
  platform.name === "macos" &&
  !options.production &&
  !environment.APPLE_CERTIFICATE &&
  !environment.APPLE_SIGNING_IDENTITY
) {
  environment.APPLE_SIGNING_IDENTITY = "-";
}

let tauriConfigOverride;

if (platform.name === "windows" && environment.WINDOWS_CERTIFICATE_THUMBPRINT) {
  tauriConfigOverride = {
    bundle: {
      windows: { certificateThumbprint: environment.WINDOWS_CERTIFICATE_THUMBPRINT },
    },
  };
}

if (platform.name === "macos") {
  // llama.cpp is linked dynamically on macOS so it does not collide with the
  // separate GGML copy used by Whisper. Build once to materialize the dylibs,
  // then tell Tauri exactly which target-specific libraries to bundle.
  const cargoArguments = [
    "build",
    "--manifest-path",
    path.join("src-tauri", "Cargo.toml"),
    "--release",
  ];
  if (options.target) cargoArguments.push("--target", options.target);
  await run("cargo", cargoArguments, environment);

  const targetReleaseDirectory = options.target
    ? path.join("target", options.target, "release")
    : path.join("target", "release");
  const bundledLibraries = [
    "libggml-base.0.dylib",
    "libggml-cpu.0.dylib",
    "libggml-metal.0.dylib",
    "libggml.0.dylib",
    "libllama-common.0.dylib",
    "libllama.0.dylib",
  ].map((filename) => path.join(targetReleaseDirectory, filename));
  tauriConfigOverride = {
    bundle: { macOS: { frameworks: bundledLibraries } },
  };
}

await detachStaleDmgBuildImages();

const buildArguments = ["run", "tauri", "--", "build", "--ci", "--bundles", platform.bundles];
if (options.target) buildArguments.push("--target", options.target);
if (tauriConfigOverride) buildArguments.push("--config", JSON.stringify(tauriConfigOverride));
await run("npm", buildArguments, environment);

const targetDirectory = options.target
  ? path.join(repositoryRoot, "src-tauri", "target", options.target, "release", "bundle")
  : path.join(repositoryRoot, "src-tauri", "target", "release", "bundle");
const outputDirectory = path.join(
  releaseDirectory,
  "artifacts",
  `v${version}`,
  `${platform.name}-${platform.architecture}`,
);
const artifacts = await collectArtifacts({
  bundleDirectory: targetDirectory,
  outputDirectory,
  platform: platform.name,
});

if (platform.name === "macos") {
  const appPath = path.join(targetDirectory, "macos", "Open Dictate.app");
  await run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], environment);
  for (const artifact of artifacts.filter((filePath) => filePath.endsWith(".dmg"))) {
    await run("hdiutil", ["verify", artifact], environment);
    if (options.production) {
      await run("xcrun", ["stapler", "validate", artifact], environment);
    }
  }
  if (options.production) {
    await run("spctl", ["--assess", "--type", "execute", "--verbose=4", appPath], environment);
  }
}

if (platform.name === "windows" && options.production) {
  const verifier = path.join(releaseDirectory, "scripts", "verify-windows-signature.ps1");
  for (const artifact of artifacts.filter((filePath) => /\.(exe|msi)$/iu.test(filePath))) {
    await run("pwsh", ["-NoProfile", "-File", verifier, "-Path", artifact], environment);
  }
}

console.log("\nRelease artifacts:");
for (const artifact of artifacts) console.log(path.relative(repositoryRoot, artifact));
if (!options.production) {
  console.log(
    "\nThis test build is not trusted-publisher signed. Do not present it as a production release.",
  );
}
