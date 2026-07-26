import path from "node:path";

import {
  assertMatchingVersions,
  createReleaseEnvironment,
  ensureFile,
  parseArguments,
  platformDetails,
  projectVersions,
  repositoryRoot,
  validateReleaseEnvironment,
} from "./lib.mjs";

const options = parseArguments(process.argv.slice(2));
const platform = platformDetails(options.target);
const environment = await createReleaseEnvironment(options);

const version = assertMatchingVersions(await projectVersions());
if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME !== `app-v${version}`) {
  throw new Error(
    `Release tag ${process.env.GITHUB_REF_NAME} does not match application version ${version}`,
  );
}
await ensureFile(path.join(repositoryRoot, "src-tauri", "icons", "icon.icns"));
await ensureFile(path.join(repositoryRoot, "src-tauri", "icons", "icon.ico"));
validateReleaseEnvironment(environment, {
  production: options.production,
  publicDemo: options.publicDemo,
  platform: platform.name,
});

console.log(
  `Release preflight passed for Open Dictate ${version} (${platform.name}-${platform.architecture}).`,
);
if (options.publicDemo) {
  console.log("Mode: public demo build without managed-service configuration.");
} else if (!options.production) {
  console.log("Mode: distributable test build. Use --production to require trusted signing.");
}
