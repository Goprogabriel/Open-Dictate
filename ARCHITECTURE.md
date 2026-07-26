# Open Dictate architecture

Open Dictate is designed as a cross-platform desktop dictation product: a Tauri 2 host owns device and operating-system work, a React/TypeScript webview owns the user experience, and an authenticated backend owns paid-service and billing authority.

This document describes the checked-in pre-release implementation and the remaining production-release requirements. Implemented code is not described as platform-qualified until it has been exercised in signed builds against configured external services.

## Status legend

- **Implemented** means the repository contains the relevant code path. It does not imply that the path has completed release qualification.
- **Validation pending** means the implementation is present but still needs real-platform or external-service release evidence.
- **Required** means the behavior is a production invariant and must be finished before a public release.
- **Optional** means a future extension that is not part of the initial release gate.

## Current implementation snapshot

| Area                                                                  | Status             | Notes                                                                                                                                                                                |
| --------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| React application shell, routes, onboarding, pages, and recording HUD | Implemented        | Includes English, Danish, Norwegian, and Swedish resources.                                                                                                                          |
| Typed frontend service boundaries and Zustand domain stores           | Implemented        | Firebase, Tauri, native secure-state, and browser-preview adapters are separated from page components.                                                                               |
| Native audio capture                                                  | Validation pending | CPAL capture, downmixing, resampling, level events, bounded recording, and temporary WAV cleanup are implemented; signed-build device testing remains.                               |
| Modifier-only global shortcut                                         | Validation pending | The Rust monitor implements 180 ms arming and third-key cancellation; the macOS/Windows input matrix remains a release gate.                                                         |
| Focused-application text insertion                                    | Validation pending | Native focus capture, revalidation, insertion, and copy fallback are implemented; protected/elevated target testing remains.                                                         |
| Free/BYOK secret handling                                             | Validation pending | Encrypted private-file storage and Rust-only OpenAI requests are implemented; clean-machine testing remains.                                                                         |
| Firebase authentication and repositories                              | Implemented        | Email/password authentication, sync, Rules, indexes, and exact top-level paths are present; production Firebase configuration/deployment remains.                                    |
| Paid OpenAI proxy, usage ledger, and Stripe                           | Implemented        | Functions v2 implements managed dictation, reservation/settlement, subscription billing, portal/invoices, signed webhooks, and top-up grants; external configuration and E2E remain. |
| Encrypted local history/prompt/dictionary                             | Implemented        | AES-256-GCM vaults use a private local key and isolate `local` from `user:<uid>` state; unscoped legacy state is adopted once after a successful encrypted migration.                |
| Signed and notarized installers                                       | Not configured     | macOS signing/notarization credentials and Windows signing configuration must be supplied by the release environment.                                                                |

## Architectural principles

1. **Native work stays native.** Rust owns recording, global key observation, OS permissions, secure key-vault access, focus tracking, and text insertion.
2. **The webview does not receive secrets it does not need.** A BYOK value is write-only from the webview's perspective. Open Dictate's service OpenAI key, Stripe secret, and webhook secret never ship in the desktop bundle.
3. **The backend is authoritative for paid usage.** Subscription state, allowance credits, reservations, settlements, and billing events are server writes.
4. **Provider boundaries are explicit.** UI features depend on typed contracts; Firebase, Tauri, browser preview, OpenAI, and Stripe are adapters.
5. **Dictation is independent of navigation.** Recording must continue when the main window is hidden or a different page is selected.
6. **Failures are safe and recoverable.** Open Dictate must not insert into the wrong application, duplicate a charge, keep unbounded audio, or silently lose successfully generated text.
7. **Privacy defaults are conservative.** Audio is transient, screen contents are not captured, logs are redacted, and transcript persistence is explicit.

## Repository boundaries

The checked-in application is organized as follows:

```text
open-dictate/
├── src/
│   ├── app/                    # application bootstrap and routing
│   ├── components/             # reusable layout and UI primitives
│   ├── features/               # feature-owned workflows and views
│   ├── hooks/                  # cross-feature React hooks
│   ├── locales/                # en, da, no, sv translation resources
│   ├── pages/                  # route-level composition
│   ├── services/
│   │   ├── api/                # authenticated managed-service contracts
│   │   ├── firebase/           # auth and Firestore adapters
│   │   ├── native/             # typed Tauri IPC and event adapter
│   │   └── storage/            # local persistence adapters
│   ├── stores/                 # Zustand stores by domain
│   ├── types/                  # domain and transport contracts
│   └── utils/                  # pure helpers
├── src-tauri/
│   ├── capabilities/           # per-window Tauri permissions
│   ├── permissions/            # generated custom-command permissions
│   ├── src/
│   │   ├── audio/              # CPAL capture and temporary WAV lifecycle
│   │   ├── state/              # native runtime state
│   │   └── ...                 # command/platform modules as completed
│   ├── Entitlements.plist
│   ├── Info.plist
│   ├── Cargo.toml
│   └── tauri.conf.json
├── functions/                  # managed API, billing, dictation, and ledger
├── firebase.json               # emulator/deployment configuration
├── firestore.indexes.json      # query indexes
├── firestore.rules             # client authorization policy
├── ARCHITECTURE.md
├── CONTRIBUTING.md
├── README.md
├── SECURITY.md
└── SETUP.md
```

The checked-in `functions/`, Firebase configuration, Rules, indexes, and tests form the managed backend implementation. They remain a pre-release environment until the reviewed configuration is deployed to separate staging and production projects and exercised against the real Firebase, Stripe, and OpenAI services.

## Runtime trust zones

| Zone            | Trusted responsibilities                                                              | Data permitted                                                                   | Data forbidden                                                               |
| --------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| React webview   | Presentation, local workflow state, Firebase client authentication                    | Public Firebase config, Firebase user/session, user-visible settings and text    | Service OpenAI key, Stripe secret, webhook secret, readable BYOK key         |
| Tauri/Rust host | Audio capture, key observation, focus token, insertion, OS vault, direct BYOK request | Transient audio, transient transcript, BYOK value while making a request         | Billing authority, platform-wide service secrets                             |
| Managed API     | Authentication, paid transcription, transformation, metering, entitlement decisions   | Firebase ID token claims, transient audio/text, provider response, usage records | Long-term raw audio unless a separate, explicit product policy is introduced |
| Stripe          | Checkout, invoices, subscription lifecycle                                            | Customer and payment data required by Stripe                                     | Dictation audio or transcript text                                           |
| Firestore       | User-scoped product state and server-owned billing projections                        | Profiles, settings, dictionary, text history, aggregates, subscriptions, ledger  | API keys, raw audio, Stripe/OpenAI secrets                                   |

Firebase web configuration is public client configuration, not a server secret. Firestore Security Rules and backend authorization protect data.

## Frontend layering

### Pages and features

Pages compose feature views and route-level states. They do not invoke Firebase SDKs, Tauri `invoke`, OpenAI, or Stripe directly. A feature owns its workflow, validation, and feature components. Reusable visual components remain props-driven.

### Services

The service layer isolates providers:

- `AuthService` observes Firebase sessions and performs email/password account operations.
- Firebase repositories read or mutate only the paths allowed to the authenticated user.
- `BillingService` talks to the authenticated managed API; it never calls Stripe directly.
- `NativeClient` provides typed commands and events for recording, permissions, secrets, autostart, the HUD, transcription, and insertion.
- `SecureSecretService` offers set/check/delete/test operations without a key getter.
- Browser-native adapters support UI development only and must not be mistaken for system-wide dictation.

### State

Zustand stores are intentionally domain-specific:

- session and onboarding state;
- non-sensitive preferences;
- live dictation state;
- prompt and dictionary state;
- history and usage projections.

Network/server authority must never be inferred from a local store. In particular, local plan names, remaining-token displays, and usage totals are cached projections only.

Prompt and dictionary content has a different authority boundary. Firestore is the authenticated user's durable cross-device copy, while the current UID-scoped Zustand state is the source of the transformation snapshot attached to the next dictation. The managed backend validates and applies that request snapshot; it does not reload Firestore settings or vocabulary in the middle of the request.

## Dictation controller

The current implementation splits the push-to-talk lifecycle deliberately: Rust observes the global modifier chord, owns the microphone, captures the focus target, performs transcription requests, and revalidates the insertion target; `DictationRuntime.tsx` sequences those typed native operations and HUD/store transitions. Correlation IDs and native focus state prevent stale or free-floating operations from choosing a different target.

### State machine

```text
idle
  → chord-detected
  → arming
  → recording
  → processing
  → inserting
  → success
  → idle

arming | recording | processing | inserting
  → cancelled | error
  → idle or an explicit retry/copy action
```

Every attempt has a correlation ID. Only one attempt may be active. Late audio, network, or UI events for an old correlation ID are ignored.

For managed mode, the native recording UUID is also the stable request ID and `Idempotency-Key`. That identity spans the initial upload, bounded retry decisions, the server-side `transcription_jobs/{requestId}` record, and status recovery.

### Global shortcut safety

The requested macOS gesture is holding Option + Command. The current Windows physical equivalent is Alt + Windows. Both are fixed product defaults in this release; user-configurable alternatives remain a future extension because OS and application conflicts vary.

Global shortcut APIs vary in how they treat modifier-only holds and release events, so the production monitor owns the full gesture lifecycle:

1. Observe the shortcut keys without focusing an Open Dictate window.
2. Capture a focus token for the current target before showing or focusing any Open Dictate window.
3. Enter `arming` and start a configurable 150–200 ms timer; the current product constant is 180 ms.
4. If either modifier is released before the timer expires, cancel without opening the microphone.
5. If any third key is pressed while arming, cancel. This preserves normal application shortcuts.
6. When the timer expires with only the modifiers held, start recording and show the non-focusable HUD.
7. On modifier release, stop exactly once. Escape cancels. A watchdog clears stuck state after missed release events, sleep, or device changes.
8. Reject a recording that is too short or contains no useful speech. The current frontend also rejects durations below 300 ms and very small recording payloads.

The monitor must handle reversed press/release order, auto-repeat, Sticky Keys, layout changes, Windows AltGr behavior, application activation changes, and suspend/resume. It must never synthesize or suppress the observed shortcut keys.

The checked-in Rust implementation uses a cross-platform native event listener plus a dedicated arming/watchdog thread behind one interface. Release validation must confirm the listener's macOS Accessibility behavior and Windows low-level-hook behavior across the supported OS/input matrix; a platform-specific replacement remains possible behind that interface if validation finds a gap.

### End-to-end flow

```mermaid
sequenceDiagram
    participant Keys as Native key monitor
    participant Host as Rust controller
    participant HUD as Recorder HUD
    participant API as OpenAI / managed API
    participant Ledger as Pro token ledger
    participant Target as Focused application

    Keys->>Host: modifier chord detected
    Host->>Host: capture target token; arm 180 ms
    alt third key or early release
        Keys->>Host: cancel
        Host-->>HUD: idle
    else chord remains held
        Host->>Host: start microphone capture
        Host-->>HUD: recording + audio levels
        Keys->>Host: modifier released
        Host->>Host: stop and finalize audio
        alt BYOK mode
            Host->>API: direct request using OS-vault key
            API-->>Host: final text + metered usage
        else Pro mode
            Host->>API: request using fresh Firebase ID token
            API->>Ledger: reserve subscription first, then purchased
            API->>API: transcribe and polish
            API->>Ledger: settle or expiry-aware release by pool
            API-->>Host: final text + pool balances
        end
        Host->>Host: revalidate target token
        alt same valid target
            Host->>Target: insert text
        else target changed or unavailable
            Host->>Host: do not insert; copy/offer explicit fallback
        end
        Host-->>HUD: success or recoverable error
        Host->>Host: remove temporary audio
    end
```

### Focus and insertion invariants

A generic “insert into the focused app” command at completion is unsafe. The user may switch applications while transcription is running, or Open Dictate itself may accidentally take focus.

The native controller must capture a platform focus token before recording. The token should include enough stable identity to revalidate the target, such as process ID plus native window identifier when available. Immediately before insertion it must verify that the same target remains eligible. If the target changed, disappeared, is a secure surface, or cannot accept synthetic input, Open Dictate must not type into the new application. It should retain the final text in memory, copy it only according to the configured fallback policy, and let the user paste explicitly.

The HUD is always-on-top but non-focusable. The main window must not be raised during push-to-talk.

On macOS, insertion requires Accessibility authorization. On Windows, input injection is constrained by User Interface Privilege Isolation: a normally running Open Dictate process cannot reliably inject into a process running at a higher integrity level. Secure desktops and password fields are out of scope and must fail closed.

## Audio pipeline

The checked-in recorder uses CPAL and currently follows a batch pipeline:

1. Select the configured input or the system default.
2. Capture samples and publish bounded audio-level events.
3. Downmix to mono and resample to 16 kHz.
4. Write a temporary WAV under the application cache.
5. Enforce the ten-minute application limit and a pre-upload size limit.
6. Delete the file after success, cancellation, or terminal error; sweep abandoned recordings on startup.

Audio is never written to Firestore or analytics. Because a crash can leave a recoverable cache file until the next sweep, “ephemeral” does not mean “never touches disk.” A future in-memory or encrypted-spool implementation is optional hardening, subject to memory limits and retry requirements.

## Transcription and transformation

The application uses two logical stages even if a provider later combines them:

1. Speech-to-text receives audio, selected language, and a compact vocabulary hint.
2. Transformation applies punctuation, filler removal, formatting, output language, dictionary replacements, and the user's custom instruction while preserving meaning.

The transformation contract must require final text only and must preserve names, numbers, URLs, code, and factual meaning. Model identifiers, prompt versions, request limits, and provider prices are server/configuration values rather than UI constants.

### Free / BYOK path

- The user enters an OpenAI API key in the webview.
- The value crosses IPC once to be encrypted in a private native vault file.
- The UI can ask whether a key exists, replace it, delete it, or test it. There is no getter.
- For dictation, Rust retrieves the key, performs the OpenAI HTTPS request, and zeroizes short-lived buffers where practical.
- Audio, vocabulary, custom prompt, and resulting text are still sent to OpenAI. “Local key storage” does not mean local inference.

The native BYOK path defaults to `gpt-4o-mini-transcribe` for speech-to-text and `gpt-5-mini` for polishing. `OPENAI_TRANSCRIBE_MODEL` and `OPENAI_POLISH_MODEL` can override those native-process defaults for development or a deliberately configured build/runtime environment.

BYOK protects against accidentally persisting a plaintext key in the webview, but it cannot make a key unrecoverable from a compromised local account or process. The user remains the owner of the OpenAI account, spend limits, and retention choices for that key.

### Paid / managed path

- The desktop obtains a fresh Firebase ID token.
- Rust uploads the bounded audio and options to the configured managed API over TLS.
- The API verifies the token, derives the UID from verified claims, checks entitlement, and reserves allowance atomically.
- The API calls OpenAI using a service key stored in the deployment secret manager.
- It settles the reservation against actual metering and creates the server-owned dictation/usage records.
- The service OpenAI key is never returned to, embedded in, or proxied through arbitrary URLs supplied by the desktop.

For each request, the desktop sends the current custom prompt, output language, filler/punctuation/list toggles, `saveHistory`, one of the supported 7/30/90/365-day retention values, and at most 100 dictionary entries whose language is `all` or matches the selected transcription language. Rust validates the native options before upload. The managed multipart parser independently enforces exact locales and booleans, a 4,000-character prompt limit, a 100-entry dictionary limit with 100-character terms, the retention enum, WAV structure, measured duration, and upload bounds. This validated snapshot is authoritative for that dictation's transformation. Firestore settings and dictionary entries remain the durable cross-device state and are synchronized separately.

The managed Functions deployment defaults to `gpt-4o-mini-transcribe` plus the lower-cost `gpt-5-mini` polishing model. Those are independent Firebase Functions parameters and may intentionally differ from the BYOK defaults.

Ambiguous completion is recovered with the same recording UUID. Rust queries `GET /v1/dictation-requests/:requestId`; a succeeded job returns the existing text and balance, and a reserved/processing job is polled. After an initial transport error only, confirming that no job exists permits one safe upload retry. The API function timeout is 300 seconds, the native HTTP request timeout is 330 seconds, and each provider call is bounded at 135 seconds. Status recovery has one monotonic 300-second wall-clock budget shared by all status requests, response bodies, and two-second polling delays; each status request is capped at 20 seconds or the remaining budget, whichever is shorter. Pending recovery is not persisted across desktop-process restarts: an unresolved managed network error leaves the temporary WAV for startup sweep, but a later launch does not automatically resume that request ID.

Release builds pin managed traffic at Rust compile time with `OPEN_DICTATE_MANAGED_API_ORIGIN`. The value is the bare HTTPS origin of `VITE_API_BASE_URL`—scheme, host, and optional port, without `/api`. Rust also requires the managed transcription path suffix, rejects credentials/query/fragment components, and permits loopback HTTP only in debug builds. A production build without the pin fails closed rather than sending the Firebase token or audio to an arbitrary endpoint.

## Authentication

Firebase Authentication provides email/password signup, login, verification mail, password reset, persistence, and ID tokens. Client authentication proves identity; it does not prove an active subscription.

The authenticated billing bootstrap initializes `users/{uid}` from verified Firebase claims with server timestamps before creating the Stripe customer. The client cannot choose its own entitlement, token balance, role, Stripe customer ID, or billing status. If a future feature requires a profile document before billing begins, initialization should move to an equivalent trusted auth trigger without widening client create permissions.

Every managed API request verifies the Firebase ID token and uses the verified UID. Email verification requirements, token revocation checks, and abuse controls are explicit deployment policy. No application-attestation layer is currently enabled. Any future attestation layer must use a native, platform-appropriate design.

## Billing and allowance ledger

Stripe Checkout and the Customer Portal are hosted by Stripe. The desktop only requests a session URL from the authenticated backend and opens it externally. Redirects back to the app improve UX but are not billing authority.

The signed Stripe webhook is the subscription authority:

1. Verify the raw webhook body and Stripe signature.
2. Deduplicate on `stripeEventId` in `billing_events/{stripeEventId}`.
3. Map the Stripe customer to a Firebase UID using server-maintained metadata.
4. Update `subscriptions/{uid}` from the Stripe object.
5. On a new paid period, replace the period-bound subscription-token pool with the configured fixed allowance and record the Stripe subscription plus billing-period identity in an idempotent ledger entry.
6. Expire any unused subscription tokens from the preceding period. Purchased tokens are held in a separate pool and are never changed by period rollover.

Managed usage uses reservation and settlement:

1. Use the native recording UUID as the unique `transcription_jobs/{requestId}` key.
2. In a transaction, check active entitlement and available allowance, then reserve a conservative amount from subscription tokens first and purchased tokens second.
3. Store the reservation's per-pool allocation and subscription-period identity on the job so recovery and settlement preserve the funding source.
4. Record `reserved` / `processing` state so ambiguous desktop responses can recover the same request.
5. Settle actual usage against the reserved subscription portion first, then the purchased portion, and write a source-aware debit ledger entry.
6. On a terminal provider failure, release the reservation. Purchased tokens are always restored; a subscription portion is restored only while its original billing period is still active, so a late release cannot revive expired tokens. Retried requests return the existing job outcome instead of charging twice.

The authenticated API exposes `subscriptionTokens`, `purchasedTokens`, their combined `remainingTokens`, the fixed `allowanceTokens`, and the subscription-token expiry. The backend's Firestore fields, transition functions, and deployment parameters retain the internal name **credits**. These are the same integer allowance unit at different boundaries, not literal OpenAI tokens. Provider transcription and polish token counts are metering inputs converted through the configured credit rates.

Legacy records contain only a blended balance, so their original source and expiry cannot be reconstructed. The schema-v2 migration conservatively classifies existing available credits and in-flight reservations as purchased/non-expiring value on the first transactional write. This avoids taking paid value away during rollout; all new grants use explicit pools.

Revenue margin is a server-owned funding-source policy. Stripe price IDs, grant quantities, and margin basis points are required deployment parameters configured together on the server; none is accepted from the desktop. Each purchase grant retains its exact tier, revenue, and margin metadata. Usage captures preserve subscription-versus-purchased allocation; purchased tokens are otherwise one non-expiring pool, so per-tier margin remains purchase-level accounting rather than being reconstructed from later usage.

Provider-cost reporting remains separate from revenue margin. Functions estimates provider spend in integer micro-USD from measured audio duration and polish input/output usage. Successful polish calls use provider-reported usage. A dispatched polish call that times out or produces an unusable response without trustworthy usage gets a conservative, versioned estimate based on request bytes and configured ceilings. Known pre-dispatch failures remain zero. The allowance ledger remains the entitlement authority; the commercial record explains provider economics and must be reviewed when provider pricing or estimation policy changes.

Additional-token purchases use `POST /v1/billing/topup-session` with the strict server-recognized tier `usd_5`, `usd_10`, or `usd_20`. The backend requires an active/trialing subscription and an idempotency key, maps that tier to one configured Stripe price and grant, and tags the Checkout session with server-authored pack metadata. The signed `checkout.session.completed` handler verifies paid status, tier metadata, amount, and the matching allow-listed line-item price before adding non-expiring purchased tokens. The ledger source key derived from the Checkout session makes duplicate webhook delivery harmless. A client-supplied price, quantity, token grant, or payment redirect never creates a grant.

## Firestore data model

These are exact top-level paths expected by the desktop and managed backend. They are not `users/{uid}` subcollections.

| Path                                   | Purpose                                                | Client access                                     | Write authority                              |
| -------------------------------------- | ------------------------------------------------------ | ------------------------------------------------- | -------------------------------------------- |
| `users/{uid}`                          | Name, email projection, language, mode, timestamps     | Owner read; tightly validated profile edits only  | Client for allowed profile fields or backend |
| `settings/{uid}`                       | Prompt, output language, and transformation behaviors  | Owner read/write with schema validation           | Owner                                        |
| `dictionary/{uid}/entries/{entryId}`   | Live vocabulary records or durable deletion tombstones | Owner read/write; physical delete denied          | Owner writes; trusted backend may later GC   |
| `dictations/{uid}/items/{dictationId}` | Managed dictation text and metadata                    | Owner read/delete                                 | Backend create/update; owner delete          |
| `usage/{uid}/periods/{yyyy-mm}`        | Monthly usage aggregate and chart projection           | Owner read                                        | Backend only                                 |
| `subscriptions/{uid}`                  | Stripe-derived entitlement projection                  | Owner read                                        | Backend/webhook only                         |
| `subscriptions/{uid}/ledger/{entryId}` | Credits, reservations, settlements, adjustments        | Owner read if product policy permits              | Backend only                                 |
| `billing_events/{stripeEventId}`       | Webhook idempotency and processing state               | None                                              | Backend only                                 |
| `transcription_jobs/{requestId}`       | Managed-request idempotency, recovery, and reservation | None; status is exposed through authenticated API | Backend only                                 |

Suggested fields use server timestamps and bounded values:

```text
users/{uid}
  name, email, language, mode, createdAt, updatedAt

settings/{uid}
  prompt, language, removeFillers, correctPunctuation, formatLists, updatedAt

dictionary/{uid}/entries/{entryId}
  live: spoken, replacement, language, createdAt, updatedAt
  tombstone: deleted=true, createdAt, updatedAt

dictations/{uid}/items/{dictationId}
  text, durationMs, speakingMs, application, language, words,
  transcriptionTokens, transformTokens, modelTranscription, modelPolish,
  polishApplied, createdAt, expiresAt

usage/{uid}/periods/{yyyy-mm}
  dictationMs, speakingMs, wordsGenerated, dictationCount,
  transcriptionTokens, transformTokens, estimatedSavedMs, points, updatedAt

subscriptions/{uid}
  plan, status, stripeCustomerId, stripeSubscriptionId, stripePriceId,
  currentPeriodStart, currentPeriodEnd, entitlementEndsAt, cancelAtPeriodEnd,
  subscriptionCredits, purchasedCredits,
  reservedSubscriptionCredits, reservedPurchasedCredits,
  consumedSubscriptionCredits, consumedPurchasedCredits,
  availableCredits, reservedCredits, consumedCredits,
  subscriptionCreditPeriodId, subscriptionCreditsPeriodStart,
  subscriptionCreditsExpireAt, balanceSchemaVersion, updatedAt

subscriptions/{uid}/ledger/{entryId}
  kind, sourceId, availableDelta, reservedDelta, consumedDelta,
  subscriptionAvailableDelta, purchasedAvailableDelta,
  subscriptionReservedDelta, purchasedReservedDelta,
  subscriptionConsumedDelta, purchasedConsumedDelta,
  creditAllocation, expiredPriorSubscriptionCredits,
  subscriptionCreditPeriodId, metadata, createdAt

transcription_jobs/{requestId}
  uid, status, reservedCredits, reservedSubscriptionCredits,
  reservedPurchasedCredits, subscriptionCreditPeriodId,
  creditAllocation, resultText, createdAt, updatedAt
```

Account sync resolves dictionary records to one terminal state per ID: a tombstone always beats a live record regardless of timestamp, while timestamps order two live records or two tombstones. Tombstones remain encrypted in the matching `user:<uid>` vault but are never shown or included in dictation requests. Firestore denies tombstone-to-live updates for the same document; intentionally re-adding a term creates a new UUID. Prompt records likewise retain an explicit timestamp and distinguish a missing cloud document from a present document whose values intentionally equal the defaults.

After every prompt or dictionary write, the repository reads the committed document directly from the Firestore server. Account sync replaces the device-authored mutation time with that server timestamp only if the exact attempted mutation is still current; a newer local edit keeps its own timestamp for the already queued write. Acknowledgement hydration is explicitly suppressed in the store subscriptions so timestamp normalization cannot trigger a redundant upload loop. This keeps clock-skewed devices from repeatedly winning future merges without weakening terminal dictionary tombstones.

Currency is stored in integer minor units. Durations and usage units are integers. Clients do not supply server timestamps or authoritative totals. Firestore rules must validate ownership, allowed fields, types, sizes, and immutable fields; path ownership alone is insufficient.

## Local persistence

### Current implementation

- History, prompt settings, and dictionary entries are serialized through native IPC into three authenticated namespace vault files.
- Each vault uses AES-256-GCM with a fresh 96-bit nonce and the namespace as additional authenticated data.
- A random 256-bit master key is created once in the app data directory with private file permissions. Key material and decrypted buffers use zeroizing wrappers where practical.
- Writes use private file permissions on Unix, a temporary file, `sync_all`, and replacement; each namespace has a 4 MiB plaintext limit.
- The version-2 payload inside each encrypted vault partitions state into `local` and `user:<firebase-uid>` scopes. Switching accounts hydrates the matching scope with persistence temporarily suppressed, so one account's history, prompt, dictionary, or pending-delete queue cannot be exposed to another account on the same device.
- An old unscoped encrypted payload or legacy `open-dictate-history`, `open-dictate-prompt`, or `open-dictate-dictionary` Zustand envelope is first wrapped in a temporary `legacy` scope. After Firebase resolves the first local/account identity that has no existing scoped value, that identity adopts the legacy value and the `legacy` scope is removed. A legacy `localStorage` key is removed only after the encrypted write succeeds.
- Non-sensitive preferences, onboarding progress, and locale may remain in webview storage. Firebase Auth uses IndexedDB persistence. Usage state is a local/server projection rather than billing authority.
- The BYOK API key is stored in a separate native-only encrypted vault namespace that public secure-state IPC rejects.

Explicitly deleting a synced history item removes it locally and adds its ID to the UID-scoped encrypted `pendingCloudDeletes` queue. Account sync retries the Firestore delete on later sync sessions and removes the queue entry only after the remote delete succeeds. Deleting a local-only item needs no cloud intent. In contrast, **Clear local cache** empties only this device's cached history and does not enqueue Firestore deletion; cloud history can reappear after a later account sync. There is no implicit bulk cloud delete.

The `saveHistory` preference prevents new local history entries and is also sent to the managed backend. When false, managed usage is still settled/aggregated but no `dictations/{uid}/items/{dictationId}` document is created. The selectable retention periods are 7, 30, 90, and 365 days. Local hydration and preference changes prune older cached items, cloud sync filters older results, and each newly saved managed dictation receives a server-authored `expiresAt`. The scheduled reconciler runs every 15 minutes and deletes expired dictations in bounded batches; deletion can therefore lag the selected boundary until a cleanup run. Completed server-side transcription job payloads expire after 24 hours; immutable ledger entries retain only the metering/idempotency record required for billing integrity.

Temporary audio remains a bounded cache with cleanup on success, cancellation, terminal error, and startup recovery. Release testing must exercise the encrypted vault, legacy adoption, credential loss, tamper detection, and crash-recovery behavior on both platforms.

## Platform permissions

### macOS

- **Microphone** is required to record.
- **Input Monitoring** may be required for global modifier observation, depending on the chosen event-monitor implementation and distribution context.
- **Accessibility** is required for reliable focused-application insertion and must be checked independently from Input Monitoring.
- **Screen Recording is not required.** Open Dictate does not read pixels or capture screens and must not request this permission. Any compatibility field in a permission DTO is informational only and should be removed if it causes confusing UI.

`NSMicrophoneUsageDescription` and the audio-input entitlement are present. The final signed bundle must be tested because macOS privacy grants are tied to code identity and bundle identity.

### Windows

- Microphone privacy access for desktop applications must be enabled.
- The low-level keyboard monitor and insertion path must be exercised under standard user accounts, Remote Desktop, multiple keyboard layouts, and sleep/resume.
- Open Dictate does not bypass UIPI, the secure desktop, protected applications, or higher-integrity targets. It reports a recoverable insertion error instead.

## Tauri security boundary

The recorder overlay has an event-listening-only capability and is deliberately non-interactive. This is the desired shape.

The main window has explicit custom-command permissions for the native operations it orchestrates. Rust validates recording IDs and payload bounds, stores the insertion target natively, revalidates focus before insertion, keeps API-key storage write-only, restricts secure-state namespaces, fixes BYOK traffic to OpenAI, and compile-time-pins the managed origin for release builds. The Content Security Policy does not load remote scripts. The release review must confirm that configured capabilities and CSP entries match the final bundle and external API origin.

## Failure behavior

| Failure                            | Required behavior                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| Shortcut conflict or early release | Cancel before microphone activation; leave underlying shortcut untouched.                     |
| Microphone denied/unavailable      | Keep the target app focused, retain no audio, and show actionable permission/device guidance. |
| Lost key-up event                  | Stop via watchdog and return to idle; never record indefinitely.                              |
| Managed network/ambiguous response | Recover the same UUID; retry an initial transport failure only if no job exists.              |
| Unresolved managed network error   | Keep the temporary file until startup sweep; do not claim restart replay.                     |
| Empty/no-speech result             | Do not insert or create billable-looking success history.                                     |
| Target focus changed               | Do not insert. Preserve final text for an explicit copy/paste fallback.                       |
| Native insertion rejected          | Preserve text in memory and offer Copy; report platform limitations.                          |
| Cloud sync failure                 | Keep a local pending projection without presenting it as server-authoritative.                |
| Stale or mismatched entitlement    | Deny managed use safely and refresh from the backend. Do not trust the local plan.            |
| Duplicate webhook/request          | Return the existing idempotent outcome; never credit or debit twice.                          |

## Verification strategy

- **Unit:** state transitions, shortcut arming/cancellation, prompt construction, formatters, validators, allowance math, and request idempotency.
- **Frontend component:** empty/loading/error/populated states, onboarding recovery, keyboard navigation, and all four locales.
- **Contract:** TypeScript-to-Rust command/event schemas and desktop-to-managed-API schemas.
- **Firestore Rules:** emulator tests prove cross-user access fails, server-owned paths reject client writes, and field/size validation works.
- **Native audio:** device selection, format conversion, device loss, cancellation, duration/size limits, and abandoned-file cleanup.
- **Native input:** both press orders, both release orders, third-key cancellation, ordinary app shortcuts, Sticky Keys, AltGr, layout changes, missed release watchdog, focus change, and protected targets.
- **Security:** IPC fuzz/limit tests, log-redaction tests, malicious endpoint tests, webhook signature tests, UUID replay/recovery tests, scoped-vault isolation, deletion-queue tests, and legacy-adoption tests.
- **Release:** signed macOS and Windows smoke runs covering fresh permissions, upgrades, startup, tray/background behavior, uninstall/reinstall, and insertion into representative applications.

## Evolution points

These are optional behind stable interfaces:

- streaming transcription instead of batch WAV upload;
- local/offline speech models;
- per-application prompt profiles;
- teams and shared dictionaries;
- additional identity providers;
- organization billing and pooled allowances;
- organization retention policy and legal-hold controls;
- a companion mobile client that shares cloud contracts but not desktop-native commands.

Material changes to trust boundaries, Firestore paths, shortcut semantics, local encryption, billing authority, or retention policy should be captured as Architecture Decision Records before implementation.
