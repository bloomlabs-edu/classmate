# Classroom Invitation & Learner Verification Bridge

**Status: implemented and tested in this repository (ClassMate side
only). Not committed, not pushed, not deployed — see "What Was Not
Done" at the end of this document.** Learning Hub was not modified.
Student Mode was not modified or migrated. `CONFLICT-0001` was not
touched.

**Update (production endpoint round):** §7 and §13 below were written
before the production entry point existed and described it as an
unresolved placeholder. A real Cloud Function scaffold
(`functions/index.js`, `functions/src/*.js`) now exists, is tested
against real Firestore + Auth emulators, and is described in the new
§27–§30 at the end of this document. §7/§13's original text is left in
place, struck through where superseded, so the reasoning trail stays
visible — read §27 onward for the current, implemented design.

This document is the deliverable required alongside the
implementation: it explains what was built, why each boundary is where
it is, and what remains a documented, deliberate non-solution rather
than an oversight. It builds directly on, and does not re-litigate,
the locked decisions in `LEARNER_IDENTITY_BRIDGE_CONTRACT.md` and the
security posture in `STUDENT_PROFILE_BRIDGE_SECURITY_REVIEW.md`. Where
this document repeats a decision from those two, it is citing it, not
re-deciding it.

---

## 1. Problem Statement

Learning Hub (a separate Firebase project, student-facing) now has its
own learner-profile foundation. It needs to answer, for a given
authenticated learner and a given classroom, "is this learner a
verified member of this ClassMate classroom, and if so, which roster
student are they?" ClassMate owns the roster and the classroom; it is
the only system that can answer that question honestly. This document
describes the bridge that lets it do so — safely, without creating a
second roster system in Learning Hub, and without reviving any of the
identity shortcuts the prior Student Mode system used.

## 2. What This Is Not

Per the Contract's own findings and this task's explicit instructions,
this bridge deliberately does **not**:

- Reuse an anonymous per-device Firebase Auth UID (Student Mode's
  `bloomLabsDeviceApprovedProfiles` pattern) as cross-product identity.
  That identity is device-local by construction (§3.2–3.4 of the
  Contract) and cannot mean anything to a different product on a
  different device.
- Revive `studentAuthLinks`. That collection is not reintroduced in
  any form here.
- Treat a classroom code, a student ID in a URL, a student's name, or
  possession of a classroom invitation as proof of *which* student
  someone is. All four are either guessable/shareable-by-design (join
  codes, invitation codes) or trivially forgeable (a name, an ID
  typed into a request).
- Attempt automatic name/ID matching between a Learning Hub learner
  profile and a ClassMate roster student. See §8.

It reuses exactly one thing from `MembershipLink`: the *pattern* of a
deterministic composite document ID (`{a}_{b}`) that turns a
cross-collection membership check into a single `get()`, not a
list/query. It does **not** reuse `MembershipLink`'s permanence
assumption — see §5.

## 3. The Two-Step Bridge

**Step 1 — Classroom Invitation.** A teacher generates an invitation
representing one classroom. It identifies the classroom only, is
shareable with the whole class, is usable asynchronously by anyone who
has it, and — critically — authorizes nothing about a specific
student. Presenting it creates, at most, a **PENDING** connection
request. See §4.

**Step 2 — Identity Verification.** Before a PENDING relationship can
become ACTIVE, ClassMate must have a trusted, unambiguous mapping to
exactly one roster student. Today, no such automatic signal exists
(§8), so the only path to ACTIVE is the fallback: a teacher-issued,
student-specific, single-use verification code. See §5–§6.

This split is the whole design: an invitation can never, by itself,
grant access to a student's records, because *nothing about the
invitation names a student*. A verification code can, but only once,
only for the student it was issued for, and only through a transaction
that re-checks the live roster at redemption time.

## 4. Classroom Invitation

**Model:** `js/models/LearnerConnection.js` — `createClassroomInvitation()`,
`generateClassroomInvitationCode()` (reuses the existing
`generateJoinCode()` alphabet/shape, 6 characters, so it looks and
behaves like every other code in this app).

**Storage:**
- `classrooms/{classroomId}/classroomInvitations/{invitationId}` — the
  invitation record itself (`classroomId`, `status: 'active' |
  'revoked'`). Teacher read/create/revoke-only-update. No student
  field exists on this document at all — there is nothing to leak.
- `classroomInvitationCodes/{code}` — a top-level `code -> classroomId`
  pointer, mirroring the existing `joinCodes`/`studentJoinCodes`
  top-level-lookup pattern already in this file. Unlike
  `studentJoinCodes`, this is **not** publicly readable — see §7 for
  why that matters here specifically. Resolution for the bridge always
  happens server-side (Admin SDK), which bypasses this rule entirely,
  by design; the client-read path exists only for the teacher's own
  management UI.

**What a client (Learning Hub, or anyone holding the code) can do with
just this code:** call `createConnectionRequest(adminDb, {
learnerProfileId, classroomId, invitationCode })` — server-side only.
This validates the code, and produces or leaves alone a relationship
document, **never** with `status: 'ACTIVE'`. See §5.

## 5. Relationship Lifecycle

`learnerClassroomRelationships/{learnerProfileId}_{classroomId}` — the
persistent record of "this Learning Hub learner may be treated as this
ClassMate roster student in this classroom." Composite, deterministic
document ID, generalizing the `MembershipLink` pattern per the
Contract's approved §22–26 decisions.

States: `PENDING -> ACTIVE -> REVOKED`. Only two transitions are
possible through the Firestore rules for this collection:

| Transition | Allowed via client rules? | Allowed at all? |
|---|---|---|
| (none) -> PENDING | No (`create: if false`) | Yes, Admin SDK only (`createConnectionRequest`) |
| PENDING -> ACTIVE | No | Yes, Admin SDK only, and only inside `verifyStudentCode`'s transaction, and only after a real credential is redeemed |
| ACTIVE -> REVOKED | **Yes** — the classroom's own teacher, narrow diff (`status`, `revokedAt`, `revokedByUid` only) | Yes |
| REVOKED -> ACTIVE | No, by any path | Only by starting over: a fresh `createConnectionRequest` (client-triggerable via the invitation, since that's idempotent and does not resurrect an old studentId) followed by a fresh `verifyStudentCode` redemption |

The REVOKED -> ACTIVE row is the one this task called out explicitly:
revocation must not auto-reactivate on retry. It doesn't — a revoked
relationship requires the *entire* verification process again, not a
retry of the last step. This was tested directly (see §12,
"REVOKED").

`createConnectionRequest` is idempotent with respect to an existing
ACTIVE relationship: calling it again (e.g., a learner re-opens the
invitation link) returns the existing ACTIVE state as-is and does not
reset `studentId` to `null` or touch anything. Tested explicitly.

## 6. Student Verification Code (Fallback Credential)

**Model:** `generateStudentVerificationCode()` — 10 characters from a
32-symbol, ambiguity-free alphabet (no `0/O/1/I/L`), ~50 bits of
entropy. Lower than the 256-bit cross-project bridge token elsewhere
in this system, deliberately: this code is meant to be read aloud or
handed to one specific student in a classroom, not transmitted over an
untrusted channel unattended, and it is single-use with a 7-day
expiry — the threat model is "don't let it be guessed by brute force
within its short life," not "protect it forever."

**Storage:** `classrooms/{classroomId}/studentVerificationCodes/{codeHash}`,
document ID is `sha256(rawCode)` — the raw code is never persisted,
matching this codebase's own established "hash, never the secret"
convention. A teacher may create one naming a `studentId` and may
revoke their own still-active code (narrow, single-field update, same
pattern as everywhere else in this file). No client, including the
issuing teacher, can move `status` to `redeemed` — only the trusted
server module can, because only it can compute the hash needed to
address the document in the first place.

**Redemption:** `verifyStudentCode(adminDb, { learnerProfileId,
classroomId, rawCode })` in
`server/learnerVerification/verifyLearnerConnection.js` — one Firestore
transaction, reads the code, the relationship, and the live classroom
roster, then either fails generically or writes both the code
(`-> redeemed`) and the relationship (`-> ACTIVE`, with `studentId`,
`verifiedAt`, `verifiedVia`) atomically. Concurrency is handled by
Firestore's own transaction serialization on the same documents — a
second, racing redemption attempt for the same code necessarily
observes the first one's write and fails. Tested directly with two
genuinely concurrent calls (§12, "CONCURRENT REDEMPTION").

**What redemption checks, in order, any one of which produces the same
generic failure:**
1. Code exists, is `active`, belongs to this `classroomId`, is not
   expired.
2. The classroom's *live* roster still contains `code.studentId` (a
   plain `.some()` check over the actual current teams/students array
   — not a rules-level check; see §9 for why the rules layer cannot do
   this itself).
3. The relationship is not already `ACTIVE`. This is the one check
   unique to redemption (not present in `createConnectionRequest`) — it
   closes a hijack path that has nothing to do with a "bad" or fake
   code: a genuinely valid, teacher-issued code for a *different* real
   student in the same classroom cannot overwrite an already-active
   relationship. Only revocation, then a fresh connection request, can
   ever change who a `learnerProfileId` maps to. Tested directly (§12,
   "WRONG LEARNER / hijack attempt").

## 7. Trust Boundary

**Superseded by §27 — the box below labeled "Learning Hub backend /
future ClassMate Cloud Function" was, at the time this section was
written, deliberately left unresolved about which side authenticates
the caller and how. That is no longer true — §27 documents the actual,
implemented mechanism. This diagram is left in place, unedited, so the
"before" state stays visible; do not treat it as the current design.**

```
Learning Hub (separate Firebase project)
  |
  | learner authenticates with ITS OWN Firebase Auth
  | (its tokens are not valid ClassMate `request.auth` values —
  |  there is no rule in this file that could recognize one)
  v
Learning Hub backend / future ClassMate Cloud Function
  |  (the ONLY place createConnectionRequest / verifyStudentCode run)
  |  — Admin SDK, bypasses ClassMate Firestore rules entirely,
  |    which is the only way to do the SHA-256 comparison this
  |    whole scheme depends on (rules language has no hash function)
  v
ClassMate Firestore (this project)
  - classroomInvitations / classroomInvitationCodes
  - studentVerificationCodes
  - learnerClassroomRelationships   <-- the answer lives here
```

ClassMate answers exactly one question: *"may this learnerProfileId be
linked to this classroomId, and if so, to which studentId?"* It answers
by exposing `{ ok, classroomId, studentId }` on success or a single
generic failure otherwise (§10). It does not learn anything about
Learning Hub's learner-profile data model, and Learning Hub does not
gain any read/write path into ClassMate's roster, team, or student
records beyond that one answer. `learnerClassroomRelationships` is the
full extent of what ClassMate exposes about "membership" to the other
side of this bridge — Learning Hub is expected to build its own
ongoing classroom-membership representation on top of that answer, not
treat ClassMate as a live roster source it queries repeatedly. This
document does not specify Learning Hub's own data model for that
representation — that is explicitly Learning Hub's concern, per the
ownership split in the task brief, and out of scope here.

~~Deploying the actual Cloud Function this server module is written to
back (IAM binding, service account, `firebase deploy --only
functions`) is out of scope for this phase, matching the existing
`STUDENT_PROFILE_BRIDGE_SECURITY_REVIEW.md` / implementation-plan
framing of this as future infrastructure work — see "What Was Not
Done."~~ **The Cloud Function scaffold itself (not its deployment) now
exists — see §27.** Deployment (`firebase deploy --only functions`)
remains out of scope, unchanged — see the updated "What Was Not Done."

## 8. Automatic Matching: Not Available Today

`findTrustedAutomaticMatch({ learnerProfileId, classroomId })` in
`js/models/LearnerConnection.js` always returns `null`. This is not a
placeholder or a TODO — it is the evidence-based answer, and it is
called for real (not skipped) in `createConnectionRequest`, so the
absence of a signal is asserted, not assumed:

- **Name match** is explicitly ruled out by this task's own
  instructions and by the Contract's finding that Student Mode names
  were never treated as identity proof.
- **Email match** does not exist as a signal at all: ClassMate roster
  students have no email field in this app's data model, and Learning
  Hub learner profiles are, per the task brief, out of this bridge's
  visibility.
- **`localStorage`/anonymous device UID** is Student Mode's own
  mechanism, is device-local by construction (Contract §3.2–3.4), and
  is exactly what this task instructed not to reuse.
- **Student ID as a bearer credential** (e.g., in a URL) is explicitly
  ruled out by this task's instructions — a value that identifies a
  record is not proof of being that record's owner.

Conclusion, stated as an architectural fact rather than a gap to be
silently worked around: **no trusted automatic mapping exists in the
current architecture.** Every connection request today falls through
to `PENDING`, and the student verification code is not a "fallback for
the rare ambiguous case" — it is the *only* currently-available path
to `ACTIVE`. If a future, genuinely trusted signal is introduced
(e.g., Learning Hub and ClassMate come to share a real, verified
account-linking mechanism), it would be implemented inside
`findTrustedAutomaticMatch` without changing anything about the
relationship lifecycle or rules above it — the seam is already there.

## 9. A Firestore Rules Engine Limitation (Discovered, Not Assumed)

An early version of the `studentVerificationCodes` create rule
attempted to check "does `studentId` actually name a real student in
this classroom's roster" directly in rules, via a nested list macro:
`classroom.teams.exists(t, t.students.exists(s, s.id ==
request.resource.data.studentId))`. This is invalid — first for CEL
syntax (arrow-function syntax `s => ...` is not CEL; the correct form
is comma-syntax `s, ...`), and then, after fixing the syntax, for a
real engine limitation: **a two-level-nested `.exists()` is not
supported** ("Function not found error: Name: [exists]"), confirmed
against the real Firestore emulator, not merely suspected. This
corroborates a pre-existing, independently-discovered comment already
in this same `firestore.rules` file (its own "Phase 3.6" fix) that
`.all()` hit the identical "Function not found" failure — i.e., this
file already had first-hand evidence that the rules engine implements
only a constrained subset of CEL, and this bridge's own attempt
reproduced the same class of failure at a different macro.

**Resolution:** the roster-membership check was moved to where it can
actually be expressed correctly — `verifyStudentCode`'s own
transaction, in plain JavaScript, with no CEL constraints (§6, check
2). The rules-level create check for `studentVerificationCodes` is
narrowed to what rules genuinely can verify: the caller is the
classroom's own teacher, and `studentId` is a non-empty string. A code
naming a nonexistent or wrong-classroom student **can** be created
(rules cannot see far enough to stop that) but can **never** be
successfully redeemed (the server module re-checks the live roster
every time). This is a real, tested enforcement boundary at a
different layer, not a weakened one — see the "WRONG STUDENT" tests in
§12.

## 10. Security Properties (What This Task Required to Be Impossible)

All of the following were verified against the real Firestore emulator
and/or the real server module — not asserted from rules text alone:

| Requirement | How it's enforced | Tested |
|---|---|---|
| Untrusted client cannot create an active relationship | `learnerClassroomRelationships.create: if false` — no branch produces `ACTIVE` | Rules test |
| Untrusted client cannot choose another student's roster ID | `verifyStudentCode`'s live-roster re-check + the code being scoped to one `studentId` at issuance | Server test |
| Untrusted client cannot flip PENDING -> ACTIVE | No update rule branch permits it (the only update rule requires `ACTIVE -> REVOKED`) | Rules test |
| Untrusted client cannot reactivate REVOKED | Same — the only update branch requires the *current* status be `ACTIVE` | Rules test |
| Invitation alone cannot impersonate a student | Invitation documents carry no student field at all | Rules test (schema check) |
| Invitation cannot be used to enumerate the roster | `classroomInvitationCodes` is teacher-read-only; resolution happens server-side via Admin SDK | Rules test |
| A code from another classroom cannot be used | Codes live at `classrooms/{classroomId}/studentVerificationCodes/...`; redemption looks up that exact path — a code for classroom A does not exist at classroom B's path at all | Server test ("CROSS-CLASSROOM ISOLATION") |
| A consumed one-time credential cannot be reused | Transaction marks it `redeemed`; redemption re-checks `status == 'active'` | Server test ("REUSED CREDENTIAL", x2) |
| Auditable verification event | Every successful redemption stamps `verifiedAt`, `verifiedVia`, and the code document's own `redeemedAt`/`redeemedByLearnerProfileId` | Implementation + server tests |
| Anti-oracle (no information leakage about *why* verification failed) | Every failure path returns the identical `{ ok: false, error: 'verification_failed' }`, regardless of cause | Server tests (all failure cases assert only `ok === false`, never branch on `error`) |

## 11. The Pre-Existing Permissive Classroom Read Rule (Documented Blocker, Not Fixed)

`firestore.rules` line 136–137:

```
allow get: if (request.auth != null &&
  request.auth.uid in resource.data.memberUids) || true;
```

This rule (with its own in-file comment explaining it as deliberate,
supporting an unauthenticated student join flow) means **any caller
who knows a `classroomId` can read the entire classroom document**,
including its full `teams[].students[]` roster, regardless of
authentication or membership. This predates this bridge and was not
introduced or altered by it.

**Does it affect this bridge?** Checked directly, not assumed: no.
None of the four new collections
(`classroomInvitations`, `classroomInvitationCodes`,
`studentVerificationCodes`, `learnerClassroomRelationships`) ever
exposes a `classroomId` to an untrusted client as a side effect of
this bridge's own flow. Specifically:
- `classroomInvitationCodes/{code}` — the code-to-classroomId pointer
  — is **teacher-read-only**, not `if true` like the older
  `studentJoinCodes`. An untrusted Learning Hub client never resolves
  a `classroomId` from an invitation code itself; that resolution
  happens exclusively inside the Admin-SDK-only `createConnectionRequest`,
  which bypasses rules and never returns the `classroomId` back out
  through any new public read path.
- All four new collections require `request.auth.uid in
  ...classrooms/{classroomId}.data.memberUids` for any client read.

So a Learning Hub learner's own client never learns a ClassMate
`classroomId` through this bridge in a way that could be pointed at
the permissive rule above to fish out a roster. The pre-existing gap
remains exactly what it was — a known, inherited issue, tracked here
as a blocker for anyone doing broader security work on this file, but
**deliberately not touched**, per this task's explicit instruction not
to undertake an unrelated security rewrite.

## 12. Tests

Three suites, run independently (see §14 for why independently), all
passing:

- **`tests/models/learnerConnection.test.js`** — 7/7 pass. Pure logic:
  relationship ID determinism, invitation/verification code
  shape+entropy (200 and 500 draws respectively, zero collisions),
  `findTrustedAutomaticMatch` always-null, enum values, and
  browser/server SHA-256 cross-environment equality + determinism.
- **`tests/rules/learnerConnection.rules.test.js`** — 21/21 pass,
  against the real Firestore emulator (`@firebase/rules-unit-testing`,
  project `demo-classmate-bridge-test`). Covers invitation
  creation/isolation/schema, verification-code creation and the
  documented rules-layer limitation from §9, and every relationship
  transition in the table in §5, plus the safe classroomId-filtered
  list-query pattern (succeeds for the owning teacher, returns nothing
  for another classroom's teacher — proving the query itself cannot be
  used to enumerate another classroom).
- **`tests/server/verifyLearnerConnection.test.js`** — 18/18 pass,
  against the same emulator via `firebase-admin`. Covers: valid
  verification; wrong classroom; wrong student (nonexistent and
  cross-classroom-roster variants); the relationship-hijack ("wrong
  learner") case; ambiguous identity (two learners independently
  verifying against the same classroom without conflation); an
  already-ACTIVE relationship rejecting a second, otherwise-valid
  code; a REVOKED relationship correctly re-activating only through a
  real fresh redemption, and explicitly *not* through a replayed
  request with no real code; reused/already-redeemed credentials (same
  learner, and a different learner); expired codes; cross-classroom
  credential isolation; and genuinely concurrent redemption resolving
  to exactly one success.

**Total: 46/46 new tests passing (bridge module round).**

**Update (production endpoint round): +27 more, also passing** — see
§27–§29:
- `tests/functions/learningHubAuth.test.js` — 7/7, real Auth emulator.
- `tests/functions/verifyLearnerConnectionEndpoint.test.js` — 20/20,
  real Firestore + Auth emulators.

**Combined bridge + endpoint total: 73/73.**

Full pre-existing project suite (`tests/**/*.test.js`, now 834 tests
total with these two new files included, run with
`--test-concurrency=1` — see §14) passes at 833/834. The one failure
(`tests/ui/programmeSessionView.test.js`) is pre-existing and
unrelated — confirmed by running that file alone, where it fails
identically on a missing export (`getEffectiveAttendanceStatus`) in
`js/ui/views/ProgrammeSessionView.js`, a file this bridge never
touched. Unchanged from the prior round.

## 13. Integration Contract (What Learning Hub Calls / What ClassMate Returns)

This section describes the shape of the two entry points Learning Hub
(via its own backend, or a future Cloud Function ClassMate exposes) is
expected to call. Neither function is exposed as an HTTP endpoint in
this phase — see "What Was Not Done."

**`createConnectionRequest({ learnerProfileId, classroomId,
invitationCode })`**
- Learning Hub provides: its own opaque `learnerProfileId`, the
  `classroomId` it already knows (obtained however Learning Hub's own
  UI conveys it — out of scope here), and the raw `invitationCode` text
  the student/teacher shared.
- ClassMate returns: `{ ok: true, status: 'PENDING' | 'ACTIVE' }` or
  the generic failure shape below. Never anything about the roster.

**`verifyStudentCode({ learnerProfileId, classroomId, rawCode })`**
- Learning Hub provides: the same `learnerProfileId`/`classroomId`,
  plus the raw student verification code text.
- ClassMate returns, on success: `{ ok: true, classroomId, studentId }`
  — exactly enough for Learning Hub to record "this learner is this
  student in this classroom," and nothing else. No student name, no
  team data, no other roster fields.
- On any failure, for any reason: `{ ok: false, error:
  'verification_failed' }` — deliberately identical regardless of
  cause (§10, anti-oracle), so Learning Hub cannot use this endpoint to
  probe which codes, classrooms, or students exist.

ClassMate does not expose, and Learning Hub is not expected to need,
anything about `teams`, other students, teacher identities, or
classroom settings through this bridge. `learnerClassroomRelationships`
itself is readable only by the classroom's own ClassMate teacher (§7)
— Learning Hub never reads it directly; it only ever calls the two
functions above and consumes their return values.

## 14. A Test-Infrastructure Note (Not a Product Defect)

The two emulator-backed suites (`tests/rules/...` and
`tests/server/...`) share one real Firestore emulator instance,
started once via `firebase emulators:start --only firestore --project
demo-classmate-bridge-test`. Running them in the same `node --test`
invocation without `--test-concurrency=1` produced flaky, order-
dependent failures (transaction lock timeouts, spurious
`PERMISSION_DENIED`s) — both suites mutate/clear the same shared
Firestore project, and node's test runner otherwise executes separate
test files as concurrent processes. Serializing them
(`--test-concurrency=1`) makes the shared state safe and produces
fully deterministic, reproducible green runs (confirmed by re-running
the full suite this way twice). This is a property of how these two
new test files share a single emulator process, not a flaw in the
product code or in the rules themselves — both suites are 100% green
individually under any execution order.

## 15. Deliberate Scope Decisions

- **No `services/learnerConnectionService.js` wrapper layer.**
  `js/repositories/firestoreLearnerConnectionRepository.js` already
  exposes clean, purpose-named functions
  (`createClassroomInvitationForClassroom`, `revokeRelationship`,
  etc.); an additional pass-through service layer would be an
  abstraction with no behavior of its own. Added if and when a real
  second caller or cross-cutting concern (e.g., UI-level caching)
  demands it.
- The task referenced a file named
  `STUDENT_MODE_TO_LEARNING_HUB_MIGRATION.md`. No file by that exact
  name exists in this repository; the closest existing document is
  `STUDENT_PROFILE_MIGRATION_PROPOSAL.md`, which was read for context
  but not modified.

## 27. The Production Entry Point (Implemented This Round)

`functions/` is a new, minimal Cloud Functions v2 (HTTPS) package:

```
functions/
  package.json                          # firebase-admin, firebase-functions as RUNTIME deps (not root devDependencies)
  index.js                              # thin onRequest() glue — untested, unexercised, never deployed
  src/learningHubAuth.js                # verifies a Learning Hub ID token against Learning Hub's OWN project
  src/learnerProfileOwnership.js        # THE unresolved piece — see §28
  src/verifyLearnerConnectionEndpoint.js # framework-agnostic core: auth -> validate -> bind identity -> delegate
```

`firebase.json` gained a `"functions": {"source": "functions"}` block
and an `"auth"` emulator entry (port 9099) — the minimum needed for
this to be a real, testable Cloud Function target, not a wider
restructure.

**Why HTTPS `onRequest`, not a callable (`onCall`):** a callable
function's built-in `context.auth` is populated by verifying the
caller's token against the *function's own* Firebase project
(`classmate-302c2`). A genuine Learning Hub token would simply fail
that built-in check — not because it's invalid, but because it's from
the wrong project entirely — so relying on `context.auth` here would
silently reject every real caller. `onRequest` lets this endpoint do
its own explicit, correctly-scoped cross-project verification instead
(§28).

**Request contract** (POST only):

```
Authorization: Bearer <Learning Hub Firebase ID token>
Content-Type: application/json

{
  "learnerProfileId": "string",
  "classroomId": "string",
  "credentialType": "invitation" | "verification",
  "credential": "string"
}
```

`studentId` is never an accepted field — a request containing one is
rejected outright (400), not silently stripped (see §29's security
table).

**Response contract:**
- `401 { ok: false, error: 'unauthenticated' }` — no/invalid/wrong-project bearer token. Safe to distinguish from the domain-level failure below: it reveals nothing about any classroom, student, or learner, only "you are not an authenticated caller."
- `400 { ok: false, error: 'invalid_request' }` — malformed body, wrong types, unrecognized `credentialType`, or a `studentId` field present at all. Equally safe to distinguish — reveals nothing domain-specific.
- `200 { ok: false, error: 'verification_failed' }` — every domain-level rejection from this point on: unowned `learnerProfileId`, bad/expired/reused credential, wrong classroom, already-active relationship, anything — identical anti-oracle shape as the underlying module, extended to this new layer.
- `200 { ok: true, status: 'PENDING' | 'ACTIVE', classroomId, studentId? }` — exactly what `createConnectionRequest`/`verifyStudentCode` already returned; this endpoint does not reshape or add to it.

## 28. Cross-Project Identity Binding — What Was Implemented, and What Was Not

Two separate questions, answered differently, per the task's own
explicit "if not, STOP and document exactly what missing trust
mechanism prevents safe implementation" instruction:

**(a) "Is this really a Learning Hub caller?" — IMPLEMENTED.**
`functions/src/learningHubAuth.js` verifies the bearer token via a
SEPARATELY initialized, named Firebase Admin app configured with
`LEARNING_HUB_FIREBASE_PROJECT_ID` (an environment variable, never
hard-coded — see §30). This requires no Learning Hub secret: an ID
token's RSA signature is verified against Google's own public
certificate endpoint, identical for every Firebase project — the only
Learning-Hub-specific input is its (non-secret) project ID, used to
check the token's `aud` claim actually matches. Proven against the
real Auth emulator (`tests/functions/learningHubAuth.test.js`, 7/7):
valid token from the configured project succeeds; a real, well-formed,
unexpired token whose audience does NOT match the configured project
fails identically to a garbage string (anti-oracle preserved at this
layer too); a missing/empty/non-string token fails closed; an unset
`LEARNING_HUB_FIREBASE_PROJECT_ID` fails closed by throwing rather than
silently verifying against ClassMate's own default project.

**(b) "Does this verified uid actually own this `learnerProfileId`?" —
NOT IMPLEMENTED. Stopped at the boundary, per instruction.**
`functions/src/learnerProfileOwnership.js` always returns `false`
today. This is not an oversight or a shortcut — it is the honest
answer given what this repository actually has access to. Answering
(b) for real requires BOTH:
1. A real Learning Hub service-account credential, granted Firestore
   read access on Learning Hub's own project, provisioned for
   ClassMate's Cloud Function's runtime identity. Not present anywhere
   in this repository, and not something this task is authorized to
   invent or fabricate.
2. Learning Hub's actual, current Firestore schema for learner-profile
   ownership (collection name, field name). Not documented anywhere
   this repository has access to — the one existing sketch of
   `learnerProfiles` (`displayName`, `avatarRef`, `createdAt`,
   `createdVia`) names no owner-uid field at all; ownership is
   described elsewhere only as a separate, unspecified many-to-many
   account↔learner link.

Per the task's own instruction not to substitute an insecure client
assertion, this function does not trust the request body's own claim,
does not invent a schema, and does not attempt to read any Learning
Hub project. **Practical consequence: with today's real, production
default, no request — however well-authenticated — can reach an
ACTIVE relationship through this endpoint.** This was proven directly,
not assumed (`tests/functions/verifyLearnerConnectionEndpoint.test.js`,
"PRODUCTION DEFAULT" test): a fully authenticated, perfectly
well-formed request is still rejected with the generic failure, and no
Firestore document is created. This is the strongest currently-honest
guarantee against "Caller A submits Caller B's `learnerProfileId`" —
today, *no* caller, honest or not, gets through this gate. The rest of
the test suite exercises the pipeline's correctness (delegation,
concurrency, reuse, isolation) using an *injected* test-only resolver,
never the production default — clearly separated in the test file's
own comments so the override can never be mistaken for real behavior.

Two concrete candidate designs for actually resolving (b), for a
future round, neither implemented here (both require a decision made
*with* Learning Hub, not unilaterally):
- **(a) cross-project Firestore read** — Learning Hub grants a
  read-only credential + publishes its real schema; this function then
  performs the read the original task description envisioned.
- **(b) custom claims** — Learning Hub embeds the caller's authorized
  `learnerProfileId`(s) as a custom claim on its own ID tokens
  (`setCustomUserClaims`, on Learning Hub's own side); this function
  then reads the claim already present on the token
  `verifyLearningHubIdToken` decoded, with no cross-project Firestore
  read needed at all.

## 29. Security Table — What An Untrusted Client Can and Cannot Do Through This Endpoint

| Untrusted client attempt | Possible? | Why |
|---|---|---|
| Invoke the endpoint with no/invalid token | No | 401, before any Firestore access |
| Use a real token from a different Firebase project | No | `learningHubAuth.js`'s audience check, proven against the real Auth emulator |
| Submit `learnerProfileId` not their own | No (today: **nothing** can reach ACTIVE at all — see §28b) | `verifyLearnerProfileOwnership` fails closed unconditionally |
| Submit a `studentId` field directly | No | Rejected outright (400) if the field is present at all, regardless of value |
| Create an ACTIVE relationship directly | No | Endpoint never writes Firestore itself; only delegates to `createConnectionRequest`/`verifyStudentCode`, whose own rules (`create: if false`) and transaction logic are untouched |
| Reactivate a REVOKED relationship without a fresh verification code | No | Proven at the endpoint layer (`tests/functions/...`, REVOKED test) — an invitation replay restarts at PENDING, never ACTIVE |
| Redeem the same verification code twice | No | Proven at the endpoint layer; same transaction guarantee as the underlying module |
| Use a verification code issued for a different classroom | No | Proven at the endpoint layer |
| Win a race by redeeming the same code concurrently through two requests | No — exactly one succeeds | Proven at the endpoint layer with two genuinely concurrent calls |
| Learn *why* a request failed (wrong profile vs. bad code vs. wrong classroom vs. already active) | No | All domain-level failures return the identical `200 {ok:false, error:'verification_failed'}` |

## 30. Production Configuration

Required before this could ever be deployed (not done — see "What Was
Not Done"):
- **`LEARNING_HUB_FIREBASE_PROJECT_ID`** — Learning Hub's real Firebase
  project ID. Not secret, but not present in this repo; must be set as
  Cloud Functions runtime configuration (2nd-gen: an environment
  variable set at deploy time, e.g. via `--set-env-vars` or a
  `.env.<project>` file per the Firebase Functions docs — not
  committed to source control regardless, since it's
  environment-specific).
- **Whatever credential/schema the eventual §28 resolution needs** —
  either a Learning Hub-issued service-account key (stored in Secret
  Manager, never committed, never placed in this repository) or a
  Learning-Hub-side custom-claims change (no ClassMate secret at all
  needed for that path).
- **`functions/node_modules` and `functions/package-lock.json` do not
  exist yet** — `npm install` was deliberately not run inside
  `functions/` this round (no network-heavy, unnecessary setup for
  code that isn't being deployed); required before any real
  `firebase deploy --only functions`.
- ClassMate's own Firestore access (the `adminDb` the endpoint
  delegates to) uses the function's default, ambient Cloud Functions
  service account — no new configuration needed there, unchanged from
  how every other Google-Cloud-hosted Firestore Admin access already
  works in this project.

No service-account JSON, private key, or API secret was created,
invented, or committed anywhere in this round.

## What Was Not Done (Explicit, Per Task Instruction)

- **Not committed. Not pushed. Not deployed.** See final `git status`
  in the session report.
- Learning Hub was not opened, read, or modified.
- Student Mode (`StudentDeviceFlow.js`, `StudentJoinClassroomView.js`,
  `StudentRosterPickerView.js`, Goals, Recognition, Feed, Today,
  assignments UI, student analytics, Parent Access, Avatar Builder) was
  not touched.
- `studentAuthLinks` was not restored.
- `CONFLICT-0001` was not resolved or touched.
- ~~The actual Cloud Function wrapping
  `server/learnerVerification/verifyLearnerConnection.js` (IAM binding,
  service account, `firebase deploy --only functions`) was not
  provisioned — that module is the tested logic the function will
  wrap, not the deployed function itself.~~ **Superseded: the Cloud
  Function scaffold now exists (§27) and is tested, but was never
  deployed** — no `firebase deploy` was run, `functions/node_modules`
  was never installed, and no IAM/service-account provisioning was
  performed.
- The cross-project learner-profile-ownership check
  (`functions/src/learnerProfileOwnership.js`) was deliberately left
  unimplemented, failing closed — see §28 for the full reasoning and
  the two candidate designs for resolving it.
- The pre-existing permissive `classrooms/{classroomId}` `get` rule
  (§11) was not modified, per instruction not to undertake an
  unrelated security rewrite — it is documented here as a known,
  inherited gap that does not, on inspection, compromise this bridge.
