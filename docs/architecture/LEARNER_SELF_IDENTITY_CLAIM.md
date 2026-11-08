# Learner Self-Identity Claim

Product decision: a Learning Hub student should be able to join a
classroom by signing in with Google, entering the shared classroom
code, and picking their own name off the real roster — without waiting
for a teacher to blindly guess which pending request belongs to them.

## Why this still requires teacher confirmation for a first claim

Google authentication proves *who is signing in*; it proves nothing
about *which roster student that account belongs to*. A roster student
record (`js/models/Student.js`'s own `createStudent()`) carries only a
name, a roll number, score/bucket/badges/notebook data — never an
email, a contact field, or any identity signal a Google account could
be checked against. This was already investigated and documented twice
before this feature existed: `STUDENT_PROFILE_ARCHITECTURE_AUDIT.md`
§3.9/§14, and `js/models/LearnerConnection.js`'s own
`findTrustedAutomaticMatch()` header comment, which is why that
function is a permanent, literal no-op (`return null`) — not a stub
waiting to be filled in, a documented architectural conclusion.

ClassMate's own Student Mode roster picker
(`StudentJoinClassroomView.js`/`StudentRosterPickerView.js`) solves this
by not solving it: any device tapping any name instantly becomes that
student, by explicit, documented product decision, because the stakes
are low (a shared classroom device, trust re-established every time a
teacher resets it). Learning Hub's stakes are categorically different —
a personal Google account, persistent across devices, with real content
tied to it — so that precedent's UI is reused here, but its "zero
server verification" trust model is not.

**Conclusion, per explicit product direction:** since no existing data
can prove a first claim safely, a first claim always produces a
PENDING relationship and still requires one teacher confirmation — but
the claim itself names a candidate student, turning that confirmation
into a single tap instead of a blind pick from an unordered roster.
Once ACTIVE, a returning student's own account is recognized
automatically and never re-prompted.

## The flow

1. Student signs in with Google (Learning Hub's existing auth,
   unchanged).
2. Student enters the shared classroom code (the unified
   `classroomStudentJoinCode`/`studentJoinCodes` code from the
   "Unified Classroom Code" change — PR #24 — with the legacy
   `classroomInvitationCodes` fallback preserved).
3. Learning Hub calls `getClassroomRosterForLearner` (new; wraps
   ClassMate's `getClassroomRosterForLearnerEndpoint.js`) with just the
   code — no `learnerProfileId` needed, since listing a roster
   implicates no specific learner's own data. Returns `{classroomId,
   classroomName, students: [{id, name, teamName}]}`, resolved via the
   exact same `resolveInvitationClassroomId()` redemption itself uses —
   never a second, parallel lookup.
4. Student picks their name. Learning Hub calls the existing
   `redeemClassroomConnection` → `verifyLearnerConnection`, now with an
   additional, optional `claimedStudentId` field alongside the
   invitation code.
5. `createConnectionRequest()` validates the claim is a real, live
   roster id in the resolved classroom, and that the claimed student
   isn't already the ACTIVE match for a *different* learner (a cheap,
   non-authoritative pre-check — purely so a learner gets an honest
   "already connected" message immediately). Writes a PENDING
   relationship carrying `studentId` and `claimedByLearner: true` —
   never ACTIVE. Two different learners can each have their own PENDING
   claim on the same student at once; this is not resolved until a
   teacher reviews it.
6. `ConnectLearningHubView.js`'s pending-request queue shows the
   learner's own claim pre-selected in the roster picker (still
   overridable — teacher control is preserved). "Confirm match" calls
   the existing `activateLearnerConnection`, now with one more
   authoritative check: `studentId` must not already be the ACTIVE
   match for a different `learnerProfileId` in this classroom
   (transactional, re-checked immediately before the write — the real
   guarantee; `createConnectionRequest()`'s own pre-check is only a
   convenience).
7. On a later visit, Learning Hub's existing `ClassroomConnection.list()`
   already recognizes an ACTIVE membership — a returning student is
   never asked to claim again.

## What did not change

- `activateLearnerConnection` remains the one and only path that can
  ever set a relationship to ACTIVE. Nothing in the claim flow
  activates anything.
- Teacher confirmation is never bypassed for a first claim — only made
  faster.
- No Firestore rules were weakened. `learnerClassroomRelationships`'
  `allow create: if false` is untouched; every write here still runs
  exclusively through the Admin SDK.
- ClassMate Student Mode's own join flow is untouched.
- The unified classroom code (PR #24) and its legacy-code fallback are
  both reused unmodified.
