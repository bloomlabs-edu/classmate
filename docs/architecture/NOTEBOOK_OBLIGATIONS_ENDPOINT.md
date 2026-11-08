# Notebook Obligations Endpoint

**Status:** Implemented (ClassMate side), tests passing against the local Firestore + Auth emulators. **Not committed, not pushed, not deployed.** Builds directly on the already-implemented, already-tested Learner Identity Bridge (`docs/architecture/CLASSROOM_INVITATION_VERIFICATION_BRIDGE.md`) — reuses its two trust primitives unmodified; does not alter them.

## Purpose

Lets Learning Hub show a learner their own outstanding ClassMate notebook work — read-only, nothing else. Answers exactly one question, server-to-server: *"for this (already-verified) learner, in this classroom, what notebook obligations do they currently have?"*

This endpoint performs **no Firestore writes anywhere.** It does not create, modify, or touch `learnerClassroomRelationships`, `classrooms`, or any other document. It also does not copy notebook data between projects — it returns a small, derived, per-request JSON projection over an HTTPS response; nothing is persisted on Learning Hub's side by anything this endpoint does.

## Request / Response Contract

```
POST https://us-central1-classmate-302c2.cloudfunctions.net/getNotebookObligationsForLearner
Authorization: Bearer <Learning Hub Firebase ID token>
Content-Type: application/json

{
  "learnerProfileId": "string",
  "classroomId": "string"
}
```

No other field is ever accepted. `studentId` is never a request input — a request containing it (or any other unrecognized key) is rejected outright with 400, not silently stripped.

**Responses — the complete, exhaustive set, enforced by an allowlist test (see Testing below):**
- `401 { ok: false, error: 'unauthenticated' }` — no/invalid/wrong-project bearer token.
- `400 { ok: false, error: 'invalid_request' }` — malformed body, missing/oversized/non-string `learnerProfileId` or `classroomId`, or any unrecognized field (including `studentId`).
- `200 { ok: false, error: 'obligations_unavailable' }` — every domain-level rejection from this point on: unowned `learnerProfileId`, no `learnerClassroomRelationships` record, a `PENDING`/`REVOKED` (non-`ACTIVE`) relationship, a relationship for a different classroom than requested, or a classroom document that no longer exists. **Deliberately identical across all of these** (anti-oracle, matching the Learner Identity Bridge's own established convention) — a caller cannot distinguish any of these cases from one another.
- `200 { ok: true, obligations: [...] }` — exactly what `getNotebookObligationsForStudent()` already returns, reused unmodified. Each item: `{ requestId, title, subjectId, notebookTypeId, dueDate, status, reviewOutcome, isOpen, updatedAt }` — nothing more, nothing less. `studentId` never appears in the response (Learning Hub already supplied the `learnerProfileId` that maps to it; it has no need to be told its own resolved value back, and echoing it would be an unnecessary field to defend going forward).

## Files

| File | Purpose |
|---|---|
| `functions/src/getNotebookObligationsForLearnerEndpoint.js` | Framework-agnostic core: auth → shape validation → ownership check → authoritative relationship lookup → classroom load → projection → response. New. |
| `functions/src/notebookObligationsProjection.js` | Deliberate duplicate of `getNotebookObligationsForStudent()` and its 3 read-only helper dependencies, copied verbatim from `js/services/workRequestService.js`. New. See "Why a duplicate, not a reuse" below. |
| `functions/index.js` | New `getNotebookObligationsForLearner` export — `onRequest` glue only. Existing exports untouched. |
| `tests/functions/notebookObligationsProjection.test.js` | Pure parity test — no emulator — proves the duplicate stays behaviorally identical to the real `workRequestService.js`. New. |
| `tests/functions/getNotebookObligationsForLearnerEndpoint.test.js` | Emulator test suite (Firestore + Auth) for the endpoint itself. New. |

`functions/src/learningHubAuth.js`, `functions/src/learnerProfileOwnership.js`, `functions/src/verifyLearnerConnectionEndpoint.js`, and `functions/src/learnerVerification/**` are **not modified** — this endpoint only imports from the first two, exactly as `verifyLearnerConnectionEndpoint.js` already does.

## Why a duplicate, not a direct reuse

`getNotebookObligationsForStudent()` lives in `js/services/workRequestService.js`, outside `functions/`. `firebase.json`'s `functions.source: "functions"` means Cloud Functions only packages the `functions/` directory at deploy time — a relative import reaching outside it would crash the deployed container at startup (this is the exact, already-documented failure this repo hit once before with `verifyLearnerConnection.js`; see that file's own header comment and `functions/index.js`'s own header comment).

This repo already has an established, tested pattern for exactly this situation: duplicate the pure logic into `functions/src/`, verbatim, with (a) a header comment naming the duplication and its reason, (b) an explicit statement of which copy is the source of truth, and (c) a parity test proving the two stay identical. See `js/utils/hashUtils.js` / `functions/src/learnerVerification/hashUtils.js` and `js/models/LearnerConnection.js` / `functions/src/learnerVerification/learnerConnectionShared.js`, both asserted equal by `tests/models/learnerConnection.test.js`.

`functions/src/notebookObligationsProjection.js` follows this exact pattern: it duplicates only the four read-only functions `getNotebookObligationsForLearnerEndpoint.js` actually needs (`listWorkRequests`, `isOpen`, `getEntryForStudent`, `getNotebookObligationsForStudent`), copied line-for-line with no logic changes, and `tests/functions/notebookObligationsProjection.test.js` proves parity against the real `js/services/workRequestService.js` for several fixtures (multiple obligations, single obligation, no obligations, absent `workRequests` field, non-notebook filtering, and sort order). **If the two ever disagree, `js/services/workRequestService.js` is the source of truth** — fix the duplicate, never the other way around.

**One deliberate, documented exception to "verbatim," added during post-implementation security review:** `getEntryForStudent()` in the duplicate guards against `workRequest.entries` being missing, `null`, or not an array before calling `.find()` on it; the original `js/services/workRequestService.js` has no such guard, because every `WorkRequest` it has ever written itself always populates `entries` at creation. This server-side endpoint has no such guarantee about classroom documents it merely reads, and an uncaught exception here would be externally observable (see Security Decision 10 below). `js/services/workRequestService.js` was **deliberately not changed** to add the same guard — it is a shared client-side file outside this endpoint's own scope, with its own callers, tests, and release process. That file's gap remains open; `tests/functions/notebookObligationsProjection.test.js`'s own "malformed entries" tests prove this directly, by asserting the original still throws on the exact input the duplicate now handles safely, so the gap stays visible rather than silently appearing fixed.

## Security Decisions

**1. Authentication (reused, unmodified).** `functions/src/learningHubAuth.js` verifies the bearer token against Learning Hub's own Firebase project via a separately-initialized Admin app, exactly as the Learner Identity Bridge already does. A missing, malformed, garbage, or wrong-project token fails closed with `401`, indistinguishable from one another in the response.

**2. Ownership (reused, unmodified).** `functions/src/learnerProfileOwnership.js`'s real, IAM-gated, cross-project check (impersonating `learning-hub-profile-verifier@classmate-302c2.iam.gserviceaccount.com` to call Learning Hub's `verifyLearnerProfileOwnership`) is used exactly as-is. This endpoint adds no second ownership mechanism and does not weaken or bypass the existing one. In this local dev/test sandbox (no Application Default Credentials configured), the real production default fails closed exactly as it does for `verifyLearnerConnection` today — proven directly by this endpoint's own "PRODUCTION DEFAULT" test, not merely assumed.

**3. `studentId` is resolved exclusively server-side, read fresh on every request.** It is never an accepted request field (rejected outright per decision 4 below), never cached, and never derived from anything but the live `learnerClassroomRelationships/{learnerProfileId}_{classroomId}` document's own `status === 'ACTIVE'` and `studentId` fields. A `PENDING` or `REVOKED` relationship — even one that already names a real `studentId` — is treated identically to "no relationship at all."

**4. Strict request-field allowlist.** The handler checks `Object.keys(body)` against the exact allowed set (`learnerProfileId`, `classroomId`) and rejects the request outright (400) if any other key is present — not just `studentId` specifically, any unrecognized field. This matches the Learner Identity Bridge's own "reject outright, don't silently strip" convention, so a caller cannot use response-behavior differences to probe whether an extra field is read.

**5. Defense in depth on the classroom binding.** Even though the relationship document's id is itself built from `(learnerProfileId, classroomId)`, the handler additionally checks `relationship.classroomId === classroomId` before trusting it — the same "don't trust structure alone" posture `verifyStudentCode()` already applies to its own code/classroom binding.

**6. Anti-oracle response shape.** Every domain-level failure past the 400/401 gates — unowned profile, missing relationship, non-ACTIVE relationship, classroom mismatch, missing classroom document — returns the identical `{ ok: false, error: 'obligations_unavailable' }` at `200`. A caller cannot learn *why* a request failed, only that it did.

**7. Response field minimization, enforced structurally and by test.** Every response object in the handler is built field-by-field from named constants — never via object spread of Firestore-sourced data — so there is no code path by which a stray Firestore field could leak into a response. `getNotebookObligationsForStudent()` itself already only ever constructs a fixed 9-field projection per obligation (never raw `WorkRequest`/`WorkRequestEntry` documents). The test suite proves this directly: a fixture `WorkRequest`/entry deliberately salted with extra fields (`secretInternalField`, `teacherNotes`, `internalAuditTrail`) is confirmed absent from the response, and both the top-level success shape (`{ok, obligations}`) and failure shape (`{ok, error}`) are asserted to have *exactly* those keys, nothing more — "**Add a strict response-schema allowlist test**" from this endpoint's own requirements.

**8. `Cache-Control: private, no-store` on every response.** Set unconditionally in `functions/index.js`'s `onRequest` handler before the method check, so it applies to every status code this endpoint can ever return, including `405`. A response here can contain a real learner's notebook status; it must never be cached by any intermediary, CDN, or the caller's own HTTP stack.

**9. No logging of tokens, ids, or content.** Neither the handler nor the `index.js` glue logs `req.body`, the `Authorization` header, the verified uid, `learnerProfileId`, `classroomId`, `studentId`, or any obligation data — matching every other handler in this `functions/index.js` file, none of which log request content either.

**10. Fail-closed on unexpected exceptions, added during post-implementation security review.** Two layers, not one:
- `functions/src/notebookObligationsProjection.js`'s `getEntryForStudent()` specifically guards against a notebook `WorkRequest` with missing/`null`/non-array `entries` (a realistic shape for legacy or malformed classroom data this endpoint never wrote itself) — such a request is now silently excluded from the result, not thrown. See "Why a duplicate, not a direct reuse" above for the full reasoning and the documented, still-open gap this leaves in the original client-side file.
- `functions/src/getNotebookObligationsForLearnerEndpoint.js` additionally wraps the entire classroom-data-access-plus-projection step (`classroomSnap.data()` through `getNotebookObligationsForStudent(...)`) in its own try/catch, returning the same `GENERIC_FAILURE` anti-oracle shape on **any** exception — not just the one known malformed-`entries` case. This is deliberate defense in depth: a classroom document could be malformed in some other way this review didn't anticipate, and this endpoint must never leak a stack trace, classroom contents, or a framework-default error response instead of its own documented contract. The caught error is never logged (it could contain classroom contents).
- **Honest test-coverage note:** `tests/functions/notebookObligationsProjection.test.js` proves the first guard directly (a WorkRequest with missing/malformed `entries` no longer throws). No test in `tests/functions/getNotebookObligationsForLearnerEndpoint.test.js` currently forces a genuine, uncaught exception through the *outer* handler-level try/catch — every seeded classroom fixture in that file is well-formed, and the one known malformed shape is already intercepted one layer down before it would ever reach this outer catch. The outer try/catch's own correctness rests on code inspection and the general guarantee that a caught exception returns `GENERIC_FAILURE` (the same pattern already exercised live by this file's `catch` blocks around the Firestore reads), not on a dedicated live-throw test of this exact block.

## Invoker / Platform Configuration Review

`getNotebookObligationsForLearner` is declared `onRequest({ cors: false, invoker: 'public' })`, identical to `verifyLearnerConnection`. This was deliberately reviewed, not copy-pasted blindly:

- **Why `invoker: 'public'` is correct here, not a gap.** Cloud Run/Functions IAM answers "is the caller a specific, known Google Cloud identity?" — it has no concept of "a Learning Hub end user." Learning Hub's backend calling this endpoint is not itself a provisioned GCP service account ClassMate could allowlist via IAM (unlike the *reverse* direction — `learnerProfileOwnership.js` calling *into* Learning Hub — which does use a real, narrow IAM-gated service account, because that caller identity *does* exist and *was* provisioned). The actual, enforced security boundary for this endpoint is entirely inside `handleGetNotebookObligationsForLearnerRequest`: a verified Learning Hub ID token (step 1) and a verified ownership claim (step 3), both of which fail closed. `invoker: 'public'` only means "Cloud Run won't reject the HTTP connection before the function's own code runs" — it does not mean "unauthenticated." This is the same reasoning already documented for `verifyLearnerConnection` in `CLASSROOM_INVITATION_VERIFICATION_BRIDGE.md` §27, applied to a second, structurally identical endpoint.
- **No CORS.** `cors: false` and no `Access-Control-Allow-Origin` handling anywhere in this export — this is a server-to-server call from Learning Hub's own backend, never a browser directly, matching `verifyLearnerConnection`'s own posture (as opposed to the device-signin endpoints in the same file, which *do* need browser CORS and use `applyCorsIfAllowed`).
- **No `serviceAccount` override.** This function keeps the project's normal default Cloud Functions runtime identity (needed for its own `classrooms`/`learnerClassroomRelationships` Firestore reads); the one cross-project outbound call inside `learnerProfileOwnership.js` already uses its own separate, narrowly-scoped impersonated identity for that single call only — unchanged, not touched by this endpoint.
- **No new IAM grant, credential, or service account was created for this task.** Everything this endpoint calls (`learningHubAuth.js`, `learnerProfileOwnership.js`) already exists and was already provisioned for the Learner Identity Bridge.

## Abuse-Control Posture (Initial)

- **The primary control is authentication, not rate limiting.** Unlike `startDeviceSignIn`/`pollDeviceSignIn` (fully anonymous, low-entropy pairing codes, which is *why* those two specifically need `functions/src/deviceSignIn/rateLimiter.js`'s Firestore-backed fixed-window limiter), every request to this endpoint already requires a real, verified Learning Hub ID token plus a passing cross-project ownership check before any Firestore read happens. An attacker without a genuine Learning Hub-issued token for a genuinely-owned `learnerProfileId` cannot reach the data-access path at all, regardless of request volume.
- **Bounded input.** `learnerProfileId`/`classroomId` are each capped at 200 characters (matching `verifyLearnerConnectionEndpoint.js`'s own `MAX_ID_LENGTH` convention) and must be non-empty strings — oversized or malformed input is rejected with `400` before any Firestore access.
- **No new Firestore-backed rate limiter was added for this endpoint.** Considered and deliberately not built this round: it would be new infrastructure/surface beyond what an authenticated, ownership-checked, read-only endpoint needs, and this task's own constraints call for sensible bounds, not broad new grants or infrastructure. **This is a decision to revisit, not a final answer** — if Learning Hub's real call volume per learner turns out to be unexpectedly high (e.g., polling on every screen render rather than on-demand), the existing `rateLimiter.js` primitive could be reused here with a `uid`-keyed bucket without introducing a new pattern.
- **Platform defaults only.** No `maxInstances` or `concurrency` override is set — identical to every other `onRequest` export in this file; none of them customize Cloud Functions v2's default scaling behavior, so this endpoint doesn't introduce an inconsistency.
- **No data written anywhere by this endpoint** — there is no mutation path to rate-limit against write amplification; the only cost per request is a bounded number of Firestore reads (one relationship doc, one classroom doc) plus one outbound cross-project HTTPS call already rate-governed by whatever Learning Hub enforces on its own `verifyLearnerProfileOwnership` endpoint.

## Testing

Run against the Firestore + Auth emulators (`firebase emulators:start --only firestore,auth --project demo-classmate-bridge-test-endpoint` — this specific project id matters; see "Known Limitations" below):

```
node --test --test-concurrency=1 \
  tests/functions/learningHubAuth.test.js \
  tests/functions/learnerProfileOwnership.test.js \
  tests/functions/verifyLearnerConnectionEndpoint.test.js \
  tests/functions/getNotebookObligationsForLearnerEndpoint.test.js \
  tests/functions/notebookObligationsProjection.test.js \
  tests/models/learnerConnection.test.js
```

All 91 tests pass (33 pre-existing + unmodified, 9 pre-existing model tests, 49 new: 11 projection-parity [6 original + 5 added by the post-implementation security review for the malformed-`entries` guard] + 38 endpoint).

New coverage (`tests/functions/getNotebookObligationsForLearnerEndpoint.test.js`):
- Authentication: missing/malformed/garbage/wrong-project token → 401; valid token reaches validation. (Note: the "wrong-project token" test at this layer injects a stub verifier returning `null` — it proves this endpoint's own 401-wiring, not the real cross-project audience check; that check is proven directly, unmodified, in `tests/functions/learningHubAuth.test.js`.)
- Request validation: malformed body, missing fields, `studentId` injection, any other unexpected field, oversized/non-string ids → 400.
- Ownership: production default (fails closed, no ADC in this sandbox), injected-false resolver, throwing resolver.
- Relationship states: none at all, `PENDING`, `REVOKED`, `ACTIVE` for a *different* classroom (mismatch), `ACTIVE` but classroom document missing.
- Real success: full obligations returned correctly for a seeded `ACTIVE` relationship + classroom + notebook `WorkRequest`.
- Empty results: `ACTIVE` relationship, real classroom, zero matching entries → `{ok: true, obligations: []}`.
- Two students in one classroom: each learner's request returns only their own student's obligations — direct isolation proof, plus a named "Caller A reads Caller B's data" security test.
- Response schema allowlist: success and failure shapes each contain *exactly* their approved keys, proven against a fixture deliberately salted with extra, must-not-leak fields.
- `adminDb` required-dependency contract (mirrors the sibling endpoint's own test).

New coverage (`tests/functions/notebookObligationsProjection.test.js`, added by the post-implementation security review):
- Intended case: a genuinely empty `entries: []` array behaves identically in both the duplicate and the original (not an error).
- Malformed cases: `entries` absent, `null`, or a non-array object — the duplicate safely excludes the malformed `WorkRequest` without throwing, while a parallel test asserts the **original** `js/services/workRequestService.js` still throws on the identical input, keeping that known, still-open limitation visible and executable rather than merely described in prose.

## Known Limitations / What Was Not Done

- **Ownership verification's real-world behavior is still unproven beyond this sandbox.** Exactly as documented for `verifyLearnerConnection`, the "PRODUCTION DEFAULT" test here proves the *fail-closed* guarantee in an environment with no Application Default Credentials — it does not and cannot prove the real cross-project IAM call succeeds in a genuine deployed environment, since that requires real GCP infrastructure this task has no access to. **Cross-project integration has not been proven end-to-end; only each side's own unit/emulator behavior has.**
- **No client (Learning Hub) wiring exists or was added.** No code anywhere in the `learning-hub` repository references this endpoint's name or URL — this is, like `verifyLearnerConnection` before it, a ClassMate-side implementation with no live caller yet.
- **No new abuse-specific rate limiter.** See "Abuse-Control Posture" above — a deliberate, documented, revisitable decision, not an oversight.
- **Not deployed, not committed to this functions package's `package-lock.json`'s deploy path.** `functions/node_modules` was installed locally purely to execute these tests (same one-time step the Learner Identity Bridge's own `verifyLearnerProfileOwnership` work already required per its own doc) — `firebase deploy --only functions` was never run.
- **A pre-existing test-environment quirk, unrelated to this endpoint:** the Firestore + Auth emulator pair must be started with `--project demo-classmate-bridge-test-endpoint` for `learningHubAuth.test.js`/`verifyLearnerConnectionEndpoint.test.js` to pass (their own token-minting fixtures are tied to that literal project id) — this new test file's own project id constant was deliberately aligned to the same value so all functions tests can run in one shared emulator session, matching the existing suite's own convention. A different, unrelated existing suite (`tests/functions/deviceSignIn/deviceSignInEndpoints.emulator.test.js`) hardcodes yet another project id (`demo-classmate-devicesignin-test`) and was not run as part of this change (device sign-in/PIN behavior is explicitly out of scope and was not touched) — its tests were not exercised one way or the other by this task.
- **`functions/node_modules` and a root-level `firebase-admin` devDependency did not previously exist** in this worktree; both were installed locally to actually execute any of these emulator-backed tests (old or new) — this is a one-time local environment fix, not a change to what gets deployed (`functions/node_modules` is not committed, matching this repo's existing `.gitignore` convention for that directory).
- **Dependency version alignment (resolved by the post-implementation security review):** the root `firebase-admin` devDependency was initially installed at a newer major version than `functions/package.json`'s own `^13.10.0`, meaning the test suite briefly ran against a different SDK major version than what would actually deploy. This has been corrected — the root devDependency is now pinned to the identical `^13.10.0` range, and both `node_modules/firebase-admin` and `functions/node_modules/firebase-admin` resolve to the exact same `13.10.0` version, confirmed directly (`require(...).version` in both locations), not merely declared.
- **The outer, defense-in-depth try/catch added to `getNotebookObligationsForLearnerEndpoint.js` (Security Decision 10) is not exercised by a dedicated live-throw test.** The one known failure shape it exists to catch (malformed `entries`) is already intercepted one layer down by `notebookObligationsProjection.js`'s own guard before it would ever reach this outer catch; no current test constructs a classroom fixture malformed in some *other* way (e.g. a non-array `workRequests` field itself) to force a genuine exception through this specific block. Its correctness currently rests on code inspection and consistency with this same file's other, directly-exercised `catch` blocks, not a dedicated regression test.
