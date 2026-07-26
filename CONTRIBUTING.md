# Contributing to Open Dictate

Open Dictate is an open-source desktop project with an optional self-hosted managed service. The implementation is pre-release while its native platform matrix, external-service configuration, signing, and notarization are qualified. Contributions should preserve the trust boundaries, platform behavior, accessibility, privacy, and maintainability described in [ARCHITECTURE.md](./ARCHITECTURE.md).

## Before you start

1. Read [README.md](./README.md) for project status.
2. Follow [SETUP.md](./SETUP.md) for local prerequisites and configuration.
3. Read [SECURITY.md](./SECURITY.md) before changing native input, permissions, secrets, networking, Firebase, billing, history, or logging.
4. Keep the distinction between **implemented**, **validation pending**, **required**, and **optional** behavior accurate in code and documentation.

Do not use live customer data, live Stripe mode, or a production OpenAI/Firebase credential for routine development and tests.

## Install and run

```bash
npm ci
npm run dev
```

For native work:

```bash
npm run desktop:dev
```

For managed-backend work, install and validate that workspace independently:

```bash
npm --prefix functions ci
npm run functions:build
npm run functions:test
```

The browser adapter is useful for UI development but cannot validate system-wide dictation. Native changes must be tested in a Tauri build on the affected operating system.

## Engineering boundaries

### Frontend

- `pages/` compose route-level features; they do not call Tauri, Firebase, Stripe, or OpenAI directly.
- `features/` own user workflows and feature components.
- `components/ui/` contains reusable presentation primitives with no provider knowledge.
- `services/` contains typed infrastructure adapters and validation at transport boundaries.
- Zustand stores stay small and domain-specific. Do not create a single application-wide store or treat local state as cloud authority.
- Provider SDK values must be mapped to domain types before reaching presentation components.

### Native host

- Rust owns global input observation, microphone capture, permission checks, OS-vault access, focus tracking, text insertion, and native lifecycle state.
- Keep platform code behind common interfaces and `cfg(target_os = "macos")` / `cfg(windows)` modules.
- Keep `unsafe` blocks small, explain their invariants, and isolate callbacks/message loops from application state.
- Do not block a key-hook callback, audio callback, or Tauri main thread with network or disk work.
- IPC commands validate sizes, enums, URLs, state transitions, and correlation IDs independently of TypeScript types.

### Managed backend

- The backend verifies Firebase ID tokens and derives the UID from verified claims.
- Stripe, OpenAI service keys, webhook secrets, and administrative Firebase credentials stay server-side.
- Subscription state, allowance, ledger entries, usage aggregates, and managed dictation creation are server-owned.
- Provider, Firebase, and Stripe code sits behind service/domain functions so it can be tested without live APIs.
- Retryable operations are idempotent and have explicit request/event IDs.
- Firestore settings and dictionary entries are durable cross-device state; the strictly validated transformation snapshot attached to a managed request is the immediate source for that dictation.

## Stable data paths

The exact Firestore layout is:

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

The first seven paths are UID-partitioned product data. `billing_events` and `transcription_jobs` are server-only. Do not move settings, dictionary, dictations, or usage under `users/{uid}` subcollections casually.

A schema change must update, in one coordinated change:

- TypeScript domain and transport types;
- frontend repositories;
- backend validators and writes;
- Firestore Rules and indexes;
- Rules and contract tests;
- emulator fixtures/migrations;
- `ARCHITECTURE.md`, `SETUP.md`, and any retention/privacy documentation.

Never authorize access from a mutable `ownerId` field when the immutable UID path segment can be used.

## Dictation invariants

Changes to the dictation path must preserve all of these behaviors:

1. The original target application/window is captured before Open Dictate can change focus.
2. A modifier-only chord arms for 150–200 ms and does not consume the underlying key events.
3. Any non-modifier key during arming cancels dictation so ordinary Option + Command + key or Alt + Windows + key shortcuts still work.
4. Either modifier release stops once; Escape cancels; a watchdog handles lost release events.
5. Only one recording/correlation ID is active, and late events are ignored.
6. The target focus token is revalidated immediately before insertion.
7. Changed, unavailable, secure, protected, or higher-integrity targets fail closed with an explicit copy fallback.
8. Audio and request size/duration limits are enforced before upload.
9. Temporary audio is removed on success, cancel, terminal error, and next startup after a crash.
10. The HUD is non-focusable and never becomes the insertion target.
11. A managed attempt uses the native recording UUID unchanged as its upload idempotency key, status-recovery key, and job ID.

Do not replace the native modifier-edge monitor with a conventional accelerator library unless the configured shortcut includes a non-modifier key and the product behavior is deliberately changed.

### Native input test matrix

Test affected shortcut/insertion changes with:

- both modifier press orders and both release orders;
- a short tap, a valid hold, repeats, and a lost key-up watchdog;
- a third key before and at the arming boundary;
- common application shortcuts that share the modifiers;
- Sticky Keys, macOS input sources, Windows layouts, and AltGr;
- sleep/resume, lock/unlock, Remote Desktop where relevant, and device changes;
- focus switches during recording and processing;
- representative editors, browsers, chat apps, and terminals;
- password fields, secure desktops, and elevated targets, which must fail closed.

## BYOK and managed-service rules

### BYOK

- The webview may submit a new key but may never retrieve the stored key.
- Store the key only in the native encrypted credential vault; never expose its namespace through public secure-state IPC.
- Rust sends requests only to the fixed OpenAI API host.
- Never include a key in command output, error text, logs, fixtures, snapshots, or crash metadata.
- Tests use a fake provider or local mock; they do not consume a contributor's real account by default.

### Managed mode

- The desktop sends a current Firebase ID token only to the configured HTTPS API origin. Release builds must compile Rust with the bare HTTPS `OPEN_DICTATE_MANAGED_API_ORIGIN` matching the origin of `VITE_API_BASE_URL`.
- Every account endpoint authenticates; CORS/origin checks are defense in depth, not identity.
- The server ignores client-supplied UID, plan, price, balance, usage, cost, and Stripe identifiers.
- The desktop sends the current custom prompt, output language, behavior toggles, `saveHistory`, 7/30/90/365-day retention choice, and no more than 100 dictionary replacements relevant to the transcription language. Rust and the managed parser validate the contract independently.
- Do not replace the request snapshot with a mid-request Firestore settings/dictionary lookup. Firestore synchronization is durable cross-device persistence, while the submitted validated snapshot defines the current transformation.
- A request reserves subscription credits first and purchased credits second, persists both reservation portions plus the subscription-period identity, settles actual usage from the same pools, and releases failed reservations without restoring an expired period.
- The recording UUID is the `Idempotency-Key`. Ambiguous responses recover through authenticated `GET /v1/dictation-requests/:requestId`; only an initial transport failure with no job may retry the POST once.
- Preserve the 300-second Functions timeout, 330-second native request timeout, and 135-second provider-call timeout relationship unless the whole request/recovery contract is reviewed together.
- Do not claim cross-process pending-request replay: the current client does not journal it. Unresolved managed network errors leave the temporary WAV for startup cleanup.
- A Stripe redirect never grants Pro or top-up credits. Only a verified, idempotent webhook updates subscription authority or grants a configured `usd_5`, `usd_10`, or `usd_20` pack after verifying paid status, server-authored metadata, amount, and the matching allow-listed price.
- A paid monthly invoice replaces the period-bound subscription pool; unused subscription tokens expire at period end. Purchased tokens are additive, never expire, and must not be erased by subscription lifecycle events.
- Preserve the versioned provider-cost calculation as reporting independent from revenue margin. Funding grants carry the server-authored, deployment-configured margin policy.

The authenticated API exposes `subscriptionTokens`, `purchasedTokens`, their combined `remainingTokens`, and the fixed `allowanceTokens`. The backend's `*Credits` parameters, Firestore balance fields, and transition functions are the internal name for the same integer accounting unit. Do not present either one as the raw OpenAI provider token count.

## Local data and privacy

- Never add raw audio, dictation text, prompts, dictionary entries, emails, credentials, authorization headers, or full payment identifiers to logs or analytics.
- Persist history, prompt settings, and dictionary entries only through the native AES-256-GCM vault. Its random 256-bit master key belongs in the private app data directory; do not move it into source, a `VITE_*` value, or webview storage.
- Preserve version-2 scope isolation: `local` and every `user:<firebase-uid>` payload must hydrate independently, with persistence suppressed during a scope switch. The history scope includes `pendingCloudDeletes`; the dictionary scope includes durable tombstones; the prompt scope includes explicit update metadata.
- Preserve legacy adoption: wrap old unscoped encrypted or `localStorage` payloads in `legacy`, adopt them only into the first resolved scope without data, and remove a legacy `localStorage` key only after an authenticated encrypted write.
- “Do not save history” must affect local and managed history writes; it is not merely a hidden UI row.
- Explicit deletion of a synced item must queue and retry the Firestore deletion until acknowledged. Clearing the local cache must not create cloud-delete intent or call a bulk delete; cloud data may reappear on later sync.
- Dictionary deletion is different from history deletion: write and retry a live-record tombstone, never a client-side physical delete. Keep tombstones out of UI and transcription snapshots while retaining them for latest-wins merges.
- Preserve server-timestamp acknowledgement for prompt and dictionary writes: read committed state from Firestore, apply its timestamp only while the attempted local mutation is still current, and suppress acknowledgement hydration from scheduling another upload.
- Retention accepts only 7, 30, 90, or 365 days. Preserve local pruning, cloud-result filtering, server-authored `expiresAt`, and scheduled bounded cleanup together.
- New retention or cloud-sync behavior requires documentation, account-isolation tests, and deletion-path tests.
- Clipboard fallback is explicit because clipboard managers may retain content.
- Screen Recording permission is not required and must not be requested, documented as required, or added to entitlements.

## Internationalization and accessibility

All user-visible product text belongs in translation resources:

```text
src/locales/en.json
src/locales/da.json
src/locales/no.json
src/locales/sv.json
```

When adding or changing a key:

1. update all four locale files;
2. keep interpolation variable names identical;
3. run `npm run locales:check` and locale tests;
4. verify long Danish/Norwegian/Swedish text does not break the layout;
5. avoid concatenating translated fragments whose grammar assumes English.

Controls need accessible names, visible keyboard focus, correct semantic elements, and keyboard operation. Color cannot be the only status cue. Respect reduced-motion preferences for nonessential animation. The recording HUD must be understandable without stealing focus.

## UI contributions

Open Dictate's visual language is calm, minimal, and desktop-native rather than a generic admin dashboard. Reuse existing spacing, color, typography, radius, motion, and component tokens before adding a new variant.

- Keep route pages focused on one primary task.
- Prefer whitespace and hierarchy over dense panels.
- Reuse `components/ui` primitives.
- Provide loading, empty, error, offline, disabled, and permission-denied states.
- Avoid decorative charts or metrics that imply server-authoritative data when only preview/local data exists.
- Test at the configured minimum window size and with increased text size.

## API and IPC contract changes

TypeScript types do not validate runtime input. Contract changes require runtime validation on both sides.

For Tauri IPC:

- use explicit serializable request/response structs;
- use stable command/event names;
- return redacted error codes plus user-safe detail;
- reject unexpected lifecycle states and stale recording IDs;
- update custom command permissions and per-window capabilities;
- add contract tests for optional fields, casing, and error shapes.

For the managed API:

- define method, path, authentication, content type, request ID, body limits, success schema, and error schema;
- keep `/v1` compatibility or provide a coordinated migration;
- update desktop clients, backend routes, tests, and setup documentation together;
- never accept arbitrary callback/provider URLs from the client.

## Firestore Rules workflow

Every Rules change needs emulator tests before deployment. Include at least:

- unauthenticated denial;
- owner success cases;
- cross-user denial for every affected path;
- forbidden client writes to server-owned fields/collections;
- malformed, oversized, missing, extra, and immutable-field cases;
- query behavior for repositories, not only direct document reads.

The Firebase Admin SDK bypasses Rules. Backend tests must exercise handler authorization separately.

## Quality gates

Run the relevant commands before requesting review:

```bash
npm run typecheck
npm run lint
npm test
npm run locales:check
npm run format
npm run build
```

For Rust changes, run formatting, linting, and tests from `src-tauri` using the repository's toolchain policy:

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets --all-features
```

For backend/Rules changes, also run:

```bash
npm run functions:build
npm run functions:test
```

and the checked-in Firestore emulator test command once that configuration is present.

A contributor working on one platform should still keep the other platform compiling. Native behavior changes need review or validation on both macOS and Windows before they are release-ready.

## Tests expected by change type

| Change                 | Minimum evidence                                                               |
| ---------------------- | ------------------------------------------------------------------------------ |
| UI/component           | Component tests for key states, keyboard/accessibility check, all locales      |
| Zustand/business logic | Unit tests for transitions and persistence/migration behavior                  |
| Tauri IPC              | Rust unit/contract tests plus TypeScript adapter test                          |
| Audio                  | Device/format/cancel/limit tests and a manual hardware smoke test              |
| Shortcut/insertion     | Native input matrix and focus revalidation tests on affected OS                |
| Firebase repository    | Emulator test with owner, cross-user, and unauthenticated cases                |
| Managed endpoint       | Auth, strict snapshot validation, UUID recovery, limits, and redaction tests   |
| Stripe                 | Signature, duplicate, retry, out-of-order, and customer-mapping tests          |
| Persistence/retention  | UID isolation, legacy adoption, clear/delete queue, expiry, and recovery tests |
| Installer/release      | Signed clean-install, upgrade, startup, permissions, and uninstall smoke tests |

## Documentation expectations

Update documentation in the same change when behavior, setup, trust boundaries, data paths, permissions, supported platforms, provider models, billing policy, or production status changes.

Do not describe a contract, placeholder, UI preview, emulator-only implementation, or unverified native path as shipped. Conversely, once a feature is complete and release-qualified, update status tables so the docs remain useful.

Material changes to data ownership, secret flow, dictation lifecycle, focus behavior, billing authority, or retention should have an Architecture Decision Record with context, decision, rejected alternatives, consequences, migration, and rollback.

## Change review

A reviewable change should:

- have one clear purpose;
- avoid unrelated formatting or generated-file churn;
- preserve existing user changes and platform code outside scope;
- include tests or explain why a test is not meaningful;
- call out security/privacy implications;
- include screenshots for visible UI changes and platform details for native changes;
- include migration and rollback notes for stored data or API changes;
- state which commands and operating systems were actually verified.

Do not commit `.env*` secrets, certificates, service-account files, real audio/transcript fixtures, provider responses containing personal data, or production database exports. Use synthetic fixtures and redact screenshots.

## Definition of done

A change is done when:

- its behavior is complete for the agreed scope rather than hidden behind an unexplained placeholder;
- architecture and security invariants still hold;
- runtime inputs are validated at trust boundaries;
- errors are actionable and redact sensitive data;
- relevant automated tests pass;
- locale and accessibility requirements are satisfied;
- the affected platforms have appropriate evidence;
- documentation and configuration examples match reality;
- no new secret, transcript, audio, or billing-authority exposure was introduced.

Release readiness is a separate decision made against the full checklists in [SETUP.md](./SETUP.md) and [SECURITY.md](./SECURITY.md).
