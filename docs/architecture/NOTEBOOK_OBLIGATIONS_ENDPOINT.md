# Notebook Obligations Endpoint

**Status:** Implemented (ClassMate side), checkpoint-aware, committed and pushed as [bloomlabs-edu/classmate#20](https://github.com/bloomlabs-edu/classmate/pull/20) (branch `feature/notebook-status-integration`). **Not merged, not deployed.** Builds directly on the already-implemented, already-tested Learner Identity Bridge (`docs/architecture/CLASSROOM_INVITATION_VERIFICATION_BRIDGE.md`) — reuses its two trust primitives unmodified; does not alter them.

## Revision history

This endpoint was first built against ClassMate's legacy `WorkRequest` obligations system only (branch `feature/notebook-obligations-api`, now superseded, left open and untouched until this replacement is verified on `main`). It has since been extended to be **checkpoint-aware**: it now merges BOTH of ClassMate's notebook-tracking systems — the newer, now-default Checkpoint system and the legacy WorkRequest system — exactly matching the precedence rule already established by `js/services/notebookStatusService.js`. This is a **breaking response-shape change** (see below); no Learning Hub consumer existed for the old shape at the time of the change (confirmed), so there was nothing to migrate.

## Purpose

Lets Learning Hub show a learner their own real ClassMate notebook status — read-only, nothing else. Answers exactly one question, server-to-server: *"for this (already-verified) learner, in this classroom, where do they stand on their notebook work, across every tracking system ClassMate uses?"*

This endpoint performs **no Firestore writes anywhere.** It does not create, modify, or touch `learnerClassroomRelationships`, `classrooms`, or any other document. It also does not copy notebook data between projects — it returns a small, derived, per-request JSON projection over an HTTPS response; nothing is persisted on Learning Hub's side by anything this endpoint does.

## Request / Response Contract (current)

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
- `200 { ok: false, error: 'obligations_unavailable' }` — every domain-level rejection from this point on: unowned `learnerProfileId`, no `learnerClassroomRelationships` record, a `PENDING`/`REVOKED` (non-`ACTIVE`) relationship, a relationship for a different classroom than requested, a classroom document that no longer exists, **or any unexpected exception while loading/projecting classroom data** (see Security Decision 10 below — this now includes a dedicated live-throw test, not just known malformed shapes). **Deliberately identical across all of these** (anti-oracle) — a caller cannot distinguish any of these cases from one another, and never sees classroom contents or a stack trace instead.
- `200 { ok: true, status: { summary: {...}, items: {...} } }` — the checkpoint-aware merge, built from `getNotebookStatusForStudent()` (see "Checkpoint integration" below) and then independently field-minimized by this endpoint (see Security Decision 7).

### The five status buckets

Every response's `summary` and `items` always contain exactly these five keys, in this priority order (most-actionable first):

| Bucket | Meaning |
|---|---|
| `needsCorrection` | Submitted, reviewed, and sent back for correction |
| `awaitingSubmission` | Not yet submitted (checkpoint with no record, or a legacy `assigned` obligation) |
| `awaitingReview` | Submitted, not yet reviewed (checkpoint `submitted`/`not_reviewed`, or legacy `submitted`/`resubmitted`) |
| `reviewed` | Submitted and marked complete |
| `absent` | Legacy-only status — a WorkRequest entry explicitly marked `absent`. Checkpoints have no equivalent concept. |

`summary` is a plain `{bucket: count}` map, always present with all 5 keys (0 where nothing contributes) — it is a cheap, pre-aggregated count so a caller never has to sum `items` arrays itself, and the two are proven to always agree (see Testing).

### The seven permitted response-item fields

Every item inside every bucket is built explicitly, field-by-field, from exactly these 7 fields — nothing more, nothing less:

```
{ source: 'checkpoint' | 'workRequest', title, subjectId, notebookTypeId, dueDate, updatedAt, actionable }
```

`source` tells the caller which tracking system produced this item (informational only — Learning Hub does not need to treat the two differently). `actionable` is `true` for every checkpoint item (checkpoints never close) and for a legacy item only while its own `WorkRequest` is still open.

**Deliberately never present, on any item, in any bucket:** the projection's own internal `id`, `checkpointId` (checkpoint-sourced items), `requestId` (legacy-sourced items), or `studentId` — all ClassMate-internal identifiers with no established need on Learning Hub's side. This is enforced structurally (the endpoint rebuilds every item from its own explicit field list, never spreading the projection's raw output) and proven by test (response-schema allowlist test, and a dedicated cross-student isolation test).

## Checkpoint integration

`functions/src/notebookStatusProjection.js` is a deploy-boundary duplicate of `js/services/notebookStatusService.js`'s `getNotebookStatusForStudent()`, built the same way `notebookObligationsProjection.js` already duplicates `workRequestService.js` (see "Why a duplicate, not a direct reuse" below — same packaging constraint applies to both). It reuses `notebookObligationsProjection.js`'s own `getNotebookObligationsForStudent()` for the legacy half rather than re-duplicating it a second time.

**Precedence rule (the single most important property of this module, copied from the real service's own header comment):** checkpoint tracking WINS whenever both tracking systems describe the same `(subjectId, notebookTypeId)` identity — a legacy WorkRequest obligation sharing that identity is **dropped entirely**, never merged, never double-counted. Proven by 11 parity tests (see Testing), including a dedicated collision scenario: a checkpoint and a stale legacy obligation for the identical identity resolve to exactly one item, never two.

## Files

| File | Purpose |
|---|---|
| `functions/src/getNotebookObligationsForLearnerEndpoint.js` | Framework-agnostic core: auth → shape validation → ownership check → authoritative relationship lookup → classroom load → checkpoint-aware projection → field-minimized response. |
| `functions/src/notebookStatusProjection.js` | **New.** Deploy-boundary duplicate of `js/services/notebookStatusService.js`'s `getNotebookStatusForStudent()` plus its checkpoint-side pure dependencies (`checkpointService.js`, `notebookConfigService.js`). Reuses `notebookObligationsProjection.js` for the legacy half. |
| `functions/src/notebookObligationsProjection.js` | Deliberate duplicate of `getNotebookObligationsForStudent()` and its 3 read-only helper dependencies, copied verbatim from `js/services/workRequestService.js`. Unchanged from the original implementation. See "Why a duplicate, not a direct reuse" below. |
| `functions/index.js` | `getNotebookObligationsForLearner` export — `onRequest` glue only. Existing exports untouched. |
| `tests/functions/notebookObligationsProjection.test.js` | Pure parity test — no emulator — proves the legacy-half duplicate stays behaviorally identical to the real `workRequestService.js`. Unchanged. |
| `tests/functions/notebookStatusProjection.test.js` | **New.** Pure parity test — no emulator — proves the checkpoint-aware duplicate stays behaviorally identical to the real `notebookStatusService.js`. |
| `tests/functions/getNotebookObligationsForLearnerEndpoint.test.js` | Emulator test suite (Firestore + Auth) for the endpoint itself — updated for the new response shape, plus 2 new checkpoint-aware scenarios and a dedicated outer-try/catch exception test. |

`functions/src/learningHubAuth.js`, `functions/src/learnerProfileOwnership.js`, `functions/src/verifyLearnerConnectionEndpoint.js`, and `functions/src/learnerVerification/**` are **not modified** — this endpoint only imports from the first two, exactly as `verifyLearnerConnectionEndpoint.js` already does.

## Why a duplicate, not a direct reuse

`getNotebookObligationsForStudent()` and `getNotebookStatusForStudent()` both live outside `functions/` (in `js/services/`). `firebase.json`'s `functions.source: "functions"` means Cloud Functions only packages the `functions/` directory at deploy time — a relative import reaching outside it would crash the deployed container at startup (this is the exact, already-documented failure this repo hit once before with `verifyLearnerConnection.js`; see that file's own header comment and `functions/index.js`'s own header comment).

This repo already has an established, tested pattern for exactly this situation: duplicate the pure logic into `functions/src/`, verbatim, with (a) a header comment naming the duplication and its reason, (b) an explicit statement of which copy is the source of truth, and (c) a parity test proving the two stay identical. See `js/utils/hashUtils.js` / `functions/src/learnerVerification/hashUtils.js`, `js/models/LearnerConnection.js` / `functions/src/learnerVerification/learnerConnectionShared.js`, and now `js/services/workRequestService.js` / `functions/src/notebookObligationsProjection.js` and `js/services/notebookStatusService.js` / `functions/src/notebookStatusProjection.js`.

**Two deliberate, documented exceptions to "verbatim":**

1. `notebookObligationsProjection.js`'s `getEntryForStudent()` guards against `workRequest.entries` being missing, `null`, or not an array before calling `.find()` on it; the original `js/services/workRequestService.js` has no such guard. Proven by `tests/functions/notebookObligationsProjection.test.js`'s own malformed-`entries` tests, which also assert the original still throws on the identical input — the gap stays visible, not silently fixed-looking.
2. `notebookStatusProjection.js`'s `listSubjects()`/`listNotebookTypes()` default to an empty array when `classroom.notebookConfig` is missing entirely; the real `js/services/notebookConfigService.js` throws in that case. Proven by `tests/functions/notebookStatusProjection.test.js`'s own tests, which assert the real service throws on a classroom with no `notebookConfig` while the duplicate safely returns an all-empty status. This is a deliberately better outcome for a legitimate edge case (a classroom never configured for notebooks gets an honest "no obligations" answer instead of an opaque failure) — not a security-relevant change, since the endpoint's own outer try/catch would have caught the real throw anyway (see Security Decision 10).

Neither client-side original (`workRequestService.js`, `notebookConfigService.js`) was changed to add the same guard — both are shared client-side files with their own callers, tests, and release process, outside this endpoint's own scope.

## Security Decisions

**1. Authentication (reused, unmodified).** `functions/src/learningHubAuth.js` verifies the bearer token against Learning Hub's own Firebase project via a separately-initialized Admin app, exactly as the Learner Identity Bridge already does. A missing, malformed, garbage, or wrong-project token fails closed with `401`, indistinguishable from one another in the response.

**2. Ownership (reused, unmodified).** `functions/src/learnerProfileOwnership.js`'s real, IAM-gated, cross-project check (impersonating `learning-hub-profile-verifier@classmate-302c2.iam.gserviceaccount.com` to call Learning Hub's `verifyLearnerProfileOwnership`) is used exactly as-is. This endpoint adds no second ownership mechanism and does not weaken or bypass the existing one. In this local dev/test sandbox (no Application Default Credentials configured), the real production default fails closed exactly as it does for `verifyLearnerConnection` today — proven directly by this endpoint's own "PRODUCTION DEFAULT" test, not merely assumed.

**3. `studentId` is resolved exclusively server-side, read fresh on every request.** It is never an accepted request field (rejected outright per decision 4 below), never cached, and never derived from anything but the live `learnerClassroomRelationships/{learnerProfileId}_{classroomId}` document's own `status === 'ACTIVE'` and `studentId` fields. A `PENDING` or `REVOKED` relationship — even one that already names a real `studentId` — is treated identically to "no relationship at all."

**4. Strict request-field allowlist.** The handler checks `Object.keys(body)` against the exact allowed set (`learnerProfileId`, `classroomId`) and rejects the request outright (400) if any other key is present — not just `studentId` specifically, any unrecognized field. This matches the Learner Identity Bridge's own "reject outright, don't silently strip" convention, so a caller cannot use response-behavior differences to probe whether an extra field is read.

**5. Defense in depth on the classroom binding.** Even though the relationship document's id is itself built from `(learnerProfileId, classroomId)`, the handler additionally checks `relationship.classroomId === classroomId` before trusting it — the same "don't trust structure alone" posture `verifyStudentCode()` already applies to its own code/classroom binding.

**6. Anti-oracle response shape.** Every domain-level failure past the 400/401 gates — unowned profile, missing relationship, non-ACTIVE relationship, classroom mismatch, missing classroom document, or an unexpected exception during projection — returns the identical `{ ok: false, error: 'obligations_unavailable' }` at `200`. A caller cannot learn *why* a request failed, only that it did.

**7. Response field minimization, enforced structurally and by test.** Every response object in the handler is built field-by-field from named constants and an explicit per-item allowlist (`toResponseItem()`) — never via object spread of Firestore-sourced data or of the projection's own internal item shape — so there is no code path by which a stray Firestore field, or the projection's own internal `id`/`checkpointId`/`requestId`, could leak into a response. The test suite proves this directly: a fixture seeded with extra junk fields (`secretInternalField`, `teacherNotes`, `internalAuditTrail`) is confirmed absent from the response, and the top-level success shape (`{ok, status}}`, with `status` containing exactly `{summary, items}` across all 5 bucket keys) and failure shape (`{ok, error}`) are each asserted to have *exactly* those keys, nothing more.

**8. `Cache-Control: private, no-store` on every response.** Set unconditionally in `functions/index.js`'s `onRequest` handler before the method check, so it applies to every status code this endpoint can ever return, including `405`. A response here can contain a real learner's notebook status; it must never be cached by any intermediary, CDN, or the caller's own HTTP stack.

**9. No logging of tokens, ids, or content.** Neither the handler nor the `index.js` glue logs `req.body`, the `Authorization` header, the verified uid, `learnerProfileId`, `classroomId`, `studentId`, or any status/obligation data — matching every other handler in this `functions/index.js` file, none of which log request content either.

**10. Fail-closed on unexpected exceptions — now exercised by a dedicated live-throw test, closing the previously-honest gap.** Three layers:
- `notebookObligationsProjection.js`'s `getEntryForStudent()` guards the known malformed-`entries` case (see "Why a duplicate" above).
- `notebookStatusProjection.js`'s `listSubjects()`/`listNotebookTypes()` guard the known missing-`notebookConfig` case (see "Why a duplicate" above).
- `functions/src/getNotebookObligationsForLearnerEndpoint.js` additionally wraps the entire classroom-data-access-plus-projection step in its own try/catch, returning the same `GENERIC_FAILURE` anti-oracle shape on **any** exception — not just the two known cases above. **This outer catch is now directly exercised by a dedicated test** (`tests/functions/getNotebookObligationsForLearnerEndpoint.test.js`, "a genuinely malformed classroom shape neither inner guard anticipates forces a real exception through the outer try/catch"): a classroom fixture with `notebookConfig.subjects` set to a non-array truthy value (a string) forces a real `TypeError` inside `getCheckpointsForStudentAcrossNotebooks()`'s own `.forEach()` call — past both inner guards, genuinely uncaught until this outer layer — and the test asserts the response is the identical `obligations_unavailable` generic failure, with no exception message, stack trace, or classroom content anywhere in the response body. The caught error itself is never logged (it could contain classroom contents).

## Invoker / Platform Configuration Review

`getNotebookObligationsForLearner` is declared `onRequest({ cors: false, invoker: 'public' })`, identical to `verifyLearnerConnection`. This was deliberately reviewed, not copy-pasted blindly:

- **Why `invoker: 'public'` is correct here, not a gap.** Cloud Run/Functions IAM answers "is the caller a specific, known Google Cloud identity?" — it has no concept of "a Learning Hub end user." Learning Hub's backend calling this endpoint is not itself a provisioned GCP service account ClassMate could allowlist via IAM (unlike the *reverse* direction — `learnerProfileOwnership.js` calling *into* Learning Hub — which does use a real, narrow IAM-gated service account, because that caller identity *does* exist and *was* provisioned). The actual, enforced security boundary for this endpoint is entirely inside `handleGetNotebookObligationsForLearnerRequest`: a verified Learning Hub ID token (step 1) and a verified ownership claim (step 3), both of which fail closed. `invoker: 'public'` only means "Cloud Run won't reject the HTTP connection before the function's own code runs" — it does not mean "unauthenticated."
- **No CORS.** `cors: false` and no `Access-Control-Allow-Origin` handling anywhere in this export — this is a server-to-server call from Learning Hub's own backend, never a browser directly.
- **No `serviceAccount` override.** This function keeps the project's normal default Cloud Functions runtime identity; the one cross-project outbound call inside `learnerProfileOwnership.js` already uses its own separate, narrowly-scoped impersonated identity for that single call only — unchanged, not touched by this endpoint.
- **No new IAM grant, credential, or service account was created for this task.** Everything this endpoint calls (`learningHubAuth.js`, `learnerProfileOwnership.js`) already exists and was already provisioned for the Learner Identity Bridge.

## Abuse-Control Posture (Initial)

- **The primary control is authentication, not rate limiting.** Every request to this endpoint already requires a real, verified Learning Hub ID token plus a passing cross-project ownership check before any Firestore read happens. An attacker without a genuine Learning Hub-issued token for a genuinely-owned `learnerProfileId` cannot reach the data-access path at all, regardless of request volume.
- **Bounded input.** `learnerProfileId`/`classroomId` are each capped at 200 characters and must be non-empty strings — oversized or malformed input is rejected with `400` before any Firestore access.
- **No new Firestore-backed rate limiter was added for this endpoint.** A deliberate, revisitable decision — the existing `rateLimiter.js` primitive could be reused here with a `uid`-keyed bucket later if real call volume warrants it.
- **Platform defaults only.** No `maxInstances` or `concurrency` override is set.
- **No data written anywhere by this endpoint.**

## Testing

Run against the Firestore + Auth emulators (`firebase emulators:start --only firestore,auth --project demo-classmate-bridge-test-endpoint` — this specific project id matters; see "Known Limitations" below):

```
node --test --test-concurrency=1 \
  tests/functions/learningHubAuth.test.js \
  tests/functions/learnerProfileOwnership.test.js \
  tests/functions/verifyLearnerConnectionEndpoint.test.js \
  tests/functions/getNotebookObligationsForLearnerEndpoint.test.js \
  tests/functions/notebookObligationsProjection.test.js \
  tests/functions/notebookStatusProjection.test.js \
  tests/models/learnerConnection.test.js
```

Or, for just this endpoint's own two projection files and its own endpoint suite:

```
node --test tests/functions/notebookStatusProjection.test.js tests/functions/notebookObligationsProjection.test.js
firebase emulators:exec --only firestore,auth --project demo-classmate-bridge-test-endpoint \
  "node --test tests/functions/getNotebookObligationsForLearnerEndpoint.test.js"
```

**Current totals** (all re-run fresh immediately before each push to PR #20):
- `tests/functions/notebookObligationsProjection.test.js` — **11/11** (unchanged from the original implementation)
- `tests/functions/notebookStatusProjection.test.js` — **11/11** (new)
- `tests/functions/getNotebookObligationsForLearnerEndpoint.test.js` — **30/30** (29 from the checkpoint-aware round + 1 new dedicated outer-try/catch exception test)
- Full shared-emulator run, including the pre-existing identity-bridge suites (`learningHubAuth`, `learnerProfileOwnership`, `verifyLearnerConnectionEndpoint`, `learnerConnection` model) — **105/105**

New coverage (`tests/functions/getNotebookObligationsForLearnerEndpoint.test.js`), beyond what's inherited unchanged from the original implementation (auth, request validation, ownership, relationship-state handling, response-schema allowlist, dependency contract):
- **CHECKPOINT-AWARE: a Bloom-Force-19-shaped classroom (checkpoint-tracked notebook, no WorkRequest at all) returns real checkpoint status**, not an empty result.
- **CHECKPOINT-AWARE: checkpoint tracking wins over a stale legacy obligation for the SAME notebook identity** — no double-count.
- **A genuinely malformed classroom shape neither inner guard anticipates forces a real exception through the outer try/catch** — the response is the identical `obligations_unavailable` generic failure, never the exception message, a stack trace, or classroom content.
- Response schema allowlist updated for the new `{summary, items}` shape, including proving `id`/`checkpointId`/`requestId`/`studentId` never leak from either checkpoint- or legacy-sourced items.

New coverage (`tests/functions/notebookStatusProjection.test.js`):
- Checkpoint-only, legacy-only, mixed (no collision), identity collision (checkpoint wins, proven exactly one item survives), zero-notebook classroom, and the one deliberate divergence from the real service (missing `notebookConfig` — see "Why a duplicate" above).

## Learning Hub integration status

**Client wiring now exists**, in two separate Learning Hub-side pull requests (tracked independently, not part of this PR):
- [bloomlabs-edu/learning-hub#6](https://github.com/bloomlabs-edu/learning-hub/pull/6) — the Learning Hub-side `getNotebookObligations` Cloud Function that calls this endpoint.
- [bloomlabs-edu/learning-hub#7](https://github.com/bloomlabs-edu/learning-hub/pull/7) — the "My Notebook" browser UI that calls that function. Depends on #6.

This endpoint has no effect on any real learner until all three PRs (this one plus both of the above) are merged **and deployed** — none of the three are deployed as of this writing.

## Known Limitations / What Was Not Done

- **Ownership verification's real-world behavior is still unproven beyond this sandbox.** The "PRODUCTION DEFAULT" test here proves the *fail-closed* guarantee in an environment with no Application Default Credentials — it does not and cannot prove the real cross-project IAM call succeeds in a genuine deployed environment. **Cross-project integration has not been proven end-to-end; only each side's own unit/emulator behavior has**, plus a comprehensive scratch integration scenario run during this feature's own pre-merge audit (16/16 checks, never committed to either repo — mentioned for context only, not part of this test suite).
- **No new abuse-specific rate limiter.** See "Abuse-Control Posture" above — a deliberate, documented, revisitable decision, not an oversight.
- **Not deployed.** `firebase deploy --only functions` was never run. `functions/node_modules` and the root-level `firebase-admin` devDependency exist purely to execute these tests locally — not part of what gets deployed.
- **This branch (`feature/notebook-status-integration`) is based on current `main`, not on the original `feature/notebook-obligations-api` branch**, which had diverged (missing `js/services/notebookStatusService.js`, added by an unrelated later PR). Confirmed via `git merge-tree` that merging the original branch would be conflict-free; nothing from it is lost — 3 of its 4 files are ported here byte-identical, the 4th (this endpoint) is extended, not replaced. The original branch should be considered superseded once this PR merges and is verified on `main`, not deleted before then.
- **A pre-existing test-environment quirk, unrelated to this endpoint:** the Firestore + Auth emulator pair must be started with `--project demo-classmate-bridge-test-endpoint` for `learningHubAuth.test.js`/`verifyLearnerConnectionEndpoint.test.js` to pass (their own token-minting fixtures are tied to that literal project id).
