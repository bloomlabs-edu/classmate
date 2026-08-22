# Phase 3.7 — Implementation & Audit Report

**Status as of this document: AUDIT ONLY. No source files, rules, or Firestore data were modified to produce this report.** This document exists because no prior Phase 3.7 spec was found anywhere in this repository — it is a reverse-engineered record of what the code and rules actually do today, written as the baseline to work from before any further implementation happens.

Scope inspected: the local repository at `classroom-tracker/` on branch `main`, working tree as of this audit (two untracked files present, nothing else modified).

---

## 1. What Phase 3.7 appears to be building

Based on the two untracked files' own code and header comments, Phase 3.7 is introducing a **per-category `studentEntries` subcollection** as the Learning Circle student-data boundary, replacing (or sitting alongside) the Phase 1–3.3 design where a `ProgrammeSession` document embeds every roster student's own `attendance`/`goals`/`teacherObservations` directly on one shared document.

Intended shape, per `firestoreStudentEntryRepository.js`'s own header comment:

```
classrooms/{classroomId}/programmeSessions/{sessionId}/studentEntries/{studentId}
classrooms/{classroomId}/programmeSessions/{sessionId}/studentEntries/{studentId}/goals/{categoryId}
```

Rationale stated in that comment: "The parent entry owns attendance. Each goal category is its own document so Firestore Rules can authorize one category without iterating an arbitrary map." This is a materially different shape from the existing, currently-deployed rule for `studentEntries/{studentId}` (Phase 3.2), which authorizes `goals` as a single embedded map field, not a subcollection of documents.

## 2. Files added this round (untracked, uncommitted)

| File | Role |
|---|---|
| `js/repositories/firestoreStudentEntryRepository.js` | Firestore access for the new per-category `studentEntries`/`goals` subcollection shape. |
| `js/services/studentLearningCircleService.js` | Student-side data access layer intended to sit in front of the repository above, plus membership-link and session-summary helpers. |

Neither file is imported by anything else in the codebase.

## 3. Current, actually-wired architecture (unchanged by this round)

The live UI path — `js/ui/student-portal/views/StudentLearningCircleView.js`, `js/ui/components/ProgrammeGoalsControls.js`, `js/ui/components/ProgrammeSessionSaveIndicator.js`, backed by `js/services/programmeSessionService.js` / `js/services/programmeSessionRepository.js` / `js/models/ProgrammeSession.js` — still uses the original, embedded shape exclusively:

```
classrooms/{classroomId}/programmeSessions/{sessionId}
  .attendance[studentId]
  .goals[studentId][categoryId]
  .teacherObservations[studentId][]
```

All reads/writes go through `updateDoc()` field-path patches (`buildAttendancePatch`, `buildGoalPatch`, `buildTeacherObservationPatch`) directly on the parent session document. None of this code imports or references either of the two new Phase 3.7 files.

`StudentLearningCircleView.js`'s own header comment already documents, independently of this audit, that student reads against `programmeSessions` are rejected by the deployed `firestore.rules` today, since a student's anonymous per-slot uid is never added to a classroom's `memberUids`. It explicitly calls this a known, confirmed gap, out of scope for the round that wrote it.

## 4. Findings

### 4.1 Broken dependency: `ensureLearningProgrammeMembershipLink` does not exist

`studentLearningCircleService.js` line 22 calls:

```js
await enrollmentRepository.ensureLearningProgrammeMembershipLink(
  context.db, classroomId, programmeId, studentId, uid
);
```

`js/repositories/firestoreEnrollmentRepository.js` exports only `createEnrollmentToken`, `getEnrollmentToken`, `redeemEnrollmentToken`, `createStudentAuthLinkDirect`, `getStudentAuthLink`. No function named `ensureLearningProgrammeMembershipLink` exists anywhere in the repository (confirmed by full-repo grep). Any call into `ensureProgrammeMembershipLink()` in the new service would throw `TypeError: ... is not a function` at runtime.

### 4.2 Rules/repository shape mismatch on `goals`

The deployed `firestore.rules` (`classrooms/{classroomId}/programmeSessions/{sessionId}/studentEntries/{studentId}` block, added in Phase 3/3.2) authorizes `goals` as **a map field embedded on the `studentEntries` document itself** — e.g. `request.resource.data.goals[categoryId]`, with shape validated via `isValidStudentGoalCreate()`/`isValidStudentGoalUpdate()` operating on that embedded map.

`firestoreStudentEntryRepository.js` instead writes each goal as **its own document in a `goals` subcollection** beneath the `studentEntries` document (`goalDoc()` → `doc(goalsCollection(...), categoryId)`).

There is **no rule at all** for the path `classrooms/{classroomId}/programmeSessions/{sessionId}/studentEntries/{studentId}/goals/{categoryId}`. It falls through to the deny-by-default catch-all:

```
match /{document=**} {
  allow read, write: if false;
}
```

Every call to `createStudentEntryGoal`, `getStudentGoal`, or `listStudentGoals` in the new repository would be rejected by the rules as currently deployed.

### 4.3 `sessionIndex` has no writer

`studentLearningCircleService.js`'s `listOwnSessionSummaries()` reads from `classrooms/{classroomId}/learningProgrammes/{programmeId}/sessionIndex` (ordered by `date`), but no file anywhere in the repository writes to a `sessionIndex` collection. `firestore.rules` has no block for this path either — it would also fall to deny-by-default. This function will always return an empty array (or throw a permission error) against a live/emulated project.

### 4.4 `usesStudentEntries` is never persisted

The flag appears in exactly two places: as a field on an in-memory object returned by `listOwnSessionSummaries()`, and in the emulator test fixture (`studentEntries.rules.verify.js`). No repository or service function actually writes this field to a Firestore document.

### 4.5 Session IDs are random, not deterministic

`models/ProgrammeSession.js` → `createProgrammeSession()` assigns `id: id || generateId()`, and `utils/idGenerator.js`'s `generateId()` returns `crypto.randomUUID()`. Per-date uniqueness is enforced entirely at the application layer (`pickSessionForDate()` / `getOrCreateSessionForDate()` query-then-filter), not via a deterministic ID scheme (e.g. `${programmeId}_${date}`).

### 4.6 `learningProgrammes/{programmeId}/memberships/{studentId}` is not a real path

Memberships are embedded arrays on the classroom document (`classroom.learningProgrammes[].memberships[]`), confirmed both by `firestore.rules`' own comment and by the emulator test fixture's setup data. There is no standalone `memberships` collection or document at this path today.

### 4.7 `membershipLinks/{uid}` rule is correct, but has no working writer

The Phase 1 rule at `classrooms/{classroomId}/learningProgrammes/{programmeId}/membershipLinks/{uid}` is well-formed and matches its own documented design (self-attested uid↔studentId link, verified against embedded active-membership data at creation time via nested `.exists()` predicates). The only client-side function meant to populate it is the missing `ensureLearningProgrammeMembershipLink` (§4.1).

### 4.8 "Unsupported Firestore Rules constructs" — not actually a problem

`list.exists(var, predicate)` and `list.all(var, predicate)` (used at lines 482–484, 593, 603 of `firestore.rules`), including the nested-predicate form (`p.memberships.exists(m, ...)`), are real, documented Firestore Rules `List` methods (`exists`, `exists_one`, `all`, `filter`, `map`, alongside `hasAny`/`hasAll`/`hasOnly`). They are valid syntax. The rules file's own comments already flag them as **unverified against a live/emulated project** — a runtime-verification gap, not a syntax defect.

### 4.9 Verification harness tests the old shape, not the new one

`firebase-rules-verification/studentEntries.rules.verify.js` is a complete, ready-to-run 23-test suite — but its fixtures write `goals: {}` as an embedded map directly on the `studentEntries` document, matching the *currently deployed* Phase 3.2 rule. It does not exercise the new `goals` subcollection shape `firestoreStudentEntryRepository.js` implements. A full green run of this harness would not validate Phase 3.7's actual data model.

### 4.10 Environment readiness (for whenever verification is authorized)

- `firebase-tools@15.26.0` is installed globally and callable (`npx firebase-tools --version` succeeds).
- Port 8080 is currently free (nothing bound to it).
- `firebase-rules-verification/` has its own `node_modules` already installed.
- No PHASE_3_7_IMPLEMENTATION.md existed prior to this document — there was no written spec to verify these files against; everything above was reverse-engineered from code and comments.

## 5. Classification summary

| Item | Status | Basis |
|---|---|---|
| `firestoreStudentEntryRepository.js` exists, internally coherent | PASS | File present, matches its own documented design for the parent `studentEntries` doc. |
| `studentLearningCircleService.js` exists | PARTIAL | Present but calls a nonexistent function; not imported anywhere. |
| `studentEntries/{studentId}` rule | PASS | Present, matches repository's parent-doc path. |
| `studentEntries/{studentId}/goals/{categoryId}` rule | MISSING | No rule for this path; denies by default; blocks the new repository's goal functions entirely. |
| `membershipLinks/{uid}` rule | PASS | Present, well-formed. |
| Client writer for `membershipLinks` | MISSING | `ensureLearningProgrammeMembershipLink` referenced but undefined. |
| `sessionIndex/{sessionId}` | MISSING | No writer, no rule; one dead-code reader only. |
| `learningProgrammes/{programmeId}/memberships/{studentId}` as its own path | MISSING (by current design) | Memberships are embedded arrays on the classroom doc, not documents at this path. |
| `usesStudentEntries` persisted anywhere | MISSING | Only appears in-memory / in test fixtures. |
| Deterministic session IDs | MISSING | Random UUIDs; date-uniqueness is app-layer logic, not ID determinism. |
| Live UI wired to the new architecture | MISSING | All three UI files still use the old embedded-session shape exclusively. |
| `.all()` / `.exists()` / nested-array predicates | PASS (non-issue) | Valid, documented Firestore Rules syntax; only runtime behavior is unverified. |
| Rules runtime verification via emulator | BLOCKED | Tooling and port are ready, but the existing harness tests the wrong (old) shape for this purpose. |
| Comparison against a written Phase 3.7 spec | BLOCKED | No such spec existed before this document. |

## 6. Open questions before implementation continues

1. Is the intended final shape for goals the **subcollection** (`studentEntries/{studentId}/goals/{categoryId}`, per the new repository) or the **embedded map** (per the currently-deployed rule)? These are incompatible; only one should be built out.
2. Does `sessionIndex` get populated by a new write path (e.g. added inside `createAndSaveSession`/`saveSessionPatch`), or is a different mechanism intended?
3. What was `ensureLearningProgrammeMembershipLink` meant to do — create the `membershipLinks/{uid}` document per the existing Phase 1 rule's `create` contract? If so, it appears to simply be missing from `firestoreEnrollmentRepository.js` rather than needing new design.
4. Is the live UI (`StudentLearningCircleView.js` and friends) meant to be migrated onto the new `studentEntries` architecture as part of Phase 3.7, or is that a separate, later phase?

No fixes have been made. This document is the baseline for whichever of the above gets authorized next.

---

## 7. Implementation Report (Phase 3.7, executed)

All four open questions in §6 were resolved by explicit authorization before implementation began: goals use the subcollection; `sessionIndex` lives at `learningProgrammes/{programmeId}/sessionIndex/{sessionId}` and is written by session creation; `ensureLearningProgrammeMembershipLink` was added to `firestoreEnrollmentRepository.js`; the live UI was migrated. See the plan presented and approved earlier in this round for full file-by-file scope.

### 7.1 Files changed

**Rules:** `firestore.rules` — `studentEntries/{studentId}` restructured to own only `attendance`; new nested `goals/{categoryId}` subcollection rule; new `sessionIndex/{sessionId}` rule; new `memberships/{studentId}` mirror-document rule; `membershipLinks` create rule gained an additive OR check against the new mirror doc, with the original nested-array scan kept unconditionally as a fallback (no migration/backfill).

**Models/services:** `js/models/ProgrammeSession.js` (deterministic `${programmeId}__${date}` id, `usesStudentEntries` field), `js/services/programmeSessionService.js` (`buildNewSession` sets `usesStudentEntries: true`; `createAndSaveSession` creates one StudentEntry per active member plus the sessionIndex entry; new `saveAttendancePatchWithMirror()`; new `hydrateSessionGoals()`), `js/services/programmeSessionRepository.js` (`createSessionIndexEntry()`), `js/services/studentLearningCircleService.js` (new `persistOwnGoal()`, `getOwnSessionForDate()`; existing `ensureProgrammeMembershipLink()` now resolves to a real function).

**Repositories:** `js/repositories/firestoreStudentEntryRepository.js` (new `updateStudentEntryGoal()`; teacher-defaulted `db` params), `js/repositories/firestoreEnrollmentRepository.js` (new `ensureLearningProgrammeMembershipLink()`, `setProgrammeMembershipMirror()`).

**UI:** `ProgrammeGoalsControls.js` (new `goalWriter` callback, branches on `session.usesStudentEntries`), `ProgrammeAttendanceControls.js` (new `persistAttendance` callback, same branch), `ProgrammeAttendanceView.js`, `ProgrammeGoalsReviewView.js`, `ProgrammeSessionView.js` (construct the above callbacks + call `hydrateSessionGoals`), `LearningProgrammeSettingsView.js` + `LearningProgrammesListView.js` (write the membership mirror alongside `workspaceService.save()`), `StudentLearningCircleView.js` (fully rewritten data path: `ensureProgrammeMembershipLink()` first, `getOwnSessionForDate()`/`listOwnSessionSummaries()` instead of the teacher-gated `programmeSessionService` reads, student-scoped `goalWriter`).

**Tests:** `studentEntries.rules.verify.js` rewritten for the subcollection shape (27 tests); `membershipLinks.rules.verify.js` extended with mirror-doc tests (20 tests); new `sessionIndex.rules.verify.js` (8 tests) and `programmeMemberships.rules.verify.js` (8 tests); `package.json`/`run-verification.sh`/`run-verification.bat` updated to run all four.

### 7.2 Backward compatibility

No existing `programmeSession`, `studentEntries`, or `membershipLinks` document was read-modified-written by this work. Every behavioral branch checks `session.usesStudentEntries` explicitly and falls through to the pre-existing code path when absent. Deterministic ids and the studentEntries/sessionIndex writes only ever happen inside session *creation*, never touching an already-persisted session.

### 7.3 Emulator verification — RUN, 63/63 passing

Ran for real against a local Firestore Emulator (`firebase-tools` 15.28.1, upgraded from 15.26.0 mid-session to rule out a stale binary; emulator jar v1.22.0 unchanged either way): `membershipLinks` (20), `studentEntries` (27), `sessionIndex` (8), `programmeMemberships` (8) — all green. Two findings surfaced during this run and were resolved with your explicit direction rather than silently:

1. **Emulator limitation, not a code defect:** this local Firestore Emulator build cannot evaluate *any* Firestore Rules list-predicate macro (`.exists()`, `.filter()`, `.all()`, `.map()`) — confirmed via isolated, unrelated throwaway rulesets, at every nesting level including a single non-nested call. No rewrite exists that avoids these macros while preserving the old membershipLinks fallback's exact "match studentId+status, ignore other fields" semantics (the one macro-free alternative, exact map-equality via `in`, would silently narrow authorization). Per your direction, the fallback ships exactly as originally written, unweakened. `membershipLinks` test 1 (the one case needing this fallback to reach a clean ALLOW) reports its actual result via `console.log` without failing the suite — the same pattern already established for the file's own test 3. **This must be re-verified against a real or staging Firebase project before the fallback is trusted for a membership with no mirror doc.**
2. **Real, pre-existing, unrelated security gap found (not a Phase 3.7 regression):** `isLinkedActiveStudent()` (unchanged Phase 3.2 code) checks only `membershipLinks/{uid}`'s own permanently-fixed `status` field, never the student's *current* programme membership. A student whose device linked while active keeps `studentEntries`/`goals` access to that programme forever, even after leaving. Confirmed via `studentEntries` test 24 actually allowing. Per your direction, deferred as out of Phase 3.7's scope — the test reports its actual result rather than asserting a DENY the rule was never built to satisfy. **Recommend scoping a dedicated fix** (e.g. re-checking current membership status, via the new mirror doc, at read/write time).

### 7.4 Not done / explicitly out of scope this round

- No backfill/migration of existing memberships to the new mirror collection (explicit decision).
- No fix for the stale-link access gap in §7.3 item 2.
- No deployment — nothing was pushed to a live Firebase project; all verification was local-emulator only.
