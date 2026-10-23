# Decisions log

Append-only. Every entry is a decision the Supervisor and any future agent
must treat as binding until explicitly superseded by a new entry (never by
silently contradicting an old one). "Made by" distinguishes a real human
decision from something an agent inferred/recommended.

Entries are numbered `DEC-000N`, oldest first.

---

## Pending — awaiting user decision

These six were surfaced by prior research (`WORK-0002`) into the ClassMate <->
Learning Hub integration and are **not yet decided**. They block any future
build work on that integration (see `cross-project/dependencies.md`). Listed
here, not just left inside the source docs, so the Supervisor can check "is
this still open?" without re-reading four long documents every time.

### DEC-PENDING-1 — Integration auth mechanism & trusted-server ownership
Which of: (A) shared client credential, (B) Cloud Function + Admin SDK,
(C) Cloud Function + signed-request verification, (D) read-only-only — and
who operates it (Learning Hub vs. ClassMate vs. jointly-owned)?
Researched recommendation on file (not a decision): (C), operated by Learning
Hub. Source: `learning-hub/docs/CLASSMATE_LEARNING_HUB_INTEGRATION_RECOMMENDATIONS.md` Decision 1.
**Gates:** all downstream cross-project integration build work.

### DEC-PENDING-2 — Authoring identity model (`authorId`)
Shared "integration account" vs. one Console-granted account per
school/teacher. Researched recommendation on file: shared `authorId` +
real-name `authorName` override. Source: same doc, Decision 2.
**Gates:** same as DEC-PENDING-1, paired with it.

### DEC-PENDING-3 — Publish-lifecycle ownership
Auto-publish vs. human review vs. reuse existing `publish()` triggered by the
ClassMate teacher. Researched recommendation on file: reuse `publish()`,
ClassMate-teacher-triggered. Source: same doc, Decision 3.

### DEC-PENDING-4 — Result/evidence callback scope
Whether a Learning-Hub-to-ClassMate result callback is in scope for this
integration or a later concern. Researched recommendation on file: out of
scope for now. Source: same doc, Decision 4.

### DEC-PENDING-5 — `classroomContext` persistence
Persist which classroom triggered an integration action inside Learning Hub's
own Firestore, or keep it external (Cloud Function logs only)? Researched
recommendation on file: external logs only. Source: same doc, Decision 5.

### DEC-PENDING-6 — Deletion/unlink contract
What happens to a Learning Hub resource when its ClassMate source is deleted?
Cascade-delete / archive / leave orphaned. Researched recommendation on file:
archive (reuse existing `status: "archived"`). Source: same doc, Decision 6.

**None of DEC-PENDING-1 through 6 have been ratified by the user.** They are
documented research + recommendation only. Any agent must not build against
them as if settled. **Reconfirmed explicitly by the user on 2026-09-13:**
recommendations are not approvals — these remain open until the user says
otherwise, in this log, not in a source doc's own wording.

---

## Made

### DEC-0001 — Where the Supervisor's persistent state lives
- **Date:** 2026-09-13
- **Made by:** Supervisor (foundation-setup task), not yet confirmed by user
- **Decision:** `.claude/supervisor/` lives inside the `classmate` (classroom-tracker) repo, not inside `learning-hub` and not in a third neutral location. Every record inside it carries an explicit `project` field so it can still coordinate both repos without ambiguity.
- **Rationale:** the foundation-setup session was invoked from the classroom-tracker working directory; writing coordination-only files into the sibling learning-hub repo would have created uncommitted changes in a repo the task explicitly says not to casually modify while working in the other. A single home avoids the two coordination stores drifting out of sync.
- **What future agents/work must respect:** treat this directory as the one authoritative Supervisor state store for both projects. Do not create a second, competing `.claude/supervisor/` inside `learning-hub`.
- **Status:** **CONFIRMED by the user, 2026-09-13.** Canonical location is permanently `classroom-tracker/.claude/supervisor/`. Not to be moved to `learning-hub` or a neutral directory.

### DEC-0002 — Work registry and task pool are one file, not two
- **Date:** 2026-09-13
- **Made by:** Supervisor (foundation-setup task)
- **Decision:** `registry/work-registry.json` serves as both the "work registry" and the "task pool" the original task asked for as separate structures. The task pool is this same file filtered by `status`.
- **Rationale:** every field the task pool needs is already a property of a work item; a second parallel structure could silently disagree with the first about a task's true status.
- **What future agents/work must respect:** never create a separate task-pool store. Add tasks by appending a work item with `status: "queued"` (or `"ready"`) to `work-registry.json`.
- **Status:** active.

### DEC-0003 -- Lesson Plan Builder Submit button position is intentional, not a bug
- **Date:** 2026-10-01
- **Made by:** User (rejeesh), explicitly confirmed -- not inferred or recommended by any agent.
- **Decision:** The Lesson Plan Builder's "Submit for Review" button sits near the top of the page, rather than literally after the Differentiation section as an earlier design brief's linear-flow diagram assumed. This placement is intentional, pre-existing, deliberate design and does not need to change.
- **Rationale:** per the user directly -- the earlier brief's linear top-to-bottom flow diagram was a planning aid, not a binding layout spec; the actual placement decision was made deliberately and stands.
- **What future agents/work must respect:** do not treat this placement as a defect, regression, or inconsistency with the design brief in any future UI pass on the Lesson Plan Builder (including WORK-0022 through WORK-0028, the follow-up items recorded the same day). No implementation action is needed or authorized as a result of this entry -- it exists only to prevent this from being re-flagged as a bug later.
- **Status:** CONFIRMED by the user, 2026-10-01. Closed, no action needed.

### DEC-0004 -- Lesson Plan Builder comprehensive visual-consistency redesign: scope and approach
- **Date:** 2026-10-21
- **Made by:** User (rejeesh), escalated directly to the requesting session.
- **Decision:** Scope is VISUAL / CSS / markup-structure only -- no change to the lesson-planning workflow, data model, autosave, or submission process. The redesign establishes one shared section design system (containers, headings, descriptions, field labels, content areas, spacing, borders, background colors) applied across the whole Lesson Plan Builder canvas in a single comprehensive pass, not phased section-by-section. Implementation is performed directly by the requesting session (main agent) in this same session, not delegated to a worktree or specialist agent.
- **Rationale:** per the user directly -- uneven typography, floating/disconnected labels and descriptions, inconsistent section layouts, and unclear visual hierarchy were observed across effectively every section of the page (lesson overview, common learning resources, Spark, learning activities, activity-specific resources, interactions, differentiation, pair explanation, exit ticket, student reflection), making a shared-system, whole-page pass more coherent than patching sections individually.
- **What future agents/work must respect:** this is registered as WORK-0029. Do not re-litigate "visual only, no workflow change" as the scope boundary without a new user decision. DEC-0003 (Submit button position is intentional) still applies and is not reopened by this pass. WORK-0022 through WORK-0028 (7 queued follow-up items from the 2026-10-01 visual QA round, same file) are not superseded automatically -- a future session should re-check each one's symptom against the post-redesign page before assuming it is resolved or still open, except WORK-0025 which additionally still needs its own product decision (button-tier unification) before any implementation, unaffected by this entry.
- **Status:** CONFIRMED by the user, 2026-10-21. Implementation in progress (WORK-0029).

### DEC-0005 -- WORK-0030/WORK-0031 parallel assignment and testimonial privacy model
- **Date:** 2026-10-22
- **Made by:** User (rejeesh), escalated directly to the requesting session.
- **Decision:** Two new, disjoint-file work items are authorized to proceed in parallel, each by a separate implementing agent: WORK-0030 (Group management roster picker) and WORK-0031 (Recognition, comments, and testimonials). Confirmed, non-negotiable product rule for WORK-0031: teacher comments on a student are PRIVATE BY DEFAULT; publishing a comment to a student testimonial section is a deliberate, explicit, separate teacher action; unpublishing must NOT delete the underlying comment, only remove it from the published/testimonial surface. Access control for private versus published comments must be enforced in the service/data-access layer AND in firestore.rules, not UI-only.
- **Rationale:** per the user directly -- these are two genuinely independent feature asks on disjoint files, and the comment-privacy model is a settled product requirement, not an open design question, given the sensitivity of unpublished teacher feedback on a student.
- **What future agents/work must respect:** (1) neither WORK-0030 nor WORK-0031 may touch js/ui/views/LessonPlanBuilderView.js, or css/styles.css's Lesson Plan Builder sections (WORK-0029's domain -- see CONFLICT-0004); (2) neither may touch .claude/supervisor/** registry files -- that is this coordination call's own domain, not either implementation agent's; (3) neither implementing agent may run commit, push, deploy, or a firestore.rules deploy -- integration/commit/push/deploy remains a separate, explicitly human-reviewed step, consistent with the Supervisor's standing authority limits; (4) the private-by-default/explicit-publish testimonial model is binding and must not be re-litigated or silently reinterpreted (e.g. as published-by-default, or deleted-on-unpublish) without a new decision entry superseding this one.
- **Status:** CONFIRMED by the user, 2026-10-22.

### DEC-0006 -- WORK-0030/WORK-0031 verified-complete, pending human sign-off
- **Date:** 2026-10-22
- **Made by:** Recorded by the Supervisor on report from the main coordinating session, which independently verified both items (not self-reported by either implementing agent alone). This is a verification-status record, not a new product decision.
- **Decision:** WORK-0030 (Group management roster picker) and WORK-0031 (Recognition, comments, and testimonials) are both marked `completed` in the work registry on the basis of independent third-party verification: re-run test suites (WORK-0030: 22/22; WORK-0031: 28/28 service-level + 3/3 badgeService meta, full regression 1404/1411 with 7 pre-existing unrelated failures) plus a fresh, independently-written Firestore Rules Emulator suite (`tests/rules/studentCommentsAndTestimonials.rules.test.js`, 8/8 passing against the real `firestore.rules`) written by neither implementing agent. `git diff` confirmed the two items' affected files remain mutually disjoint and that neither touched WORK-0029's Lesson Plan Builder surface (per DEC-0005/CONFLICT-0004). Nothing has been committed, pushed, or deployed by either implementing agent or by this verification pass -- both remain in the working tree only.
- **Rationale:** per the user directly -- "completed" here means implementation + independent verification are done, not that human product sign-off or commit/push/deploy have happened. Recording this distinction explicitly rather than letting `status: completed` imply more than it does.
- **What future agents/work must respect:** (1) WORK-0030 has one open product decision, intentionally left unresolved rather than invented: both the new "+ Add Existing Student" button and the pre-existing "+ Add Student" button currently use `.btn--text` styling (accessible `<button>` elements, but text-link visual weight, not the more prominent treatment the original complaint asked for) -- a human must choose which existing button tier (e.g. `btn--secondary` / `btn--tonal-neutral`) to apply before this is considered fully closed; (2) WORK-0031 has no open product or safeguarding concern beyond what DEC-0005 already settled; (3) neither item may be committed, pushed, or deployed by an agent acting on this entry alone -- that remains a separate, explicitly human-reviewed step per the Supervisor's standing authority limits; (4) this entry does not reopen or supersede any part of DEC-0005.
- **Status:** Verification CONFIRMED complete by the main coordinating session, 2026-10-22. Human product sign-off (WORK-0030's button-tier decision) and commit/push/deploy remain outstanding.

### DEC-0007 -- WORK-0032 resolves WORK-0030's last open item; WORK-0030/0031/0032 all verified-complete
- **Date:** 2026-10-22
- **Made by:** Recorded by the Supervisor on report from the main coordinating session, which implemented and independently verified WORK-0032 directly (small scope, not delegated). This is a verification-status record, not a new product decision.
- **Decision:** WORK-0032 (redemption name-pill removal + Add Student button tier promotion) is marked `completed`. It resolves WORK-0030's one previously-open item (DEC-0006): the Add Student / Add Existing Student buttons are now `.btn--tonal .btn--tonal-blue .btn--pill`, matching an existing tier used elsewhere (e.g. Lesson Plan Builder's Add Activity/Interaction/Differentiation buttons) -- no new button style introduced. The redemption pill CSS was deleted entirely, not recolored; the climbing (green) pill, underlying nameHighlight/redemption state, and performanceStateService.js logic are untouched. WORK-0031 (recognition/testimonials) is explicitly unrelated and untouched by this change.
- **Rationale:** per the user directly -- small, scoped, CSS/markup-only fixes handled in-session rather than delegated; 18/18 relevant tests pass; before/after screenshots (isolated fixture harness, no Firestore/production writes) confirm the fix with no layout regression at desktop/mobile.
- **What future agents/work must respect:** WORK-0030, WORK-0031, and WORK-0032 are all now verified-complete. Nothing across the three has been committed, pushed, or deployed -- that remains an explicit, separate, human-reviewed step. Do not re-open WORK-0030's button-tier question without a new decision superseding this one.
- **Status:** CONFIRMED, 2026-10-22.
