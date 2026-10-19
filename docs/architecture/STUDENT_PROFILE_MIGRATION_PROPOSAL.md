# ClassMate ↔ Learning Hub — Learner Identity Migration Proposal

**Status: design proposal, not approved, not implemented.** No code,
Firestore rule, Firestore collection, or authentication behavior was
created or modified to produce this document. This is a companion
design document to `docs/architecture/STUDENT_PROFILE_ARCHITECTURE_AUDIT.md`
— read that first; every claim here about "what exists today" is
sourced from it, not re-derived.

This document proposes an identity model. It does not implement one.
Section E lists every decision that needs your explicit approval
before any of this becomes real.

---

## Non-negotiable boundaries carried into this design

Four identifiers, never conflated, never substituted for one another:

| Identifier | Issued by | Identifies | Lifetime |
|---|---|---|---|
| **Firebase Auth UID** | Learning Hub's own Firebase project, via real Google Sign-In | *Whoever is currently authenticated* — a parent/guardian, or a learner old enough to sign in themselves | As long as that Google account exists |
| **Learner Profile ID** | Learning Hub, freshly generated | *One real learner*, independent of any account, classroom, or device | Permanent — this is the id all learning history is keyed to |
| **ClassMate `Student.id`** | ClassMate, freshly generated | One student record nested inside one specific classroom document | Durable *within that classroom's own roster* (per the audit, §1/§17) — a new enrollment in a different classroom is a different `Student.id` |
| **Classroom Membership ID** | Learning Hub (proposed, new) | The *fact* that a specific Learner Profile is enrolled in a specific ClassMate classroom as a specific `Student.id` | Active for the duration of that enrollment; superseded, not deleted, when it ends |

No layer of this design ever uses one of these where another belongs —
in particular, per your explicit instruction, the Firebase Auth UID is
never treated as the learner's identity (an account can hold several
learners), and `Student.id` is never treated as the Learning-Hub-facing
identity (a learner outlives any one classroom enrollment).

Ownership stays split exactly as you specified: ClassMate remains
authoritative for classroom membership, orchestration, teacher
workflows, scoring/recognition, and assignments; Learning Hub owns
concepts, activities, checks, responses, attempts, understanding,
learning history, and evidence. Nothing in this proposal duplicates
either side's data into the other — the only thing that crosses the
boundary is a verified *reference* (which learner ↔ which classroom
enrollment), never the underlying domain data itself.

---

## A. Proposed conceptual model

```
Firebase Auth UID  (Learning Hub's own project; real Google Sign-In)
      │
      ▼
Account                              accounts/{uid}
  - one per Firebase Auth UID (1:1, doc id == uid)
  - holds the denormalized list of Learner Profiles this
    account currently manages
      │
      │  (many-to-many: one account, several learners;
      │   one learner, potentially several accounts — §7)
      ▼
Learner Profile                      learnerProfiles/{learnerProfileId}
  - ONE per real learner, generated once, permanent
  - never equals a Firebase UID, never equals a Student.id
  - this is what all Learning Hub history keys to
      │
      │  (a learner may hold zero, one, or several classroom
      │   memberships over time — one per real-world enrollment)
      ▼
Classroom Membership                 learnerClassroomMemberships/{membershipId}
  - proves: "this Learner Profile IS ClassMate Student X,
    in ClassMate classroom Y, verified once, on this date"
  - superseded (not deleted) when the enrollment ends
      │
      ▼
ClassMate Student Record              classrooms/{classroomId}.teams[].students[{studentId}]
  - unchanged, ClassMate-owned, exactly as it exists today
```

This is a direct generalization of the audit's `MembershipLink`
pattern (§16/§19 of the audit), not a new mechanism invented from
scratch: `MembershipLink` already proved "verify a uid against a real
membership record once, at creation, then let a listless Firestore
rule check it forever after" works. This proposal applies that same
shape twice — once for Account↔Learner, once for Learner↔Classroom —
rather than trying to make one link do both jobs (which is exactly
what would have re-created the `studentAuthLinks` list-query problem
the audit found evidence was already rolled back once).

### Independent Mode fits the same shape, not a second system

For a learner using Learning Hub outside any ClassMate classroom (the
"INDEPENDENT" branch from the earlier product direction), the Account
still gets exactly one auto-created Learner Profile representing
themselves, with zero Classroom Memberships. The same four-layer model
applies uniformly; there is no second, parallel identity system for
this case.

---

## B. Proposed Firestore model

All new collections below are proposed to live in **Learning Hub's own
Firebase project**, not ClassMate's `classmate-302c2` — the audit
confirmed these are separate projects. Where a proposed document needs
to reference ClassMate data, it stores `classroomId`/`studentId` as
plain reference fields, the same "reference by id, never embed" pattern
ClassMate itself already uses for `classroomRefs` (per the audit).

### `accounts/{uid}`
```
{
  learnerProfileIds: [learnerProfileId, ...],   // denormalized, for a single listless get()
  lastActiveLearnerProfileId: learnerProfileId | null,  // UX convenience only, not identity
  createdAt
}
```
Doc id **is** the Firebase Auth uid — mirrors `MembershipLink`'s own
"doc id is the identity being checked" trick, so a rule can resolve
"which learners can `request.auth.uid` act as" with one `get()`, never
a query.

### `learnerProfiles/{learnerProfileId}`
```
{
  displayName,           // whatever Learning Hub shows the learner as
  avatarRef,             // non-photographic, matches existing ClassMate avatar convention
  createdAt,
  createdVia: 'classmate-link' | 'independent-signup'
}
```
`learnerProfileId` is a freshly generated id — **never** a Firebase UID,
**never** a ClassMate `Student.id`. This is the one field every future
learning-history document keys against.

### `learnerAccountLinks/{uid}_{learnerProfileId}`
```
{
  uid, learnerProfileId,
  role: 'guardian' | 'self',
  linkedAt,
  linkedVia: 'invitation-redemption' | ...,
  status: 'active' | 'revoked'
}
```
Immutable audit trail of *how and when* this specific account/learner
pair was established — mirrors `MembershipLink`'s own immutability
("a device's own link is never edited... a brand-new one, never a
rewrite" — audit §16). `accounts/{uid}.learnerProfileIds` is the fast,
denormalized read path; this collection is the source of truth for
revocation history and for the "which accounts manage this learner"
reverse lookup (§10).

### `learnerClassroomMemberships/{membershipId}`
```
{
  learnerProfileId,
  classroomId,             // ClassMate's own document id
  studentId,                // ClassMate's own Student.id
  status: 'active' | 'ended',
  verifiedAt,
  verifiedVia: 'classmate-invitation-code'
}
```
`membershipId` is its own generated id (not composite, so a membership
can be superseded — status flipped to `ended` — while a *new* one is
created for a re-enrollment, without ever reusing or mutating history).
This is the direct Learner-side analogue of `MembershipLink`, scoped to
classroom enrollment instead of Learning Programme access.

### Everything Learning Hub already owns (concepts, activities, checks, responses, attempts, evidence, history)
Every such record keys to **`learnerProfileId`**, never to
`(classroomId, studentId)` directly and never to a Firebase UID. This
is the concrete answer to your item 18: a learner's entire learning
history survives a classroom change, a device change, an account
change, or even (per §7) a second account linking in, because none of
those events ever touch `learnerProfileId` itself.

---

## C. Proposed authorization model

Generalizing the audit's own description of why `MembershipLink` is
safe (§12/§16): every check below is a **chain of single, listless
`get()` calls**, each keyed by a value already known before the rule
runs (either `request.auth.uid`, or a field on the document actually
being written) — never a `list`/query-shaped rule, which is exactly
the class of rule Firestore cannot safely evaluate (the same
limitation the audit found had already broken `studentAuthLinks` once).

1. **Can this uid act as this learner?**
   `get(accounts/$(request.auth.uid))` → confirm `learnerProfileId` is
   in its `learnerProfileIds` array. One doc read, keyed by a value
   Firestore already knows (`request.auth.uid`).

2. **Is this learner genuinely enrolled in this classroom, as this student?**
   `get(learnerClassroomMemberships/$(membershipId))` (or a
   deterministic id derived from `learnerProfileId` + `classroomId`,
   still a single-doc `get()`, not a query) → confirm `status ==
   'active'` and the claimed `studentId` matches.

3. **Learning Hub's own domain writes** (a check, an attempt, a
   response) are authorized by chaining 1 → 2 → allow the write to a
   document whose own `learnerProfileId` field matches — the same
   two-hop shape `firestore.rules` already uses for
   `programmeSessions/{sessionId}/studentEntries/{studentId}` (audit
   §12, `isLinkedActiveStudent()`), just one layer taller (account →
   learner → classroom membership, instead of uid → learner directly).

4. **ClassMate-side data** (roster, scoring, recognition, assignments)
   is **never** writable through this chain, in either direction —
   Learning Hub's rules would only ever *read* a
   `learnerClassroomMemberships`-equivalent reference to know which
   classroom context applies; ClassMate's own existing rules
   (unmodified, per your instruction) remain the only path to
   ClassMate's own data.

5. **Revocation is a status flip, never a delete-and-recreate.**
   `learnerAccountLinks.status = 'revoked'` and removal from
   `accounts/{uid}.learnerProfileIds` immediately closes step 1 for
   that account, for every learner, retroactively and without touching
   any learning-history document — the same "immutable record,
   narrow status field changes it" shape `firestore.rules` already
   uses elsewhere (per the audit's own citations).

### Privacy boundary
`learnerProfiles` documents should carry only what's already acceptable
under this org's data rules — display name and a non-photographic
avatar, nothing from the prohibited list (contact details, government
IDs, health data, photos of minors). Any future field beyond that
(e.g., date of birth, if ever proposed for age-appropriate content
gating) should be escalated to the AI Working Committee first, the
same gate the audit found `ConsentProvider.js` was already built to
anticipate but never wired up to anything load-bearing.

---

## D. Migration strategy

### Cross-project verification is the one open engineering question this proposal does not resolve
`learnerClassroomMemberships` needs to be verified against ClassMate's
*real* roster — but ClassMate and Learning Hub are separate Firebase
projects (per the audit). This proposal assumes some verified
cross-project channel exists or will be built (e.g., a ClassMate-issued,
single-use invitation token redeemed through a narrow, purpose-built
verification path) but does not design that channel here — it's listed
as an unresolved decision in §E, not quietly assumed.

### Phase 1 — build alongside, touch nothing live
Stand up `accounts`, `learnerProfiles`, `learnerAccountLinks`,
`learnerClassroomMemberships` in Learning Hub's project. Zero interaction
with the current, live Student Mode device-slot flow. This phase is
purely additive and reversible.

### Phase 2 — new door, old door both open
A parent signs into Learning Hub with Google, redeems a ClassMate-issued
invitation (reusing the *interface shape* the audit found already fully
designed in `StudentLinkRepository.js` — `resolveInvitationToken`/
`redeemInvitationToken` — never its `Local`/`Demo` implementations, per
your explicit instruction), and a Learner Profile + Classroom Membership
are created. The existing anonymous device-slot flow keeps working
unchanged for anyone who hasn't done this yet — no one is forced to
migrate to reach their current classroom.

### Phase 3 — Learning Hub becomes the primary student-facing surface
New Student Mode features, and eventually existing ones, are rebuilt
inside Learning Hub against `learnerProfileId`. ClassMate's own Student
Mode UI is not deleted in this phase — it keeps working for anyone not
yet migrated (§16 below), consistent with your instruction not to
modify current Student Mode as part of this design.

### Phase 4 — sunset ClassMate Student Mode UI
Only once Learning Hub's coverage is genuinely equivalent. This
proposal takes no position on timing — that is a product decision, not
an architecture one.

### What happens to existing Student Mode `localStorage` profiles (item 16)
They are not migrated automatically, and nothing in this proposal reads
or writes them — they have no server-side counterpart to migrate *from*
(the audit confirmed device-slot identity is `localStorage`-only, §6/§10).
A student who already uses the current flow keeps using it exactly as
today until a parent separately links a Learning Hub Account to that
same real classroom enrollment via Phase 2's flow above — at that
point a *new*, durable Learner Profile is created; the old device-local
profile is not deleted, converted, or referenced by it in any way. Two
identities for the same real learner briefly coexisting (old device
profile, new Learner Profile) during a gradual, opt-in migration is an
accepted, temporary condition of this strategy, not a defect — the same
"leave the old thing in place, unused, rather than force a rewrite"
approach the audit found this codebase already uses for its own
superseded onboarding flows.

### How existing ClassMate classroom codes fit in (item 17)
Per the audit (§22), the classroom code today is the *only* thing
standing between an anonymous visitor and roster read access — it
cannot simply be deleted without removing that protection for anyone
still on the old flow. Under this proposal, once a real,
Google-authenticated Firebase UID is verified (via Phase 2's linking
step) into a durable Learner Profile and Classroom Membership, that
verified relationship is what subsequent Learning Hub access relies
on — no code is presented or checked again after that one-time linking
step. The classroom code's role becomes exactly what a
PIN/invitation-token already does elsewhere in this codebase
(per the audit, §22): a one-time, teacher-issued credential that
*establishes* a verified link, not a standing credential checked on
every access afterward.

---

## E. Unresolved decisions requiring your approval

Six genuine open questions this proposal deliberately does not resolve
on its own. Each is expanded to the same nine-point structure so they
can be reviewed and approved independently.

### E1. Cross-project verification mechanism

**1. Decision.** How does a Learning-Hub-side write actually confirm a
ClassMate invitation code is real, unused, and points at a genuine
`(classroomId, studentId)` — given ClassMate and Learning Hub are
separate Firebase projects (per the audit)?

**2. Options considered.**
- **(A) Cloud Function bridge** — a single-purpose, callable function,
  colocated with ClassMate's own project, that verifies a token
  against ClassMate's real Firestore and returns a verified
  `{classroomId, studentId}` result. Learning Hub never touches
  ClassMate's database directly.
- **(B) Direct cross-project Firestore access** — grant Learning Hub's
  backend a service account with read access into ClassMate's
  Firestore to verify tokens itself.
- **(C) Signed assertion / custom token** — ClassMate mints a
  cryptographically signed assertion at redemption time; Learning Hub
  verifies the signature offline, without any further data access.
- **(D) Human-mediated fallback** — a teacher manually confirms in
  both systems. Not scalable; fallback only.
- **(E) Neutral third-party bridge service** — a small, independently
  hosted service both projects trust, mediating the exchange.

**3. Recommendation.** (A) — a single-purpose Cloud Function, colocated
with ClassMate's project, as the sole verification path, consuming a
short-lived, single-use, cryptographically random invitation token
(not a human-typed PIN).

**4. Why.** This keeps ClassMate as the sole authoritative source of
enrollment truth — no second project needs broad query rights into
ClassMate's real production data (which (B) would require), and no new
cryptographic infrastructure needs to be designed and audited before
this can work at all (which (C) would require, though it remains a
reasonable future hardening layered on top of (A), not a competing
choice). It reuses the invitation-token *concept* the audit already
found fully designed (`generateInvitationTokenForStudent`/
`resolveInvitationToken`), just backed by a real, narrowly-scoped
endpoint instead of a `Local`/`Demo` implementation. A single,
purpose-built function is also the easiest of the five options to
independently test, rate-limit, and reason about — the opposite of
opening a broad new cross-project trust surface.

**5. Security implications.** The function must reject any caller
other than Learning Hub's own verified backend (App Check and/or a
scoped service-account/IAM invoker restriction) — otherwise it becomes
a way to probe or redeem other classrooms' invitation tokens.
Redemption must be checked and marked used inside a single transaction
to prevent two simultaneous callers both succeeding against the same
token (a race the existing, unwired `invitationTokens.used` field
design already anticipated, per the audit, but never had to defend
against concurrent access). This is the narrowest of the five options
in terms of new attack surface: one function, one job, versus (B)'s
broad standing data-access grant.

**6. Data-integrity implications.** This function becomes the single
arbiter of "is this a real ClassMate enrollment" for every Classroom
Membership ever created — a defect here has the same shape and
severity as the Winning Team Member incident from the prior audit
(a correctly-specified rule producing wrong results against
degenerate/duplicate input). It needs the same rigor: deterministic,
idempotent redemption, and tests for double-redemption and
already-used tokens before any real linking happens.

**7. Migration implications.** This is the one piece of net-new
infrastructure Phase 2 cannot start without — every other part of the
proposal (the Firestore model, the authorization chain) can be built
and reviewed independently of this decision, but no real Account↔Learner
or Learner↔Classroom link can be created for real until this exists and
is tested.

**8. Reversibility.** Fully reversible. The function can be replaced,
hardened (e.g. layering in (C) later), or relocated without touching
any Learner Profile or Classroom Membership document already created —
those are just data, independent of how they were verified into
existence.

**9. Dependencies.** Directly gates E2 (who issues the token this
function consumes) and E4 (where this function's code physically
lives) — E1 and E4 are really one decision seen from two angles and
should be approved together.

---

### E2. Who can issue the ClassMate-side invitation

**1. Decision.** Is classroom-membership linking driven by the
existing teacher-facing PIN/invitation-token interface
(`generatePinForStudent`/`generateInvitationTokenForStudent`, already
fully designed per the audit), or does it need its own, separate
issuance path?

**2. Options considered.**
- **(A) Reuse the existing teacher-issued interface as-is**, backed by
  a real Firestore implementation instead of `Local`/`Demo`.
- **(B) A brand-new, separate issuance mechanism** dedicated to
  Learning Hub linking, kept conceptually distinct from the existing
  device-approval PIN.
- **(C) Student/family self-issuance** — an already-approved device in
  the current Student Mode flow gets a button to generate its own
  Learning Hub link code, without teacher involvement.
- **(D) Both (A) and (C)** together, covering more real-world scenarios
  at the cost of securing and auditing two issuance paths instead of one.

**3. Recommendation.** (A) — reuse the existing teacher-issued
interface, backed by a real implementation, as the only issuance path
initially.

**4. Why.** It's the smallest possible diff: the interface was already
designed against real classroom data (per the audit) and needs only a
real backing store, not a new mental model for teachers. It also
preserves the existing authority boundary — teachers control who links,
consistent with ClassMate remaining authoritative for classroom
membership. (C) is the one to be most cautious of: it would let a
device already trusted only for the *old*, self-attested, device-local
flow silently mint a credential that leads to a *stronger*, durable,
cross-product identity link — a privilege escalation the current
architecture was never designed to gate, and not something to introduce
as a side effect of this decision rather than its own deliberate choice.

**5. Security implications.** Teacher-only issuance means no new
anonymous-writable surface is introduced — token generation stays
reachable only from an already-authenticated teacher session, exactly
like today. If self-service issuance (C) is ever added later, it needs
its own dedicated security review specifically because of the privilege
escalation risk noted above.

**6. Data-integrity implications.** Because a token is only ever
generated against a real, teacher-verified roster entry, there is no
path to a token pointing at a fabricated or ambiguous student —
inherits the same integrity guarantee the existing (unwired) design
already has.

**7. Migration implications.** Bounded, well-scoped work: back an
already-designed interface with a real implementation. No new UI
concept for teachers.

**8. Reversibility.** Fully reversible — adding a second issuance path
later (e.g. (C), if a real need emerges) doesn't invalidate memberships
already created via teacher-issued tokens, since verification (E1) only
cares that a token was validly issued and redeemed once, not which UI
produced it.

**9. Dependencies.** Consumed by E1 (the verification mechanism);
interacts with E4 since "teachers issue it" implies the issuance-side
write naturally lives in ClassMate's own project.

---

### E3. Multiple accounts linked to one learner — consent policy

**1. Decision.** Can a second parent/guardian account link to an
already-linked child without the first parent's knowledge or consent?
Does a teacher need to approve a second link?

**2. Options considered.**
- **(A) Fully open** — any account that redeems a valid, teacher-issued
  token can link, with no notification to existing linked accounts.
  Matches how the (currently unused) PIN model already behaves.
- **(B) Notify-only** — linking succeeds immediately, but existing
  linked accounts are notified afterward that a new account has linked.
- **(C) Consent-gated** — an existing linked account or a teacher must
  approve a new link before it takes effect; requires a new pending
  state in the data model.
- **(D) Teacher-mediated only** — only a teacher, never a parent
  directly, can add a second account to an already-linked learner.

**3. Recommendation.** (B) now, with (C) flagged as the likely eventual
target once real usage patterns exist — not built speculatively yet.

**4. Why.** (A) is too permissive to be a considered default: silently
letting anyone with a valid token attach to a child's profile with zero
visibility to existing guardians is a foreseeable safeguarding concern
(an estranged co-parent, a non-guardian relative) even though the
underlying token is already scoped to one specific student by a
teacher. (C) is the more defensible long-term answer but requires
designing an approval workflow (who approves, what happens while
pending, timeout behavior) that is real, unbuilt complexity — deciding
it now, before any usage data exists, risks designing the wrong
workflow speculatively. (B) captures most of the practical safety
benefit (an existing guardian finds out and can act, e.g. ask a teacher
to revoke) with none of the new pending-state complexity, and is a
strict subset of (C)'s data model — nothing about choosing (B) now
forecloses (C) later.

**5. Security implications.** The real security boundary here is
actually E2 (how tightly invitation issuance is controlled), not this
policy — whoever legitimately holds a valid token can link, by
construction, under any of (A)/(B)/(C). This decision only governs how
quickly a guardian learns about it, not whether it can happen.

**6. Data-integrity implications.** None — `learnerAccountLinks` is
many-to-many by construction regardless of which policy gates it, so
this is purely a workflow decision layered on an already-adequate
schema, not a schema decision.

**7. Migration implications.** None blocking — choosing (B) doesn't
delay or complicate Phases 1-3.

**8. Reversibility.** Straightforward in the (B)→(C) direction: adding
a `status: 'pending'` value and an approval action doesn't disturb
existing `active` links. Less clean in the (A)→(B)/(C) direction if (A)
were chosen first: links already created silently under (A) wouldn't
automatically get retroactively reviewed just because the policy
tightens — a one-time backfill notification would need separate
consideration if that path were ever taken. This asymmetry is itself
part of why (B), not (A), is recommended as the starting point.

**9. Dependencies.** Builds directly on E2 — together they define the
complete trust chain for "who ends up linked to a learner."

---

### E4. Where the Classroom Membership verification step runs

**1. Decision.** Does the code that checks a ClassMate invitation
token against real ClassMate data (and produces the verified result
Learning Hub writes into `learnerClassroomMemberships`) live inside
ClassMate's project, inside Learning Hub's project, or in a separate
shared service?

**2. Options considered.**
- **(A) Inside ClassMate's own project** — a Cloud Function colocated
  with `classmate-302c2`, verifying locally against data it already
  owns, returning a trusted result to the caller.
- **(B) Inside Learning Hub's project** — Learning Hub's backend reads
  ClassMate's Firestore directly (requires a cross-project grant).
- **(C) A separate, neutral shared service** trusted by both sides.

**3. Recommendation.** (A) — verification logic lives inside ClassMate's
own project.

**4. Why.** This directly follows the ownership principle you stated:
ClassMate is the authoritative source for classroom membership, so the
code deciding whether a membership claim is valid should live where
that authoritative data already lives, rather than granting a second
project broad read access to it (B) or standing up new shared
infrastructure before there's a concrete need for one (C). It also
matches the audit's own observation that every existing
verification-adjacent mechanism (PIN/invitation generation and
resolution) already lives in ClassMate's own services layer — (A)
simply extends that existing boundary outward with one new, narrow,
externally-callable entry point.

**5. Security implications.** (A) keeps ClassMate's Firestore security
perimeter completely intact — Learning Hub never talks to ClassMate's
database, only to one narrow function. (B) would require provisioning
a cross-project service account with read access that operates via the
Admin SDK, which bypasses Firestore security rules entirely — a
materially larger, harder-to-audit trust grant than reviewing one
function's internal logic.

**6. Data-integrity implications.** Co-locating the check with the
source data means there is no risk of verifying against a stale or
partially-synced copy of the roster — a risk (B) or (C) could introduce
if any caching or replication were ever added between projects.

**7. Migration implications.** This is the same underlying function as
E1 — resolving E4 finalizes where that function's code physically
lives and who builds/maintains it (a ClassMate-side engineering task
under this recommendation, not a Learning Hub one).

**8. Reversibility.** Moderate. Moving the verification logic later
(e.g. from (A) to (C)) doesn't require touching any Learner Profile or
Classroom Membership document already created — those are just data —
but it does mean re-pointing Learning Hub's linking flow at a new
endpoint and re-establishing whatever new trust boundary that
introduces. Not a data migration, but not a zero-cost change either.

**9. Dependencies.** This is the direct resolution of "where" for E1's
"how" — approve E1 and E4 together, not separately.

---

### E5. Timing and scope of Phase 4 (sunsetting ClassMate Student Mode UI)

**1. Decision.** When, if ever, does ClassMate's own Student Mode UI
(today's device-slot flow and its ~19 dependent views, per the audit
§13) get retired, and what "genuinely equivalent" means before that
happens.

**2. Options considered.**
- **(A) No fixed timeline now** — defer entirely; revisit once Learning
  Hub's coverage is observably close to complete. (This proposal's
  current default.)
- **(B) Set a concrete target now** (e.g. a specific feature-parity
  milestone), to avoid indefinite dual-maintenance.
- **(C) Never fully sunset** — keep ClassMate Student Mode permanently,
  even after Learning Hub becomes the primary experience.

**3. Recommendation.** (A) for this design phase — explicitly defer —
paired with starting a feature-parity checklist (derived from the
audit's own list of dependent views) as a living artifact from Phase 2
onward, so a future Phase 4 decision is measured against something
concrete rather than judged impressionistically later.

**4. Why.** Committing to a hard date (B) before Phase 2 has even
started, while E1 (the largest piece of net-new engineering this whole
migration depends on) is still unresolved, would be a guess dressed up
as a plan. (C) forecloses an option — retiring dual maintenance once
it's genuinely safe to — without any evidence yet that permanent
duplication is actually necessary, which cuts against the stated end
goal of Learning Hub becoming the complete student-facing experience.

**5. Security implications.** None directly — this is a scheduling
decision, not an authorization one. Indirectly: running two live
student-facing surfaces longer than necessary means maintaining two
separate security postures (today's self-attested-uid model, and the
new verified-Learner-Profile model) concurrently for longer than
strictly needed once Learning Hub is genuinely ready.

**6. Data-integrity implications.** None — Phases 2-3 already run both
systems side by side by design; deferring E5 doesn't change that
overlap, only how long it eventually lasts.

**7. Migration implications.** Zero bearing on whether Phases 1-3 can
proceed — E5 only governs the end state, and deferring it removes a
false dependency that future planning might otherwise assume exists.

**8. Reversibility.** Fully reversible — a scheduling decision with no
data-model consequence either way. Choosing "defer" now costs nothing
to revisit later with better information.

**9. Dependencies.** Implicitly depends on real usage/coverage outcomes
from Phases 2-3, which don't exist yet — cannot be meaningfully decided
in this design phase regardless of preference.

---

### E6. Whether `learnerProfiles` needs fields beyond display name/avatar

**1. Decision.** Does the `learnerProfiles` document need any
additional field (date of birth, grade level, language preference,
etc.) before implementation, or does it ship with exactly
`{displayName, avatarRef, createdAt, createdVia}`?

**2. Options considered.**
- **(A) Ship minimal** — only the fields already proposed; add anything
  else later, each as its own separately reviewed change.
- **(B) Add a coarse grade/age-band now**, to support age-appropriate
  content gating in Learning Hub from day one.
- **(C) Add full date of birth now**, for precise age gating.

**3. Recommendation.** (A) — ship minimal, add fields later only as
each is specifically needed and separately reviewed.

**4. Why.** This follows this organization's own standing data-handling
rule directly: a new field beyond what's already been reviewed should
be escalated to the AI Working Committee *before* it's added, not
bundled speculatively into the initial schema because it might be
useful eventually. Date of birth in particular sits close to categories
this organization's data rules already treat carefully; even a coarser
grade/age-band (B) is a new category of learner data this proposal
doesn't currently need for anything concrete — no age-gated content
exists yet anywhere in this design. Adding it now would be speculative
scope, matching exactly the kind of unrequested expansion both this
org's data guidance and this project's own engineering norms
("don't design for hypothetical future requirements") caution against.

**5. Security implications.** A smaller schema is a smaller
data-exposure surface by construction — fewer fields to secure, audit,
and risk over-exposing in a future rule or client read.

**6. Data-integrity implications.** None either way — adding a field
later is additive and requires no migration or backfill of existing
`learnerProfiles` documents; a field simply reads as absent until
populated.

**7. Migration implications.** None — this is already the smallest
possible starting schema, so there is nothing to migrate away from;
growing it later is a forward-only, additive change.

**8. Reversibility.** Fully reversible in the direction of *adding*
fields later. Materially harder in the direction of *removing* a field
already collected from real users — e.g. if DOB were added now (C) and
then had to be walked back after a Working Committee review, that would
require a real data-deletion/notice process, not just a schema edit.
Starting minimal avoids ever being in that harder position.

**9. Dependencies.** None on the other five decisions — fully
independent, and could be decided immediately without waiting on
anything else.

---

**This is a proposal only. No implementation has begun. Waiting for
your decisions on §E before any further work.**
