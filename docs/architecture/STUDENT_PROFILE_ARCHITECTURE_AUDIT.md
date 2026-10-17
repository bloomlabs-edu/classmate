# ClassMate Student Mode — Learner Profile Architecture Audit

**Status:** Read-only investigation. No code, Firestore, or auth was
modified to produce this document. Written to support an architecture
evaluation for migrating ClassMate Student Mode into Learning Hub — it
does not choose a target architecture, does not invent a new data
model, and does not recommend an implementation.

**Scope:** every finding below is traced to a specific file (and, where
useful, line-level behavior) in this repository as it exists today.
Where a claim is inferred rather than directly observed in code, it is
marked as such.

---

## 0. Executive summary

ClassMate currently has **two entirely separate, non-interoperating
identity layers for the Student Portal**, plus **one narrow, real,
already-working precedent for exactly the kind of uid↔student mapping
the target architecture needs** — built, tested, and left unwired:

1. **The live system** (everything `js/main.js` actually reaches):
   device-scoped, anonymous, no Google account anywhere in the loop.
   A "learner profile" is a `{classroomId, studentId, studentName}`
   tuple remembered in `localStorage`, one specific browser at a time.
   Up to 3 such tuples per device, **all from the same classroom**.
   Nothing server-side records which human is behind any of it.

2. **A dead, unreachable system** (`studentIdentityService.js` and
   everything under it): an already-designed, already-coded
   Google-account → linked-student(s) → selector architecture that is
   structurally very close to what's being proposed now — but it was
   never wired to real Google Auth, never wired to Firestore, and is
   not imported from `main.js` or `StudentPortalShell.js` anywhere.
   Its own header comments say so explicitly.

3. **A real, working, in-production precedent** (`MembershipLink` /
   `membershipLinkService.js`, "PHASE 1 — Membership Identity
   Foundation"): a genuine Firestore-enforced mapping from a per-slot
   anonymous Firebase Auth `uid` to a `studentId`, scoped to a Learning
   Programme, solving the exact security-rule problem
   (`studentAuthLinks`'s list-query limitation) that caused an earlier,
   similar attempt to be rolled back. It is explicitly documented as
   "NOT YET CALLED FROM ANYWHERE" in Student Mode — built as
   infrastructure, not yet load-bearing there.

The proposed conceptual model (Google Account → Learner Profile →
Classroom Membership → ClassMate classroom/student record) is **partially
supported** by system 1's data shape, **structurally anticipated** by
system 2's abandoned design, and **has a real, working verification
precedent** in system 3 — but no single existing path connects all four
links today. See §21 for the full gap analysis.

---

## 1. How learner profiles are currently represented

A "learner profile" in the live system is not a persisted entity at
all — it's a plain, three-field reference object:

```js
{ classroomId, studentId, studentName }
```

(`js/services/studentDeviceService.js`, throughout; also the return
shape of `StudentJoinClassroomView.js` → `StudentRosterPickerView.js`).

The actual student it points to is a **nested object inside the
classroom document**, not a top-level Firestore document:
`classrooms/{classroomId}.teams[].students[]`, shaped by
`models/Student.js`'s `createStudent()`:

```js
{ id, name, rollNumber, score, bucket, badges, notes, submissions,
  learningRecord, history }
```

`id` is a `generateId()` UUID with **no relationship to any
authentication identity whatsoever** — it is not a Firebase UID, not
derived from one, and the model file never mentions auth. Fields like
`hasJoinedPortal` (set in `workspaceService.markStudentJoinedPortal()`)
and `portalPin`/`deviceResetPin` (documented in
`repositories/identity/StudentLinkRepository.js` and `models/Classroom.js`
respectively) are bolted onto this object or its parent classroom
outside the formal model constructor — there is no first-class
"learner profile" or "identity" field on the Student model itself.

## 2. Whether multiple learner profiles can share one authenticated account

**In the live system: there is no authenticated account for them to
share.** The live flow never asks for Google sign-in (see §14). What
it *does* support is multiple learner profiles sharing one **device**
(`studentDeviceService.js`'s `MAX_APPROVED_PROFILES = 3`), which is a
different thing: three siblings using the same phone, but with no
account backing any of them.

The dead system (`studentIdentityService.js`) *was* designed for
exactly "multiple profiles per account" — `getCurrentStudent()`
explicitly branches on `linkedStudents.length === 1` vs. `> 1`, and
`listLinkedStudents()` exists specifically to power a "Who's learning
today?" picker keyed by `providerUserId`. It was never connected to a
real provider.

## 3. How profiles are created

Live path (`StudentDeviceFlow.js` → `StudentJoinClassroomView.js` →
`StudentRosterPickerView.js`):
1. Enter the classroom's public `classroomStudentJoinCode`.
2. See the real roster (`classroom.teams[].students[]`), pick a name.
3. `studentDeviceService.addApprovedProfile(studentRef)` — free, no PIN,
   *only* because this is a fresh device with zero existing profiles.
4. `workspaceService.markStudentJoinedPortal()` flips a `hasJoinedPortal`
   flag server-side (best-effort; see §12 for why this write is not
   actually rule-protected).

Adding a **second or third** profile to an already-claimed device goes
through `StudentManageProfilesView.js` instead, and requires the
classroom's `deviceResetPin` (verified via
`workspaceService.verifyDeviceResetPin()`, a plain string comparison
against the classroom document's own field — no hashing, no rate
limiting observed).

Dead-path equivalent: `studentIdentityService.linkWithPin()` /
`linkWithInvitationToken()`, backed by `LocalStudentLinkRepository.js`.

## 4. How profiles are selected

`StudentDeviceFlow.js`: if exactly one approved profile exists, it's
auto-selected. If more than one, `StudentRosterPickerView.js` renders
an avatar picker among just the device's approved profiles (never the
whole classroom roster). Nothing here consults a server for "which
profile should be active" — it's a pure `localStorage` read
(`ACTIVE_PROFILE_ID_KEY`).

## 5. How profile switching works

`studentDeviceService.setActiveProfile(studentRef)` — writes one
`localStorage` key. No confirmation, no PIN, free between profiles
already approved on the device (`StudentManageProfilesView.js`'s own
subtitle: *"Tap a name to switch — no PIN needed for that."*).

## 6. What data belongs to the account

**Nothing, in the live system** — there is no account. The closest
analog, `studentDeviceService`'s `localStorage` keys
(`bloomLabsDeviceApprovedProfiles`, `bloomLabsDeviceActiveStudentId`),
belong to the **browser/device**, not any account: clearing site data,
or opening the same login on a different browser, loses it entirely.

In the dead system, "account data" would have been
`identityLinks/{providerUserId}` (documented, never built — see §11).

## 7. What data belongs to the learner profile

Everything under `classrooms/{classroomId}.teams[].students[{id}]` —
`score`, `bucket`, `badges`, `notes`, `submissions`, `learningRecord`,
`history` (per `models/Student.js`) — plus whatever subcollections key
by `studentId` directly: `studentGoals`, `studentEntries` (under
`programmeSessions`), `studentConceptRecords`,
`studentEventReadState`. All of this lives inside the **classroom's**
data, not any account's.

## 8. How ClassMate identifies the selected learner

Purely client-side, on every load:
`studentDeviceService.getActiveProfile()` returns `{classroomId,
studentId}` from `localStorage`; `studentPortalDataService.js`'s
`loadCurrentStudentAndClassroom()` then does a live/fresh Firestore
read of `classrooms/{classroomId}` and finds the matching `studentId`
inside `teams[].students[]`. **There is no server-side session or
token that identifies the student** — `classroomId`/`studentId` are
not secrets (they're plain document/array-item ids), and nothing
cryptographically ties a browser to a specific student beyond "this
browser's `localStorage` happens to remember it."

## 9. How classroom membership relates to the learner profile

They are the same thing, structurally: a learner profile *is* a
pointer into one classroom's own roster. A student cannot exist
without belonging to exactly the one classroom their `Student` object
is nested inside. `studentDeviceService.addApprovedProfile()`
structurally refuses to add a profile from a **different** classroom
than the ones already approved on a device — multi-classroom
membership on one device is explicitly not supported today (see §17,
§18).

## 10. Whether profile identity is durable or device-specific

**Device-specific, by explicit design**, not an oversight. There is no
mechanism anywhere in the live code that makes a learner profile
follow a person across devices — a student opening the portal on a new
device goes through the full "fresh device" join flow again, entirely
independently accumulating its own separate `localStorage` state. Two
devices can each independently hold "the same real student" as an
approved profile with zero cross-linking or awareness of each other.

## 11. What Firestore data is involved

**Actually written to, live:**
- `classrooms/{classroomId}` (read constantly; `hasJoinedPortal` write attempted — see §12)
- `classrooms/{classroomId}/studentGoals/{goalId}` — keyed by `uid` field, self-attested (see §12)
- `classrooms/{classroomId}/programmeSessions/{sessionId}/studentEntries/{studentId}`
- `classrooms/{classroomId}/studentConceptRecords/...` (`firestoreStudentConceptRecordsRepository.js`)
- `classrooms/{classroomId}/studentEventReadState/{studentUid}`
- `classrooms/{classroomId}/learningProgrammes/{programmeId}/membershipLinks/{uid}` — written by `membershipLinkService.js`, but **that service is not called from anywhere in the live Student Portal today** (see §0.3, §16).

**Documented but never built** (`StudentLinkRepository.js`'s own header
comment, explicitly labeled as a future-production proposal):
- `identityLinks/{providerUserId}` — `{ provider, studentRefs: [{classroomId, studentId}], lastSelectedStudentId, linkedAt }`
- `invitationTokens/{token}`
- `student.portalPin` / `student.portalPinGeneratedAt` fields on the existing Student object

**Built once, then removed** (`firestore.rules`, multiple comments,
e.g. line 289): a `studentAuthLinks` collection and an "enrollment"
step that populated it existed at some point and were **rolled back**
("see project history" — the exact commit/PR was not locatable via
`git log`/`CHANGELOG.md` search in this session; the removal is only
evidenced by rules comments referencing it after the fact, three times,
independently, in `studentGoals`, `feedPosts`, and a third collection's
rule blocks).

## 12. What security rules protect profiles

This is the most important finding for any migration decision.

- `classrooms/{classroomId}` reads are **`allow get: if (member) ||
  true`** — deliberately open to fully unauthenticated callers, because
  the whole no-auth student flow depends on it (`firestore.rules` lines
  136–143, comment: *"gets must be open to unauthenticated students
  once they have a classroomId, which in practice only ever happens via
  an unguessable code"*).
- Every student-authored write observed (`studentGoals` create,
  `feedPosts` create, notebook-adjacent collections) is authorized by
  **`request.resource.data.uid == request.auth.uid`** — i.e. "this
  anonymous uid is writing a document that claims to be itself." **No
  rule anywhere verifies that `uid` genuinely corresponds to a real
  student in that classroom.** The rules file says this outright (line
  441-449): *"without a studentAuthLinks-style mapping (removed earlier
  in this project's history), no rule anywhere in this file... can
  cryptographically prove a given anonymous uid genuinely belongs to a
  real student in THIS classroom, as opposed to some other classroom's
  own anonymous device."*
- `markStudentJoinedPortal()`'s write to the classroom document's
  nested `hasJoinedPortal` flag is **explicitly unprotected** — the
  rules file has a standalone comment block (lines 211–223) titled "NOT
  YET SUPPORTED" explaining that no safe rule exists for it yet, and
  that the call is wrapped in a try/catch that silently no-ops on
  failure so the student experience isn't blocked by it.
- The one collection with a **real, verified, listless** uid↔student
  binding is `membershipLinks/{uid}` (§0.3, §16) — but it is scoped to
  Learning Programme access only, and unused by Student Mode today.

**Conclusion:** the live Student Portal's trust model is "self-attested
roster selection," not verified identity, by the rules file's own
explicit acknowledgment. Any migration that assumes today's Student
Mode already has a "verified classroom relationship" would be building
on a foundation the codebase itself says doesn't exist yet.

## 13. What Student Mode features depend on the profile

Every one of the ~19 `js/ui/student-portal/views/*.js` screens
(Journey, Team, Recognition, Profile, Goal Tracker, Notebooks, Learning
Circle, Assessment Results, Feed, Achievements, Weekly Reports, Avatar
Builder, etc.) is reached only after `StudentDeviceFlow.js` resolves an
active profile, and all of them read/write through
`studentPortalDataService.js` keyed by `{classroomId, studentId}`.
There is no Student Mode feature that operates independently of an
active profile.

## 14. Whether the profile system is live production functionality

**Yes, for the device-slot system.** `js/main.js` imports and calls
`renderStudentDeviceFlow` (line 758) and `studentDeviceService`
directly (lines 37, 623, 752); this is unambiguously the real,
deployed entry point.

**No, for the Google-account/identity-link system.**
`studentIdentityService.js`, `StudentOnboardingFlow.js`,
`StudentSignInView.js`, `StudentPickerView.js`, `StudentLinkView.js`,
`LocalStudentLinkRepository.js`, `DemoIdentityProvider.js`, and
`DemoConsentProvider.js` are never imported by `main.js` or
`StudentPortalShell.js`. `StudentJoinClassroomView.js`'s own header
comment confirms this directly: *"That older flow, and the whole
identity/consent/PIN layer beneath it, is left in place, unused rather
than deleted."* `DemoIdentityProvider.js` itself is a mock ("wrapping
Firebase Auth's GoogleAuthProvider, the same pattern...") — even if
this path were reachable, it does not perform real Google
authentication today.

## 15. Whether any parts are deprecated, rolled back, or dead

Three confirmed layers of history, oldest to newest:
1. An even earlier "classroom-code flow" — superseded, its CSS
   (`.student-join-code`) reused by the current flow but its own logic
   gone (per `StudentJoinClassroomView.js`'s own comment).
2. The Google+PIN "identity/consent" layer (`studentIdentityService.js`
   and everything under it) — built, then made secondary/unreachable
   when `StudentJoinClassroomView.js` became the default front door.
   Left in the tree, not deleted, not imported.
3. `studentAuthLinks` (a Firestore collection + an enrollment step) —
   actually implemented and wired into rules at some point, then
   explicitly rolled back; only visible today via `firestore.rules`
   comments explaining why current rules *don't* reference it anymore.

## 16. What would be required to associate a profile with a Learning Hub Firebase UID

No existing mechanism does this for Student Mode today, but one
directly transferable, already-solved precedent exists:
`MembershipLink` (`models/MembershipLink.js`,
`services/membershipLinkService.js`,
`firestoreMembershipLinkRepository.js`, rules at
`firestore.rules:1274`). It already does "one Firebase Auth uid ↔ one
studentId, verified once at creation, keyed by uid so a rule can check
it without a list query" — the exact shape a Learning-Hub-UID↔student
mapping would need. Its own header comment is explicit that this is
**not** a claim of real-world identity verification, only "this uid
self-attested this studentId, checked against an active membership
record at creation time." It is currently scoped to Learning Programme
access and its own service module says outright it is not called from
Student Mode. Extending it (or building an equivalent) to cover
general classroom membership, and to a real (not anonymous) Google
Auth uid, is a design question this document does not resolve.

## 17. What would be required for one Google account to have two classroom learners

Structurally blocked today at two levels, both deliberate, not
incidental:
- `studentDeviceService.addApprovedProfile()` refuses a second profile
  whose `classroomId` differs from the first (`DIFFERENT_CLASSROOM`
  reason, surfaced verbatim in `StudentManageProfilesView.js`).
- The whole device-slot/anonymous-Firebase-Auth model
  (`studentAuthService.js`, `SLOT_COUNT = 3`) is device-scoped, not
  account-scoped, so there is no account-level concept of "two
  classroom learners" to begin with — only "up to 3 same-classroom
  profiles per device."

Two children in **different** classrooms sharing one household today
would each need their own device (or the same device would need to be
fully reset via `deviceResetPin` to switch classrooms entirely) — the
live system has no path for "two siblings, two classrooms, one
device."

## 18. Whether the current architecture can support this without creating duplicate identities

Not as-is. The live system's `Student.id` has no relationship to any
Firebase Auth uid, so "the same real learner" already has at least two
independent identifiers the moment they're both a ClassMate `Student`
and (hypothetically) a Learning Hub Firebase-Auth user — nothing
currently unifies them. `MembershipLink` demonstrates the codebase
already knows how to bind a uid to a studentId safely; nothing in
Student Mode currently uses that pattern to prevent the same human
being represented as two unrelated `Student` records if they, say, join
the same classroom twice from two devices before any linking exists.

## 19. What parts could safely be reused

- **`Student.id` as the durable learner identifier** — already the
  cross-system convention (`docs/LEARNING_HUB_INTEGRATION_CONTRACT.md`
  §1: *"Students have no top-level Firestore document of their own...
  but the app already keys subcollection documents by studentId
  elsewhere... safe to use as a Result key the same way."*).
- **The `MembershipLink` pattern** (uid-keyed document, verified once
  at creation, immutable, listless rule evaluation) as the template for
  any future uid↔student binding — it already solves the exact
  Firestore rules limitation that broke `studentAuthLinks`.
- **The classroom/team/student nested data shape itself** — reusing it
  is explicitly the existing project philosophy (`StudentLinkRepository.js`:
  *"reusing the classroom/team/student model that already exists,
  rather than a parallel top-level `students` collection"*).
- **`StudentLinkRepository.js`'s already-designed interface** (`getLinkedStudents`,
  `selectStudent`, `linkWithPin`/`linkWithInvitationToken` equivalents)
  as a reference shape for "one identity, many linked learners" — even
  though its own storage implementation (`LocalStudentLinkRepository`)
  should not be reused (see §20).

## 20. What parts should NOT be reused

- **`studentDeviceService.js`'s device-slot model as the identity
  layer** — it is fundamentally device-scoped by design; carrying it
  forward as-is would import the exact "not durable, not
  account-portable" limitation the target architecture is trying to
  get away from.
- **`LocalStudentLinkRepository.js`** — explicitly `localStorage`/in-memory,
  PINs held in a plain JS `Map` that is lost on reload; its own header
  comment calls it a stand-in pending real Firestore + consent review,
  never a production candidate.
- **`DemoIdentityProvider.js` / `DemoConsentProvider.js`** — mocks,
  named as such.
- **Anonymous Firebase Auth as the account layer** — `studentAuthService.js`'s
  per-slot anonymous sign-in was deliberately scoped to "prove the
  identity itself can exist," not to carry real account semantics; it
  has no email, no cross-device persistence, and no relationship to
  Google Sign-In.
- **The current unauthenticated `hasJoinedPortal`/self-attested-uid
  write pattern** — the rules file itself flags this as an accepted
  gap, not a pattern to extend into a verified-identity future.

---

## 21. Analysis: does the current architecture support this model?

```
Google Account
      ↓
Learner Profile
      ↓
Classroom Membership
      ↓
ClassMate classroom/student record
```

**Partially supports, with one real gap and one abandoned attempt at
exactly this gap.**

- `Learner Profile → Classroom Membership → student record`: **already
  true today**, structurally, in the live system — a learner profile
  *is* a pointer into a classroom's student roster (§9). This part of
  the chain is not new engineering; it already exists.
- `Google Account → Learner Profile`: **does not exist in the live
  system at all.** The one place this exact link was designed
  (`studentIdentityService.js`) is unreachable dead code, and the one
  place a *similar* uid→student link is real and working
  (`MembershipLink`) both (a) uses an anonymous, not Google, uid, and
  (b) is scoped to a narrower purpose (Learning Programme access) than
  general classroom membership.
- **"Establish verified classroom relationship"** (the proposed
  target's own middle step): the codebase's own security-rules
  comments are explicit that no current mechanism verifies this — every
  student-authored write today is self-attested, and the rules file
  says so outright (§12). The `MembershipLink` pattern is the one piece
  of code that gets closer to "verified" (a rule checks the link at
  read time, not just at write time), but even its own doc comment
  insists it should not be described as verifying real-world identity —
  only that a specific device once self-attested a specific studentId.

**No conflict was found** between the proposed model and the existing
architecture — nothing in the current system actively contradicts
"Google Account → Learner Profile → Classroom Membership." The gap is
absence, not opposition: the top link of the chain has never been
built for Student Mode, and the one adjacent, real precedent for
building it (`MembershipLink`) was deliberately scoped away from
Student Mode when it was created ("NOT YET CALLED FROM ANYWHERE").

## 22. Are classroom codes actually necessary under this model?

Under the *current* architecture, the classroom code
(`classroomStudentJoinCode`) serves a specific, load-bearing purpose:
it is the **only credential** standing between "any unauthenticated
visitor" and "read access to a specific classroom's roster" (§12 — the
classroom `get` rule is `if (member) || true`). Today, nothing else in
the live flow authenticates the request at all, so removing the code
without replacing its function would mean any client could read any
classroom's roster if it merely learned/guessed the classroom's
Firestore document id.

Under a Google-authenticated model, however, the codebase already
contains **two alternative mechanisms that don't depend on a
memorized/typed code**, both currently used server-side (teacher- or
programme-facing, not yet Student Mode):

- **PIN/invitation-token redemption** — already fully designed
  end-to-end in `StudentLinkRepository.js`/`studentIdentityService.js`
  (`linkWithPin`, `linkWithInvitationToken`, single-use expiring
  tokens). This is a *teacher-issued, per-student* credential rather
  than one shared classroom-wide code — a different security property
  (individually revocable, attributable to one student) than a
  classroom code offers.
- **`MembershipLink`-style verified binding** — once a Google-auth uid
  is bound to a studentId via something equivalent to
  `membershipLinkService.ensureMembershipLinkForCurrentStudent()`,
  subsequent access no longer needs *any* code at all; the security
  rule checks the link, not a shared secret.

Neither of these currently exists as a *live, wired* replacement for
the classroom code in Student Mode — this section identifies that the
codebase already contains working building blocks for both
alternatives, not that either has been adopted.

---

## Appendix: files this audit is grounded in

`js/services/studentAuthService.js`, `js/services/studentDeviceService.js`,
`js/services/studentIdentityService.js`, `js/services/membershipLinkService.js`,
`js/services/studentPortalDataService.js`, `js/services/workspaceService.js`
(`markStudentJoinedPortal`, `verifyDeviceResetPin`),
`js/repositories/identity/StudentLinkRepository.js`,
`js/repositories/identity/LocalStudentLinkRepository.js`,
`js/repositories/identity/DemoStudentLinkRepository.js`,
`js/repositories/firestoreMembershipLinkRepository.js`,
`js/models/Student.js`, `js/models/Classroom.js`, `js/models/MembershipLink.js`,
`js/ui/student-portal/StudentPortalShell.js`,
`js/ui/student-portal/onboarding/StudentDeviceFlow.js`,
`js/ui/student-portal/onboarding/StudentJoinClassroomView.js`,
`js/ui/student-portal/onboarding/StudentRosterPickerView.js`,
`js/ui/student-portal/onboarding/StudentOnboardingFlow.js`,
`js/ui/student-portal/onboarding/StudentSignInView.js`,
`js/ui/student-portal/onboarding/StudentPickerView.js`,
`js/ui/student-portal/onboarding/StudentLinkView.js`,
`js/ui/student-portal/views/StudentManageProfilesView.js`,
`js/main.js` (import graph, lines 34–37, 572–758),
`firestore.rules` (lines 124–334, 1274–1370),
`docs/LEARNING_HUB_INTEGRATION_CONTRACT.md`.

Not found via `git log`/`CHANGELOG.md` search in this session: the
specific commit(s) that implemented and later rolled back
`studentAuthLinks`. Its prior existence and removal is established
solely from `firestore.rules`' own comments referencing it
retrospectively, in three independent locations, consistently.
