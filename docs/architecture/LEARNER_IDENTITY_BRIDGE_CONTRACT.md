# Learner Identity Bridge Contract

**Status: architecture/security contract audit only. Nothing
implemented.** No application code, Firestore rule, Firestore data,
authentication logic, route, UI, Cloud Function, or deployment
configuration was created or modified to produce this document. This
document re-traces the current implementation directly rather than
relying on the two prior audit documents in this folder — and, in
doing so, **corrects one material claim** from
`STUDENT_PROFILE_ARCHITECTURE_AUDIT.md` (see §6). Read that correction
before relying on either document's framing of `studentAuthLinks`.

**Update:** §§22–26 were added after this contract's original §20
open decisions 1 and 2 were reviewed and approved. §21 and the
"Contract Readiness" section are left in place with their original
reasoning struck through rather than deleted, so the approval's context
remains visible. Still nothing implemented — see the confirmation at
the end of this document, updated for this round.

---

## 1. Purpose

Determine the safest, smallest mechanism by which ClassMate can
establish, and Learning Hub can trust, the fact: *"this authenticated
learner is this ClassMate roster student, and is a member of this
classroom."* This document traces what exists today, in enough detail
to make that determination possible — it does not build the mechanism.

## 2. Non-Goals

Not in scope: implementing anything; modifying Firestore rules, data,
or auth; restoring `studentAuthLinks`; resolving CONFLICT-0001;
choosing a final schema; writing Cloud Function code. Where the
investigation surfaces a genuine open question, it is recorded in §20,
not answered.

---

## 3. Current Identity Architecture

Answering the 13 required questions directly, each grounded in a
specific file:

1. **What creates a Student Mode identity?** Entering a classroom's
   `classroomStudentJoinCode` and picking a name off the real roster
   (`StudentJoinClassroomView.js` → `StudentRosterPickerView.js`),
   confirmed live via `js/main.js`'s own import of
   `StudentDeviceFlow.js`.
2. **What persists it?** Two `localStorage` keys on one specific
   browser: `bloomLabsDeviceApprovedProfiles` (up to 3 `{classroomId,
   studentId, studentName, slotIndex}` entries) and
   `bloomLabsDeviceActiveStudentId` (`studentDeviceService.js`).
   Nothing server-side persists "which device/browser this is."
3. **Is it device-specific?** Yes — by construction, not by omission.
   A second browser/device has no access to the first's `localStorage`
   and must independently rejoin from scratch.
4. **Is it slot/profile-specific?** Yes — a device holds up to
   `MAX_APPROVED_PROFILES = 3` slots, each with its own **anonymous**
   Firebase Auth identity in its own named Firebase App instance
   (`studentAuthService.js`'s `studentSlot0/1/2`), never shared with
   the teacher's own default-app Auth session.
5. **Is it person-specific?** No. Nothing anywhere binds a slot's
   anonymous uid, or the device's `localStorage` entry, to a real
   human. `models/Student.js` has no identity/auth field at all (§5).
6. **Can the same student move to another device?** Yes, freely — by
   re-running the entire join flow on the new device. This produces a
   **new**, independent local approval and a **new** anonymous uid
   (via a fresh slot on that device) with no link back to the first
   device's identity for that same real student.
7. **Can two students use the same device?** Yes, up to 3, **but only
   if they are in the same classroom** — `studentDeviceService.addApprovedProfile()`
   structurally rejects a profile from a different `classroomId` than
   whatever is already approved on that device.
8. **Can one student have multiple device identities?** Yes,
   unboundedly across devices (each device's join is independent), and
   up to 3 *slots* within one device if, implausibly, the same student
   were separately re-added to their own device more than once (not a
   normal flow, but nothing structurally prevents it).
9. **Current roster identifier:** `Student.id` (`models/Student.js`),
   a `generateId()` UUID, nested inside
   `classrooms/{classroomId}.teams[].students[]`. No top-level
   Firestore document of its own.
10. **Current authenticated identifier:** the per-slot anonymous
    Firebase Auth `uid` (`studentAuthService.js`), scoped to one named
    Firebase App per slot, per device.
11. **Where are they connected?** Nowhere durable, today, for the
    default (live) join flow. See §5 for the full trace of every place
    a connection is *attempted*.
12. **Who can create that connection?** Depends which mechanism —
    see §5/§6; the live default path creates no server-verified
    connection at all.
13. **What prevents a client from claiming another student's ID?**
    Nothing cryptographic. `Student.id` is visible to any device that
    can read the classroom document (open to `if (member) || true` —
    §7), and nothing checks that the caller claiming to write "as"
    that `studentId` is the same device/session that originally joined
    as them. This is the load-bearing finding of §7.

---

## 4. Current Classroom Join / Membership Flow

Traced directly (`StudentJoinClassroomView.js`, `StudentRosterPickerView.js`,
`StudentDeviceFlow.js`, `workspaceService.js`, `firestore.rules`), the
**actual, live** flow is:

```
Student device (browser, no prior state)
    ↓
Enter classroomStudentJoinCode
    ↓ workspaceService.resolveStudentJoinCode(code)
    ↓   → studentJoinCodes/{code}  (allow read: if true — fully open)
    ↓   → classrooms/{classroomId} (allow get: if (member) || true — open)
Real roster returned (teams[].students[])
    ↓
Student picks their own name
    ↓ studentDeviceService.addApprovedProfile({classroomId, studentId, studentName})
    ↓   (localStorage only — no Firestore write yet)
    ↓ workspaceService.markStudentJoinedPortal(classroomId, studentId)
    ↓   (best-effort write of a `hasJoinedPortal` flag; see §7 — this
    ↓    write has no supporting Firestore rule and is expected to fail
    ↓    silently in production, per firestore.rules' own "NOT YET
    ↓    SUPPORTED" comment block)
Device now "approved" for this studentId, this classroom
```

**No anonymous sign-in happens in this default path at all.**
`studentAuthService.ensureAnonymousSignIn()` is only invoked later, on
demand, by specific downstream features that need it (Learning Circle
— §5) — not as part of joining itself. This means: for a student who
has only ever joined a classroom and never opened Learning Circle,
**no Firebase Auth identity of any kind exists for them.** Their entire
"identity" is two `localStorage` keys.

A second, code-present-but-unreachable path
(`StudentEnrollmentCodeView.js` → `enrollmentService.js` →
`firestoreEnrollmentRepository.js`) exists for a **teacher-issued
token → anonymous-uid binding**, described fully in §6 — it is not part
of the live flow.

---

## 5. Current Roster-to-Authentication Binding

Every place a `studentId` and a `uid` co-occur, traced directly:

| Where | `uid` source | Binding mechanism | Verified? |
|---|---|---|---|
| `classroom.teams[].students[].hasJoinedPortal` | none (no uid involved) | a boolean flag, best-effort write, unsupported by any rule | N/A |
| `classrooms/{id}/studentGoals/{goalId}` | per-slot anonymous uid | `request.resource.data.uid == request.auth.uid` at write time; **the document's own comment claims a `studentAuthLinks` cross-check still happens — it does not** (§6, the correction) | **Self-attested only.** Anyone with a valid anonymous uid can write a goal claiming any `studentId` they like; the rule never checks that `studentId` belongs to that `uid`. |
| `classrooms/{id}/programmeSessions/{sid}/studentEntries/{studentId}` | per-slot anonymous uid | `isLinkedActiveStudent()` — a real two-hop rule: resolves the session's `programmeId`, then `get()`s `membershipLinks/{request.auth.uid}` and checks `link.data.studentId == studentId && status == 'active'` | **Genuinely verified**, but only for Learning Circle, and only if a `MembershipLink` was ever created (§ below) |
| `classrooms/{id}/learningProgrammes/{pid}/membershipLinks/{uid}` | per-slot anonymous uid (doc id) | created by `firestoreEnrollmentRepository.ensureLearningProgrammeMembershipLink()`, called from `studentLearningCircleService.ensureProgrammeMembershipLink()` — **live**, reachable via `#/student/.../learning-circle` (`main.js` line ~665) | Self-attested at creation ("this uid claims this studentId"), then structurally enforced thereafter by the listless `get()` — see §6/§7 for exactly what this does and does not prove |
| `classrooms/{id}/studentAuthLinks/{studentId}` | per-slot anonymous uid | `firestoreEnrollmentRepository.createStudentAuthLinkDirect()` / `redeemEnrollmentToken()` | **Dead.** No matching Firestore rule exists at all (§6) — any write attempt is denied by the deny-by-default backstop. |
| `classrooms/{id}/feedPosts/{postId}` | per-slot anonymous uid | `request.resource.data.uid == request.auth.uid` | Self-attested only — same shape as `studentGoals`, and the rules file says so explicitly (line ~441). |

**Conclusion:** exactly one collection (`membershipLinks`, feeding
`studentEntries`) has a genuinely rule-enforced uid↔studentId check
today. Everything else that looks like a binding is either (a) a
self-attested `uid == request.auth.uid` match with no cross-reference
to *which* studentId that uid is allowed to claim, or (b) inert code
with no supporting rule at all.

---

## 6. StudentAuthLinks Investigation

**This section corrects `STUDENT_PROFILE_ARCHITECTURE_AUDIT.md`'s
framing.** That document described `studentAuthLinks` as "built once,
then removed... rolled back," inferred solely from `firestore.rules`'
own retrospective comments, without checking whether the code itself
still existed. It does.

- **What it was intended to do:** establish a verified, server-checked
  mapping `classrooms/{classroomId}/studentAuthLinks/{studentId} → {uid,
  linkedAt, sourceToken}` — exactly the "roster student ↔ authenticated
  uid" binding this whole investigation is looking for. Two creation
  paths were built: a teacher-issued, single-use `enrollmentTokens/{token}`
  redemption (`redeemEnrollmentToken`), and a no-token "device's first
  student" direct link (`createStudentAuthLinkDirect`).
- **Where it exists today:** the full repository module,
  `js/repositories/firestoreEnrollmentRepository.js`, is present,
  complete, and internally consistent (writeBatch, deterministic
  cross-references, idempotency comments). Its callers,
  `js/services/enrollmentService.js` and
  `js/ui/student-portal/onboarding/StudentEnrollmentCodeView.js`, also
  still exist.
- **Whether any production code still references it:** the *code*
  does (the files above). Confirmed via `grep`, `StudentEnrollmentCodeView.js`
  has **zero importers anywhere else in the tree** — it is not rendered
  from `StudentDeviceFlow.js`, `StudentManageProfilesView.js`, or
  `main.js`. It is unreachable, exactly like `studentIdentityService.js`
  from the prior audit — present, not deleted, not wired in.
- **Why the rules indicate it was rolled back — precisely:** there is
  **no `match` block at all**, anywhere in `firestore.rules`, for either
  `enrollmentTokens/{token}` or
  `classrooms/{classroomId}/studentAuthLinks/{studentId}`. The file's
  own explicit backstop —
  `match /{document=**} { allow read, write: if false; }` (confirmed at
  the file's end) — means **any attempt to actually call
  `createEnrollmentToken`/`redeemEnrollmentToken`/`createStudentAuthLinkDirect`/
  `getStudentAuthLink` today is denied by Firestore itself**, regardless
  of whether the calling application code runs. This is the concrete,
  verifiable meaning of "rolled back": the security rules that would
  authorize these documents were removed (or never re-added); the
  application code that would write them was left in the tree, unused.
- **Whether any current functionality depends on it:** no live feature
  depends on `studentAuthLinks` specifically. `studentGoals`' own write
  rule was rewritten to a bare self-match specifically *because*
  `studentAuthLinks` is gone (`firestore.rules` line ~288: *"no longer
  cross-references... studentAuthLinks... A student write is now
  authorized by a direct match... instead"*) — **but the repository
  comment in `firestoreStudentGoalsRepository.js`
  (`submitGoal()`, line ~91: "the create/update rule still verifies
  this uid against studentAuthLinks at write time") is stale and
  describes behavior the current rules do not implement.** This is a
  genuine, citable inconsistency between a code comment and the actual
  enforced rule — evidence that reasoning from comments/naming alone
  (rather than the rules text itself) would have produced a wrong
  conclusion here.
- **Whether its underlying design is still useful:** yes, structurally.
  Its shape (deterministic doc id, atomic batch linking a token's
  consumption to the resulting link, rules validating each half via a
  known-path `get()`) is the same pattern that `MembershipLink` later
  reused successfully for Learning Circle. It is a reasonable reference
  design, not a reason to restore this specific collection.
- **What security property it was supposed to provide:** a real,
  rule-enforced answer to "is the caller's own `request.auth.uid`
  genuinely linked to this specific `studentId`" — precisely the gap
  `studentGoals`' current self-attested rule still has today.

---

## 7. Current Trust Boundaries

For the load-bearing identity transitions, SOURCE → CLAIM →
VERIFICATION → AUTHORIZED WRITE → PERSISTED RELATIONSHIP:

**Joining a classroom (default, live path):**
- SOURCE: anyone who has the `classroomStudentJoinCode` (a
  human-readable code, not a secret keyed to any account).
- CLAIM: "I am `studentName`, in this classroom's real roster."
- VERIFICATION: **none.** The code resolves to a real classroom (a
  document lookup), and the roster is real, but nothing verifies the
  *caller* is the real person named. This is **hard to guess** (the
  code isn't published), not **cryptographically verified** (no proof
  of identity is ever checked) — these are different properties, and
  the current design only has the first.
- AUTHORIZED WRITE: none required — `studentDeviceService.addApprovedProfile()`
  is a pure `localStorage` write, needing no Firestore permission at
  all for the first profile on a fresh device.
- PERSISTED RELATIONSHIP: **device-local only.** No Firestore document
  records "this device/person is this studentId" as a result of this
  flow.

**Writing a student goal (`studentGoals`):**
- SOURCE: whatever anonymous uid the device's active slot currently
  has (`studentAuthService.ensureAnonymousSignIn()`).
- CLAIM: `{studentId, uid}` in the write payload.
- VERIFICATION: `request.resource.data.uid == request.auth.uid` — this
  proves the caller controls *some* anonymous uid and is being honest
  about *which* uid it is. **It does not prove that uid, or the device
  behind it, has any real relationship to the claimed `studentId`.**
  Any device with any valid anonymous uid can submit a goal for any
  `studentId` in that classroom it can read (which is any `studentId`,
  since roster reads are open).
- AUTHORIZED WRITE: allowed, per the rule above.
- PERSISTED RELATIONSHIP: a `studentGoals` document exists, denormalizing
  `uid` — but that `uid`↔`studentId` pairing was never independently
  checked against anything.

**Learning Circle entry (`studentEntries`, via `MembershipLink`):**
- SOURCE: the device's active slot's anonymous uid.
- CLAIM: `ensureLearningProgrammeMembershipLink()` writes
  `membershipLinks/{uid} = {studentId, status: 'active'}` — a
  **self-attested claim at creation time**, exactly like the goal
  write above, with one structural difference: this claim is
  **immutable once created** (`allow update: if false`) and every
  *subsequent* read/write against `studentEntries` is checked against
  it via a real `get()`, rather than trusting a fresh, unverified claim
  on every single write.
- VERIFICATION: at *creation*, none stronger than the goal-write case —
  whatever `studentId` the client supplies is what gets bound to that
  uid, once. **`MembershipLink`'s own model file is explicit about
  this**: *"do not describe this as cryptographic proof of real-world
  student identity... this document establishes exactly one thing —
  this specific uid has, at some point, self-attested a specific
  claimed studentId."*
- AUTHORIZED WRITE: allowed, once, then locked.
- PERSISTED RELATIONSHIP: durable (until the uid/device is abandoned),
  rule-enforced for every subsequent access — the strongest binding
  that exists anywhere in this codebase today, while still being
  self-attested at its one moment of creation.

**Named-value summary:** this codebase's own comments already draw the
"hard to guess" vs. "verified" line correctly in the one place it
matters most (`MembershipLink`'s own doc comment) — the risk is
elsewhere, where naming (`studentAuthLinks`, `uid` fields, "linked")
could be mistaken for verification when tracing the actual rule text
shows otherwise (`studentGoals`, `feedPosts`).

---

## 8. Cross-Product Identity Requirements

Restating the target shape from the prompt, unchanged: Google Account
→ Firebase UID → Learner Profile → Learning Context (Independent /
Classroom) → Classroom Membership → ClassMate Student. The requirement
that **one Google account can house two Learner Profiles, each
independently mapped to a different ClassMate Student**, is the single
hardest constraint the rest of this document tests every candidate
against — because, per §7, nothing in the current architecture
distinguishes "two children on one account" at all; every existing
binding (self-attested `uid`, or `MembershipLink`'s uid-keyed doc) is
built around **one uid → one claimed identity**, never one uid → many.

---

## 9. Candidate Identity Bridge Models

**(A) Existing anonymous ClassMate UID.** Per-device, per-slot,
non-durable (§3.6), no email/account behind it, cannot survive a
device change, cannot distinguish siblings beyond 3 device-local slots.

**(B) Existing roster `studentId`.** Durable *within one classroom's
own data*, but has no relationship to any authentication whatsoever
(`models/Student.js` has no auth field) and — per the audit already on
file — likely changes on re-enrollment in a new classroom.

**(C) Google/Firebase UID (Learning Hub's own).** Real, durable,
account-level. **Cannot, by itself, distinguish two learners sharing
one account** — this is the exact case the prompt calls out, and no
evidence anywhere in this codebase suggests otherwise.

**(D) A new stable learner identifier.** Doesn't exist yet anywhere in
ClassMate; would be a genuinely new concept, not a repurposing of A/B/C.

**(E) A verified mapping (UID ↕ Learner Profile ↕ ClassMate Student).**
The shape `MembershipLink` already partially demonstrates (uid-keyed,
listless, immutable) — but `MembershipLink` itself maps **uid directly
to studentId**, one-to-one per document, which is the same "can't
distinguish two learners on one uid" limitation as (C) unless
generalized to route through a separate Learner Profile layer first
(exactly what the two prior design documents in this folder already
proposed, not re-litigated here).

**(F) Teacher-mediated classroom connection.** ClassMate already has
this exact shape live today for a *different* relationship (co-teacher
join, `isSelfOnlyJoin()`) and dormant for this one
(`enrollmentTokens`/`studentAuthLinks`, §6) — a real, previously-designed
precedent, currently unreachable.

**(G) Student-mediated one-time connection.** The *default live flow
today* (§4) is exactly this, minus any verification step at all — code
+ roster pick, no proof of identity, no durable server-side link.

**(H) Hybrid.** Combining F (teacher issues a verifiable credential)
with E (a generalized, uid-through-Learner-Profile mapping) is what the
two prior design documents already proposed; this document does not
re-select it, only confirms the trace supports treating it as viable
(§10).

---

## 10. Comparison of Candidate Models

| | Identity meaning | Persistence | Cross-device | Shared account | Server verification | 2nd competing identity? |
|---|---|---|---|---|---|---|
| A. Anonymous UID | a device+slot | device-local | **no** | n/a (device concept, not account) | none | — |
| B. `Student.id` | a roster row | durable per-classroom, not cross-classroom | n/a (not auth) | n/a | none | — |
| C. Google/Firebase UID alone | an account | durable | yes | **cannot distinguish learners** | strong (Google's own) | risk: if used as learner id, yes |
| D. New learner identifier | a real learner | as durable as designed | yes, by design | yes, by design | depends entirely on how it's bound | only if built alongside, not instead of, existing ids |
| E. Verified uid↕profile↕student mapping | the binding itself | durable, rule-enforced | yes | yes, if routed through a profile layer, not uid directly | yes, at least at creation (`MembershipLink`'s own honest caveat) | no — it's the connective tissue, not a new identity |
| F. Teacher-mediated | an issued credential | as durable as the resulting link | yes | yes | strong, if redemption is properly gated (§ security review already on file) | no |
| G. Student-mediated one-time (today's live default) | a self-asserted claim | device-local only, today | no | n/a | **none** | no, but also proves nothing |
| H. Hybrid (F issuance + E-style verified mapping) | combines both | durable | yes | yes | strong | no |

Migration complexity and compatibility notes: A and B are already-live,
zero-migration-cost, but structurally cannot meet §8's requirement. C
alone is explicitly ruled out by the prompt's own instruction and by
this trace (no distinguishing mechanism exists or could exist from a
bare uid). D/E/H are additive to current ClassMate data (no existing
collection needs to change) and compatible with Learning Hub owning
its own Learner Profile concept, per the ownership split already
established in the two prior documents in this folder.

---

## 11. Shared Google Account Model

```
One Google Account (one Firebase UID)
    ├── Learner Profile A → ClassMate Student A
    └── Learner Profile B → ClassMate Student B
```

The UID cannot distinguish A from B — nothing in Firebase Auth, and
nothing in this codebase's own trust model (§7), ever attaches more
than one claimed identity to one uid safely (the closest existing
precedent, `MembershipLink`, is keyed **one document per uid**, a
1:1 shape). Distinguishing A from B therefore **requires an
intermediate Learner Profile layer** that the UID points to a *list*
of, with each list entry independently carrying its own binding to a
ClassMate Student — not the uid pointing at a student directly. This
document does not name a schema for that (already covered, not
re-specified here) — it confirms the *reason* it's structurally
necessary, directly from how `MembershipLink` is shaped today.

---

## 12. Device Migration Model

```
Student on Device A → joins classroom, approved locally
    ↓ (time passes; new device)
Student on Device B → nothing carries over
```

Confirmed directly: `studentDeviceService`'s approved-profile list and
active-profile pointer are `localStorage`-only (§3.2); `studentAuthService`'s
anonymous uid is scoped to a named Firebase App per device+slot,
regenerated fresh per device. **Current ClassMate identity does not
survive a device change.** Architectural consequence: any bridge that
uses the anonymous per-device uid (Candidate A) as the cross-product
identity would inherit this exact non-durability into Learning Hub —
precisely what the prompt instructs not to do, and what this trace
independently confirms is true today.

---

## 13. Classroom Connection Model

| | Who initiates | Who authorizes | What is verified | Persistence | Revocation | Guessable/shareable? | Code = identity or connection mechanism? |
|---|---|---|---|---|---|---|---|
| **Today's live join-code flow** | student/family | nobody | nothing about the caller's real identity | device-local (`localStorage`) only | uninstall/clear storage, or teacher's `deviceResetPin` for a 2nd+ profile | yes — the code is classroom-wide, not per-student, and grants read-only roster visibility to anyone who has it | **connection mechanism only** — explicitly documented as such (`models/Classroom.js`: "never a `members` entry") |
| **Dormant enrollment-token flow** (§6) | teacher | teacher (issues token), then the rules (validate redemption) | that the redeeming device's uid matches a real, teacher-issued, unused, unexpired token for that specific student | would be durable (`studentAuthLinks`), if rules existed | none built | no — single-use, teacher-scoped, presumed short-lived (not verified — code is unreachable) | connection mechanism, scoped to one specific student, stronger than the join code |
| **Teacher invites / learner accepts** (not built for students; exists for co-teachers via `isSelfOnlyJoin()`) | teacher | learner accepts | the accepting uid genuinely becomes a `members` entry, narrowly, additively | durable, real `memberUids` | removal from `members` | no — scoped to the specific invited party, if built with a real per-invite token | would be identity **and** connection, if built — stronger than either existing student mechanism |

The join code today is unambiguously a **connection mechanism**, never
an identity — it resolves a classroom, not a person, and the codebase's
own model-file comment says so explicitly (§4, §13 table).

---

## 14. Authentication vs Learner Identity vs Student vs Membership vs Authorization

Kept fully separate, as instructed, with today's actual state for each:

- **Authentication** — "who controls the authenticated account." Today:
  a per-device, per-slot **anonymous** Firebase Auth uid
  (`studentAuthService.js`), created on demand, not at join time, not
  tied to any Google account.
- **Learner identity** — "which human is using the account right now."
  Today: **does not exist as a concept anywhere in ClassMate.** The
  closest analog is the device's locally-remembered `{studentId,
  studentName}` — not an identity, a cached pointer.
- **ClassMate Student** — "which roster entity represents that learner."
  Today: `Student.id`, nested inside one classroom's document, with
  zero auth linkage of its own (§3.9).
- **Classroom Membership** — "which classroom(s) is the learner
  associated with." Today: **for students, this concept does not exist
  in the same sense it does for teachers.** `classroom.members`/`memberUids`
  (real, rule-enforced access control) has never had a student/parent
  entry written to it — confirmed directly in `config/memberRoles.js`:
  *"No code path currently assigns either role to a real uid, and
  neither has any permission yet."* What *does* exist for students is
  either an unverified roster row (§3.9) or, for Learning Circle
  specifically, a `MembershipLink` (§5) — neither is "classroom
  membership" in the access-control sense teachers have.
- **Authorization** — "what the learner can access/modify." Today:
  almost entirely self-attested (`uid == request.auth.uid` on
  `studentGoals`/`feedPosts`), with exactly one exception
  (`studentEntries`, gated by the real `MembershipLink` check).

**This is the concrete, evidence-based form of the prompt's own
"CLASSROOM MEMBERSHIP ≠ VERIFIED LEARNER IDENTITY" finding**: they are
not merely conceptually distinct — for students, *neither currently
exists in a rule-enforced form at all*, except narrowly for Learning
Circle.

---

## 15. Deep-Link Boundary

Traced directly, `learningHubLaunchUrlService.js` carries **only
content/resource context**: an entry `type` (`mission` / `concept` /
`element-journey` / `root-journey` / `sound-journey` / `listen-read`)
and an opaque id, assembled into `<host>/?entry=<type>:<id>`. Confirmed
by reading both exported functions in full:
- `buildLearningHubLaunchUrl(type, id)` — pure string construction, zero
  imports, zero DOM, zero Firebase.
- `resolveLearningHubConceptBucketUrl(concept)` — passes through
  `concept.learningHubConcept.conceptId` unchanged; returns `null`
  rather than a malformed URL if absent.

**Carries:** content/resource identity only. **Does not carry:**
student identity, classroom identity, learner profile identity, or any
authentication proof, in any form, anywhere in this file or its
(zero) dependencies. This is a genuinely clean boundary already — the
risk is entirely in how a *future* caller might be tempted to embed
identity into this URL, not in anything the file does today. Per the
prompt's own instruction, this document treats it strictly as a
content pointer and nothing more.

---

## 16. Source-of-Truth Matrix

| Concept | ClassMate | Learning Hub | Shared Contract | Unknown |
|---|---|---|---|---|
| Authentication | teacher Google Auth (real); student anonymous per-device (real, but not person-level) | Google/Firebase Auth (per prior design docs, not yet built) | — | whether ClassMate's teacher-side auth and Learning Hub's learner-side auth are ever the same Firebase project (no evidence found either way) |
| Learner Profile | does not exist | proposed, not built (see prior design docs) | — | — |
| ClassMate Student | ✅ authoritative (`Student.id`, nested in classroom doc) | — | — | — |
| Classroom | ✅ authoritative (`classrooms/{id}`) | — | — | — |
| Classroom Membership (teacher/co-teacher) | ✅ authoritative (`members`/`memberUids`) | — | — | — |
| Classroom Membership (student) | ⚠️ **does not exist in rule-enforced form** (§14) | — | this is precisely the gap this whole contract audit exists to close | — |
| Curriculum | ✅ ClassMate-owned (Units/Concepts pipeline, per `ARCHITECTURE.md`) | — | — | — |
| Concepts | — | — | — | **CONFLICT-0001**: "Concept" names three unrelated things across the two products with no shared ID space today; do not assume a shared meaning here (§19) |
| Learning evidence / attempts / responses | — | ✅ Learning Hub-owned, per your stated product-ownership split | — | — |
| Goals (`studentGoals`) | ✅ ClassMate-owned today | — | — | whether this stays ClassMate-owned once Learning Hub owns "learning history" broadly, or is redefined as a ClassMate-side, teacher-facing thing distinct from Learning Hub's own goal/evidence concept |
| Recognition / scoring / Achievement Events | ✅ ClassMate-owned (per this project's own prior Badge & Achievement Engine work) | — | — | — |
| Feed (`feedPosts`) | ✅ ClassMate-owned | — | — | — |

---

## 17. Existing-Data Migration Considerations

Not implemented; analysis only.

- **Existing anonymous students (no Google link ever made):** their
  device-local approval and any `MembershipLink`s they hold remain
  fully functional under any new bridge, since nothing in this proposal
  requires removing the current live flow. No deterministic migration
  is possible for these — there is no server-side record connecting
  them to any real person to migrate *from*.
- **Existing classrooms / roster students:** unaffected structurally —
  `Student.id` and the classroom document shape are not proposed to
  change.
- **Students with existing progress** (`studentGoals`, `studentEntries`,
  scoring, achievements): all keyed to `studentId`/`classroomId`
  already — a future bridge that adds a Learner Profile layer *on top*
  of these, rather than replacing their keys, requires no backfill of
  this historical data.
- **Students who change devices, or share a device:** covered by §12 —
  deterministic migration isn't applicable since no durable identity
  exists yet to migrate.
- **Students who share a Google account:** cannot be deterministically
  resolved automatically — distinguishing which real child a given
  Learner Profile represents, when two share one account, is exactly
  the case requiring an explicit linking action (teacher-issued
  credential or equivalent), not something inferable from existing
  data.
- **Students who never connect Google:** by design, remain on the
  current live flow indefinitely, per the two prior design documents'
  own phased migration strategy (not repeated here).
- **Existing Learning Hub users, existing ClassMate teacher users:**
  outside this document's scope — no student-mode data references them
  directly.

**Where explicit confirmation is required, not deterministic:** any
case where a real-world child's identity must be established for the
first time as a Learner Profile — there is no existing ClassMate data
field that already proves this, for any student, today (§3.13). This
is not a migration gap to engineer around; it is the fundamental
reason a verification step is required at all.

---

## 18. Target Security Properties

For each, CURRENT vs. TARGET, per the prompt's own list:

1. *A learner cannot claim another learner's ClassMate student.*
   **CURRENT: not guaranteed** — `studentGoals`/`feedPosts` accept any
   `studentId` from any caller with any valid anonymous uid (§7).
   **TARGET: required.**
2. *A learner cannot claim membership in another classroom merely by
   knowing its ID.* **CURRENT: partially true by obscurity** —
   `classrooms/{id}` reads are open to anyone who has the id, but
   `Firestore.list` is denied, so ids aren't discoverable by scanning;
   this is "hard to guess," not "verified," per §7's own distinction.
   **TARGET: required as genuine verification, not obscurity.**
3. *A classroom code is not itself a permanent identity.* **CURRENT:
   already true** — confirmed directly, the student join code grants
   only transient roster visibility, never a `members` entry
   (`models/Classroom.js`'s own comment, §4/§13). **No change needed
   here.**
4. *URLs do not establish authorization.* **CURRENT: already true**
   for the one URL mechanism that exists (§15) — but this is a property
   to explicitly preserve going forward, not one enforced by any rule;
   it holds today only because the deep-link file happens to carry no
   identity at all.
5. *A Google UID alone does not identify a specific child in a
   shared-account household.* **CURRENT: not applicable yet** (no
   Google UID is in the student-mode picture at all today). **TARGET:
   required**, and — per §9/§11 — structurally impossible to satisfy
   with a bare UID regardless of implementation, only with an
   intermediate profile layer.
6. *Learner Profile identity is distinguishable from authentication
   identity.* **CURRENT: N/A**, Learner Profile doesn't exist yet.
   **TARGET: required**, and directly why Candidate C is ruled out as a
   standalone identity (§9).
7. *Classroom membership is explicitly represented and verified.*
   **CURRENT: not true for students** (§14). **TARGET: required.**
8. *Revoked classroom membership stops classroom access.* **CURRENT:
   no revocation mechanism exists for student "membership" at all**,
   because no verified membership exists to revoke (§14). `MembershipLink`
   is explicitly immutable (`allow update: if false`) — today, by
   design, it cannot be revoked either. **TARGET: required**, and a
   genuinely new property, not an extension of anything live today.
9. *Cross-product identity mapping cannot be silently overwritten by
   arbitrary client writes.* **CURRENT: mixed** — `MembershipLink`
   already achieves this for its own narrow scope (immutable after
   creation); `studentGoals`' denormalized `uid` field does not (any
   subsequent write with a matching `request.auth.uid` can freely
   restate it). **TARGET: required uniformly**, wherever a real
   cross-product mapping is introduced.

None of these nine properties should be assumed already implemented
outside the one exception (Learning Circle's narrow, single-purpose
case) called out explicitly above.

---

## 19. CONFLICT-0001 Boundary

Not resolved here, per instruction. Recorded dependency: this identity
bridge contract's own scope (Authentication → Learner Profile →
Classroom Membership → ClassMate Student) does **not**, on its own,
require resolving what "Concept" means across the two products — no
candidate model in §9/§10 depends on a shared `conceptId` space. The
one place this contract's own §16 source-of-truth matrix *touches*
CONFLICT-0001 is the "Concepts" row, where this document explicitly
declines to assume a shared meaning, per the existing conflict record's
own instruction (*"any future task... involving conceptId must check
this record... before assuming shared meaning"*). If a future
implementation of this bridge ever needs to reference a *concept* (e.g.
learning evidence scoped to a specific concept a learner is working
on), that is the moment CONFLICT-0001 becomes load-bearing for this
work — flagged here as an **open decision (§20)**, not addressed
further.

---

## 20. Open Architectural Decisions

1. **RESOLVED — see §22.** Whether the eventual bridge generalizes
   `MembershipLink`'s existing uid-keyed pattern (routed through a
   Learner Profile layer, per §11) or introduces a structurally new
   mechanism. ~~the two prior design documents in this folder already
   lean toward generalizing `MembershipLink`; this document's fresh
   trace does not contradict that lean, but also does not re-ratify it
   as final here.~~ Approved: generalize the *pattern* (§25), not the
   collection.
2. **RESOLVED — see §22.** Whether classroom membership, in the
   access-control sense, is ever extended to students via the
   already-reserved but unused `MEMBER_ROLES.STUDENT`/`PARENT`
   placeholders (`config/memberRoles.js`), or whether student
   "membership" remains a structurally separate concept from teacher
   `memberUids` membership permanently. ~~Evidence found: the
   placeholders exist specifically anticipating this question,
   unresolved by design ("a decision for when authentication is
   approved").~~ Approved: **separate, for now** (§22, §24) — the
   `STUDENT`/`PARENT` placeholders in `config/memberRoles.js` remain
   exactly what they were, untouched, reserved, and unassigned;
   nothing in this decision consumes or resolves them.
3. Whether the dormant `enrollmentTokens`/`studentAuthLinks` collections
   should be formally deleted (dead code cleanup) or left as reference
   material for the new bridge's design, given §6's finding that their
   *pattern* (not their exact schema) is still a reasonable precedent.
   This document takes no position — deletion is itself a Firestore/
   code change, out of scope here.
4. Whether the (also currently unreachable) `studentIdentityService.js`/
   `StudentLinkRepository.js` interface layer (documented in the first
   audit) or a newly-designed contract better fits the eventual bridge
   — not re-decided here, flagged as still open.
5. Whether "Classroom Membership" as a first-class, revocable, verified
   entity (§18 property 7/8) is scoped to student-mode only, or is
   designed to eventually also formalize what `memberUids` already does
   for teachers, unifying the two — a genuinely large architectural
   question this document surfaces but does not attempt to answer.
6. The CONFLICT-0001 dependency noted in §19, if and when learning
   evidence needs concept-level scoping.

## 21. Recommended Next Step

**Superseded by §22 — decisions 1 and 2 are now resolved.** This
section is left in place, struck through rather than deleted, so the
reasoning that led to the approval remains visible rather than
silently disappearing:

~~Given everything traced in this document, the smallest safe next
step is not implementation — it is resolving open decisions 1 and 2
above, since every other candidate model and every security property
in §9/§10/§18 is contingent on whether classroom membership for
students stays a separate, bridge-specific concept or converges with
the existing teacher `memberUids` model. That single decision
determines which of the already-designed prior proposals (in this
folder) is ready to move from "proposal" to "approved design," and
which parts of §6's dormant code are genuinely reusable reference
material versus dead weight worth removing in a later, separate,
explicitly-scoped cleanup.~~

With both decisions now ratified (§22), the next step is the data-flow
design in §26 — still documentation, not implementation (see §26's own
header).

---

## 22. Approved Decisions

Two decisions from §20 are now ratified. Recorded verbatim in effect,
not paraphrased away, since future readers of this contract need the
exact scope of what was approved, not just the conclusion.

### Decision 1 — Student classroom membership and `memberUids` remain separate

**Approved.** Student classroom membership (whatever form the new
learner-identity bridge gives it) and the existing ClassMate
`memberUids`/`members` model (teachers, co-teachers, viewers, and the
reserved Program Manager/Head Master roles) are **two distinct
relationships**, not one relationship expressed two ways. This is not
merely "not yet unified" — it is an explicit decision **not to unify
them**, reversible only by a future, separate decision made *after* the
new learner membership model exists, has been implemented, and has been
tested in production.

Concretely, this means:
- `models/Classroom.js`'s `members`/`memberUids` map is not modified to
  accommodate this migration, in shape, semantics, or population.
- The reserved `MEMBER_ROLES.STUDENT`/`PARENT` placeholders
  (`config/memberRoles.js`) are **not** activated, assigned, or
  repurposed by this work — they remain exactly what they already were:
  reserved vocabulary for a *possible* future decision, untouched here.
- No code path introduced by this bridge writes a student or a
  guardian's uid into `memberUids`, under any circumstance.
- "Teacher is a member of classroom X" and "learner is linked to
  classroom X" are treated as **different kinds of fact**, verified by
  different mechanisms (§23), even though both happen to be about the
  same classroom document.

### Decision 2 — Generalize the `MembershipLink` *security pattern*, not the collection

**Approved**, with an explicit, narrower scope than "reuse
`MembershipLink`":

**Reused — the pattern's principles** (§25 has the full mapping):
- a relationship document keyed by the identity being authorized (so a
  rule resolves it via one known-path lookup, never a query);
- authorization expressed as a single-document `get()`, never a
  `list`/query-shaped rule;
- the binding is checked *against authoritative membership data* at the
  moment it's created, not asserted unconditionally;
- once created, the binding is treated as an explicit, rule-enforced
  fact — not a denormalized field re-trusted on every subsequent write.

**Not reused:**
- `studentAuthLinks` itself is **not** resurrected — no `match` block
  for it is proposed, and its exact collection path/shape is not
  revived (§25).
- The unreachable enrollment-token code
  (`firestoreEnrollmentRepository.js`'s `createEnrollmentToken`/
  `redeemEnrollmentToken`/`createStudentAuthLinkDirect`, and
  `enrollmentService.js`/`StudentEnrollmentCodeView.js`) is **not**
  restored or called from anywhere new. It remains exactly what §6
  already found it to be: present, dead, unauthorized by any rule.
- `MembershipLink` is **not** copied verbatim into a new collection.
  Its own semantics (Learning-Programme-scoped, anonymous per-device
  uid, no expiry, no revocation, immutable-forever) were built for a
  narrower purpose than this bridge needs and are not assumed to
  transfer unexamined — each property is re-derived on its own merits
  in §25, not inherited by default.

---

## 23. Ownership Boundary — ClassMate vs Learning Hub

Formalizing the split given in this round's instructions, stated as
two distinct *questions*, each answered by exactly one product:

| | Owns | Answers |
|---|---|---|
| **ClassMate** | the authoritative classroom roster; the `Student` record (§3.9); whether a specific classroom-link invitation is currently valid; whether a specific student is eligible to be linked | **"May this learner be linked to this classroom?"** |
| **Learning Hub** | Account (per the migration proposal); Learner Profile; Learner↔Account links; the learner-facing Classroom Membership *representation*; learner-facing learning history | **"What classrooms is this learner currently linked to?"** |

These are related but **not the same responsibility**, and the
distinction is load-bearing, not cosmetic:

- ClassMate's answer is a **one-time, narrow, verification-shaped**
  fact — true or false, checked once at the moment a link is attempted,
  using data ClassMate already authoritatively owns (the roster, and
  whatever invitation/eligibility record names a specific student).
  ClassMate does not need to know, store, or ever query "what
  classrooms is learner X linked to" — that question is never asked of
  ClassMate, by design.
- Learning Hub's answer is an **ongoing, read-many, representation**
  question — every time Learning Hub needs to know a learner's current
  classrooms (dashboard, gating classroom-scoped content, a classroom
  switcher), it answers this entirely from its own stored membership
  records, **never** by calling back into ClassMate. ClassMate is
  consulted only once, at link time — not on every read.
- This means the verification step (§26) is the *only* place these two
  products' data ever needs to meet. Before it and after it, each
  product answers its own question from its own data, independently.

This is a direct consequence of, and consistent with, §16's
source-of-truth matrix and the product-ownership statement already
given in the migration context ("ClassMate remains the teacher-facing
system... Learning Hub is the student-facing system").

## 24. Why `memberUids` Is Not Reused, and Why Student Membership Is Not Merged Into It

Three independent reasons, each sufficient on its own, confirmed
directly from this trace rather than assumed:

1. **`memberUids` answers a different question than learner membership
   does.** Every existing use of `memberUids` (§7, §14) is about
   *classroom-management authority* — can this uid edit students, award
   points, review lesson plans, invite a co-teacher. A learner being
   linked to a classroom asserts none of that; a learner should never
   gain `memberUids`-style authority over the classroom they're in.
   Merging the two would mean every rule that currently trusts "in
   `memberUids` implies teacher-level authority" (there are many —
   §7, §14) would need individual re-audit to exclude learners: a
   large, error-prone change against working, real production rules,
   for no benefit `memberUids` doesn't already provide teachers.
2. **`memberUids` has no concept of *whose child* — only *which
   account*.** §11 already established that a bare account identifier
   cannot distinguish two learners sharing one account. `memberUids` is
   exactly this kind of bare-account list (a set of uids). Even setting
   aside reason 1, `memberUids` could not represent "Learner Profile A
   and Learner Profile B, both linked to this classroom, both under one
   guardian account" without growing a second dimension it does not
   have today — at which point it is no longer the same data
   structure, only reusing the same field name.
3. **The reserved `STUDENT`/`PARENT` roles were deliberately left
   unassigned, on record, pending exactly this kind of decision.**
   `config/memberRoles.js`'s own comment (quoted in §6/§20) says the
   real permission model for these roles is "a decision for when
   authentication is approved" — not a default to fall into by
   convenience now that authentication (via Learning Hub) is finally
   arriving. Activating them as a side effect of this migration, rather
   than as its own deliberate future choice, would be exactly the kind
   of collapsed decision this contract's approval process (§22) exists
   to prevent.

**Why student membership is not merged into `memberUids` either** (the
converse direction — could a learner's classroom link simply be
written into `memberUids` under a `STUDENT` role, rather than kept
separate?): reasons 1 and 2 apply identically in this direction — a
`memberUids` entry is still a bare uid with no learner-profile
dimension, and still carries the connotation of classroom-management
authority everywhere else in this codebase already assumes it does.
Keeping the new relationship structurally separate (its own concept,
not a role value inside the existing one) is what makes Decision 1
(§22) actually safe, not merely nominal.

## 25. MembershipLink Pattern Generalization — What Is Reused, What Is Not

A direct, property-by-property mapping from `MembershipLink` (§5, §7)
to what this contract approves reusing:

| `MembershipLink` property (today, Learning-Circle-scoped) | Reused as a principle? | Applied where |
|---|---|---|
| Document ID = the identity being authorized (`{uid}`) | **Yes** | Both sides of the bridge: ClassMate's own invitation/verification record is keyed by the token's hash (single-lookup identity, per the already-approved security review); Learning Hub's own learner-membership record is keyed for single-lookup resolution against whichever identity Learning Hub's own rules check (a Learning-Hub-internal decision, not fixed by this contract) |
| Authorization via one `get()`, never a `list`/query | **Yes** | Learning Hub's own rules, wherever they need to gate learner-scoped content by classroom membership — the same reasoning §5/§7 already traced for why `studentEntries` works and `studentGoals` doesn't |
| Verified against authoritative data *at creation* | **Yes**, but "authoritative data" differs per side: ClassMate verifies against its own live roster (§26 step 5); Learning Hub verifies against ClassMate's *verification response*, treated as a trusted, one-time oracle result, not re-derived independently | Both sides, independently |
| Explicit, rule-enforced binding (not a re-trusted denormalized field) | **Yes** | Enforced independently in each product's own rules — this contract does not propose a shared rules file or a cross-project rule |
| Immutable forever, `allow update: if false` | **Not directly reused** — appropriate for `MembershipLink`'s own narrow, permanent case; this bridge instead needs a **status field** (active/ended, active/revoked) because §18 property 8 ("revoked classroom membership stops classroom access") requires revocation, which pure immutability cannot support. A deliberate departure, not an oversight. |
| Scoped to one Learning Programme | **Not reused as scope** — the new relationship is scoped to a classroom enrollment generally, broader than one programme within a classroom |
| No expiry, no token gating the link's creation | **Not reused** — the already-approved security review requires a short-lived, single-use, high-entropy token gating creation of the ClassMate-side verification record; `MembershipLink`'s own "just write it, no gate" creation path is the same shape `studentAuthLinks`' `createStudentAuthLinkDirect` also had, and is not carried forward |

The net effect: **the same architectural shape is applied twice,
independently, once on each side of the ownership boundary (§23)** —
not one shared collection, not a resurrection of `studentAuthLinks`,
and not `MembershipLink` itself pressed into a second, larger job it
was never designed or reviewed for.

## 26. Final Proposed Data-Flow Diagram

**Proposed design, not implemented.** No Firestore collection, rule,
Cloud Function, or authentication behavior described below exists yet.

```
TEACHER (ClassMate — already authenticated, real memberUids
membership in the classroom)
    │
    │ (1) generates an invitation for ONE specific roster student
    │     DATA AT REST (ClassMate-owned):
    │       {classroomId, studentId, tokenHash, expiresAt, status}
    │       — raw token itself is never persisted (security review)
    ▼
[[ TRUST BOUNDARY 1 — internal to ClassMate. Teacher's own real,
   Google-authenticated memberUids membership (existing, unchanged).
   This is the ONLY moment a human asserts "this is genuinely my
   student" — by an already-trusted party. ]]
    │
    │ (2) raw token delivered out-of-band to the family
    │     (delivery channel not yet decided — security review §D.1)
    ▼
[[ TRUST BOUNDARY 2 — physical/human delivery channel, outside any
   system's control. Bounded only by short lifetime + single-use.
   DATA CROSSING: the raw token ONLY — never classroomId/studentId
   directly. ]]
    │
    ▼
LEARNING HUB ACCOUNT (parent/guardian signs in with Google;
Account + Learner Profile created/selected — Learning-Hub-owned)
    │
    │ (3) family enters/scans the token in Learning Hub's own UI
    ▼
[[ TRUST BOUNDARY 3 — ordinary web-app frontend/backend boundary,
   not specific to this bridge.
   DATA CROSSING: the raw token, browser → Learning Hub's own backend
   ONLY. The token never reaches ClassMate from the browser — the
   browser is never an authorized caller (security review §B). ]]
    │
    ▼
CLASSMATE VERIFICATION
Learning Hub's backend calls ClassMate's dedicated,
authenticated-only verification function
    │
[[ TRUST BOUNDARY 4 — cross-project, service-to-service ONLY. GCP IAM
   OIDC: a dedicated service account, invoker-only on this one
   function (security review §B). No API key, no embeddable
   credential, ever.
   DATA CROSSING, Learning Hub → ClassMate: the raw token ONLY. No
   learnerProfileId, no Account uid, no Learning-Hub-internal identity
   crosses this boundary — ClassMate never needs Learning Hub's own
   concepts to answer its own question (§23). ]]
    │
    ▼
ClassMate-side: hash token → look up → check unexpired/unused →
re-check live roster still valid (security review §12/§13) →
atomic flip to used
    │  THIS step is "ClassMate answers: may this learner be linked
    │  to this classroom?" (§23) — a single-document get(), never a
    │  query, verified against ClassMate's own authoritative roster
    │  (§25 principle).
    ▼
[[ DATA CROSSING, ClassMate → Learning Hub: the verified
   {classroomId, studentId} pair, and success/failure ONLY. Nothing
   about ClassMate's internal roster shape, scores, or any other
   student beyond this one crosses back. ]]
    │
    ▼
LEARNING HUB LEARNER MEMBERSHIP
Learning Hub's backend, having received a verified
{classroomId, studentId}, creates its OWN record binding the
CURRENTLY ACTIVE Learner Profile to that classroom enrollment
    │
[[ TRUST BOUNDARY 5 — entirely internal to Learning Hub. Learning
   Hub's own Firestore rules govern this write, generalizing the
   MembershipLink PATTERN (§25), keyed for Learning Hub's own
   single-doc get() checks. ClassMate has no visibility into, or
   control over, this step at all — this representation is
   Learning-Hub-owned (§23). ]]
    │
    ▼
DATA AT REST (Learning Hub-owned):
  {learnerProfileId, classroomId, studentId,
   status: active/ended, verifiedAt}
  — status-flippable, NOT immutable-forever (§25's deliberate
    departure from MembershipLink, required for revocation)

From this point on: "What classrooms is this learner currently linked
to?" is answered ENTIRELY from this record, by Learning Hub, on every
subsequent read. ClassMate is never called again for this question
(§23) — only at the one-time link moment above.
```

### Boundary summary table

| Trust boundary | Between | What crosses | What does NOT cross |
|---|---|---|---|
| 1 | Teacher ↔ ClassMate's own auth | nothing external — internal to ClassMate | — |
| 2 | ClassMate invitation ↔ family (human) | the raw, single-use token | classroomId, studentId (resolved server-side only, later) |
| 3 | Learning Hub frontend ↔ Learning Hub backend | the raw token | — |
| 4 | Learning Hub backend ↔ ClassMate verification function | the raw token (Hub → ClassMate); verified `{classroomId, studentId}` + outcome (ClassMate → Hub) | any Learning-Hub-internal identity (uid, Account, Learner Profile id) going in; any ClassMate roster data beyond the one verified pair coming back |
| 5 | ClassMate verification response ↔ Learning Hub's own membership write | nothing further crosses a product boundary — Learning Hub consuming its own already-received data | ClassMate has no further involvement, ever, in this write |

---

### Contract Readiness

*Written before §22–26 existed; updated in place (not rewritten) where
those sections have since resolved something this list originally
flagged as open. Items 2, 5, 7, and 8 carry follow-up notes below their
original text; items 1, 3, 4, 6 stand as originally written.*

1. **What we now know with high confidence.** The live Student Mode
   identity is 100% device-local and anonymous, with zero person-level
   or account-level binding (§3, §4, §12). Classroom "membership" for
   students does not exist in the same rule-enforced sense it does for
   teachers (§14) — confirmed directly from `config/memberRoles.js`'s
   own comments, not inferred. `studentAuthLinks` is dead — its code
   still exists, but zero supporting Firestore rule exists, confirmed
   via the file's own deny-by-default backstop (§6). Exactly one
   collection (`membershipLinks`) achieves genuine, rule-enforced,
   immutable-after-creation uid↔studentId binding today, and it is
   explicitly self-attested only at the moment of creation, by its own
   documentation (§7). The Learning Hub deep-link mechanism carries only
   content context, never identity (§15).
2. **What remains uncertain.** The exact commit/PR history behind
   `studentAuthLinks`' rollback (not locatable via `git log` in this or
   the prior session). ~~Whether `MembershipLink`'s pattern will be
   formally generalized, or superseded by something new (open decision
   1). Whether student classroom membership ever converges with the
   teacher `memberUids` model (open decision 2).~~ **Resolved by §22:**
   the pattern is generalized (not the collection, §25); the two
   membership models stay separate, revisitable only after the new
   model ships and proves itself (§22 Decision 1).
3. **Which identity mechanism(s) are viable.** A Learner Profile layer
   interposed between the Google/Firebase UID and any ClassMate-facing
   identity (Candidates D/E/H) — consistent with, and no evidence
   found against, the two prior design documents already on file.
   `MembershipLink`'s existing pattern (uid-keyed, listless, immutable)
   is a viable, already-proven building block for the verification
   step specifically.
4. **Which mechanisms should be ruled out, and why.** Candidate A
   (anonymous device UID) — non-durable by design, confirmed directly
   (§12). Candidate B (`Student.id` alone) — has no authentication
   relationship at all (§3.9). Candidate C (bare Google/Firebase UID as
   *the* learner identity) — structurally cannot distinguish siblings on
   one account, confirmed by tracing that no existing mechanism in this
   codebase supports a one-to-many uid→identity mapping either (§9,
   §11). The live, default join flow (Candidate G) as a *security*
   mechanism — it verifies nothing about the caller, by design and by
   explicit product choice (§4, §13).
5. **What must be decided before implementation.** ~~Open decisions 1
   and 2 (§20) — everything else in this document is downstream of
   those.~~ **Resolved by §22.** What remains before implementation now:
   open decisions 3–6 (§20, unchanged by this round) and the security
   review's own open decisions (delivery channel, exact token
   lifetime, whether PIN redemption is permitted, redemption
   notification, prior-token invalidation).
6. **What can safely be deferred.** Formal deletion or archival of the
   dormant `studentAuthLinks`/`enrollmentTokens`/`studentIdentityService`
   code (open decision 3/4) — inert today, provably so, and not blocking
   any forward design work.
7. **Whether Learning Hub or ClassMate needs to own the canonical
   learner identity.** ~~Not resolved by this document — this is exactly
   open decision 1/2 territory.~~ **Resolved by §22/§23: Learning Hub
   owns Account and Learner Profile; ClassMate owns the roster and the
   eligibility/validity answer, not the learner's identity itself.**
   What *is* clear from this trace, and unchanged by the resolution:
   ClassMate does not currently own anything resembling a canonical,
   durable, person-level learner identity (only a roster row and, at
   most, a self-attested anonymous-uid link) — so "ClassMate already
   owns it, Learning Hub should just read it" was never supported by
   the evidence, consistent with where the decision landed.
8. **The smallest safe next architectural step.** ~~Ratify (or revise)
   open decisions 1 and 2~~ — **done (§22).** The next step is now the
   data-flow design in §26 (also complete, as documentation) and,
   beyond this contract, the implementation prerequisites already listed
   in the companion security-review document.

---

**Confirmed:**
- No application code modified.
- No Firestore rules modified.
- No Firestore data modified.
- No authentication logic modified.
- No routes modified.
- No UI modified.
- No deployment performed.
- No commit made.
- No push made.
