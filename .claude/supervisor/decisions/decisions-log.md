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
