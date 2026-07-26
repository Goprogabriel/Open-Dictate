# Open Dictate security

Open Dictate handles microphone audio, dictated text, user instructions, account identity, an optional user-supplied OpenAI key, and paid usage. Those data classes make security and privacy release requirements, not later enhancements.

## Security status

Version `0.1.0` is a pre-release implementation and is **not** yet a security-supported production release. The application and backend controls described here are implemented; the remaining launch work is release assurance on real macOS/Windows systems, production external-service configuration, a release-time managed-origin pin, code signing/notarization, and operational readiness.

Once public releases exist, only the latest signed release line should receive security fixes unless the maintainers publish a different support table here.

## Reporting a vulnerability

Do not include an exploitable proof of concept, API key, user transcript, audio, payment data, or personal data in a public issue.

Use [GitHub private vulnerability reporting](https://github.com/Goprogabriel/Open-Dictate/security/advisories/new). If that form is unavailable, contact the repository owner privately through their GitHub profile. Include:

- affected version and operating system;
- the smallest safe reproduction;
- security impact and prerequisites;
- whether secrets or user data may have been exposed;
- suggested mitigation, if known.

Never test a report against another user's account, Stripe live mode, or a production dataset without written authorization.

## Security objectives

Open Dictate is designed to preserve these invariants:

1. A platform OpenAI key, Stripe secret, webhook secret, and Firebase administrative credential never ship in the desktop application.
2. A BYOK value is not readable from the webview after storage and is never written to local storage, Firestore, logs, analytics, or crash reports.
3. Paid access and remaining allowance are determined by an authenticated backend and append-only/idempotent ledger behavior, not by client state.
4. Text is inserted only into the application target captured for that dictation and revalidated immediately before insertion.
5. Modifier-only monitoring does not break or hijack ordinary Option + Command + key or Alt + Windows + key shortcuts.
6. Raw audio is bounded, transient, and never stored in Firestore or product analytics.
7. Screen contents are neither captured nor required. Screen Recording permission is not requested.
8. Cross-user Firestore access and client writes to server-owned billing/usage paths are denied and emulator-tested.
9. Security-sensitive failures are closed and recoverable: no wrong-target insertion, double debit, leaked key, indefinite recording, or silently retained audio.
10. Encrypted local history, prompts, vocabulary, and cloud-delete intents are isolated between the device-local profile and every Firebase UID used on the same machine.

## Threat model

### Protected assets

- microphone audio and temporary recordings;
- final dictation text, history, custom prompts, and dictionary entries;
- BYOK OpenAI credentials;
- Firebase ID and refresh tokens;
- platform OpenAI and Stripe secrets;
- subscription state, token/credit allowance, invoices, and ledger entries;
- native Accessibility/Input Monitoring capabilities;
- signed release identities and update/install artifacts.

### Relevant attackers and failures

- malicious or compromised content running in the webview;
- another authenticated user attempting cross-account Firestore or API access;
- one local account observing state left by another Firebase account on the same device;
- replayed or duplicated managed-transcription requests;
- forged, duplicated, or out-of-order Stripe webhook events;
- an attacker who obtains a desktop bundle and inspects all client assets;
- log, analytics, crash-report, clipboard, or temporary-file leakage;
- a local application that changes focus during transcription;
- ordinary application shortcuts accidentally interpreted as dictation;
- compromised dependencies or unsigned/tampered installers;
- resource-exhaustion attempts using large audio, prompts, dictionaries, or request rates.

An administrator/root compromise of the local machine, a fully compromised signed Open Dictate process, or a compromise inside OpenAI, Stripe, Firebase, Apple, or Microsoft is outside the application's ability to prevent completely. Open Dictate must still minimize retained material, restrict credentials, and support rotation and incident response.

## Trust boundaries

### React webview

The webview is treated as a potentially exposed client. It may hold user-visible text and a Firebase client session. It may not hold privileged provider secrets or billing authority.

All `VITE_*` values are public because they are compiled into client assets. Firebase's web API key is configuration; Firestore Rules and verified backend authorization provide access control.

### Tauri/Rust host

Rust is trusted with device access, transient audio, transient text, focused-window identity, and encrypted credential-vault access. Commands must validate payloads and correlate operations to one active dictation.

Native code is not a billing authority. It cannot create allowance, select an arbitrary paid price, or assert subscription state.

### Managed API

The managed API is trusted with service secrets, Firebase token verification, transient managed audio/text, provider requests, Stripe operations, and server-owned Firestore writes. It must be deployed under least-privilege IAM and use a secret manager.

### Third parties

OpenAI receives audio and transformation inputs for both BYOK and managed modes. Firebase stores account/product state. Stripe handles subscription/payment data. Production privacy disclosures, retention choices, subprocessors, and data-processing terms must match actual deployment configuration.

## Secret handling

### User-supplied OpenAI key

The production BYOK path is:

1. Accept the key in a masked field.
2. Send it once to a narrow Tauri command.
3. Encrypt it in a private native vault file that cannot be loaded through public secure-state IPC.
4. Expose only `set`, `has`, `delete`, and a carefully redacted `test` operation. Never expose `get` to the webview.
5. Retrieve it in Rust only for a request to the fixed OpenAI API host.
6. Avoid clones and zeroize short-lived memory where practical.
7. Redact request headers and any error that could echo credentials.

The encrypted private vault protects against accidental plaintext persistence and avoids recurring OS credential prompts. Because its local key belongs to the same user account, it does not protect against malware or a process running with that user's authority. Users should use a restricted OpenAI project key and provider-side spend limits.

### Service secrets

The following belong only in the backend deployment secret manager:

- `OPENAI_API_KEY`;
- `STRIPE_SECRET_KEY`;
- `STRIPE_WEBHOOK_SECRET`;
- Firebase service-account private credentials, if explicit credentials are needed outside the managed runtime;
- release signing private keys and passwords, in the CI secret store rather than the runtime.

Secrets must be separate across development, staging, and production. Rotation procedures must identify dependent functions and verification steps. A suspected leak requires revocation first, then investigation; deleting a leaked value from Git history does not revoke it.

### Firebase tokens

Firebase Auth currently persists sessions in IndexedDB. Treat the application's local profile as account-bearing. Managed calls should request a current ID token, send it only to the configured API origin, and never log it.

Every protected backend route verifies signature, audience/project, expiry, and relevant revocation/email-verification policy. The verified token's UID is the only account identifier used for authorization.

## Dictation safety

### Modifier-only shortcut

Option + Command is a prefix of many legitimate application shortcuts. Starting recording immediately on those modifiers would create unintended microphone activations and could interfere with user workflows.

The native controller must arm for 150–200 ms, currently 180 ms, without consuming events. It cancels if a modifier is released or any non-modifier key is pressed before arming completes. Only a modifiers-only hold starts recording. Escape cancels, and a watchdog recovers from lost release events.

Tests must cover both key orders, both release orders, repeats, Sticky Keys, AltGr, input layout changes, sleep/resume, and ordinary application shortcuts. An accelerator library that requires a non-modifier key is not a valid substitute for modifier-edge monitoring.

### Focus capture and revalidation

The original target is captured before the HUD or main window can affect focus. Immediately before insertion, Rust compares the current eligible target with the captured process/window token.

If the target changed, disappeared, is elevated/protected, or cannot accept synthetic input, Open Dictate must not insert. It retains the final text in memory and offers a user-controlled copy/paste fallback. It must not silently type into whichever application happens to be focused at completion.

Password fields, secure desktops, login windows, UAC prompts, and other protected surfaces are not insertion targets.

### Microphone lifecycle

- One active recording at a time, keyed by a correlation ID.
- Hard duration and byte limits on both desktop and server.
- Cancellation and terminal errors stop the stream and remove temporary files.
- Startup cleanup removes abandoned cache files after a crash.
- Audio-level events are rate-limited and do not contain audio samples.
- No automatic retry can call the provider twice without an idempotency decision.
- Managed recording UUIDs remain stable across upload and in-process status recovery.

## Remaining release assurance

The core controls are implemented. These items still block a production claim until they are configured or verified:

| Item                                     | Current risk                                                                          | Required release evidence                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Native shortcut/audio/focus integration  | OS permissions, input hooks, device changes, or protected targets can vary            | Pass the clean-machine macOS and Windows input/audio/insertion matrix using the signed candidate                                  |
| Temporary WAV lifecycle                  | A crash can leave recoverable audio until the startup sweep                           | Exercise success, cancel, provider error, crash, restart, and cleanup on both platforms; document the bounded residual risk       |
| Managed-service production configuration | Incorrect Firebase/Stripe/OpenAI parameters, Rules, secrets, or IAM can break auth    | Deploy reviewed staging/production configuration and pass Rules emulator plus real external-service end-to-end tests              |
| Release-time managed origin              | A mismatched or missing pin prevents managed dictation; a weak pin risks exfiltration | Compile with the exact HTTPS `OPEN_DICTATE_MANAGED_API_ORIGIN` matching `VITE_API_BASE_URL` and verify mismatch/fail-closed tests |
| macOS/Windows publisher identity         | Unsigned artifacts cannot provide a stable trusted publisher identity                 | Sign and timestamp Windows artifacts; sign, harden, notarize, staple, and assess macOS artifacts; test upgrades                   |
| Security operations                      | Reports or incidents may not reach an accountable owner                               | Publish a monitored private reporting channel and assign incident response, retention, deletion, rotation, and rollback owners    |

Implemented code and unit tests are not substitutes for evidence from the intended signed release and production configuration.

## Local data and retention

### Current behavior

History, prompt settings, and dictionary entries are persisted through native IPC in three AES-256-GCM namespace vault files. Encryption uses a random 256-bit master key in a private local file, a fresh 96-bit nonce for each write, and the namespace as additional authenticated data. Decrypted/key buffers are zeroized where practical, vault payloads are bounded to 4 MiB per namespace, and writes use private/atomic file handling.

Each version-2 encrypted payload contains separate `local` and `user:<firebase-uid>` scopes. Authentication bootstrap waits for secure-state initialization, switches to the resolved identity scope with persistence suppressed, and starts Firestore sync only afterward. The history scope includes the pending cloud-delete queue. This ordering prevents account A's cached state or deletion intent from being hydrated into account B.

On upgrade, an old unscoped encrypted payload or `open-dictate-history`, `open-dictate-prompt`, or `open-dictate-dictionary` Zustand envelope is wrapped in a temporary `legacy` scope. The first resolved identity scope without existing data adopts it; a legacy `localStorage` key is removed only after the encrypted write succeeds. Non-sensitive preferences, locale, and onboarding state may remain in webview storage. Firebase Auth persists account state in IndexedDB. Native recording uses the bounded temporary WAV cache described above.

The current retention choices are 7, 30, 90, and 365 days. Local hydration and preference changes prune older cached history, account sync filters older cloud results, and each saved managed dictation receives a server-authored `expiresAt`. The scheduled reconciler runs every 15 minutes and deletes expired dictations in bounded batches, so expiry is not an instantaneous deletion guarantee. Completed transcription-job result payloads expire after 24 hours. Billing ledger entries remain for integrity without transcript text.

“Do not save history” prevents new persistent transcript writes locally and in managed cloud history, while the server still writes transcript-free usage/ledger records. Explicitly deleting a synced item creates a UID-scoped encrypted `pendingCloudDeletes` intent; account sync retries it and acknowledges it only after Firestore deletion succeeds. **Clear local cache** only removes this device's cached history. It neither adds delete intents nor performs a bulk cloud deletion, and cloud history can reappear on a later sync. The current product has no implicit bulk cloud-history or account-delete operation.

Billing and antifraud records may require a different lawful retention period; keep transcript text out of those records. Clipboard fallback remains intentional because other applications and clipboard managers may retain copied text. Future bulk deletion or account deletion requires an explicit scoped workflow, observable completion/failure, and coverage of derived history/index records.

The managed request sends `saveHistory`, retention, the current custom prompt/output behaviors, and a bounded relevant dictionary. The server strictly validates this snapshot before using it. Firestore settings and dictionary documents are durable cross-device state; they are not treated as a more current source than the snapshot already attached to a dictation.

Raw audio is not stored in Firestore. If future features introduce audio retention, they require a separate design review, storage encryption, authorization model, lifecycle policy, UI consent, and privacy-policy change.

## Tauri and webview controls

Tauri capabilities are permissions, not input validation. The current implementation:

- keeps the recorder overlay event-only and non-focusable;
- gives the main window explicit custom-command permissions rather than shell or broad filesystem access;
- validates strings, arrays, enums, URLs, byte lengths, dictionary counts, prompt lengths, secure-state namespaces, and recording IDs in Rust;
- stores the insertion target natively and revalidates it immediately before insertion;
- keeps BYOK secret storage write-only and fixes BYOK traffic to the OpenAI API;
- requires release builds to pin managed traffic with compile-time `OPEN_DICTATE_MANAGED_API_ORIGIN` and a fixed transcription path;
- retains a restrictive Content Security Policy and packages scripts/fonts locally.

The release review must verify that the final capabilities, CSP `connect-src`, `VITE_API_BASE_URL`, and native origin pin agree. `style-src 'unsafe-inline'` remains a narrowly documented style exception, not permission for remote script execution. If automatic updates are added, updater signing requires a separate review.

## Managed API controls

Every endpoint should apply:

- Firebase ID-token verification where account data or billing is involved;
- strict method/content-type checks;
- Zod or equivalent schema validation;
- upload limits enforced while streaming, before buffering the full body;
- per-UID and per-IP rate limits, with a documented proxy/IP trust model;
- the implemented 300-second function timeout, 330-second native request timeout, 135-second provider-call timeout, abort propagation, and bounded retries;
- fixed provider/model allow lists;
- correlation/request IDs generated or validated as opaque bounded values;
- structured, redacted errors without provider keys or raw responses;
- CORS/origin checks as defense in depth, never as the primary authentication mechanism;
- native platform attestation if a supportable desktop design is introduced; no browser-script attestation runs in the privileged Tauri webview.

The checked-in API applies per-instance IP limits to `/v1`, with stricter limits on billing and
dictation creation. Express trusts exactly one proxy hop because Cloud Functions terminates the
public connection before the application. Multi-instance production deployments should add a
distributed edge quota such as Cloud Armor or API Gateway and, where appropriate, an authenticated
per-UID quota. The in-process limiter is not presented as a complete distributed abuse-control
system.

The API must never accept a client-supplied UID, ledger delta, remaining balance, plan, price ID, Stripe customer ID, provider cost, or privileged role as authoritative.

## Firestore authorization

The exact data paths are:

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

Rules must default-deny, match UID ownership from `request.auth.uid`, validate field names/types/sizes, and protect immutable/server fields. Client SDKs may read owner data and modify only explicit user-owned settings/dictionary fields. Managed dictation creation, aggregate usage, subscription state, ledger entries, billing events, and jobs are server-only writes.

Admin SDK code bypasses Security Rules. Backend handlers require independent authorization and validation. Emulator tests must include negative cross-user and unauthenticated cases, not only successful reads.

## Allowance and billing integrity

### Reservation and settlement

A managed request uses a unique request ID. In a Firestore transaction, the backend verifies entitlement and atomically reserves a conservative credit amount. After provider completion it settles the reservation to actual usage. Terminal failure releases the reservation. A retry reads the existing job outcome instead of making an independent debit/provider call.

The native recording UUID is the stable request ID and `Idempotency-Key`. After an ambiguous response, Rust authenticates `GET /v1/dictation-requests/:requestId` and polls the same `reserved` / `processing` job; an initial transport failure can retry the POST once only when status checks show no job. The running desktop does not persist a pending-request journal, so process restart does not automatically resume the request ID. An unresolved managed network error leaves its temporary WAV for startup cleanup.

Ledger entries are append-only corrections rather than client-authored balance rewrites. The authenticated API exposes period-bound `subscriptionTokens`, non-expiring `purchasedTokens`, and their combined `remainingTokens`; backend fields and parameters call the same accounting unit **credits**. These units are not raw provider tokens. Any client-cached balance is derived; the ledger/job transaction is the authority.

Existing schema-v1 blended balances have no trustworthy source attribution. Their one-time schema-v2 migration treats available value and in-flight reservations as purchased credits so rollout cannot silently expire customer value. New grants must never use the blended legacy path.

Commercial provider-cost reporting is versioned and independent of entitlement debits and revenue margin. Provider spend is estimated in integer micro-USD from measured duration and provider-reported polish usage. When a dispatched polish request may have been processed but no trustworthy usage is returned, reporting uses an auditable safety estimate based on request bytes, a configured input-framing allowance, and the configured maximum output. The method and inputs are retained with the breakdown; known pre-dispatch failures stay at zero. These fallback values never increase the customer's allowance debit. Revenue margin is a required server-side deployment parameter on funding grants. Clients cannot submit or overwrite cost, revenue, or margin fields.

### Stripe

- Subscription and top-up Checkout prices, token grants, and margins are selected from server configuration. The client supplies only the strict top-up tier `usd_5`, `usd_10`, or `usd_20`; it never supplies a price ID, quantity, token amount, or margin.
- Portal and Checkout sessions are created only for the authenticated UID's server-mapped customer.
- Webhooks verify the raw-body signature before JSON processing.
- `billing_events/{stripeEventId}` makes delivery idempotent.
- Subscription updates use event/object timestamps or retrieve current Stripe state to handle out-of-order events.
- Every paid billing period has a stable idempotency key such as subscription + period. Applying a new period replaces the subscription-token pool, expires unused tokens from the previous period, and never changes purchased tokens.
- Reservations allocate subscription tokens before purchased tokens and persist both portions plus the subscription-period identity. Capture and release use that exact allocation; a late release cannot restore subscription tokens after their period expires.
- A top-up grant requires a paid Checkout completion, server-authored tier metadata, the expected amount, and a line item matching that tier's allow-listed Stripe price. Its immutable ledger source is the Checkout session ID.
- Purchased-token grants are additive and never expire. Subscription cancellation, reactivation, invoice retry, or period rollover cannot erase them.
- Success redirects and client refreshes never grant entitlement or credits.

Dictionary deletion is a validated, timestamped tombstone write rather than a physical client delete. Tombstones are terminal per document ID: they beat live records regardless of clock order, and Firestore denies tombstone-to-live updates. They are retained in the UID-scoped encrypted vault and Firestore merge set, hidden from UI/request snapshots, and an intentional re-add receives a new UUID. Physical tombstone garbage collection requires a future trusted protocol that can prove no supported device still depends on it.

Test test-mode and live-mode separation, duplicate events, retries, failed invoices, cancellation, reactivation, top-up completion, and account/customer mapping.

## Logging, analytics, and diagnostics

Do not log or attach:

- raw audio;
- dictated/final text;
- custom prompts or dictionary entries;
- OpenAI keys, Firebase ID tokens, refresh tokens, authorization headers, cookies, or webhook signatures;
- email addresses or full Stripe customer/subscription identifiers;
- raw provider responses or multipart bodies.

Permitted production diagnostics are redacted correlation IDs, application version/platform, prompt/model configuration version, coarse size/duration buckets, metered units, endpoint latency, and enumerated error classes.

Sanitize errors at every boundary. Provider and OS errors may include paths, device names, account details, or echoed request content. Analytics must be opt-in where required and must not be required for core dictation.

## Platform-specific limits

### macOS

Microphone, Input Monitoring, and Accessibility are independent privacy decisions. Code signature and bundle identity affect grants. Open Dictate must explain each required permission and deep-link only to the relevant pane.

Screen Recording is not needed and must not be requested.

Hardened Runtime, a stable bundle identifier, Developer ID signing, notarization, stapling, and Gatekeeper assessment are release requirements for direct distribution.

### Windows

Open Dictate respects microphone privacy settings and User Interface Privilege Isolation. It does not inject into higher-integrity processes, UAC/secure desktops, or protected fields. Code signing and timestamping are release requirements. Installer/update behavior must preserve publisher identity across versions.

## Dependency and supply-chain security

- Commit and review npm and Cargo lockfiles.
- Use `npm ci` in CI; do not silently update dependencies during a release build.
- Review Tauri, Rust, Firebase, Stripe, OpenAI, React, and native-input dependency advisories.
- Run ecosystem audits with a documented triage policy; an audit tool is evidence, not a substitute for review.
- Pin CI actions and restrict release workflow permissions.
- Produce release artifacts from protected, reproducible workflows with retained checksums and provenance where practical.
- Keep signing identities and deployment credentials out of developer builds.
- Review new dependencies for native hooks, networking, telemetry, install scripts, and maintenance status.

Dependency-audit results are point-in-time evidence. Run both npm workspace audits and the Rust advisory audit before every release, triage transitive findings against reachable code, and track unresolved advisories publicly when disclosure is safe. Never apply an automated breaking downgrade or an unverified transitive override only to make an audit count reach zero.

Audit snapshot (2026-07-26): the desktop npm production tree reports zero vulnerabilities and
RustSec reports zero vulnerabilities in `src-tauri/Cargo.lock`. RustSec also reports maintenance
warnings for target-specific GTK3 crates and several legacy transitive utility crates; those are
not vulnerability findings, but they remain dependency-refresh work. The Functions production
tree reports five high and seven moderate aggregate findings. The high chain is the current
`google-gax` → `rimraf` → `glob` path to the `brace-expansion` denial-of-service advisory; no
request-controlled glob input has been identified in Open Dictate. The moderate chain is the
current Firebase Admin Cloud Storage path to `uuid`; the vulnerable buffer-taking API is not used
by Open Dictate. Current upstream package ranges do not provide a non-breaking resolution. These
findings must be rechecked before any managed-service launch and replaced with fixed upstream
versions as soon as they are available.

## Production security gates

The application must not be described as production-ready until all of the following have evidence:

- [ ] Modifier-only arming and third-key cancellation pass the native input matrix.
- [ ] A watchdog prevents indefinite recording after lost key-up, sleep, or hook failure.
- [ ] Focus token capture/revalidation prevents wrong-application insertion.
- [ ] Secure/protected/elevated targets fail closed with a copy fallback.
- [ ] BYOK round trips through the native encrypted vault without a getter, recurring OS prompt, or secret-bearing logs.
- [ ] The release binary is compiled with the exact production `OPEN_DICTATE_MANAGED_API_ORIGIN`; mismatch and missing-pin tests fail closed.
- [ ] All protected managed requests carry verified Firebase identity.
- [ ] Audio/prompt/dictionary/request limits are enforced in both desktop and backend.
- [ ] Firestore Rules default-deny and emulator tests prove cross-user isolation and server-only writes.
- [ ] Split-pool reservation/settlement, subscription-first priority, expiry-aware release, recording-UUID retries, status recovery, and 300/330-second timeout behavior are transactionally safe.
- [ ] Stripe signatures, duplicate/out-of-order delivery, subscription-token reset/expiry, all three top-up mappings and margins, non-expiring purchased tokens, and grant idempotency are tested against configured external services.
- [ ] AES-256-GCM vault round trips, UID-scope isolation, tamper rejection, private-file access, and legacy adoption are validated in signed builds on both platforms.
- [ ] 7/30/90/365-day pruning, Firestore `expiresAt` cleanup, and queued per-item cloud deletion are validated.
- [ ] Temporary audio cleanup passes success, cancel, error, crash, and startup tests.
- [ ] Logs, analytics, and crash reports pass a sensitive-data inspection.
- [ ] Screen Recording is not requested by code, entitlements, onboarding, or support material.
- [ ] macOS artifacts are signed, notarized, stapled, and Gatekeeper-assessed.
- [ ] Windows binaries/installers are signed, timestamped, and Authenticode-verified.
- [ ] Fresh install, upgrade, uninstall, permission denial, offline, and account deletion are tested on clean machines.
- [ ] Production IAM, backup, retention, incident response, key rotation, and security contact have owners.

## Incident response minimum

Before launch, maintain a private runbook that covers:

1. triage and preservation of redacted evidence;
2. disabling managed transcription or billing endpoints independently;
3. revoking/rotating OpenAI, Stripe, Firebase, CI, and signing-related credentials;
4. identifying affected app versions, accounts, requests, ledger entries, and webhook events without inspecting transcript content unnecessarily;
5. reconciling reservations/charges safely with append-only adjustments;
6. notifying providers, users, and authorities when required;
7. publishing a signed fixed release and preventing downgrade to a vulnerable build;
8. documenting root cause and preventive controls.

Security exceptions require an owner, written rationale, bounded scope, expiration date, and compensating controls. They must not silently weaken the invariants above.
