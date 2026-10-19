# Learner Identity Bridge — Adversarial Security Review (E1/E4)

**Status: review only, nothing implemented.** No application code,
Firestore rule, Firestore data, authentication configuration, UI, or
deployment configuration was created or modified to produce this
document. This reviews the E1/E4 bridge design from
`docs/architecture/STUDENT_PROFILE_MIGRATION_PROPOSAL.md` against 20
adversarial scenarios, then the token design and caller-authentication
mechanism in full technical detail.

---

## A. Security review — 20 scenarios

Format per scenario: threat / current proposed protection / remaining
vulnerability / required mitigation / required before Phase 2? /
deferrable?

### 1. Attacker obtains a valid invitation token
- **Threat:** whoever possesses the raw token can redeem it, linking
  their own account to a learner that may not be theirs.
- **Current protection:** short lifetime, single-use.
- **Remaining vulnerability:** possession alone is sufficient —
  nothing binds redemption to an *expected* recipient.
- **Required mitigation:** short lifetime + single-use bounds the
  exposure window (already proposed); add a teacher-visible
  notification the moment a token is redeemed, so an unexpected
  redemption is *detectable* quickly, plus a fast revocation path
  (E3's revocation mechanism) to recover from it.
- **Required before Phase 2:** short-lived/single-use, yes.
- **Deferrable:** the redemption-notification enhancement, yes —
  detection/recovery, not prevention.

### 2. Attacker guesses or enumerates invitation tokens
- **Threat:** brute-force or systematic enumeration against the
  verification endpoint.
- **Current protection:** high-entropy token (see §Token Design).
- **Remaining vulnerability:** entropy alone doesn't stop an endpoint
  being hammered as a guessing oracle over a long enough time.
- **Required mitigation:** rate limiting per caller identity and
  globally on the verification function; note the true exposure here
  is bounded further than it first appears, since only Learning Hub's
  one authenticated backend identity can call this function at all
  (see §C caller authentication) — an *external* attacker cannot reach
  it directly regardless of guesses.
- **Required before Phase 2:** entropy + basic rate limit, yes.
- **Deferrable:** advanced anomaly detection, yes.

### 3. Same token submitted concurrently from two Learning Hub sessions
- **Threat:** a race where both requests observe the token as
  still-valid and both attempt to redeem it.
- **Current protection:** single Firestore transaction performing
  read-check-flip atomically.
- **Remaining vulnerability:** none, provided redemption is genuinely
  one transaction — the vulnerability exists only if a future
  implementation splits the check and the write into separate calls.
- **Required mitigation:** mandate (not merely recommend) a single
  transaction; add a concurrency test that fires two simultaneous
  redemption attempts and asserts exactly one succeeds.
- **Required before Phase 2:** yes.
- **Deferrable:** no.

### 4. Same token submitted repeatedly after successful redemption
- **Threat:** replay after legitimate use.
- **Current protection:** `status` flips to a terminal `redeemed`
  state.
- **Remaining vulnerability:** without an idempotency key, a
  *legitimate* retry (e.g. a dropped response) looks identical to a
  malicious replay and gets the same rejection — safe, but a confusing
  failure mode for real users (this is scenario 14's concern in
  miniature).
- **Required mitigation:** reject all post-redemption replays by
  default; layer an idempotency key (§Token Design) so the *original*
  caller's own retry returns the original success result instead of an
  error.
- **Required before Phase 2:** rejection, yes; idempotency key,
  strongly recommended for Phase 2 (flaky networks are common, not an
  edge case).
- **Deferrable:** no, for the core rejection behavior.

### 5. Token is intercepted before redemption
- **Threat:** a token is captured in transit or via the delivery
  channel before the intended recipient uses it.
- **Current protection:** TLS in transit; short lifetime bounds
  exposure.
- **Remaining vulnerability:** entirely dependent on the delivery
  channel, which this proposal has not yet chosen. Note this
  organization's data rules already rule out SMS delivery (no phone
  numbers may be collected), which narrows realistic options toward
  in-person display (e.g. a QR code shown directly to the parent,
  scanned on the spot) over any message-transport channel.
- **Required mitigation:** choose and review a specific delivery
  channel before implementation — this is listed as an open decision
  in §D, not resolved by this review.
- **Required before Phase 2:** the delivery-channel decision itself,
  yes.
- **Deferrable:** hardening beyond TLS + short lifetime for whichever
  channel is chosen can be iterative.

### 6. Token expires during redemption
- **Threat:** a token is valid when the request starts but expires
  before the write commits (a time-of-check/time-of-use gap).
- **Current protection:** expiry must be checked *inside* the same
  transaction as the redemption flip, against server time only.
- **Remaining vulnerability:** exists only if expiry were (incorrectly)
  checked in application code before the transaction opens, or against
  a client-supplied timestamp.
- **Required mitigation:** mandate the expiry check happens inside the
  transaction, using the server's own clock exclusively.
- **Required before Phase 2:** yes.
- **Deferrable:** no.

### 7. Learning Hub backend is compromised
- **Threat:** an attacker with full control of Learning Hub's backend
  can call the verification function using its legitimate credentials.
- **Current protection:** the function still requires a real,
  unexpired, unused token — a compromised backend cannot manufacture
  new valid tokens, only abuse ones it can guess or has already seen.
- **Remaining vulnerability:** a compromised backend inherits all of
  Learning Hub's own legitimate calling privileges — a boundary that
  cannot be fully eliminated from ClassMate's side, only bounded.
- **Required mitigation:** scope the shared service account's IAM
  invoker binding to *only* this one function (least privilege, so a
  compromised backend can't pivot to other ClassMate resources); rate
  limit and monitor for unusual call volume even from this authorized
  identity; maintain a fast IAM-revocation runbook as an incident
  response action.
- **Required before Phase 2:** least-privilege IAM scoping and basic
  rate limiting, yes.
- **Deferrable:** sophisticated anomaly-detection tooling, yes.

### 8. ClassMate verification function is called directly by an untrusted client
- **Threat:** a browser, script, or `curl` calls the function URL
  directly, bypassing Learning Hub's backend entirely.
- **Current protection:** the function is deployed *without*
  unauthenticated invocation allowed; GCP IAM rejects any request
  lacking a valid, audience-matched, Google-signed identity token from
  the one authorized service account, at the platform level, before
  any application code runs.
- **Remaining vulnerability:** none, provided the deployment is
  genuinely authenticated-only and the IAM binding is correctly scoped
  — this closes the entire threat class at the infrastructure layer.
- **Required mitigation:** verify (and gate releases on) the
  authenticated-only deployment configuration explicitly; this is a
  deployment-configuration fact to confirm, not application logic to
  write.
- **Required before Phase 2:** yes, foundational.
- **Deferrable:** no.

### 9. A caller attempts to use a valid token for a different learner/classroom
- **Threat:** a request tries to associate a real token with a
  `classroomId`/`studentId` other than the one it was actually issued
  for.
- **Current protection:** `classroomId`/`studentId` must be derived
  *exclusively* from the token document's own stored fields, looked up
  server-side by the token's hash — never accepted as client input at
  all.
- **Remaining vulnerability:** none if the contract genuinely has no
  input parameter for these fields; a vulnerability would exist only if
  a future implementation ever trusted a client-supplied value for
  either.
- **Required mitigation:** the function's request contract accepts
  only the token itself; `classroomId`/`studentId` exist solely in the
  response, never the request.
- **Required before Phase 2:** yes.
- **Deferrable:** no.

### 10. A malicious Learning Hub client attempts to fabricate classroomId/studentId
- Same protection and reasoning as scenario 9 — if the request schema
  has no field for these values, there is nothing to fabricate.
- **Required before Phase 2:** yes. **Deferrable:** no.

### 11. Learning Hub sends a valid-looking but forged verification request
- **Threat:** a request with the correct shape but not resulting from
  a genuine end-user redemption attempt (e.g. an internal Learning Hub
  bug, or a confused-deputy scenario within Learning Hub's own
  backend).
- **Current protection:** caller authentication (§C) proves *who* is
  calling; transactional token verification proves *whether* the
  presented token is genuine and currently valid. Together: "this call
  is authentically from Learning Hub's backend, presenting a real,
  still-valid token."
- **Remaining vulnerability:** ClassMate cannot verify *which*
  Learning-Hub end-user or session actually initiated the call — that
  trust is delegated entirely to Learning Hub's own backend being
  correctly implemented.
- **Required mitigation:** document this trust boundary explicitly as
  an accepted limitation of "verify at the edge," not a gap to close
  with more ClassMate-side engineering. Learning Hub's own backend is
  responsible for only calling this function on behalf of a genuine,
  authenticated end-user action.
- **Required before Phase 2:** documenting the boundary, yes.
- **Deferrable:** n/a — nothing further is appropriate for ClassMate to
  build here.

### 12. ClassMate roster membership changes between invitation issuance and redemption
- **Threat:** a teacher moves or removes the student between issuing
  the token and it being redeemed.
- **Current protection:** none specified in the original proposal —
  only the token's own validity was checked, not whether the roster
  fact it describes is still true.
- **Remaining vulnerability:** a redemption could otherwise succeed
  and create a Classroom Membership pointing at a stale or inaccurate
  `(classroomId, studentId)` pair.
- **Required mitigation:** inside the same redemption transaction, also
  re-verify the student still exists inside
  `classrooms/{classroomId}.teams[].students[]` — the same
  stale-session revalidation *pattern* the audit already found this
  codebase using elsewhere (`StudentDeviceFlow.js`), applied here
  rather than invented fresh.
- **Required before Phase 2:** yes.
- **Deferrable:** no.

### 13. Student record is deleted/archived between issuance and redemption
- Same class of problem as 12, more extreme (student gone entirely,
  not merely moved). Same mitigation: re-check existence at redemption
  time, inside the transaction, fail closed with a generic rejection.
- **Required before Phase 2:** yes. **Deferrable:** no.

### 14. Network retry causes the same redemption request to execute more than once
- **Threat:** Learning Hub's backend retries a request that actually
  already succeeded server-side (e.g. after a timeout on the response).
- **Current protection:** the transactional single-use flip prevents
  any double *effect* regardless of retries.
- **Remaining vulnerability:** without an idempotency key, a genuine
  retry is indistinguishable from an attack replay and gets rejected —
  safe, but confusing for a legitimate caller in exactly the flaky-network
  conditions retries exist to handle.
- **Required mitigation:** Learning Hub supplies a client-generated
  idempotency key per redemption attempt; if a request with the same
  key already completed successfully, return the original result again
  rather than an "already redeemed" error.
- **Required before Phase 2:** the safety property (no double-effect)
  is required now; the idempotency key is strongly recommended now
  rather than added later, given how common network retries are in
  practice.
- **Deferrable:** the idempotency-key UX refinement could technically
  follow shortly after, but is cheap enough to include from day one.

### 15. Two different accounts attempt to redeem the same token
- **Threat:** a token shared or forwarded between two different real
  accounts, both attempting to redeem it.
- **Current protection:** identical to 3/4 — first transaction to
  commit wins; the second sees a non-active status and is rejected.
- **Remaining vulnerability:** none technically; the open question is a
  *product* one (per E3): if two guardians genuinely both need access,
  the intended path is the first to link, then use the Account↔Learner
  linking flow to add the second — never sharing one raw token between
  two people.
- **Required mitigation:** document the intended one-token behavior so
  support/product understands the expected "the code didn't work for
  my spouse" report, and points them at the correct (E3) flow instead.
- **Required before Phase 2:** the enforcement is already covered by
  3/4's mitigations; the documentation is a light addition worth doing
  now.
- **Deferrable:** the documentation only, and only barely.

### 16. A teacher accidentally issues multiple tokens for the same student
- **Threat:** clicking "generate invitation" more than once produces
  several simultaneously-valid tokens for one student.
- **Current protection:** none specified.
- **Remaining vulnerability:** not itself exploitable (each token still
  only redeems once), but increases outstanding-secret exposure and
  creates confusion about which code is current.
- **Required mitigation:** generating a new token for a student should
  invalidate any previous still-active token for that same student —
  mirrors the existing `generatePinForStudent`'s own already-established
  "overwrite any existing one" behavior (per the audit), applied to the
  new token type for consistency.
- **Required before Phase 2:** recommended, not blocking — the
  underlying redemption mechanism is safe regardless.
- **Deferrable:** yes — a hygiene/UX improvement, not a closable
  vulnerability.

### 17. Verification function leaks whether arbitrary tokens exist
- **Threat:** distinguishable responses ("not found" vs. "expired" vs.
  "already used") let a caller use the endpoint as an oracle, aiding
  scenario 2.
- **Current protection:** a single, uniform, generic error for every
  failure category.
- **Remaining vulnerability:** subtler channels remain possible in
  principle — response timing differences, or a future code change
  that adds a more specific error message without realizing the
  implication.
- **Required mitigation:** enforce identical response shape and message
  for every failure reason at the API-contract level (not just by
  convention); log the specific reason only server-side, never in the
  response.
- **Required before Phase 2:** yes, for uniform responses.
- **Deferrable:** timing-side-channel hardening beyond what a single
  document lookup naturally provides — low priority given the already
  narrow exposure (only Learning Hub's authenticated backend can reach
  this endpoint at all).

### 18. Logs accidentally contain invitation tokens or sensitive learner information
- **Threat:** verbose logging captures the raw token or excess learner
  data, becoming a leak vector independent of the function's own access
  controls.
- **Current protection:** the token design (§Token Design) already
  specifies the raw token is never persisted and never logged.
- **Remaining vulnerability:** a future code change (a generic error
  handler logging a full request body, a debug statement left in)
  could reintroduce this by accident — a process risk, not purely an
  architecture one.
- **Required mitigation:** an explicit, written logging policy for this
  function specifically: never log full request bodies; log only the
  token document's id/hash-prefix, never the raw secret; treat this the
  same way this organization's own existing data rules already treat
  other sensitive fields. Add it as a named code-review checklist item
  for this function, since it is the one place a high-value secret
  legitimately passes through the system.
- **Required before Phase 2:** yes — cheap to get right up front,
  expensive to fix after a leak.
- **Deferrable:** no.

### 19. Learning Hub's frontend attempts to bypass its backend and call ClassMate directly
- **Threat:** the browser (Learning Hub's own client code, or anyone
  inspecting it) tries to call the verification function directly.
- **Current protection:** identical to scenario 8 — authenticated-only
  deployment requiring a Google-signed OIDC token minted for a specific
  GCP service account that only Learning Hub's *backend* holds
  credentials for. A browser has no access to that service account's
  credentials and cannot mint a valid token for it.
- **Remaining vulnerability:** none, structurally — this is scenario
  8 viewed from the frontend angle specifically, which changes nothing
  about the mitigation.
- **Required mitigation:** same as 8; additionally, explicitly: no API
  key or any client-embeddable credential should ever exist for this
  function — anything embedded in frontend code is extractable by any
  user of that frontend, by definition.
- **Required before Phase 2:** yes.
- **Deferrable:** no.

### 20. ClassMate verification service becomes unavailable
- **Threat:** the function is unreachable (deploy issue, outage, quota)
  exactly when a family is trying to link.
- **Current protection:** none specified in the original proposal —
  an availability gap, not a security one.
- **Remaining vulnerability:** without a defined behavior, Learning Hub
  might retry aggressively (compounding scenario 14) or fail in a way
  that reads as "your code is invalid" when it's actually "the service
  is down" — actively misleading, since a family might discard a
  perfectly valid, unused token believing it failed.
- **Required mitigation:** Learning Hub's backend must distinguish
  verification *rejections* (4xx — "this token is invalid/expired/used")
  from *unavailability* (5xx/timeout — "try again shortly"), retrying
  the latter with bounded backoff and surfacing a clearly different
  message to the family. ClassMate's function should be deployed with
  reasonable scaling limits and basic uptime monitoring.
- **Required before Phase 2:** the rejection-vs-unavailability
  distinction in Learning Hub's own error handling, yes.
- **Deferrable:** formal SLA/monitoring tooling can be phased in.

---

## B. Revised bridge contract requirements

Consolidating the above into the actual contract (supersedes the
short description in the original proposal's §D):

### Token design

- **Entropy:** minimum 128 bits, **256 bits (32 random bytes) from a
  CSPRNG recommended**, encoded base64url for safe embedding (e.g. in a
  QR code). This is deliberately **not** the existing 6-digit numeric
  PIN design — a 6-digit PIN (~20 bits) is adequate for the *existing*,
  lower-stakes, same-session device-approval use case it was built for,
  but is not appropriate as the credential behind a durable,
  cross-product identity link, which is a materially higher-stakes
  operation. **Recommendation: the bridge accepts only the high-entropy
  invitation-token path, not the PIN path, for this specific purpose.**
- **Lifetime:** short — **15 minutes recommended** for an interactive
  "redeem now, in front of the teacher" flow. The existing
  `generateInvitationTokenForStudent`'s default 7-day expiry (found in
  the audit) must **not** be inherited for this use case without an
  explicit decision to do so; a multi-day window is appropriate only if
  the product flow genuinely requires asynchronous redemption (e.g. "take
  this home"), and that tradeoff should be made deliberately, not by
  default.
- **Raw token persistence:** **never.** Only a salted hash (e.g.
  SHA-256) of the token is persisted, exactly analogous to password
  storage. The raw token exists only transiently: generated
  server-side, handed to the issuing teacher's client or embedded in a
  QR code, and never written to Firestore in raw form.
- **Redemption transaction (exact):**
  1. Caller (Learning Hub backend) sends the raw token + a client-
     generated idempotency key.
  2. The function computes the hash server-side and looks up the token
     document by that hash — never trusts a client-supplied hash.
  3. Within a single Firestore transaction: read the document, confirm
     `status == 'active'` and `expiresAt > <server time>`, re-verify the
     student still exists in the live classroom roster (closes 12/13),
     then atomically set `status = 'redeemed'`, `redeemedAt`, and the
     idempotency key used.
  4. Only after the transaction commits does the function return the
     verified `{classroomId, studentId}`.
  5. Any failure at any step aborts the transaction with no partial
     state change, and returns the single uniform error response.
- **Post-redemption state:** `status: 'redeemed'` is terminal and
  immutable thereafter — never deleted (deletion would erase the audit
  trail and risk hash-collision reuse) and never reset to `active`.
- **Replay behavior:** any request presenting an already-`redeemed`
  token is rejected with the same generic error as an invalid token —
  *unless* it carries the exact idempotency key of the original
  successful request, in which case the original result is returned
  again, not an error.
- **Rate limiting:** per-caller-identity and global request-rate limits
  on the verification function; alerting on abnormal volume even from
  the one authorized caller identity (defends scenario 7).
- **Error-message behavior:** exactly one generic error message and
  response shape for every failure category (invalid, expired,
  already-used, roster-mismatch) — the caller is never told *which*.
  Specific reasons are recorded server-side only.
- **Audit-log contents:** timestamp, caller identity (the service
  account, never anything end-user-identifying from the caller side),
  the token document's id (hash-based, never the raw token),
  `classroomId`/`studentId` (already non-secret ClassMate reference ids
  per the original architecture audit), and success/specific-failure
  category. Never: the raw token, never contact information, never
  anything beyond what ClassMate already legitimately holds about its
  own roster.

### Caller authentication — exact mechanism

**Not** "App Check" — App Check attests that a request comes from a
genuine instance of a *client* app (browser/mobile), which is the wrong
tool for a backend-to-backend call and would be a category error here.

**The mechanism:** Google Cloud IAM-based, service-to-service OIDC
identity-token authentication —
1. The ClassMate verification function is deployed **without**
   allowing unauthenticated invocation.
2. A **dedicated, single-purpose GCP service account** is created
   specifically for this integration (e.g.
   `learning-hub-classmate-bridge@<learning-hub-project>.iam.gserviceaccount.com`)
   — not a reuse of Learning Hub's general backend identity, per
   least privilege.
3. That service account is granted `roles/cloudfunctions.invoker` (or
   `roles/run.invoker`, depending on the runtime) **on this one
   function only** — nothing else in ClassMate's project.
4. On each call, Learning Hub's backend obtains a short-lived,
   Google-signed **OIDC identity token** for that service account, with
   `audience` set to the exact target function URL, and sends it as
   `Authorization: Bearer <token>`.
5. Google Cloud's platform verifies the token's signature, audience,
   and IAM binding **before the request reaches any application code**
   — this cannot be forged without possessing that service account's
   own credentials, which a browser can never obtain.
6. As defense-in-depth, the function's own code additionally checks the
   verified token's `email`/`sub` claim matches the exact expected
   service-account identity, rather than trusting "any authenticated
   caller in the project."
7. **No static API key or shared secret** should ever exist for this
   integration — a long-lived string is inherently more leak-prone than
   a short-lived, platform-issued, automatically-rotated identity
   token, and this design needs no manually managed secret on either
   side.

This directly and structurally satisfies "the browser must never be
considered an authorized service caller": a browser cannot mint a
valid OIDC token for a service account it doesn't control, regardless
of what URL it knows.

---

## C. Exact implementation prerequisites

Before any of this is built:
1. A dedicated GCP service account for Learning Hub → ClassMate calls,
   with `invoker` scoped to the one bridge function only.
2. The bridge function itself, deployed authenticated-only, in
   ClassMate's project (per E4), implementing the exact redemption
   transaction in §B.
3. A decided token delivery channel (open decision, §D) reviewed for
   its own interception risk.
4. An explicit, written no-raw-token-logging policy, enforced as a
   code-review checklist item for this function.
5. A decided token lifetime appropriate to the chosen delivery channel
   (15 minutes for interactive redemption; a longer, explicitly
   justified window only if asynchronous redemption is a real product
   requirement).
6. A rate-limiting configuration on the function (per-identity and
   global).
7. A concurrency test (simulating scenario 3) and a stale-roster test
   (simulating scenarios 12/13) as required test coverage before this
   ships, not optional hardening added later.
8. Learning Hub's own backend implementing the rejection-vs-
   unavailability distinction (scenario 20) and idempotency-key retry
   behavior (scenarios 4/14).

---

## D. Remaining open decisions

1. **Token delivery channel** (scenario 5) — how does the raw token
   actually reach the intended parent/guardian? In-person QR display is
   the leading candidate given this organization's data rules already
   preclude SMS; this review does not choose the channel, only flags it
   as a prerequisite decision with its own interception-risk review.
2. **Exact token lifetime** for the chosen channel — 15 minutes is
   recommended for an interactive flow; a longer window is only
   appropriate if asynchronous redemption is a genuine product
   requirement, and that tradeoff should be made explicitly, not
   inherited from the existing (7-day) invitation-token default.
3. **Whether PIN-based redemption is ever permitted for this bridge at
   all** — this review's recommendation is no, the bridge should accept
   only the high-entropy token path; if there's a product reason to
   also support the lower-entropy PIN path here, that needs its own,
   separate risk acceptance, not an inherited assumption from the
   existing PIN feature's original, lower-stakes use case.
4. **Teacher-facing redemption notification** (scenario 1) — a
   detection/recovery layer this review recommends but does not mandate
   before Phase 2; needs a product decision on whether and how it's
   surfaced.
5. **Whether "invalidate prior tokens on re-issuance"** (scenario 16) is
   adopted — recommended hygiene, not blocking, needs confirmation it's
   in scope for the initial build or a fast-follow.

**This is a review only. Nothing has been implemented.**
