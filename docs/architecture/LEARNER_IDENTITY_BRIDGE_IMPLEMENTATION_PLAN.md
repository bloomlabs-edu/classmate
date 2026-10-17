# Learner Identity Bridge — Implementation Plan

**Status: implementation DESIGN only. Nothing built.** No application
code, Firestore rule, Firestore document, Cloud Function, authentication
configuration, or deployment was created or modified to produce this
document. This plan is strictly downstream of, and consistent with, the
15 locked decisions in `LEARNER_IDENTITY_BRIDGE_CONTRACT.md` and the
token/caller-authentication design already approved in
`STUDENT_PROFILE_BRIDGE_SECURITY_REVIEW.md`. Where this plan repeats a
value from that review (token entropy, lifetime, transaction shape), it
is restated here as the concrete, locked design choice, not re-derived
from scratch.

Every value chosen below is explained, not asserted. Where a value is
still genuinely open (delivery channel, exact rate-limit thresholds), it
is marked **OPEN** rather than guessed.

---

## A. ClassMate side

### A.1 Two separate concerns, not one function

Per the contract's ownership boundary (§23), ClassMate has **two**
distinct jobs, only one of which crosses the project boundary:

1. **Invitation creation** — entirely internal to ClassMate, performed
   by an already-authenticated teacher, through ClassMate's existing
   client. **No Cloud Function needed.**
2. **Invitation verification** — the one operation Learning Hub's
   backend calls into ClassMate for. **This is the only Cloud Function
   in this design.**

### A.2 Invitation creation mechanism

- A new client-side service, `services/classroomLinkInvitationService.js`
  (a fresh module — explicitly **not** `enrollmentService.js`, which
  stays untouched and unreachable per Decision 6).
- The teacher's own already-authenticated browser:
  1. Generates a raw token client-side via `crypto.getRandomValues()`
     (Web Crypto, available in every browser this app already targets).
  2. Computes `tokenHash = SHA-256(rawToken)` client-side via
     `crypto.subtle.digest()`.
  3. Writes **only** `{classroomId, studentId, tokenHash, expiresAt,
     status: 'active', createdAt, createdByUid}` to Firestore, at
     `classroomLinkInvitations/{tokenHash}` (top-level collection —
     required so the verification function can look it up knowing only
     the token, without already knowing `classroomId`; a structural
     necessity `enrollmentTokens/{token}`'s original top-level shape
     also had, not a reuse of that collection or its code).
  4. The raw token is displayed to the teacher (e.g. as a QR code — see
     §A note on delivery) and **never sent to any server**, closing the
     "raw token in a request log" risk at the moment of creation, not
     just at redemption.
- Rule requirement (design only, not implemented here): `create` is
  allowed only if `request.auth.uid in
  get(classrooms/$(classroomId)).data.memberUids` — the exact same
  membership check every other teacher-authored write in this codebase
  already uses (§7 of the contract).

### A.3 Token generation, storage, hashing

- **Raw token:** 256 bits (32 bytes) from `crypto.getRandomValues()`,
  base64url-encoded for QR/URL-safety. (Full rationale in §E.)
- **Storage:** hash-only. `classroomLinkInvitations/{tokenHash}` stores
  the SHA-256 hash as its own document ID; the raw token is never
  written to Firestore, never logged, in either the creation or
  verification path.
- **Hashing:** SHA-256, computed identically on both ends (client-side
  `SubtleCrypto` at creation, Node's `crypto` module inside the
  verification Cloud Function at redemption) — deterministic, so the
  same raw token always resolves to the same document.

### A.4 Token expiry

**15 minutes**, matching the security review's recommendation for an
interactive "redeem now, in front of the teacher" flow. Not inherited
from the old `generateInvitationTokenForStudent`'s 7-day default — that
value belonged to a lower-stakes feature and is explicitly not carried
forward (security review §D).

**OPEN:** the actual delivery channel (QR display vs. something
asynchronous) is still undecided (contract-carried-over open decision).
15 minutes assumes an interactive, in-person redemption; if an
asynchronous channel is ever chosen instead, this value must be
revisited explicitly, not silently inherited.

### A.5 Single-use state

`status: 'active' | 'redeemed' | 'revoked'` on the invitation document.
`'revoked'` exists so a teacher can explicitly cancel an outstanding
invitation (e.g. issued to the wrong student) without waiting for
natural expiry — a narrow, additive capability, not required by the
locked decisions but cheap to include from the start since it's the
same field either way. Expiry itself is **computed** at verification
time from `expiresAt`, never a separately stored status value.

### A.6 Redemption transaction (exact)

Single Firestore transaction, inside the verification Cloud Function:
1. Compute `tokenHash` from the caller-supplied raw token.
2. `get(classroomLinkInvitations/{tokenHash})`. Not found → generic
   failure.
3. Check `status == 'active'` and `expiresAt > <server time>`. Either
   false → generic failure.
4. Re-`get(classrooms/{classroomId})` (same transaction) and confirm
   `studentId` still exists in `teams[].students[]`. Not found →
   generic failure ("roster changed since issuance").
5. Set `status = 'redeemed'`, `redeemedAt`, `redemptionIdempotencyKey`.
6. Commit.
7. Return `{classroomId, studentId}` only on a successful commit.

Every check happens **inside** the transaction, against **server**
time and the **live** roster — closing the TOCTOU gaps identified in
the security review (scenarios 6, 12, 13).

### A.7 Replay protection

- After step 5 above, any further redemption attempt for the same
  `tokenHash` sees `status == 'redeemed'` and is rejected with the same
  generic failure.
- **Exception:** if the incoming request's `idempotencyKey` exactly
  matches the stored `redemptionIdempotencyKey`, the function returns
  the original success result again, rather than an error — this is
  what makes a legitimate network retry (§H, §I) safe and
  non-confusing, distinct from an actual replay/attack attempt.

### A.8 Rate limiting

Two independent layers:
- **Platform-level:** Cloud Functions/Cloud Run concurrency and
  max-instance limits, capping total throughput regardless of caller
  intent.
- **Application-level:** a per-caller-identity request counter (the
  caller identity is always the one dedicated service account, §A.10)
  with alerting on abnormal volume — defends against a compromised
  Learning Hub backend (security review scenario 7), not against a
  broad population of attackers, since no one else can call this
  function at all (§A.10).
- **OPEN:** exact numeric thresholds — a policy/ops decision, not an
  architectural one; not chosen here.

### A.9 Caller authentication — exact mechanism (not "App Check/IAM")

Restated precisely, matching the already-approved security review:
1. The function is deployed **without** `--allow-unauthenticated`.
2. A **dedicated** GCP service account exists solely for this
   integration (e.g.
   `learning-hub-classmate-bridge@<learning-hub-project>.iam.gserviceaccount.com`),
   never Learning Hub's general backend identity.
3. That service account is granted `roles/cloudfunctions.invoker` (or
   `roles/run.invoker`) **on this one function only**.
4. Learning Hub's backend mints a short-lived, Google-signed **OIDC
   identity token** for that service account, `audience` set to the
   exact function URL, sent as `Authorization: Bearer <token>`.
5. Google Cloud verifies signature, audience, and IAM binding **before
   any application code runs**.
6. The function additionally checks the token's `email`/`sub` claim
   matches the exact expected service account (defense-in-depth beyond
   the platform-level check).
7. **No API key, no static shared secret, ever.**

**App Check is explicitly not used here** — it attests client-app
instances (browser/mobile), which is the wrong tool for a
backend-to-backend call and would be a category error for this hop.
This mechanism structurally guarantees the browser can never be an
authorized caller: it cannot obtain or mint credentials for the
dedicated service account, full stop.

### A.10 Exact verification response

- **Malformed request** (missing/wrong-shaped token field — a caller
  bug, not a token-validity question, and the caller's identity is
  already IAM-verified before this check runs): HTTP 400, body
  `{ error: 'malformed_request' }`.
- **Any token-validity failure** (not found, expired, already redeemed,
  roster no longer valid): HTTP 200, body
  `{ ok: false, error: 'verification_failed' }` — one message for
  every category, per the anti-oracle requirement (security review
  §17).
- **Success:** HTTP 200, body
  `{ ok: true, classroomId, studentId }` — nothing else.

### A.11 Audit logging

Structured Cloud Logging entries (not a Firestore collection — logging
infrastructure is the right tool, and avoids inventing a log-shaped
Firestore collection with its own rules to secure): timestamp, caller
identity (the verified service-account claim), `tokenHash` (never the
raw token), `classroomId`/`studentId` once resolved (already
non-secret ClassMate reference ids, per the architecture audit),
`idempotencyKey`, and outcome — **specific** failure reason logged only
here, never returned to the caller (§A.10).

### A.12 Failure/error responses

Summarized: uniform generic responses to the caller (§A.10);
detailed, specific reasons in server-side logs only (§A.11); no
distinguishing signal of any kind (timing, shape, status code beyond
the 400/200 split above) between "token never existed," "expired,"
"already used," or "roster changed."

---

## B. Learning Hub side

All four collections live in **Learning Hub's own Firebase project**,
per the contract's ownership boundary (§23) — none of this is proposed
to live in ClassMate's project.

### B.1 `accounts/{uid}`

- **Doc ID:** the Firebase Auth UID directly (Learning Hub's own
  project) — mirrors the `MembershipLink`-generalized principle of
  "doc ID is the identity being checked" (contract §25).
- **Fields:**
  - `learnerProfileIds: string[]` — denormalized cache of currently
    linked, active Learner Profile ids, for a single listless read.
  - `lastActiveLearnerProfileId: string | null` — UX convenience only,
    never used for authorization.
  - `createdAt`.
- **Source of truth for the relationship itself is `learnerAccountLinks`
  (B.3), not this array** — this array is a read-optimization, kept in
  sync whenever a link is created/revoked.

### B.2 `learnerProfiles/{learnerProfileId}`

- **Doc ID:** freshly generated (Firestore auto-id is sufficient — no
  requirement that it be derived from anything else).
- **Fields — exactly the four locked in Decision 14, no more:**
  `displayName`, `avatarRef`, `createdAt`, `createdVia` (`'classmate-link'
  | 'independent-signup'`).
- No date of birth, grade, language, or any other field — consistent
  with the locked minimal schema and this organization's own
  AI-Working-Committee-review requirement for any future addition.

### B.3 `learnerAccountLinks/{uid}_{learnerProfileId}`

- **Doc ID:** the composite `${uid}_${learnerProfileId}` — deterministic
  and directly computable by a rule from values already known
  (`request.auth.uid` and a client-supplied `learnerProfileId`),
  enabling a single `get()`, never a query, to check "does this uid
  have an active link to this learner" (contract §25 principle #2).
- **Fields:**
  - `uid`, `learnerProfileId` (denormalized onto the document itself,
    even though both are derivable from the doc ID, so rules and
    reads never need to parse the ID string).
  - `role: 'guardian' | 'self'`.
  - `status: 'active' | 'revoked' | 'pending'` — **`'pending'` is
    included in the enum now, unused by any code path in this phase**,
    specifically so Decision 12's "must remain capable of future
    consent-gated linking" is satisfied without a schema migration
    later. Nothing in this implementation phase ever sets a link to
    `'pending'`.
  - `linkedAt`, `linkedVia: 'invitation-redemption' | 'independent-signup'`.
  - `notifiedExistingLinksAt: timestamp | null` — records whether the
    Decision 11 notify-only obligation has been fulfilled for this
    link (B.6).
- This is genuinely **many-to-many** (Decision 10): one `uid` may have
  several `learnerAccountLinks` docs (different `learnerProfileId`
  suffixes); one `learnerProfileId` may equally appear in several
  different accounts' link docs.

### B.4 `learnerClassroomMemberships/{learnerProfileId}_{classroomId}`

- **Doc ID:** composite `${learnerProfileId}_${classroomId}` — same
  reasoning as B.3: a rule checking "is this learner linked to this
  classroom" computes this ID directly from values already known
  (a client-supplied `learnerProfileId` it has already verified
  ownership of via B.3, plus the `classroomId` being accessed) and
  performs one `get()`.
- **Fields:**
  - `learnerProfileId`, `classroomId`, `studentId`.
  - `status: 'active' | 'ended'` — **not** immutable-forever (Decision
    13's explicit departure from `MembershipLink`'s own permanent-link
    semantics; required so revocation is possible at all).
  - `verifiedAt`, `verifiedVia: 'classmate-invitation'`.
  - `linkedByUid` — which account performed the linking action
    (audit only, never an authorization input).

### B.5 Indexes

The security-critical read paths (§C) are all single-document `get()`s
by a deterministic, precomputed ID — **no composite index is required
for rule enforcement.** One composite index is a genuine UI convenience,
not a security requirement: `learnerClassroomMemberships` on
(`learnerProfileId ASC, status ASC`), to let Learning Hub's own UI
query "all of this learner's currently active classrooms" in one call
rather than fetching all and filtering client-side. Whether this index
is added is an implementation-detail choice, not an architectural one.

### B.6 Creation flow (Account + Learner Profile)

1. Parent/guardian signs into Learning Hub with Google → `accounts/{uid}`
   is created on first sign-in if absent (empty `learnerProfileIds`).
2. First-ever learner for this account (or an "independent learner"
   signing in for themselves): a `learnerProfiles` document is created
   directly by Learning Hub's own backend, `createdVia:
   'independent-signup'`, and a `learnerAccountLinks` doc links it to
   the account immediately (`role: 'self'` for the independent case,
   `'guardian'` otherwise) — no ClassMate involvement, since no
   classroom is involved yet.

### B.7 Linking flow (the classroom bridge itself)

1. Family enters/scans the raw token in Learning Hub's UI.
2. Learning Hub's backend calls the ClassMate verification function
   (§A, §D) with the raw token + a freshly generated idempotency key.
3. On `{ok: true, classroomId, studentId}`:
   a. If the currently-active Learner Profile (or a newly created one,
      if this is the account's first) has no existing
      `learnerClassroomMemberships` doc for this `classroomId`, create
      one (`status: 'active'`).
   b. If a `learnerAccountLinks` doc for `{uid, learnerProfileId}`
      doesn't already exist, create it (`linkedVia:
      'invitation-redemption'`).
   c. Update `accounts/{uid}.learnerProfileIds` to include this
      `learnerProfileId` if not already present.
4. On `{ok: false, ...}`: surface a generic "this code didn't work" —
   never distinguishing why (§A.10), matching the anti-oracle
   requirement end to end, not just at the Cloud Function's own
   response.

### B.8 Learner selection flow

Entirely Learning Hub-internal, no ClassMate involvement: read
`accounts/{uid}.learnerProfileIds`, render a picker if more than one,
write the chosen id to `lastActiveLearnerProfileId` (UX cache only).
"What classrooms is this learner in" is answered entirely from
`learnerClassroomMemberships`, filtered to `learnerProfileId ==
<selected>` and `status == 'active'` — **never** a fresh call to
ClassMate (contract §23's "consulted once, not on every read").

### B.9 Unlink/revocation flow

- **Revoking an account's link to a learner:** set the relevant
  `learnerAccountLinks.status = 'revoked'` and remove that
  `learnerProfileId` from the revoked account's own
  `accounts/{uid}.learnerProfileIds`. The `learnerProfiles` document
  itself, and any `learnerClassroomMemberships` it holds, are
  **untouched** — other accounts (if any, Decision 10) keep their own
  access; the learner's history is never deleted by an account-level
  unlink.
- **Ending a classroom membership** (e.g. the student leaves the
  class): set `learnerClassroomMemberships.status = 'ended'`. Learning
  Hub's own rules (§C) must check `status == 'active'`, not merely
  document existence, everywhere classroom-scoped access is gated —
  this is the concrete mechanism behind Decision 13.

### B.10 Notification event for existing linked accounts (Decision 11)

When a **second** (or later) `learnerAccountLinks` document is created
for a `learnerProfileId` that already has at least one other
`status: 'active'` link, Learning Hub's own backend (a Firestore-triggered
function inside Learning Hub's project — no ClassMate involvement)
notifies every other actively-linked account for that learner, and
stamps `notifiedExistingLinksAt` on the new link once sent. This is
**notify-only** (Decision 11) — the new link is already active by the
time this fires; nothing blocks or delays it. The `status: 'pending'`
enum value (B.3) is reserved specifically for the future, not-yet-built
version of this flow where notification becomes approval instead
(Decision 12).

---

## C. Security rules (conceptual design — not implemented)

For every collection: what an authenticated Learning Hub user can
read/create/update, what they can never modify, and how each of the
"multiple accounts / multiple learners" safety properties holds. Every
rule below relies **only** on `request.auth.uid` (known before
evaluation) and `get()` calls to a **fixed, precomputable path** — never
a `list`/query needing an authorization check that varies per result
in a way Firestore can't prove ahead of time.

### `accounts/{uid}`
- **Read/write:** only `request.auth.uid == uid`. A user can only ever
  see or touch their own account document.
- **Never modifiable:** the document's own ID (immutable by
  construction — Firestore doc IDs never change); `learnerProfileIds`
  should only ever be modified through the same transaction that
  creates/revokes the corresponding `learnerAccountLinks` doc, not as
  an independent write (an implementation discipline, not something a
  security rule alone can enforce — flagged as an implementation
  requirement, §J).
- **UID ownership:** trivial — the doc ID *is* the uid.

### `learnerProfiles/{learnerProfileId}`
- **Read:** only if an **active** `learnerAccountLinks/{request.auth.uid}_{learnerProfileId}`
  document exists — one `get()`, at a path fully computable from
  `request.auth.uid` (fixed) and the resource's own ID (the path
  segment being read, always known). This is the direct generalization
  of `MembershipLink`'s own `isLinkedActiveStudent()` two-hop shape
  (contract §7), applied to a different pair of collections.
- **Create:** only by Learning Hub's own backend logic paths (B.6/B.7)
  — conceptually, creation should require the caller to simultaneously
  be creating (in the same transaction/batch) their own
  `learnerAccountLinks` doc for the new profile, so a profile can never
  exist with zero linked accounts from the moment of creation.
- **Update:** limited to the four fields themselves (`displayName`,
  `avatarRef`), gated by the same active-link check as read — never
  `createdAt`/`createdVia` after creation.
- **Learner ownership established by:** the chained `learnerAccountLinks`
  check above — never by the caller supplying a `learnerProfileId` and
  being trusted at face value.

### `learnerAccountLinks/{uid}_{learnerProfileId}`
- **Read:** `request.auth.uid == resource.data.uid` (a user can read
  their own links) — a simple self-match, safe because the doc ID
  already encodes the uid.
- **Create:** requires `request.resource.data.uid ==
  request.auth.uid` (can't create a link claiming to be a different
  account) **and** a valid, freshly-verified classroom-linking result
  for `role != 'self'` cases, or a self-authored independent-signup
  path for `role == 'self'` — the exact shape of "was this legitimately
  the result of §B.7's flow" is an application-layer guarantee
  (Learning Hub's own backend is the only writer in practice), not
  something the rule alone re-verifies from ClassMate — ClassMate's own
  verification already happened once, upstream (§D); this rule does not
  need to, and structurally cannot, re-check ClassMate's roster itself.
- **Update:** only the `status` field, and only by the account that
  owns the link (`request.auth.uid == resource.data.uid`) transitioning
  `active → revoked` — never `revoked → active` (unlinking is a one-way
  door in this phase; re-linking goes through B.7 again, producing a
  fresh document via the deterministic ID, which is naturally idempotent
  since the ID is the same either way).
- **How one learner can safely have multiple accounts (Decision 10):**
  each account's own link is its own, independent document
  (`{uid}_{learnerProfileId}`) — creating or revoking one never touches
  another account's own link document, since they have different doc
  IDs (different `uid` prefixes) entirely.
- **How one account can safely have multiple learners:** identical
  reasoning in the other direction — different `learnerProfileId`
  suffixes are different documents.

### `learnerClassroomMemberships/{learnerProfileId}_{classroomId}`
- **Read (single doc):** requires an active `learnerAccountLinks`
  linking `request.auth.uid` to `resource.data.learnerProfileId` — the
  same chained, listless check pattern as `learnerProfiles` above.
- **Read (list, "all of my learner's classrooms"):** filtering by
  `learnerProfileId == X` is safe **specifically because** the
  authorization check (`get(accounts/$(request.auth.uid))` →
  confirm `X` is in `learnerProfileIds`) resolves a **fixed path**
  (`accounts/{request.auth.uid}`) that does not vary across the
  candidate results being evaluated — this is the documented, safe
  case for Firestore list rules (a per-result field compared against
  one fixed-path lookup), explicitly **not** the unsafe case (a
  per-result lookup at a path that itself varies per candidate
  document), which is what made the old `studentAuthLinks`-cross-reference
  attempt (contract §6) fail.
- **Create:** conceptually restricted to Learning Hub's own backend
  process that just received a ClassMate verification success (§B.7) —
  never a bare client write asserting arbitrary `classroomId`/`studentId`
  values. The rule's job is to confirm the caller (`request.auth.uid`)
  is actively linked to the named `learnerProfileId` (same chained
  check) — it is **not** the rule's job to re-verify the ClassMate side
  of the fact, which already happened once, upstream, and is not
  re-derivable from Learning Hub's own rules at all (Learning Hub has
  no access to ClassMate's Firestore, by design, contract §23).
- **Update:** only the `status` field (`active → ended`), by an account
  actively linked to the learner.
- **How classroom membership is protected:** no client can fabricate a
  membership record for a `classroomId`/`studentId` pair that ClassMate
  never actually verified, because the *only* path that produces the
  `{classroomId, studentId}` values used to create this document is the
  Cloud-Function-verified response (§A, §D) — the rule cannot itself
  prove this (Learning Hub's rules have no way to call ClassMate), so
  this specific guarantee is an **application-layer** one (only
  Learning Hub's own backend code path writes this collection,
  never client code directly) layered on top of the **rule-layer**
  guarantee (only an actively-linked account may write it at all).
  This split is stated explicitly here rather than left implicit,
  since it's the one place in this design where "the rule alone" is
  not the complete story.

**Explicit verification of the "no unsafe list/query" requirement:**
every rule above either (a) is a single `get()` by a deterministic,
precomputable document ID, or (b) is a `list` rule whose only
cross-document dependency resolves to a **fixed path**
(`accounts/{request.auth.uid}`) that does not vary per candidate
result — the documented-safe shape, not the shape that broke
`studentAuthLinks` originally (contract §6, §25).

---

## D. Cross-project trust — exact request/response sequence

| Step | Caller | Authenticated identity | Data sent | Data returned | Trust assumption | Failure behavior |
|---|---|---|---|---|---|---|
| 1. Teacher → ClassMate invitation | Teacher's browser | Teacher's real, Google-authenticated ClassMate session (existing `memberUids` membership) | `{classroomId, studentId}` (from the teacher's own already-visible roster) | the raw token (displayed only, not persisted), plus the created invitation doc's own existence | the teacher genuinely intends to invite this specific real student — the same trust ClassMate already places in every teacher-authored write | rule rejects if the teacher is not a member of the classroom; ordinary ClassMate error handling, nothing new |
| 2. Invitation → family | (human, out of band) | n/a | the raw token, via whatever delivery channel is chosen (**OPEN**) | n/a | short lifetime + single-use bound the exposure of an intercepted token | if lost/intercepted before use, the token simply expires in ≤15 minutes |
| 3. Learning Hub frontend → Learning Hub backend | family's browser, inside Learning Hub's own app | Learning Hub's own ordinary user session (Google Sign-In into Learning Hub, unrelated to ClassMate) | the raw token, typed/scanned by the family | success/failure of the **overall** linking attempt (not yet the ClassMate response directly) | ordinary web-app frontend/backend trust, not specific to this bridge | ordinary Learning Hub error handling |
| 4. Learning Hub backend → ClassMate verification function | Learning Hub's backend | the dedicated GCP service account, via a Google-signed OIDC identity token (§A.9) — **never** the browser, **never** the family's own Learning Hub session token | the raw token + an idempotency key | `{ok: true, classroomId, studentId}` or `{ok: false, error: 'verification_failed'}` | Learning Hub's backend is trusted to only make this call on behalf of a genuine end-user redemption attempt (an accepted, documented boundary — contract §7/security review scenario 11); ClassMate trusts the OIDC signature and IAM binding, nothing about Learning Hub's own internal session state | uniform generic failure response (§A.10); 5xx/timeout is distinguished from a rejection by Learning Hub's own retry logic (§H, §I), not by ClassMate |
| 5. ClassMate function → ClassMate Firestore | the verification function itself, running with its own function identity | the function's own Cloud Functions runtime identity (standard GCP service-to-service within one project, not the cross-project hop) | tokenHash-derived lookup, roster re-check | the invitation document, the live classroom document | Firestore's own security rules for these paths would, in a real deployment, restrict this read/write to server-side (Admin SDK) contexts — not designed further here, since it's ordinary within-project access, not a new trust boundary this plan introduces | transaction aborts cleanly on any failed check (§A.6); no partial state |
| 6. Verification result → Learning Hub backend | ClassMate's function (response) | (same OIDC-authenticated channel as step 4, response leg) | `{classroomId, studentId}` only, on success | — | Learning Hub trusts this response as a one-time, authoritative oracle result — it is not re-verified against ClassMate's data again later (contract §23 — "consulted once") | see step 4 |
| 7. Learning Hub backend → Learning Hub membership | Learning Hub's backend | Learning Hub's own service identity, writing to its own project | the verified `{classroomId, studentId}` plus the caller's own `uid`/`learnerProfileId` | the created/updated `learnerClassroomMemberships` and `learnerAccountLinks` documents | entirely internal to Learning Hub from this point on — ClassMate has no further involvement, ever, in this specific link (contract §23) | ordinary Learning Hub error handling; if this step fails after step 4 already succeeded, the invitation is already consumed (§A.6) — Learning Hub must handle this partial-failure case explicitly (flagged in §H/§J, not solved by ClassMate re-issuing anything automatically) |

**Explicit confirmation:** at no point in this sequence does the
Learning Hub **browser** ever hold credentials capable of calling step
4 directly — that capability exists only inside Learning Hub's backend
process, via the dedicated service account (§A.9).

---

## E. Token security — chosen values and why

- **Entropy: 256 bits** (32 bytes from a CSPRNG), base64url-encoded.
  *Why:* 128 bits is the conventional floor for an unguessable
  bearer-style secret; 256 bits gives comfortable margin with
  negligible cost (a few extra characters), consistent with this being
  a higher-stakes credential than the existing 6-digit PIN feature
  (~20 bits), which remains appropriate only for its own original,
  lower-stakes, same-session use and is explicitly **not** reused here
  (security review, carried into this plan).
- **Brute-force infeasibility, concretely:** even an attacker able to
  attempt 1 billion guesses/second against the space of real,
  currently-outstanding tokens (already an unrealistic rate given rate
  limiting, §A.8, and that only Learning Hub's one authenticated
  backend identity can even reach the endpoint at all, §A.9) would need
  on the order of 10^58 seconds to exhaust a 256-bit space — many
  orders of magnitude longer than the age of the universe. This is not
  a close call; it is the entropy budget doing its job with enormous
  margin.
- **Lifetime: 15 minutes**, for the interactive redemption case (§A.4).
  Why not longer: every additional minute is additional exposure window
  for scenario 5 (interception) with no offsetting benefit for an
  in-person flow. Why not shorter: leaves enough real-world time for a
  family to complete the Google Sign-In + Learner Profile creation flow
  (§B.6) before attempting redemption, without needing to be rushed.
- **Raw-token persistence: never.** Only the SHA-256 hash is persisted
  (§A.3) — the same principle as password storage: a Firestore read (via
  a misconfigured rule, a backup export, or an internal tool) can never
  yield a directly-usable secret.
- **Replay:** closed by the transactional single-use flip (§A.6);
  legitimate retries are distinguished via the idempotency key (§A.7),
  not by weakening the single-use guarantee.
- **Concurrent redemption:** closed by the same transaction — Firestore
  transactions serialize conflicting reads/writes to the same document,
  so two simultaneous attempts cannot both observe `status == 'active'`
  and both succeed.
- **Enumeration:** infeasible given the entropy (above); further bounded
  by the fact that only one authenticated caller identity can reach the
  function at all (§A.9) — an external enumeration attempt has no path
  to the function in the first place.
- **Leakage through logs:** prevented by policy and design — the raw
  token is never logged anywhere (§A.11 logs only the hash), and never
  appears in a URL (next point) or request line that a standard access
  log would capture.
- **Leakage through URLs:** the raw token is never placed in a URL
  query string or path — it travels only in a request body (browser →
  Learning Hub backend, and Learning Hub backend → ClassMate function),
  which standard web/HTTP server access logs do not capture the way
  they capture URLs.
- **Retry behavior:** Learning Hub's backend should retry a
  network-level failure (timeout, 5xx) with the **same** idempotency
  key and the **same** raw token, relying on §A.7's idempotent-replay
  handling to make this safe; it should **not** retry a `{ok: false}`
  rejection, since that's a definitive answer, not a transient failure
  (§I, §H cover this distinction as its own test case).

---

## F. Data ownership matrix

| Data | Owner | Reader | Writer |
|---|---|---|---|
| Firebase Auth identity (Learning Hub) | Google / Learning Hub's own Firebase project | Learning Hub backend (via ID token verification) | Google Identity Platform only — neither product's application code |
| Account | Learning Hub | the account itself (`request.auth.uid == uid`) | Learning Hub backend, on first sign-in; the account itself for its own convenience fields |
| Learner Profile | Learning Hub | any account with an active `learnerAccountLinks` entry for it | Learning Hub backend (creation); an actively-linked account (the four locked fields only) |
| Account–Learner Link | Learning Hub | the owning account (`uid` match) | Learning Hub backend, driven by §B.7 (create) or the owning account (`status` revoke only) |
| ClassMate Student Record | ClassMate | any ClassMate teacher-member of the classroom; the ClassMate verification function (server-side, for roster re-checks) | ClassMate teacher UI only — unchanged, untouched by this design (Decision 15) |
| Classroom Membership (learner-facing representation) | Learning Hub | an actively-linked account, for its own linked learner(s) only | Learning Hub backend, driven exclusively by a successful ClassMate verification result (§B.7) — never a bare client write |
| Classroom Membership (teacher-facing, `memberUids`) | ClassMate | existing, unchanged (§7 of the contract) | existing, unchanged — **not touched by this design at all** (Decisions 1, 2) |
| Classroom roster | ClassMate | existing, unchanged | existing, unchanged |
| Invitation (`classroomLinkInvitations`) | ClassMate | the verification function only (server-side); no client ever reads this collection directly, including the teacher who created it (they already have the raw token/QR at creation time and don't need to re-read the record) | the issuing teacher (create); the verification function (status update only) |
| Learning history (concepts, activities, attempts, evidence) | Learning Hub | per Learning Hub's own, separate design — out of scope for this bridge, keyed to `learnerProfileId` (contract §16) | Learning Hub, per its own design — out of scope here |

---

## G. Migration

**Do not assume existing data can simply be merged — none of it can
be, deterministically, per the architecture contract's own §17
finding.** This section describes coexistence, not migration in the
data-transformation sense.

- **Existing `localStorage` profiles (device-approved students):**
  untouched. Nothing in this plan reads, writes, or references
  `bloomLabsDeviceApprovedProfiles`/`bloomLabsDeviceActiveStudentId` at
  all. A student already using the current flow keeps using it exactly
  as before.
- **Existing anonymous Firebase identities (per-slot uids):** untouched,
  and **structurally unrelated** to the new bridge — the new invitation/
  verification flow never touches `studentAuthService.js`'s named
  per-slot apps, and no code path proposed here calls
  `ensureAnonymousSignIn()`.
- **Existing ClassMate `Student.id` values:** unchanged in shape or
  meaning — the new `learnerClassroomMemberships` document simply
  *references* an existing `studentId`, exactly as every other
  ClassMate-adjacent collection already does (contract §16). No
  renumbering, no backfill.
- **Classroom codes (`classroomStudentJoinCode`):** entirely separate
  mechanism, untouched — a student can still join via the existing code
  flow with zero interaction with this bridge. The bridge introduces a
  **second**, independent front door (the teacher-issued invitation),
  not a replacement for the first.
- **Learner Profile creation for an existing (already-joined-by-code)
  student:** there is **no automatic linkage**. A family choosing to
  adopt Learning Hub for a student who already uses the device-local
  flow goes through the **same** invitation flow (§B.7) as anyone else
  — the teacher issues a fresh invitation naming that same
  `studentId`; redemption creates a **new** Learner Profile (unless the
  family already has one from a different context) and a **new**
  `learnerClassroomMemberships` record. The pre-existing device-local
  profile is not consulted, not merged, not deleted.
- **Account linking:** as described in §B.6/§B.7 — nothing here is
  migration-specific; it's the same flow for every family, first-time
  or not.
- **Coexistence period:** indefinite, by design (Decision 15 — Student
  Mode receives no changes in this phase). Both the old device-local
  flow and the new Learning-Hub-linked flow are live simultaneously,
  for potentially different students in the same classroom, with no
  cross-awareness between them required for either to function
  correctly.
- **Eventual full migration** (all students moved to Learning Hub,
  ClassMate Student Mode UI retired): explicitly out of scope for this
  plan — the architecture contract's own §21/§22 already deferred this
  decision (formerly open decision 5 in the security review's
  companion document) and this plan does not revisit it.
- **Failure/recovery:** if a family's redemption attempt fails partway
  (e.g. ClassMate verification succeeds, but Learning Hub's own
  membership write then fails — §D step 7's own noted gap), the
  invitation is already consumed (single-use, §A.6) and cannot be
  retried with the same token. Learning Hub's backend must treat this
  as its own internal failure to recover from (e.g., by retrying its
  own membership write using the already-returned `{classroomId,
  studentId}` — which it already has, no new ClassMate call needed —
  rather than asking the family to obtain a new invitation for what was
  actually a Learning-Hub-side failure). This is flagged explicitly as
  an implementation requirement (§J), not assumed away.

---

## H. Test plan

**Unit (pure logic, no Firestore/network):**
- Token generation produces the claimed entropy/format.
- Hash function determinism (same raw token → same hash, always).
- Idempotency-key comparison logic.
- Response-shape uniformity across every failure category (a single
  test asserting *every* failure path returns byte-identical shape/
  message, not five separate assertions that could drift apart).

**Integration (against a real or emulated Firestore + function):**
- **Valid invitation** → successful redemption, correct
  `{classroomId, studentId}` returned, invitation flips to `redeemed`.
- **Invalid invitation** (never existed / wrong hash) → generic failure.
- **Expired invitation** → generic failure, verified against server
  time, not client-supplied time.
- **Already-redeemed invitation** → generic failure (without a matching
  idempotency key).
- **Concurrent redemption** (two simultaneous requests, same token) →
  exactly one succeeds, the other receives the generic failure — this
  is the scenario-3 concurrency test flagged as mandatory, not optional,
  by the security review.
- **Two accounts redeeming the same invitation** → same mechanism as
  concurrent redemption; first commit wins, second is rejected;
  separately assert this doesn't corrupt either account's own,
  unrelated `learnerAccountLinks`/`learnerProfiles` state.
- **Account with multiple learners** → `accounts/{uid}.learnerProfileIds`
  correctly holds more than one id; each has its own independent
  `learnerAccountLinks` doc; revoking one never touches the other.
- **Learner with multiple accounts** → two different `uid`s each have
  their own `learnerAccountLinks` doc for the same `learnerProfileId`;
  the Decision 11 notification fires on the second link's creation.
- **Revoked account link** → the revoked account can no longer read the
  `learnerProfiles`/`learnerClassroomMemberships` documents it used to
  see; a different, still-active account is unaffected.
- **Roster/student removed before redemption** → redemption fails
  (§A.6 step 4), confirmed against a live re-check, not a stale cached
  roster.
- **Network retry (same idempotency key)** → returns the original
  success result, not an "already redeemed" error.
- **ClassMate service unavailable** → Learning Hub's own backend
  distinguishes this (5xx/timeout) from a genuine rejection and does
  not discard/blacklist the token as if it were invalid.

**Security-rule tests (rules emulator, no application code):**
- **Unauthorized membership creation** — a direct client write attempt
  to `learnerClassroomMemberships` (bypassing Learning Hub's own
  backend entirely) is rejected, even with an otherwise-valid,
  actively-linked account — since creation additionally requires the
  application-layer guarantee (§C) that only the backend process writes
  this collection; the rules-only test here confirms the *rule layer* still
  requires an active link at minimum, and a separate, explicit test
  confirms the client SDK path is never exposed for this write in the
  first place.
- **Forged `classroomId`** — an actively-linked account attempts to
  create/update a `learnerClassroomMemberships` doc naming a
  `classroomId` different from what its own verified membership
  actually names — rejected.
- **Forged `studentId`** — same shape, for `studentId`.
- **Forged `learnerId`** — an account attempts to read/write a
  `learnerProfiles`/`learnerClassroomMemberships` document for a
  `learnerProfileId` it has no active link to — rejected.
- **Direct frontend invocation attempt** on the ClassMate verification
  function (no valid OIDC token) — rejected at the platform/IAM layer,
  before any Firestore rule or application code runs (§A.9, §D step 4).
- **Backend impersonation attempt** — a request bearing a validly-signed
  OIDC token for a **different, unauthorized** service account is
  rejected by the IAM invoker binding (§A.9) — a genuine test requires
  a second, deliberately-unauthorized service account provisioned only
  for this test.
- **Token enumeration** — a scripted sweep of random/guessed tokens
  against the verification function returns the uniform failure
  response for all of them, with no distinguishing signal (§A.10, §E).
- **Rate limiting** — exceeding the configured threshold from the one
  authorized caller identity triggers throttling/alerting, confirmed
  in a load-test style integration check, not just unit-asserted.

**End-to-end (real browser, real — or emulated — cross-project call):**
- Full happy path: teacher issues invitation → family signs into
  Learning Hub → redeems → sees their linked classroom.
- Full unhappy path: expired/invalid code shown a clear, non-specific
  "didn't work" message, with a working retry path (request a new
  invitation), not a dead end.

---

## I. Threat model

Ranked most severe first; "required before first production use" vs.
"may be deferred" restated from the security review, not re-litigated.

| # | Threat | Attack surface | Mitigation | Residual risk | Required before first production use? |
|---|---|---|---|---|---|
| 1 | Forged classroom/learner membership written directly by a compromised or malicious client | `learnerClassroomMemberships` create path | Rule requires an active link (§C); application-layer restriction that only Learning Hub's backend performs this write, driven solely by a genuine ClassMate verification result (§B.7) | if the *application-layer* restriction is ever violated by a future code change (rules alone don't fully close this — §C's own explicit caveat), a compromised client-side path could still forge a membership *for a learner the account is legitimately linked to*, just not for classrooms it hasn't verified. | **Yes** |
| 2 | Direct/forged calls to the ClassMate verification function | the function's public endpoint | IAM-only invocation, dedicated service account, no API key (§A.9) | none, structurally, if deployment configuration is correct | **Yes** |
| 3 | Token guessing/enumeration | the verification function's token parameter | 256-bit entropy + the function being unreachable by anyone but the one authorized caller (§A.9, §E) | negligible | **Yes** |
| 4 | Concurrent/duplicate redemption creating two memberships from one token | the redemption transaction | single Firestore transaction (§A.6) | none, if implemented as specified | **Yes** |
| 5 | Roster changes between issuance and redemption producing a stale membership | the redemption transaction's roster check | live re-check inside the same transaction (§A.6 step 4) | none, if implemented as specified | **Yes** |
| 6 | Information leakage via distinguishable error responses, aiding threat 3 | the verification function's response | uniform response shape/message (§A.10) | low — a future code change reintroducing a specific error message is a process risk, not an architectural one | **Yes** |
| 7 | Raw token leakage via logs | any log sink touched by either project | never log the raw token, only the hash (§A.11); explicit written policy + code-review gate | a future, careless code change could still log a full request body by accident — a discipline risk, not fully closable architecturally | **Yes** (the policy/gate itself) |
| 8 | Compromised Learning Hub backend abusing its own legitimate calling privilege | the entire bridge, from Learning Hub's side | least-privilege IAM scoping (this one function only), rate limiting/alerting (§A.8) | a compromised Learning Hub backend still inherits everything it's legitimately allowed to do — an accepted, bounded, not fully closable risk (contract §7 scenario 7/11) | **Yes** for the scoping/limits; full anomaly detection may be deferred |
| 9 | One account silently linking to a child without another guardian's knowledge | the linking flow itself (not a technical exploit — a policy question) | notify-only (Decision 11) surfaces it after the fact; revocation (§B.9) provides recovery | genuinely accepted, not closed — full consent-gating was explicitly deferred (Decision 12 keeps the door open, doesn't walk through it now) | **No** — accepted product risk for this phase, by explicit decision |
| 10 | Delivery-channel interception of the raw token | whatever channel is eventually chosen (**OPEN**) | short lifetime bounds exposure regardless of channel | depends entirely on the channel decision, not yet made | **Yes**, once the channel is chosen — cannot be fully assessed before that decision |
| 11 | Teacher issuing multiple simultaneous tokens for one student | invitation creation | not enforced in this design (optional hygiene noted, not required) | low — each token is still independently single-use; only a minor housekeeping/confusion risk | **No** — may be deferred |
| 12 | ClassMate verification function unavailable (outage) | availability, not security | Learning Hub distinguishes rejection from unavailability, retries with backoff (§E, §G) | ordinary availability risk, not a security one | **Yes** for the rejection/unavailability distinction; formal SLA tooling may be deferred |

---

## J. Implementation order

Smallest safe sequence, with explicit test gates before proceeding to
the next step. No step in this section is executed by this plan — it
is a sequencing design only.

1. **Learning Hub: `accounts` + `learnerProfiles` + `learnerAccountLinks`
   collections and rules, with no classroom concept involved yet.**
   Gate: security-rule tests for these three collections pass in
   isolation (multi-account, multi-learner cases from §H) before
   anything classroom-related is built.
2. **ClassMate: `classroomLinkInvitations` collection + creation path
   (teacher-side only, no Cloud Function yet).**
   Gate: a teacher can create an invitation; the raw token is
   demonstrably never persisted (an explicit test asserting this, not
   just an assumption).
3. **ClassMate: the verification Cloud Function, deployed
   authenticated-only, with a real dedicated service account and IAM
   binding provisioned first.**
   Gate: the full §H integration suite (valid/invalid/expired/replayed/
   concurrent/roster-changed) passes against this function directly,
   called with a real OIDC-authenticated test client — **before**
   Learning Hub's own backend is wired to call it at all.
4. **Learning Hub: the linking flow (§B.7) wired to call the now-tested
   ClassMate function.**
   Gate: the full end-to-end happy/unhappy path (§H) passes in a
   staging-equivalent environment, including the cross-project IAM call
   actually working (not mocked).
5. **`learnerClassroomMemberships` creation/update, driven only by step
   4's flow.**
   Gate: forged-classroomId/forged-studentId/forged-learnerId rule
   tests (§H) all pass **before** any real family is invited to use
   this flow.
6. **Decision 11's notification flow** (multiple accounts on one
   learner).
   Gate: the multiple-accounts test case (§H) passes, including
   confirming the notified account's own, separate access is
   unaffected by the notification itself.
7. **Revocation/unlink (§B.9).**
   Gate: revoked-account-link test (§H) passes, confirming a revoked
   account loses access while other active links on the same learner
   do not.
8. **Rate limiting, audit logging, monitoring/alerting (§A.8, §A.11).**
   Gate: load-test-style confirmation that thresholds trigger as
   designed, before any production traffic.
9. **Only after all of the above:** a real, first production
   invitation, to one real classroom, with the teacher and family
   fully aware this is a new, additive flow — not a switch-over, per
   Decision 15 and §G.

At no point in this sequence does any existing ClassMate Student Mode
code path (`studentDeviceService.js`, `studentAuthService.js`,
`StudentDeviceFlow.js`, or anything under `js/ui/student-portal/`) get
modified — every step above is additive, new collections and new
functions only, consistent with Decision 15.

---

**Confirmed:**
- No application code written or modified.
- No Firestore documents written.
- No Firestore rules written or modified.
- No Cloud Functions created or deployed.
- No authentication configuration changed.
- No deployment performed.
- No production data touched.
- No commit made.
- No push made.

**Stopping here for review, as instructed.**
