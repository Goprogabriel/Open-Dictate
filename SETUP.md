# Open Dictate setup

This guide covers local development and the work required to configure a production deployment. Open Dictate is not production-ready merely because the frontend or Tauri bundle compiles: Firebase authorization, the paid API, provider secrets, native permissions, signing, and platform smoke tests are separate release requirements.

## 1. Prerequisites

### All platforms

- Node.js 22 or later
- npm with lockfile support
- Rust 1.85 or later on the stable toolchain
- CMake and Clang (required to compile the bundled Whisper/llama.cpp local inference engines)
- Git and a shell appropriate to the target platform
- A Firebase CLI installation when working on the managed backend or Firestore Rules
- A Firebase-Emulator-compatible Java runtime when running Firestore Rules tests

Install the Rust target that matches the machine on which the application will run. Release bundles should be built and tested on their target operating system.

### macOS

The current bundle minimum is macOS 12. Install Xcode or the Xcode Command Line Tools:

```bash
xcode-select --install
```

Accept the Xcode license if prompted. A direct-distribution release additionally needs an Apple Developer Program account, a **Developer ID Application** certificate, and notarization credentials.

See the official [Tauri macOS prerequisites](https://v2.tauri.app/start/prerequisites/#macos) and [macOS code-signing guide](https://v2.tauri.app/distribute/sign/macos/).

### Windows

Install:

- Microsoft Visual Studio 2022 Build Tools with **Desktop development with C++**;
- Windows 10 or 11 SDK through that workload;
- Microsoft Edge WebView2 Runtime;
- the stable Rust MSVC toolchain matching the build architecture;
- VBSCRIPT support if producing MSI bundles or using Tauri's `all` Windows bundle target.

A release additionally needs a trusted Windows code-signing certificate or a configured remote signing service such as Azure Artifact Signing.

See the official [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows), [Windows installer guide](https://v2.tauri.app/distribute/windows-installer/), and [Windows signing guide](https://v2.tauri.app/distribute/sign/windows/).

## 2. Install dependencies

From the repository root:

```bash
npm ci
```

If the managed backend workspace is present and has its own lockfile, install it separately:

```bash
npm --prefix functions ci
```

Do not reuse a frontend `.env.local` file for backend secrets.

## 3. Configure the desktop client

Create `.env.local` in the repository root. It is ignored by Git.

```dotenv
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=

VITE_API_BASE_URL=

VITE_ENABLE_PREVIEW_DATA=false
VITE_ENABLE_FIREBASE_EMULATORS=false
```

All `VITE_*` variables are public client configuration and can be recovered from a built application. Never put any of the following in a `VITE_*` variable:

- an OpenAI API key;
- `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET`;
- Firebase service-account JSON or a private key;
- signing certificates or passwords;
- a database administration credential.

When `VITE_ENABLE_FIREBASE_EMULATORS=true`, the client expects Auth at `127.0.0.1:9099` and Firestore at `127.0.0.1:8080`.

`VITE_API_BASE_URL` is the deployed HTTPS origin plus the API function path, without a trailing slash. For a Firebase HTTPS function named `api`, it typically resembles:

```text
https://REGION-PROJECT_ID.cloudfunctions.net/api
```

The production origin must also be allowed by the Tauri Content Security Policy. Add the exact origin to `connect-src`; do not replace the policy with an unrestricted wildcard.

### Release-time managed API origin pin

`VITE_API_BASE_URL` configures the frontend, but managed release builds also require a Rust compile-time origin pin. `npm run release:build` derives the pin from the configured API URL. For a direct `tauri build`, export the value or copy `.cargo/config.toml.example` to the ignored `.cargo/config.toml` and replace its placeholder:

```bash
export OPEN_DICTATE_MANAGED_API_ORIGIN="https://REGION-PROJECT_ID.cloudfunctions.net"
npm run desktop:build
```

Use the bare HTTPS origin—scheme, host, and optional port only. Do not include `/api` or `/v1/dictations/transcribe`. The value must match the origin of `VITE_API_BASE_URL`. Rust accepts only that origin plus the managed transcription path and fails closed when a release binary was compiled without the pin. Debug builds permit loopback HTTP for local emulator work.

## 4. Run locally

### Browser UI

```bash
npm run dev
```

The browser adapter is for UI work. It cannot validate global shortcuts, native audio, the credential vault, startup behavior, or insertion into other applications.

Set `VITE_ENABLE_PREVIEW_DATA=true` to show local preview data without Firebase.

### Desktop application

```bash
npm run desktop:dev
```

The first native run may prompt for microphone and OS input permissions. Permission prompts and insertion must be tested from a signed build before release because development and release bundles can have different privacy identities.

Native runs store history, prompt settings, and dictionary entries in AES-256-GCM vault files. A random 256-bit key is created as a private file in the app data directory. Each version-2 vault partitions its payload into a device-local `local` scope and separate `user:<firebase-uid>` scopes. Account bootstrap waits for the encrypted state, resolves Firebase identity, and hydrates only the matching scope before account sync starts.

On upgrade, an old unscoped encrypted payload or legacy `open-dictate-history`, `open-dictate-prompt`, or `open-dictate-dictionary` Zustand entry is wrapped in a temporary `legacy` scope. The first resolved local/account scope with no existing value adopts it. A legacy `localStorage` key is removed only after a successful encrypted write. Validate local → account A → account B → account A switching as part of signed-build upgrade testing; history, prompt, dictionary, and pending cloud deletions must remain isolated. Non-sensitive preferences and onboarding data may remain in webview storage.

### Validation

```bash
npm run typecheck
npm run lint
npm test
npm run locales:check
npm run format
npm run build
```

Validate the checked-in backend workspace separately:

```bash
npm run functions:build
npm run functions:test
```

Run Firestore Rules emulator tests as a separate release gate. A successful TypeScript build does not validate Security Rules.

## 5. Firebase setup

### Create the project

1. Create separate Firebase projects for development/staging and production.
2. Add a Web app and copy its public configuration into the matching `VITE_FIREBASE_*` values.
3. In **Authentication → Sign-in method**, enable Email/Password.
4. Create a Firestore database in a region compatible with the Functions deployment and product data-residency policy.
5. Configure authorized domains for browser-based development and account flows.
6. Decide whether email verification is mandatory before managed transcription. Enforce that decision in the backend, not only in the UI.

Keep the actual project alias local. Either copy `.firebaserc.example` to the ignored
`.firebaserc` and replace the placeholder, or let the Firebase CLI create it:

```bash
firebase use --add
```

The client currently uses IndexedDB Firebase Auth persistence. Signing out clears the Firebase session but is not a cloud-data deletion operation.

Settings and dictionary documents are durable cross-device state. Account sync merges them into the matching UID-scoped local state. A managed dictation uses the current local transformation snapshot sent with that request; the function does not reload these Firestore documents as its immediate prompt source.

### Required Firestore paths

The repositories and backend must agree on these exact top-level paths:

```text
users/{uid}
settings/{uid}
dictionary/{uid}/entries/{entryId}
dictations/{uid}/items/{dictationId}
usage/{uid}/periods/{yyyy-mm}
subscriptions/{uid}
subscriptions/{uid}/ledger/{entryId}
billing_events/{stripeEventId}
transcription_jobs/{requestId}
```

Do not nest settings, dictionary, dictations, or usage below `users/{uid}` without a deliberate migration.

### Security Rules policy

Production deployment requires a checked-in `firestore.rules` file and emulator tests. The policy is:

| Path                                   | Authenticated client policy                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `users/{uid}`                          | Owner read; only explicitly allowed profile fields may be edited, preferably through the backend |
| `settings/{uid}`                       | Owner read/write with type, key, and size validation                                             |
| `dictionary/{uid}/entries/{entryId}`   | Owner read/write of validated live records or tombstones; physical delete is denied              |
| `dictations/{uid}/items/{dictationId}` | Owner read/delete; create/update are server-only                                                 |
| `usage/{uid}/periods/{yyyy-mm}`        | Owner read; all writes are server-only                                                           |
| `subscriptions/{uid}`                  | Owner read; all writes are server-only                                                           |
| `subscriptions/{uid}/ledger/{entryId}` | Owner read if exposed by product policy; all writes are server-only                              |
| `billing_events/{stripeEventId}`       | No client access                                                                                 |
| `transcription_jobs/{requestId}`       | No client access                                                                                 |

The checked-in [`firestore.rules`](./firestore.rules) file is the source of truth. It default-denies unmatched paths, derives ownership from `request.auth.uid`, constrains profile changes to selected fields, validates settings plus live/tombstone dictionary shapes, preserves dictionary creation timestamps, denies tombstone-to-live resurrection and physical dictionary deletion, and blocks client writes to managed dictations, usage, subscriptions, the ledger, billing events, and transcription jobs.

Do not copy a simplified Rules example into the Firebase console. Deploy the reviewed file so source control, emulator tests, and production stay aligned:

```bash
firebase deploy --only firestore:rules,firestore:indexes --project YOUR_PROJECT_ID
```

The Admin SDK bypasses Firestore Rules. Every backend handler must therefore perform its own authentication, authorization, validation, limits, and idempotency checks.

Add emulator tests proving:

- user A cannot read or mutate user B's data;
- unauthenticated access fails;
- clients cannot create dictations or alter usage, subscriptions, ledger, billing events, or jobs;
- settings and dictionary size/type limits reject malformed data;
- allowed owner reads, settings writes, live-to-tombstone dictionary transitions, and history deletes work.

For interactive development, start the checked-in emulator configuration:

```bash
firebase emulators:start --only auth,firestore,functions
```

For an isolated Rules test run, stop any manually running Firestore emulator first, then use the workspace command (which starts and stops its own emulator):

```bash
npm --prefix functions run test:rules
```

Deploy rules and indexes only from reviewed source control; never make an untracked console-only policy change.

## 6. Managed API setup

The desktop expects these API contracts under `VITE_API_BASE_URL`:

| Method | Path                                | Purpose                                                               |
| ------ | ----------------------------------- | --------------------------------------------------------------------- |
| `POST` | `/v1/billing/checkout-session`      | Create an allow-listed Stripe Checkout session                        |
| `POST` | `/v1/billing/portal-session`        | Create a Stripe Customer Portal session                               |
| `POST` | `/v1/billing/topup-session`         | Create an allow-listed USD 5, USD 10, or USD 20 top-up Checkout       |
| `GET`  | `/v1/billing/invoices`              | Return a redacted invoice projection                                  |
| `GET`  | `/v1/me/entitlements`               | Return current subscription and allowance projection                  |
| `POST` | `/v1/dictations/transcribe`         | Reserve allowance, transcribe/transform, settle, and persist metadata |
| `GET`  | `/v1/dictation-requests/:requestId` | Resume or inspect an idempotent managed request                       |

All account and paid endpoints must require `Authorization: Bearer <Firebase-ID-token>`. The server derives the UID from the verified token and ignores any client-supplied UID, plan, price, balance, usage total, Stripe customer ID, or role.

The top-up endpoint accepts exactly `{ "tier": "usd_5" }`, `{ "tier": "usd_10" }`, or `{ "tier": "usd_20" }`. The tier is an identifier into server configuration, not a client-authored amount: the server owns the Stripe price ID, token grant, currency, and margin for each tier.

The managed transcription endpoint should also require a unique request ID, enforce MIME/size/duration limits before calling a provider, bind the request to one authenticated UID, and return an existing outcome for a safe retry.

### Managed dictation request contract

The native recording UUID is the `Idempotency-Key` for both `POST /v1/dictations/transcribe` and the corresponding `transcription_jobs/{requestId}` record. The multipart request contains one bounded WAV plus:

- transcription language, measured duration, speaking duration, and target application label;
- the current custom prompt, output language, and filler-removal, punctuation, and list-formatting toggles;
- at most 100 current dictionary replacements whose language is `all` or matches the transcription language;
- `saveHistory` and one of the supported retention periods: 7, 30, 90, or 365 days.

Rust validates these options before sending. The backend independently requires the exact fields, rejects duplicates and extra multipart parts, validates locales/booleans/retention, limits the prompt to 4,000 characters and each dictionary side to 100 characters, measures duration from the WAV, and enforces the 24 MiB / ten-minute limits. The validated request snapshot drives that dictation. Firestore settings and vocabulary remain the cross-device persistence layer, not the source re-read during processing.

On an ambiguous transport result, Rust authenticates `GET /v1/dictation-requests/:requestId` with the same Firebase identity. It polls an existing `reserved` or `processing` job, returns an existing `succeeded` result, and retries the upload once only when an initial transport failure left no server job. The Functions request timeout is 300 seconds, the native request timeout is 330 seconds, and each OpenAI provider call has a 135-second timeout. Status recovery uses a single 300-second wall-clock deadline across requests, response bodies, and polling delays; each status request is capped at 20 seconds or the remaining budget.

Pending managed requests are not journaled for replay across process restarts. An unresolved network error preserves the temporary WAV until native startup cleanup, but launching the desktop again does not automatically resume the old request ID. Test kill/restart behavior without promising cross-process recovery.

### History retention and deletion behavior

When `saveHistory` is enabled, a managed dictation document receives a server-authored `expiresAt` based on the request's 7/30/90/365-day selection. The scheduled `reconcileStaleTranscriptionJobs` function runs every 15 minutes and deletes expired dictations in bounded batches; expired data may remain until a cleanup run processes it. It also expires completed request-result payloads after 24 hours and releases stale reservations. Deploy and monitor this scheduled function together with the API.

The desktop applies the same retention boundary when hydrating/pruning its encrypted cache and filters older cloud results during sync. Deleting one synced history item creates a UID-scoped encrypted `pendingCloudDeletes` entry, retries the Firestore delete during account sync, and acknowledges it only after success. **Clear local cache** only empties this device's cached history; it does not queue or perform a bulk Firestore delete, and cloud items can reappear on a later sync. Treat local cache clearing, per-item cloud deletion, any future bulk cloud deletion, and account deletion as distinct operations.

### Backend parameters and secrets

Use the backend workspace's checked-in `.env.example` as the source of truth for non-secret parameter names. Copy it to the ignored Firebase environment file for your project, then replace every placeholder and illustrative billing value:

```bash
cp functions/.env.example functions/.env.YOUR_FIREBASE_PROJECT_ID
```

The configured subscription receives `MONTHLY_INCLUDED_CREDITS` as its fixed period allowance. The API returns that configured allowance as `allowanceTokens`, the two current pools as `subscriptionTokens` and `purchasedTokens`, their combined balance as `remainingTokens`, and the subscription-token expiration. At period rollover, unused subscription credits expire and the pool is replaced; purchased credits are additive and never expire. Managed usage reserves and consumes subscription credits before purchased credits.

Pack grants, allowance conversion, provider rates, and revenue margins are required deployment parameters because accounting credits are weighted units, not raw OpenAI tokens. The checked-in example values are deliberately generic and are not a pricing recommendation. Validate the complete economic model, taxes, fees, refunds, and currency handling before accepting real payments.

Provider-cost telemetry is separate and uses integer micro-USD without applying a universal revenue markup. It stores provider cost, component rates, usage-estimation metadata, and `COMMERCIAL_COST_SCHEDULE_VERSION` alongside capture metadata and monthly aggregates. Successful polish calls use provider-reported usage. If a dispatched polish call times out or returns a malformed response without trustworthy usage, reporting uses the versioned safety estimate `UTF-8 request body bytes + OPENAI_FAILED_POLISH_INPUT_OVERHEAD_TOKENS` for input and `OPENAI_POLISH_MAX_OUTPUT_TOKENS` for output. This deliberately overstates some ambiguous failures rather than recording potentially billable work as zero; it does not change the customer allowance debit. Confirm model availability and current provider prices before every release, then increment the schedule version whenever a rate or estimation method changes.

Dictionary deletion uses durable Firestore tombstones (`deleted=true`, original `createdAt`, server `updatedAt`) and UID-scoped encrypted local tombstones. Tombstones are terminal per document ID and beat live records regardless of timestamp; an intentional re-add creates a new UUID. Do not replace tombstones with client `deleteDoc`: a device returning from offline state could otherwise resurrect an entry. Prompt synchronization also depends on explicit `updatedAt` metadata so an intentional cloud reset to default values remains distinguishable from a missing document.

Create secrets in the deployment secret manager, not `.env.local`:

```bash
firebase functions:secrets:set OPENAI_API_KEY
firebase functions:secrets:set STRIPE_SECRET_KEY
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
```

Use separate restricted keys for staging and production. Limit IAM access to deployment and runtime principals. Rotate keys after suspected exposure and verify logs never include them.

## 7. OpenAI setup

### Free / BYOK

The user supplies their own API key during onboarding or in Settings. The production desktop flow must:

1. pass the value over IPC to Rust;
2. encrypt it in the native credential vault;
3. expose only has/replace/delete/test operations to the webview;
4. perform the OpenAI request in Rust;
5. never write the key to logs, Firestore, local storage, crash reports, or analytics.

Users should configure OpenAI project spend limits and use a project-scoped key. A desktop BYOK credential is protected at rest from accidental plaintext storage, not from a compromised user account or process.

The native BYOK implementation defaults to:

- `gpt-4o-mini-transcribe` for speech-to-text;
- `gpt-5-mini` for the polishing Responses request.

The native process can override these with `OPENAI_TRANSCRIBE_MODEL` and `OPENAI_POLISH_MODEL`. In ordinary signed desktop launches, use the checked-in defaults unless the release process deliberately provides and validates an alternative.

### Paid service

Store the platform OpenAI key only in the backend secret manager. The managed Functions defaults are `gpt-4o-mini-transcribe` for speech-to-text and `gpt-5-mini` for polishing. These Firebase Functions parameters are intentionally independent of the native BYOK defaults and may be overridden per deployment after availability, quality, latency, and allowance economics are reviewed.

The OpenAI transcription API currently accepts files up to 25 MB; Open Dictate sets a slightly smaller 24 MiB application limit and a ten-minute duration limit. For managed requests, the current relevant dictionary is sent by the desktop and validated server-side before its terms become a compact transcription prompt. The current custom instructions, output language, and behavior toggles are applied in the separate polishing stage rather than relying on speech-to-text alone.

See the official [OpenAI speech-to-text guide](https://developers.openai.com/api/docs/guides/speech-to-text) and [API key safety guidance](https://help.openai.com/en/articles/5112595-best-practices-for-api).

Do not log raw provider request bodies or responses in production. Record only redacted correlation IDs, model/prompt versions, coarse duration/size buckets, metered units, and error classes.

## 8. Stripe setup

### Product and price

1. Create separate Stripe test-mode and live-mode configurations.
2. Create an **Open Dictate Pro** product.
3. Add a recurring monthly price for USD 5. Use the resulting `price_...` ID as `STRIPE_PRO_MONTHLY_PRICE_ID`.
4. Create three fixed, one-time prices for exactly USD 5, USD 10, and USD 20. Set their IDs as `STRIPE_TOPUP_5_PRICE_ID`, `STRIPE_TOPUP_10_PRICE_ID`, and `STRIPE_TOPUP_20_PRICE_ID`, with matching grants in `TOPUP_5_CREDITS`, `TOPUP_10_CREDITS`, and `TOPUP_20_CREDITS`.
5. Set and review the deployment's revenue policy using the matching `*_MARGIN_BPS` parameters.
6. Never accept an arbitrary price ID, amount, quantity, token grant, or margin from the desktop. The server maps the strict pack tier to reviewed configuration.
7. Configure the Customer Portal for subscription cancellation, payment-method changes, and invoice access according to product policy.

### Checkout

The authenticated backend creates or reuses a Stripe customer mapped to the Firebase UID, creates Checkout, and returns only the hosted URL. Subscription Checkout uses the configured monthly price. Top-up Checkout requires an active/trialing subscription, accepts only `usd_5`, `usd_10`, or `usd_20`, uses payment mode and the corresponding configured one-time price, and carries server-authored tier/grant/margin metadata. Both creation endpoints require idempotency keys.

Success/cancel redirects are navigation signals. They do not activate Pro or grant credits; the signed webhook does.

### Webhook

Configure the deployed webhook function as a Stripe endpoint. Subscribe only to events the implementation handles, normally including:

- `checkout.session.completed`;
- `checkout.session.async_payment_succeeded`;
- `customer.subscription.created`;
- `customer.subscription.updated`;
- `customer.subscription.deleted`;
- `invoice.paid`;
- `invoice.payment_failed`;
- `invoice.finalization_failed`.

The handler must receive the raw body, verify the signature with `STRIPE_WEBHOOK_SECRET`, and deduplicate every event in `billing_events/{stripeEventId}`. It updates `subscriptions/{uid}` and writes idempotent period grants to `subscriptions/{uid}/ledger/{entryId}`. Each paid billing period replaces the subscription-token pool and expires the unused previous-period balance without changing purchased tokens. For a top-up completion, the handler verifies paid status, server-authored tier metadata, expected amount, and the matching allow-listed line-item price, then grants that tier's purchased tokens once using the Checkout session as the immutable ledger source.

Use the Stripe CLI for local test events, but keep its ephemeral webhook secret outside source control:

```bash
stripe listen --forward-to http://127.0.0.1:5001/PROJECT_ID/europe-west1/stripeWebhook
```

The exact emulator URL depends on the deployed region and function name. Exercise duplicate delivery, out-of-order subscription events, failed invoices, cancellation at period end, immediate cancellation, portal changes, and webhook retries before going live.

## 9. Native permissions

### macOS

Open Dictate needs three distinct capabilities:

- **Microphone** for audio capture;
- **Accessibility** for observing the global modifier shortcut and inserting text into another application.

It does **not** need Screen Recording. Do not request it, add a screen-capture usage string, or instruct users to grant it.

The application includes a microphone usage description and audio-input entitlement. Permission state should be checked independently; Accessibility approval does not imply Input Monitoring approval.

For development, grants can become stale when the bundle path, signature, or identity changes. Reset only the affected Open Dictate grant when testing first-run behavior, then launch the same signed artifact that will be assessed. Keep the identifier `app.opendictate.desktop` stable after release or users may be prompted again.

### Windows

Windows users must allow microphone access for desktop applications. Open Dictate should link to the appropriate privacy settings when access is unavailable.

Text insertion cannot reliably cross integrity boundaries. A normal Open Dictate process must not attempt to bypass User Interface Privilege Isolation to type into an elevated process, UAC secure desktop, or protected field. Present a copy fallback instead.

Test the keyboard monitor and insertion path with:

- multiple keyboard layouts and AltGr;
- Sticky Keys and key-repeat behavior;
- both key press/release orders;
- sleep/resume and Remote Desktop;
- standard and elevated target applications;
- password/secure fields, which must fail closed.

## 10. macOS signing and notarization

`src-tauri/tauri.conf.json` currently uses bundle identifier `app.opendictate.desktop`, hardened runtime, and a null signing identity. Configure signing in the release environment rather than committing certificate material.

For a developer machine whose Developer ID certificate is already in Keychain, set:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Legal Name (TEAMID)"
```

For CI, Tauri supports importing a base64-encoded certificate:

```bash
export APPLE_CERTIFICATE="...base64-encoded-p12..."
export APPLE_CERTIFICATE_PASSWORD="..."
export APPLE_SIGNING_IDENTITY="Developer ID Application: Legal Name (TEAMID)"
```

Never print these values or store them in repository files. Use the CI secret store.

Configure notarization with either an Apple ID and app-specific password:

```bash
export APPLE_ID="release-account@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"
```

or an App Store Connect API key using Tauri's `APPLE_API_KEY`, `APPLE_API_ISSUER`, and API-key path configuration. Prefer a narrowly scoped CI identity.

Build on macOS:

```bash
npm run desktop:build
```

Verify the resulting application and distributable:

```bash
codesign --verify --deep --strict --verbose=2 "path/to/Open Dictate.app"
spctl --assess --type execute --verbose=4 "path/to/Open Dictate.app"
xcrun stapler validate "path/to/Open Dictate.app"
```

Confirm notarization/stapling on the actual DMG or application artifact being distributed. Smoke-test a clean macOS account and a machine on which Open Dictate has never been granted microphone, Input Monitoring, or Accessibility access.

## 11. Windows signing and installers

The current Tauri configuration builds Windows bundles, uses SHA-256 and DigiCert's timestamp service, and configures NSIS for a current-user install. `certificateThumbprint` is null, so builds are unsigned until release signing is configured.

With a code-signing certificate installed in the Windows certificate store, set the certificate thumbprint in release configuration or inject it through an environment-specific Tauri config. Keep the private key out of source control. The certificate subject must match the application publisher identity used for releases.

For Azure Artifact Signing or another signing service, configure Tauri's `signCommand` according to the official Windows signing guide. Scope cloud credentials to signing and keep timestamping enabled.

Build on Windows:

```powershell
npm run desktop:build
```

Verify the executable and installer:

```powershell
Get-AuthenticodeSignature "path\to\Open Dictate.exe" | Format-List
Get-AuthenticodeSignature "path\to\Open Dictate_installer.exe" | Format-List
```

The status must be valid and timestamped. Install and uninstall with a non-administrator account, test upgrade over the previous signed release, confirm startup registration is removed on uninstall, and confirm WebView2 bootstrap behavior on a clean supported machine.

## 12. Production release checklist

Before a production release:

- all frontend, Rust, backend, Firestore Rules, and contract tests pass;
- shortcut arming, third-key cancellation, watchdog recovery, and ordinary application shortcuts are verified on both platforms;
- the original focus token is captured and revalidated before insertion;
- screen recording is neither requested nor described as required;
- BYOK values stay in the encrypted native credential vault and Rust-only request path;
- the release binary is compiled with `OPEN_DICTATE_MANAGED_API_ORIGIN` matching the production `VITE_API_BASE_URL` origin;
- the managed API verifies Firebase ID tokens and applies upload/rate limits;
- usage reservations and settlements are transactional and idempotent;
- managed recording UUID retries/status recovery and the 300/330-second timeout contract are verified;
- Stripe webhook signatures, duplicate delivery, and out-of-order delivery are tested;
- Firestore Rules emulator tests prove cross-user isolation and server-only writes;
- AES-256-GCM local-state round trips, UID-scope isolation, tamper detection, private-file access, and legacy adoption are verified in signed builds;
- 7/30/90/365-day local pruning, Firestore `expiresAt`, scheduled cleanup, and the explicit cloud-delete queue are verified;
- logs, analytics, and crash reports are inspected for audio, transcript, prompt, email, token, and secret leakage;
- macOS artifacts are signed, hardened, notarized, stapled, and assessed;
- Windows executables and installers are signed, timestamped, and verified;
- fresh-install, upgrade, background, startup, offline, permission-denied, and uninstall smoke tests pass;
- model IDs, provider pricing, allowance policy, subscription-token expiry, pool consumption order, top-up grants, and configured margins are reviewed against the current production configuration;
- backup, incident-response, secret-rotation, support, retention, deletion, and privacy policies have named owners.

See [SECURITY.md](./SECURITY.md) for security-specific launch blockers.
