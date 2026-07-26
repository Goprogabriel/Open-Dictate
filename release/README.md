# Open Dictate releases

This folder contains the reproducible desktop release setup. Generated installers are placed in
`release/artifacts/v<version>/<platform>-<architecture>/` together with a platform-named SHA-256
checksum file.

## Make a test build now

Run this on the operating system you are building for:

```bash
npm ci
npm run release:build
```

To build a shareable demo without embedding any local Firebase, managed API, or Stripe
configuration, use:

```bash
npm run release:demo
```

The public demo supports Local AI and BYOK. Managed mode stays disabled until a distributor builds
with their own service configuration.

On Apple Silicon this creates an ad-hoc-signed DMG. It is suitable for testing and direct sharing
with informed testers, but macOS may still require approval in Privacy & Security. Windows test
builds are unsigned and will show a SmartScreen warning. Windows installers must be built on
Windows; the GitHub workflow does that automatically.

## Make a production build

1. Copy `release/release.env.example` to the ignored file `release/release.env` and insert the
   public production Firebase/API configuration.
2. Export the signing variables described below. Do not put them in `release.env`.
3. Run `npm run release:build -- --production` on the target operating system.

Production mode fails before compiling if the client configuration, API-origin pin, signing
identity, or notarization credentials are missing. The versions in `package.json`,
`src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` must match.

### macOS secrets

Use a paid Apple Developer account and a **Developer ID Application** certificate for distribution
outside the App Store. Export these variables for a local build:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Legal Name (TEAMID)"
export APPLE_ID="release-account@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"
```

CI imports a base64-encoded `.p12` through `APPLE_CERTIFICATE` and
`APPLE_CERTIFICATE_PASSWORD`; Tauri infers its signing identity. Notarization runs during the Tauri
bundle step and the ticket is stapled before the artifacts are collected.

### Windows secrets

Install a trusted code-signing `.pfx` in `Cert:\CurrentUser\My`, then export its SHA-1 thumbprint:

```powershell
$env:WINDOWS_CERTIFICATE_THUMBPRINT = "CERTIFICATE_SHA1_THUMBPRINT"
npm run release:build -- --production
```

The build uses SHA-256 signatures and DigiCert timestamping. The CI helper imports the PFX only for
the job and passes its thumbprint to Tauri. Azure Artifact Signing can replace the PFX workflow by
configuring Tauri's `bundle.windows.signCommand` in a private release override.

## GitHub release workflow

`.github/workflows/release.yml` supports two flows:

- **Run workflow** creates downloadable test installers as workflow artifacts. Leave `production`
  off until signing secrets and production repository variables are ready.
- Pushing a tag such as `app-v0.1.0` performs strict production builds and creates a **draft**
  GitHub Release containing the Mac and Windows installers. Review and smoke-test the draft before
  publishing it.

Configure these GitHub repository **variables**:

- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`
- optionally `VITE_FIREBASE_MEASUREMENT_ID`
- `VITE_API_BASE_URL` including `/api`
- `OPEN_DICTATE_MANAGED_API_ORIGIN` containing only the matching HTTPS origin

Configure these GitHub repository **secrets**:

- macOS: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`,
  `APPLE_TEAM_ID`
- Windows: `WINDOWS_CERTIFICATE_BASE64`, `WINDOWS_CERTIFICATE_PASSWORD`

Before publishing, install every candidate on clean supported machines and exercise microphone,
Input Monitoring/Accessibility, dictation insertion, background startup, local AI downloads,
BYOK, sign-in, billing, upgrades, and uninstall. A successful compiler run cannot validate OS
privacy grants or production services.
